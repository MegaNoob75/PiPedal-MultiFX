import { MFX_COLORS } from "./MultiFXTheme";

interface MultiFXSettingsHubProps {
    onController: () => void;
    onTheme: () => void;
    onMultiFXUI: () => void;
    onSystem: () => void;
}

export default function MultiFXSettingsHub({
    onController,
    onTheme,
    onMultiFXUI,
    onSystem
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
                border: `1px solid ${MFX_COLORS.border}`,
                background: MFX_COLORS.panel,
                color: MFX_COLORS.text,
                textAlign: "left",
                font: "inherit",
                cursor: "pointer"
            }}
        >
            <div
                style={{
                    color: MFX_COLORS.purpleLight,
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
                    color: MFX_COLORS.muted,
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
    background: MFX_COLORS.background,
    color: MFX_COLORS.text
};

const headerStyle: React.CSSProperties = {
    minHeight: "var(--mfx-header-height, 56px)",
    display: "flex",
    alignItems: "center",
    padding: "calc(6px * var(--mfx-ui-scale, 1)) calc(70px * var(--mfx-ui-scale, 1)) calc(6px * var(--mfx-ui-scale, 1)) calc(78px * var(--mfx-ui-scale, 1))",
    boxSizing: "border-box",
    borderBottom: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panel
};

const titleStyle: React.CSSProperties = {
    color: MFX_COLORS.purpleLight,
    fontWeight: 900,
    letterSpacing: "0.05em"
};

const subtitleStyle: React.CSSProperties = {
    marginTop: 2,
    color: MFX_COLORS.muted,
    fontSize: "0.72rem"
};
