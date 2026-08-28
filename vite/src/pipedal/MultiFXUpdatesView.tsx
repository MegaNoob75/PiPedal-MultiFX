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

export default function MultiFXUpdatesView() {
    const model = useMemo(() => PiPedalModelFactory.getInstance(), []);
    const [status, setStatus] = useState<UpdateStatus>(() => model.updateStatus.get());
    const [checking, setChecking] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [message, setMessage] = useState("");

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

    const release = status.getActiveRelease();
    const updateAvailable = status.isValid
        && status.isOnline
        && status.errorMessage === ""
        && release.updateAvailable;
    const upToDate = status.isValid
        && status.isOnline
        && status.errorMessage === ""
        && !release.updateAvailable;

    const installUpdate = async () => {
        const approved = window.confirm(
            "Install the official PiPedal update now?\n\n"
            + "PiPedal will install its complete server and stock interface. "
            + "Your MultiFX controller configuration, layout and runtime state will be kept, "
            + "but the MultiFX interface must be reinstalled after a compatible MultiFX release is available."
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

    return (
        <div style={screenStyle}>
            <div style={contentStyle}>
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
                        An update installs PiPedal’s complete official server and interface. MultiFX does not
                        hold the old PiPedal interface over the new release. MultiFX-owned controller settings,
                        layouts and runtime state are retained so they can be reused when MultiFX is installed again.
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
                    <div style={sectionTitleStyle}>REINSTALL MULTIFX LATER</div>
                    <div style={bodyStyle}>
                        After confirming that your MultiFX release supports the new PiPedal version, reinstall it
                        with the existing setup utility. Your saved MultiFX configuration will be reused.
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
