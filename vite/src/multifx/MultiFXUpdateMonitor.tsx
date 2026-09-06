import { useEffect, useRef, useState } from "react";
import {
    MULTIFX_UPDATE_STATUS_EVENT,
    MultiFXUpdateStatus,
    requestMultiFXUpdate
} from "./MultiFXUpdateClient";
import { MFX_COLORS, MFX_SURFACES, multiFXSurfaceBackground } from "./MultiFXTheme";

const IDLE_POLL_MS = 5000;
const ACTIVE_POLL_MS = 1000;
const RELOAD_DELAY_MS = 3500;
const COMPLETED_RELOAD_KEY = "pipedal-multifx-completed-update";

function updateIdentity(status: MultiFXUpdateStatus): string {
    return `${status.targetVersion || status.installedVersion}:${status.startedAt}`;
}

function refreshCompletedUpdate(identity: string): void {
    window.sessionStorage.setItem(COMPLETED_RELOAD_KEY, identity);
    window.location.reload();
}

export default function MultiFXUpdateMonitor() {
    const [status, setStatus] = useState<MultiFXUpdateStatus | null>(null);
    const [connectionLost, setConnectionLost] = useState(false);
    const [dismissedFailure, setDismissedFailure] = useState(false);
    const activeUpdateRef = useRef("");

    useEffect(() => {
        let stopped = false;
        let timer = 0;

        const acceptStatus = (next: MultiFXUpdateStatus) => {
            if (stopped) return;
            setStatus(next);
            setConnectionLost(false);
            if (next.jobState === "installing") {
                activeUpdateRef.current = updateIdentity(next);
                setDismissedFailure(false);
            } else if (
                next.jobState === "complete"
                && next.completedAt > 0
                && Date.now() / 1000 - next.completedAt < 600
                && window.sessionStorage.getItem(COMPLETED_RELOAD_KEY)
                    !== updateIdentity(next)
            ) {
                // A secondary browser may see the bridge go away and return
                // without ever observing the short-lived installing state.
                activeUpdateRef.current = updateIdentity(next);
            }
        };

        const poll = async () => {
            try {
                acceptStatus(await requestMultiFXUpdate("GET"));
            } catch {
                if (!stopped && activeUpdateRef.current) setConnectionLost(true);
            } finally {
                if (!stopped) {
                    timer = window.setTimeout(
                        () => void poll(),
                        activeUpdateRef.current ? ACTIVE_POLL_MS : IDLE_POLL_MS
                    );
                }
            }
        };

        const onStatus = (event: Event) => {
            const next = (event as CustomEvent<MultiFXUpdateStatus>).detail;
            if (next) acceptStatus(next);
        };
        window.addEventListener(MULTIFX_UPDATE_STATUS_EVENT, onStatus);
        void poll();
        return () => {
            stopped = true;
            window.clearTimeout(timer);
            window.removeEventListener(MULTIFX_UPDATE_STATUS_EVENT, onStatus);
        };
    }, []);

    const completedIdentity = status?.jobState === "complete"
        ? updateIdentity(status)
        : "";

    useEffect(() => {
        if (!completedIdentity || !activeUpdateRef.current) return;
        const identity = completedIdentity;
        if (identity !== activeUpdateRef.current
            || window.sessionStorage.getItem(COMPLETED_RELOAD_KEY) === identity) {
            return;
        }
        const timer = window.setTimeout(
            () => refreshCompletedUpdate(identity), RELOAD_DELAY_MS
        );
        return () => window.clearTimeout(timer);
        // Polls replace the status object every second. Only a different job
        // may cancel this timer, not another status response for the same job.
    }, [completedIdentity]);

    const updateWasSeen = Boolean(activeUpdateRef.current);
    const visible = updateWasSeen && Boolean(status) && (
        status!.jobState === "installing"
        || status!.jobState === "complete"
        || (status!.jobState === "failed" && !dismissedFailure)
        || connectionLost
    );
    if (!visible || !status) return null;

    const complete = status.jobState === "complete";
    const failed = status.jobState === "failed";
    const title = complete
        ? "PI-MULTIFX UPDATE COMPLETE"
        : failed
            ? "PI-MULTIFX UPDATE FAILED"
            : "UPDATING PI-MULTIFX";
    const message = complete
        ? `${status.message} Refreshing this screen...`
        : failed
            ? status.message
            : connectionLost
                ? "The controller service is restarting. Waiting for it to come back online..."
                : status.message || "Installing the update...";

    return (
        <div role="status" aria-live="polite" style={backdropStyle}>
            <div style={panelStyle}>
                <div style={{ ...titleStyle, color: failed ? MFX_COLORS.danger : MFX_COLORS.cyan }}>
                    {title}
                </div>
                {!complete && !failed && <div style={progressBarStyle}><div style={progressFillStyle} /></div>}
                <div style={messageStyle}>{message}</div>
                {status.progressMessages.length > 0 && (
                    <div style={logStyle}>
                        {status.progressMessages.map((line, index) => (
                            <div key={`${index}-${line}`}>{line}</div>
                        ))}
                    </div>
                )}
                {complete && (
                    <button type="button" onClick={() => refreshCompletedUpdate(updateIdentity(status))} style={buttonStyle}>
                        REFRESH NOW
                    </button>
                )}
                {failed && (
                    <button type="button" onClick={() => {
                        activeUpdateRef.current = "";
                        setDismissedFailure(true);
                    }} style={buttonStyle}>
                        CLOSE
                    </button>
                )}
            </div>
        </div>
    );
}

const backdropStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 100000,
    display: "grid",
    placeItems: "center",
    padding: 20,
    background: "rgba(0, 0, 0, 0.72)"
};

const panelStyle: React.CSSProperties = {
    width: "min(620px, 100%)",
    maxHeight: "min(520px, 90vh)",
    overflowY: "auto",
    boxSizing: "border-box",
    padding: 22,
    borderRadius: 14,
    border: `1px solid ${MFX_SURFACES.panel.border}`,
    background: multiFXSurfaceBackground("panel"),
    color: MFX_SURFACES.panel.text,
    boxShadow: "0 18px 60px rgba(0, 0, 0, 0.65)"
};

const titleStyle: React.CSSProperties = {
    fontWeight: 900,
    letterSpacing: "0.06em"
};

const progressBarStyle: React.CSSProperties = {
    height: 6,
    marginTop: 16,
    borderRadius: 999,
    overflow: "hidden",
    background: MFX_COLORS.panelAlt
};

const progressFillStyle: React.CSSProperties = {
    width: "70%",
    height: "100%",
    borderRadius: 999,
    background: MFX_COLORS.cyan,
    animation: "mfx-update-progress 1.2s ease-in-out infinite alternate"
};

const messageStyle: React.CSSProperties = {
    marginTop: 16,
    fontWeight: 800,
    lineHeight: 1.45
};

const logStyle: React.CSSProperties = {
    marginTop: 14,
    padding: 12,
    borderRadius: 8,
    background: MFX_COLORS.panelAlt,
    color: MFX_SURFACES.panel.label,
    fontFamily: "monospace",
    fontSize: "0.8rem",
    lineHeight: 1.45,
    overflowWrap: "anywhere"
};

const buttonStyle: React.CSSProperties = {
    display: "block",
    minHeight: 42,
    margin: "18px 0 0 auto",
    padding: "0 18px",
    borderRadius: 8,
    border: `1px solid ${MFX_SURFACES.panel.border}`,
    background: MFX_COLORS.panelAlt,
    color: MFX_COLORS.text,
    font: "inherit",
    fontWeight: 900,
    cursor: "pointer"
};
