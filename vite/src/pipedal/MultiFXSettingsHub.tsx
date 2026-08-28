import {
    MFX_COLORS,
    MFX_SURFACES,
    multiFXSurfaceBackground
} from "./MultiFXTheme";

interface MultiFXSettingsHubProps {
    onController: () => void;
    onTheme: () => void;
    onMultiFXUI: () => void;
    onSystem: () => void;
    onUpdates: () => void;
}

export default function MultiFXSettingsHub({
    onController,
    onTheme,
    onMultiFXUI,
    onSystem,
    onUpdates
}: MultiFXSettingsHubProps) {
    return (
        <div style={screenStyle}>
            <div style={headerStyle}>
                <div>
                    <div style={titleStyle}>MULTIFX SETTINGS</div>
                    <div style={subtitleStyle}>
                        Configure MultiFX without editing files
                    </div>
                </div>
            </div>

            <div
                style={{
                    flex: "1 1 auto",
                    minHeight: 0,
                    overflowY: "auto",
                    padding: "calc(16px * var(--mfx-ui-scale, 1))",
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: "calc(12px * var(--mfx-ui-scale, 1))",
                    alignContent: "start"
                }}
            >
                <SettingsCard
                    title="CONTROLLER"
                    description="Switch layout, hardware inputs and actions"
                    onClick={onController}
                />
                <SettingsCard
                    title="THEME"
                    description="Built-in themes, custom colors, import and export"
                    onClick={onTheme}
                />
                <SettingsCard
                    title="MULTIFX-UI"
                    description="MultiFX behavior, backup, restore and interface options"
                    onClick={onMultiFXUI}
                />
                <SettingsCard
                    title="PIPEDAL / SYSTEM"
                    description="Audio, MIDI, Wi-Fi, routing and PiPedal system settings"
                    onClick={onSystem}
                />
                <SettingsCard
                    title="UPDATES"
                    description="Check for and install official PiPedal updates"
                    onClick={onUpdates}
                />
            </div>
        </div>
    );
}

function SettingsCard({
    title,
    description,
    onClick
}: {
    title: string;
    description: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                minHeight: "calc(118px * var(--mfx-ui-scale, 1))",
                padding: "calc(16px * var(--mfx-ui-scale, 1))",
                borderRadius: 14,
                border: "1px solid transparent",
                background: multiFXSurfaceBackground("panel"),
                color: MFX_SURFACES.panel.text,
                boxShadow: MFX_SURFACES.panel.shadow,
                textAlign: "left",
                font: "inherit",
                cursor: "pointer"
            }}
        >
            <div
                style={{
                    color: MFX_SURFACES.panel.accent,
                    fontSize: "1.1rem",
                    fontWeight: 900,
                    letterSpacing: "0.04em"
                }}
            >
                {title}
            </div>
            <div
                style={{
                    marginTop: 8,
                    color: MFX_SURFACES.panel.label,
                    lineHeight: 1.4
                }}
            >
                {description}
            </div>
        </button>
    );
}

const screenStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: MFX_SURFACES.page.background,
    color: MFX_SURFACES.page.text
};

const headerStyle: React.CSSProperties = {
    minHeight: "var(--mfx-header-height, 56px)",
    display: "flex",
    alignItems: "center",
    padding: "calc(6px * var(--mfx-ui-scale, 1)) calc(70px * var(--mfx-ui-scale, 1)) calc(6px * var(--mfx-ui-scale, 1)) calc(78px * var(--mfx-ui-scale, 1))",
    boxSizing: "border-box",
    borderBottom: `1px solid ${MFX_COLORS.border}`,
    background: MFX_SURFACES.header.background,
    color: MFX_SURFACES.header.text,
    boxShadow: MFX_SURFACES.header.shadow
};

const titleStyle: React.CSSProperties = {
    color: MFX_SURFACES.header.accent,
    fontWeight: 900,
    letterSpacing: "0.05em"
};

const subtitleStyle: React.CSSProperties = {
    marginTop: 2,
    color: MFX_SURFACES.header.label,
    fontSize: "0.72rem"
};
