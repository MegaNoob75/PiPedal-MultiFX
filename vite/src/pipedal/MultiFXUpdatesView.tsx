import { useCallback, useEffect, useMemo, useState } from "react";
import { PiPedalModelFactory } from "./PiPedalModel";
import { UpdateStatus } from "./Updater";
import {
    MFX_COLORS,
    MFX_SURFACES,
    multiFXSurfaceBackground
} from "./MultiFXTheme";

const UPDATE_CHECK_TIMEOUT_MS = 15000;
const REINSTALL_COMMAND = "sudo pipedal-multifx-setup multifx";
const MULTIFX_UPDATE_POLL_MS = 2000;
const MULTIFX_COMPLETED_RELOAD_KEY = "pipedal-multifx-completed-reload";

type MultiFXUpdateJobState = "idle" | "installing" | "complete" | "failed";

interface MultiFXUpdateStatus {
    installedVersion: string;
    latestVersion: string;
    latestName: string;
    releaseUrl: string;
    updateAvailable: boolean;
    jobState: MultiFXUpdateJobState;
    message: string;
    error: string;
}

function multiFXUpdateUrl(refresh = false): string {
    const hostname = window.location.hostname.includes(":")
        ? `[${window.location.hostname}]`
        : window.location.hostname;
    return `http://${hostname}:8877/multifx-update${refresh ? "?refresh=1" : ""}`;
}

function normalizeMultiFXUpdateStatus(value: unknown): MultiFXUpdateStatus {
    const source = value && typeof value === "object"
        ? value as Record<string, unknown>
        : {};
    const rawJobState = source.jobState;
    const jobState: MultiFXUpdateJobState = rawJobState === "installing"
        || rawJobState === "complete"
        || rawJobState === "failed"
        ? rawJobState
        : "idle";
    const text = (key: string) => typeof source[key] === "string"
        ? source[key] as string
        : "";
    return {
        installedVersion: text("installedVersion"),
        latestVersion: text("latestVersion"),
        latestName: text("latestName"),
        releaseUrl: text("releaseUrl"),
        updateAvailable: source.updateAvailable === true,
        jobState,
        message: text("message"),
        error: text("error")
    };
}

async function requestMultiFXUpdate(
    method: "GET" | "POST",
    refresh = false
): Promise<MultiFXUpdateStatus> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetch(multiFXUpdateUrl(refresh), {
            method,
            cache: "no-store",
            headers: method === "POST"
                ? { "Content-Type": "application/json" }
                : undefined,
            body: method === "POST"
                ? JSON.stringify({ action: "installLatest" })
                : undefined,
            signal: controller.signal
        });
        const payload = await response.json() as unknown;
        if (!response.ok) {
            const detail = payload && typeof payload === "object"
                && typeof (payload as Record<string, unknown>).error === "string"
                ? (payload as Record<string, string>).error
                : `HTTP ${response.status}`;
            throw new Error(detail);
        }
        return normalizeMultiFXUpdateStatus(payload);
    } finally {
        window.clearTimeout(timer);
    }
}

interface MultiFXUpdatesViewProps {
    onClose?: () => void;
}

export default function MultiFXUpdatesView({ onClose }: MultiFXUpdatesViewProps) {
    const model = useMemo(() => PiPedalModelFactory.getInstance(), []);
    const [status, setStatus] = useState<UpdateStatus>(() => model.updateStatus.get());
    const [checking, setChecking] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [message, setMessage] = useState("");
    const [multiFXStatus, setMultiFXStatus] =
        useState<MultiFXUpdateStatus | null>(null);
    const [multiFXChecking, setMultiFXChecking] = useState(false);
    const [multiFXInstalling, setMultiFXInstalling] = useState(false);
    const [multiFXMessage, setMultiFXMessage] = useState("");

    const checkForUpdates = useCallback(() => {
        setMessage("");
        setChecking(true);
        model.forceUpdateCheck();
        window.setTimeout(() => {
            setStatus(model.updateStatus.get());
            setChecking(false);
        }, UPDATE_CHECK_TIMEOUT_MS);
    }, [model]);

    useEffect(() => {
        const onChanged = (next: UpdateStatus) => {
            setStatus(next);
            setChecking(false);
        };
        model.updateStatus.addOnChangedHandler(onChanged);
        checkForUpdates();
        return () => model.updateStatus.removeOnChangedHandler(onChanged);
    }, [checkForUpdates, model]);

    const checkMultiFXUpdates = useCallback(async (refresh = true) => {
        setMultiFXChecking(true);
        setMultiFXMessage("");
        try {
            const next = await requestMultiFXUpdate("GET", refresh);
            setMultiFXStatus(next);
            setMultiFXInstalling(next.jobState === "installing");
        } catch (error) {
            setMultiFXMessage(
                `PI-MULTIFX update check failed: ${String(error)}`
            );
        } finally {
            setMultiFXChecking(false);
        }
    }, []);

    useEffect(() => {
        void checkMultiFXUpdates(true);
    }, [checkMultiFXUpdates]);

    useEffect(() => {
        if (!multiFXInstalling) return;
        let stopped = false;
        const poll = async () => {
            try {
                const next = await requestMultiFXUpdate("GET");
                if (stopped) return;
                setMultiFXStatus(next);
                if (next.jobState !== "installing") {
                    setMultiFXInstalling(false);
                    setMultiFXMessage(next.message);
                }
            } catch {
                // The bridge and PiPedal restart during a successful update.
                // Keep polling until the new service is available.
            }
        };
        const timer = window.setInterval(
            () => void poll(),
            MULTIFX_UPDATE_POLL_MS
        );
        void poll();
        return () => {
            stopped = true;
            window.clearInterval(timer);
        };
    }, [multiFXInstalling]);

    useEffect(() => {
        if (multiFXStatus?.jobState !== "complete") return;
        const completedVersion = multiFXStatus.installedVersion;
        if (completedVersion
            && window.sessionStorage.getItem(MULTIFX_COMPLETED_RELOAD_KEY)
                === completedVersion) {
            return;
        }
        const timer = window.setTimeout(
            () => {
                if (completedVersion) {
                    window.sessionStorage.setItem(
                        MULTIFX_COMPLETED_RELOAD_KEY,
                        completedVersion
                    );
                }
                window.location.reload();
            },
            2500
        );
        return () => window.clearTimeout(timer);
    }, [multiFXStatus?.installedVersion, multiFXStatus?.jobState]);

    const release = status.getActiveRelease();
    const updateAvailable = status.isValid
        && status.isOnline
        && status.errorMessage === ""
        && release.updateAvailable;
    const upToDate = status.isValid
        && status.isOnline
        && status.errorMessage === ""
        && !release.updateAvailable;
    const multiFXUpToDate = Boolean(
        multiFXStatus
        && !multiFXStatus.error
        && multiFXStatus.installedVersion
        && multiFXStatus.latestVersion
        && !multiFXStatus.updateAvailable
        && multiFXStatus.jobState === "idle"
    );

    const installUpdate = async () => {
        const approved = window.confirm(
            "Install the official PiPedal update now?\n\n"
            + "PiPedal will install its complete server and stock interface. "
            + "Your PI-MULTIFX controller configuration, layout and runtime state will be kept, "
            + "but the PI-MULTIFX interface must be reinstalled after a compatible PI-MULTIFX release is available."
        );
        if (!approved) return;
        setInstalling(true);
        setMessage("PiPedal is downloading and installing the official update...");
        try {
            await model.updateNow();
        } catch (error) {
            setInstalling(false);
            setMessage(`PiPedal update failed: ${String(error)}`);
        }
    };

    const installMultiFXUpdate = async () => {
        const target = multiFXStatus?.latestVersion || "the latest release";
        const approved = window.confirm(
            `Install PI-MULTIFX ${target} now?\n\n`
            + "The verified release package will be installed using the existing setup utility. "
            + "PiPedal audio settings, presets and saved PI-MULTIFX configuration will be kept. "
            + "The interface and controller service will restart during installation."
        );
        if (!approved) return;
        setMultiFXInstalling(true);
        setMultiFXMessage(`Starting PI-MULTIFX ${target} installation...`);
        try {
            const next = await requestMultiFXUpdate("POST");
            setMultiFXStatus(next);
            setMultiFXMessage(next.message);
        } catch (error) {
            setMultiFXInstalling(false);
            setMultiFXMessage(
                `PI-MULTIFX update could not start: ${String(error)}`
            );
        }
    };

    return (
        <div style={screenStyle}>
            <div style={contentStyle}>
                <div style={pageHeaderStyle}>
                    <div style={pageTitleStyle}>UPDATES</div>
                    {onClose && (
                        <button type="button" onClick={onClose} style={normalButtonStyle}>
                            BACK TO SYSTEM SETTINGS
                        </button>
                    )}
                </div>
                <section style={panelStyle}>
                    <div style={sectionTitleStyle}>PIPEDAL UPDATE</div>
                    <div style={versionGridStyle}>
                        <span style={labelStyle}>Installed</span>
                        <span>{status.currentVersionDisplayName || "Unknown"}</span>
                        {updateAvailable && (
                            <>
                                <span style={labelStyle}>Available</span>
                                <span>{release.upgradeVersionDisplayName || "New release"}</span>
                            </>
                        )}
                    </div>

                    <div style={statusStyle}>
                        {checking && "Checking for PiPedal updates..."}
                        {!checking && upToDate && "PiPedal is up to date."}
                        {!checking && updateAvailable && "A PiPedal update is available."}
                        {!checking && status.errorMessage && `Update check failed: ${status.errorMessage}`}
                        {!checking && !upToDate && !updateAvailable && !status.errorMessage
                            && (status.isOnline
                                ? "PiPedal did not return a valid update result."
                                : "PiPedal could not reach the update service.")}
                    </div>

                    <div style={warningStyle}>
                        An update installs PiPedal’s complete official server and interface. PI-MULTIFX does not
                        hold the old PiPedal interface over the new release. PI-MULTIFX-owned controller settings,
                        layouts and runtime state are retained so they can be reused when PI-MULTIFX is installed again.
                    </div>

                    <div style={actionsStyle}>
                        <button type="button" disabled={checking || installing}
                            onClick={checkForUpdates} style={normalButtonStyle}>
                            {checking ? "CHECKING..." : "CHECK AGAIN"}
                        </button>
                        {updateAvailable && (
                            <button type="button" disabled={installing}
                                onClick={() => void installUpdate()} style={accentButtonStyle}>
                                {installing ? "INSTALLING..." : "INSTALL OFFICIAL UPDATE"}
                            </button>
                        )}
                    </div>
                    {message && <div style={messageStyle}>{message}</div>}
                </section>

                <section style={panelStyle}>
                    <div style={sectionTitleStyle}>PI-MULTIFX UPDATE</div>
                    <div style={versionGridStyle}>
                        <span style={labelStyle}>Installed</span>
                        <span>
                            {multiFXStatus?.installedVersion || "Unknown"}
                        </span>
                        {multiFXStatus?.latestVersion && (
                            <>
                                <span style={labelStyle}>Latest</span>
                                <span>{multiFXStatus.latestVersion}</span>
                            </>
                        )}
                    </div>

                    <div style={statusStyle}>
                        {multiFXChecking && "Checking for PI-MULTIFX updates..."}
                        {!multiFXChecking && multiFXInstalling
                            && (multiFXStatus?.message || "Installing the PI-MULTIFX update...")}
                        {!multiFXChecking && !multiFXInstalling
                            && multiFXStatus?.updateAvailable
                            && `PI-MULTIFX ${multiFXStatus.latestVersion} is available.`}
                        {!multiFXChecking && !multiFXInstalling && multiFXUpToDate
                            && "PI-MULTIFX is up to date."}
                        {!multiFXChecking && !multiFXInstalling
                            && multiFXStatus?.jobState === "complete"
                            && `${multiFXStatus.message} Reloading the interface...`}
                        {!multiFXChecking && !multiFXInstalling
                            && multiFXStatus?.jobState === "failed"
                            && multiFXStatus.message}
                        {!multiFXChecking && !multiFXInstalling
                            && multiFXStatus?.error
                            && multiFXStatus.error}
                        {!multiFXChecking && !multiFXInstalling
                            && multiFXStatus?.jobState === "idle"
                            && !multiFXStatus.updateAvailable
                            && !multiFXUpToDate
                            && !multiFXStatus.error
                            && multiFXStatus.message}
                    </div>

                    <div style={{ ...bodyStyle, marginTop: 16 }}>
                        PI-MULTIFX updates use the existing verified setup utility.
                        Release checks require a Raspberry Pi package and matching
                        SHA-256 checksum before an update is offered.
                    </div>

                    <div style={actionsStyle}>
                        <button
                            type="button"
                            disabled={multiFXChecking || multiFXInstalling}
                            onClick={() => void checkMultiFXUpdates(true)}
                            style={normalButtonStyle}
                        >
                            {multiFXChecking ? "CHECKING..." : "CHECK AGAIN"}
                        </button>
                        {multiFXStatus?.updateAvailable && (
                            <button
                                type="button"
                                disabled={multiFXChecking || multiFXInstalling}
                                onClick={() => void installMultiFXUpdate()}
                                style={accentButtonStyle}
                            >
                                {multiFXInstalling
                                    ? "INSTALLING..."
                                    : "INSTALL PI-MULTIFX UPDATE"}
                            </button>
                        )}
                    </div>
                    {multiFXMessage && (
                        <div style={messageStyle}>{multiFXMessage}</div>
                    )}
                </section>

                <section style={panelStyle}>
                    <div style={sectionTitleStyle}>COMMAND-LINE RECOVERY</div>
                    <div style={bodyStyle}>
                        If an update cannot be started from this screen, reinstall
                        PI-MULTIFX with the existing setup utility. Saved
                        configuration will be reused.
                    </div>
                    <pre style={commandStyle}>{REINSTALL_COMMAND}</pre>
                </section>
            </div>
        </div>
    );
}

const screenStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    overflowY: "auto",
    padding: "calc(16px * var(--mfx-ui-scale, 1))",
    boxSizing: "border-box",
    background: MFX_SURFACES.page.background,
    color: MFX_SURFACES.page.text
};

const contentStyle: React.CSSProperties = {
    width: "min(760px, 100%)",
    margin: "0 auto",
    display: "grid",
    gap: 14
};

const pageHeaderStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10
};

const pageTitleStyle: React.CSSProperties = {
    color: MFX_SURFACES.page.accent,
    fontWeight: 900,
    letterSpacing: "0.06em",
    fontSize: "1.1rem"
};

const panelStyle: React.CSSProperties = {
    padding: 18,
    borderRadius: 14,
    border: `1px solid ${MFX_SURFACES.panel.border}`,
    background: multiFXSurfaceBackground("panel"),
    boxShadow: MFX_SURFACES.panel.shadow
};

const sectionTitleStyle: React.CSSProperties = {
    color: MFX_SURFACES.panel.accent,
    fontWeight: 900,
    letterSpacing: "0.05em",
    marginBottom: 14
};

const versionGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "minmax(90px, auto) 1fr",
    gap: "7px 14px"
};

const labelStyle: React.CSSProperties = { color: MFX_SURFACES.panel.label };
const statusStyle: React.CSSProperties = { marginTop: 16, fontWeight: 800 };
const bodyStyle: React.CSSProperties = { color: MFX_SURFACES.panel.label, lineHeight: 1.5 };

const warningStyle: React.CSSProperties = {
    ...bodyStyle,
    marginTop: 16,
    padding: 12,
    border: `1px solid ${MFX_COLORS.danger}`,
    borderRadius: 9
};

const actionsStyle: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 16
};

const buttonBaseStyle: React.CSSProperties = {
    minHeight: 42,
    padding: "0 16px",
    borderRadius: 8,
    font: "inherit",
    fontWeight: 900,
    cursor: "pointer"
};

const normalButtonStyle: React.CSSProperties = {
    ...buttonBaseStyle,
    border: `1px solid ${MFX_SURFACES.panel.border}`,
    background: MFX_COLORS.panelAlt,
    color: MFX_COLORS.text
};

const accentButtonStyle: React.CSSProperties = {
    ...buttonBaseStyle,
    border: `1px solid ${MFX_COLORS.cyan}`,
    background: MFX_COLORS.cyanSurface,
    color: MFX_COLORS.cyanText
};

const messageStyle: React.CSSProperties = { marginTop: 14, color: MFX_SURFACES.panel.label };

const commandStyle: React.CSSProperties = {
    margin: "14px 0 0",
    padding: 12,
    overflowX: "auto",
    userSelect: "text",
    background: MFX_COLORS.panelAlt,
    color: MFX_COLORS.text,
    borderRadius: 8
};
