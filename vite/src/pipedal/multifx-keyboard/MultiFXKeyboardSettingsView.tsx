import { useEffect, useState } from "react";
import {
    DEFAULT_MULTIFX_KEYBOARD_SETTINGS,
    loadMultiFXKeyboardSettings,
    MultiFXKeyboardKeyShape,
    MultiFXKeyboardMode,
    MultiFXKeyboardPlacement,
    MultiFXKeyboardSettings,
    MultiFXKeyboardSize,
    MultiFXKeyboardTextSize,
    MULTIFX_KEYBOARD_SETTINGS_CHANGED_EVENT,
    saveMultiFXKeyboardSettings
} from "./MultiFXKeyboardMode";
import {
    BUILT_IN_THEMES,
    loadCustomMultiFXThemes,
    MFX_COLORS,
    MFX_SURFACES,
    multiFXSurfaceBackground,
    themePaintToCss
} from "../MultiFXTheme";
import {
    loadCustomMultiFXKeyboardThemes,
    MultiFXKeyboardThemeDefinition,
    resolveMultiFXKeyboardTheme
} from "./MultiFXKeyboardTheme";
import { syncMultiFXKeyboard } from "../MultiFXRuntimeSync";

export default function MultiFXKeyboardSettingsView() {
    const [settings, setSettingsState] = useState<MultiFXKeyboardSettings>(
        loadMultiFXKeyboardSettings
    );
    const [message, setMessage] = useState("");
    const [syncing, setSyncing] = useState(false);
    const customThemes = loadCustomMultiFXThemes();
    const keyboardThemes = loadCustomMultiFXKeyboardThemes();
    const previewTheme = resolveMultiFXKeyboardTheme(settings.themeId);

    useEffect(() => {
        const changed = () => setSettingsState(loadMultiFXKeyboardSettings());
        window.addEventListener(MULTIFX_KEYBOARD_SETTINGS_CHANGED_EVENT, changed);
        return () => window.removeEventListener(MULTIFX_KEYBOARD_SETTINGS_CHANGED_EVENT, changed);
    }, []);

    const setSettings = (
        update: MultiFXKeyboardSettings
            | ((current: MultiFXKeyboardSettings) => MultiFXKeyboardSettings)
    ) => {
        const next = typeof update === "function" ? update(settings) : update;
        saveMultiFXKeyboardSettings(next);
        setSettingsState(next);
        setMessage("Applied. The next keyboard opened will use these settings.");
    };

    const apply = (next: MultiFXKeyboardSettings, restored = false) => {
        saveMultiFXKeyboardSettings(next);
        setSettingsState(next);
        setMessage(restored
            ? "Keyboard defaults restored."
            : "Keyboard settings saved. They apply the next time a field is selected.");
    };

    const syncKeyboard = async () => {
        if (syncing) return;
        setSyncing(true);
        setMessage("Syncing keyboard to the Pi...");
        try {
            await syncMultiFXKeyboard(settings, previewTheme);
            setMessage("Keyboard theme and settings synced to the Pi.");
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            setMessage(`Keyboard sync failed: ${detail}`);
        } finally {
            setSyncing(false);
        }
    };

    return (
        <div style={screenStyle}>
            <div style={contentStyle}>
                <div style={titleStyle}>ON-SCREEN KEYBOARD</div>
                <div style={descriptionStyle}>
                    Choose which keyboard opens when an editable field is selected.
                </div>
                <section style={panelStyle}>
                    <label style={rowStyle}>
                        <span>Keyboard mode</span>
                        <select value={settings.mode}
                            onChange={(event) => setSettings((current) => ({
                                ...current,
                                mode: event.target.value as MultiFXKeyboardMode
                            }))}
                            style={selectStyle}>
                            <option value="auto">Auto</option>
                            <option value="multifx">MultiFX Keyboard</option>
                            <option value="system">System Keyboard</option>
                            <option value="off">Off</option>
                        </select>
                    </label>
                    <div style={hintStyle}>
                        Auto uses the MultiFX keyboard on the local Pi touchscreen,
                        native keyboards on phones/tablets, and no virtual keyboard
                        on normal desktop browsers.
                    </div>
                    <label style={rowStyle}>
                        <span>Keyboard theme</span>
                        <select value={settings.themeId}
                            onChange={(event) => setSettings((current) => ({
                                ...current,
                                themeId: event.target.value
                            }))} style={selectStyle}>
                            <option value="current">Match Current UI Theme</option>
                            <optgroup label="BUILT-IN THEMES">
                                {BUILT_IN_THEMES.map((theme) => (
                                    <option key={theme.name} value={`builtin:${theme.name}`}>
                                        {theme.name}
                                    </option>
                                ))}
                            </optgroup>
                            {customThemes.length > 0 && (
                                <optgroup label="MY THEMES">
                                    {customThemes.map((theme) => (
                                    <option key={theme.name} value={`ui-custom:${theme.name}`}>
                                            {theme.name}
                                        </option>
                                    ))}
                                </optgroup>
                            )}
                            {keyboardThemes.length > 0 && (
                                <optgroup label="CUSTOM KEYBOARD THEMES">
                                    {keyboardThemes.map((theme) => (
                                        <option key={theme.name} value={`keyboard:${theme.name}`}>
                                            {theme.name}
                                        </option>
                                    ))}
                                </optgroup>
                            )}
                        </select>
                    </label>
                    <div style={inlineActionStyle}>
                        <button type="button" style={normalButtonStyle}
                            onClick={() => setSettings((current) => ({
                                ...current,
                                themeId: "current"
                            }))}>
                            USE CURRENT UI THEME
                        </button>
                    </div>
                    <div style={hintStyle}>
                        Keyboard colors come from the selected Theme Editor theme.
                        New built-in and user-created themes appear here automatically.
                    </div>
                    <KeyboardSettingsPreview settings={settings} theme={previewTheme} />
                    <label style={rowStyle}>
                        <span>Key shape</span>
                        <select value={settings.keyShape}
                            onChange={(event) => setSettings((current) => ({
                                ...current,
                                keyShape: event.target.value as MultiFXKeyboardKeyShape
                            }))} style={selectStyle}>
                            <option value="rounded">Rounded</option>
                            <option value="square">Square</option>
                        </select>
                    </label>
                    <label style={rowStyle}>
                        <span>Key text size</span>
                        <select value={settings.textSize}
                            onChange={(event) => setSettings((current) => ({
                                ...current,
                                textSize: event.target.value as MultiFXKeyboardTextSize
                            }))} style={selectStyle}>
                            <option value="normal">Normal</option>
                            <option value="large">Large</option>
                            <option value="extra-large">Extra Large</option>
                        </select>
                    </label>
                    <label style={rowStyle}>
                        <span>Keyboard size</span>
                        <select value={settings.size}
                            onChange={(event) => setSettings((current) => ({
                                ...current,
                                size: event.target.value as MultiFXKeyboardSize
                            }))} style={selectStyle}>
                            <option value="full">Full Screen</option>
                            <option value="large">Large — 85%</option>
                            <option value="compact">Compact — 72%</option>
                        </select>
                    </label>
                    <label style={rowStyle}>
                        <span>Keyboard placement</span>
                        <select value={settings.placement}
                            onChange={(event) => setSettings((current) => ({
                                ...current,
                                placement: event.target.value as MultiFXKeyboardPlacement
                            }))} style={selectStyle}>
                            <option value="top">Top</option>
                            <option value="center">Center</option>
                            <option value="bottom">Bottom</option>
                        </select>
                    </label>
                    <div style={hintStyle}>
                        Placement is most noticeable with the Large and Compact sizes.
                        Full Screen remains the safest choice for the 1024×600 Pi display.
                    </div>
                    <label style={checkRowStyle}>
                        <input type="checkbox" checked={settings.hapticFeedback}
                            onChange={(event) => setSettings((current) => ({
                                ...current,
                                hapticFeedback: event.target.checked
                            }))} />
                        <span>
                            <strong>Touch vibration</strong>
                            <span style={hintStyle}>Vibrate briefly after a key press when the touchscreen browser supports it.</span>
                        </span>
                    </label>
                    <label style={checkRowStyle}>
                        <input type="checkbox"
                            checked={settings.transparentBackground}
                            onChange={(event) => setSettings((current) => ({
                                ...current,
                                transparentBackground: event.target.checked
                            }))} />
                        <span>
                            <strong>Transparent keyboard background</strong>
                            <span style={hintStyle}>
                                Experimental. The overlay and panel become transparent;
                                the value display and keys remain opaque.
                            </span>
                        </span>
                    </label>
                </section>
                <div style={actionsStyle}>
                    <button type="button" style={normalButtonStyle}
                        onClick={() => apply({ ...DEFAULT_MULTIFX_KEYBOARD_SETTINGS }, true)}>
                        RESTORE DEFAULTS
                    </button>
                    <button type="button" style={accentButtonStyle}
                        disabled={syncing} onClick={() => void syncKeyboard()}>
                        {syncing ? "SYNCING..." : "SYNC KEYBOARD"}
                    </button>
                </div>
                {message && <div style={messageStyle}>{message}</div>}
            </div>
        </div>
    );
}

function KeyboardSettingsPreview({
    settings,
    theme
}: {
    settings: MultiFXKeyboardSettings;
    theme: MultiFXKeyboardThemeDefinition;
}) {
    const dimensions = settings.size === "full"
        ? { width: "100%", height: 238 }
        : settings.size === "large"
            ? { width: "92%", height: 200 }
            : { width: "80%", height: 164 };
    const alignItems = settings.placement === "top"
        ? "flex-start" : settings.placement === "bottom" ? "flex-end" : "center";
    const radius = settings.keyShape === "square" ? 2 : 8;
    const fontSize = settings.textSize === "extra-large"
        ? 20 : settings.textSize === "large" ? 17 : 14;
    const keyStyle = (pressed = false): React.CSSProperties => ({
        minWidth: 0,
        flex: "1 1 0",
        padding: "8px 3px",
        borderRadius: radius,
        border: `1px solid ${theme.border}`,
        background: themePaintToCss(pressed ? theme.pressedKey : theme.key),
        color: pressed ? theme.pressedText : theme.text,
        fontWeight: 900,
        fontSize
    });
    return (
        <section style={previewCardStyle}>
            <div style={previewTitleStyle}>LIVE KEYBOARD PREVIEW — {theme.name}</div>
            <div style={{
                height: 250,
                padding: 8,
                boxSizing: "border-box",
                display: "flex",
                justifyContent: "center",
                alignItems,
                overflow: "hidden",
                borderRadius: 10,
                border: `1px solid ${theme.border}`,
                background: settings.transparentBackground
                    ? "transparent" : themePaintToCss(theme.backdrop)
            }}>
                <div style={{
                    ...dimensions,
                    minHeight: 0,
                    padding: 10,
                    boxSizing: "border-box",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    borderRadius: settings.keyShape === "square" ? 2 : 10,
                    border: settings.transparentBackground ? "none" : `2px solid ${theme.border}`,
                    background: settings.transparentBackground
                        ? "transparent" : themePaintToCss(theme.panel)
                }}>
                    <div style={{ color: theme.accent, fontWeight: 900 }}>PRESET NAME</div>
                    <div style={{ padding: 7, borderRadius: radius, border: `2px solid ${theme.accent}`, background: themePaintToCss(theme.valueBox), color: theme.text }}>
                        My Preset
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                        <div style={keyStyle()}>A</div>
                        <div style={keyStyle(true)}>B</div>
                        <div style={{ ...keyStyle(), color: theme.cancel }}>CANCEL</div>
                        <div style={{ ...keyStyle(), color: theme.accent }}>DONE</div>
                    </div>
                </div>
            </div>
        </section>
    );
}

const screenStyle: React.CSSProperties = { position: "absolute", inset: 0, overflowY: "auto", background: MFX_SURFACES.page.background, color: MFX_SURFACES.page.text };
const contentStyle: React.CSSProperties = { maxWidth: 780, margin: "0 auto", padding: "calc(22px * var(--mfx-ui-scale, 1))" };
const titleStyle: React.CSSProperties = { color: MFX_SURFACES.header.accent, fontWeight: 900, fontSize: "1.3rem", letterSpacing: "0.05em" };
const descriptionStyle: React.CSSProperties = { color: MFX_SURFACES.page.label, marginTop: 6, marginBottom: 18 };
const panelStyle: React.CSSProperties = { padding: 18, borderRadius: 14, background: multiFXSurfaceBackground("panel"), boxShadow: MFX_SURFACES.panel.shadow };
const rowStyle: React.CSSProperties = { minHeight: 54, display: "grid", gridTemplateColumns: "minmax(160px, 1fr) minmax(220px, 1fr)", gap: 16, alignItems: "center" };
const selectStyle: React.CSSProperties = { width: "100%", minHeight: 42, padding: "6px 10px", borderRadius: 8, border: `1px solid ${MFX_COLORS.border}`, background: MFX_SURFACES.popup.background, color: MFX_SURFACES.popup.text, font: "inherit" };
const checkRowStyle: React.CSSProperties = { display: "flex", gap: 12, alignItems: "flex-start", paddingTop: 18, marginTop: 14, borderTop: `1px solid ${MFX_COLORS.border}`, cursor: "pointer" };
const hintStyle: React.CSSProperties = { display: "block", marginTop: 5, color: MFX_SURFACES.panel.label, fontWeight: 400, lineHeight: 1.4 };
const actionsStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 18, flexWrap: "wrap" };
const inlineActionStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", marginTop: 8 };
const normalButtonStyle: React.CSSProperties = { minHeight: 42, padding: "8px 16px", borderRadius: 8, border: `1px solid ${MFX_COLORS.border}`, background: multiFXSurfaceBackground("panel"), color: MFX_SURFACES.panel.text, fontWeight: 800 };
const accentButtonStyle: React.CSSProperties = { ...normalButtonStyle, borderColor: MFX_SURFACES.panel.accent, color: MFX_SURFACES.panel.accent };
const messageStyle: React.CSSProperties = { marginTop: 14, padding: 12, borderRadius: 8, background: multiFXSurfaceBackground("toast"), color: MFX_SURFACES.toast.text };
const previewCardStyle: React.CSSProperties = { marginTop: 14, marginBottom: 10, padding: 10, borderRadius: 10, border: `1px solid ${MFX_COLORS.border}`, background: MFX_SURFACES.page.background };
const previewTitleStyle: React.CSSProperties = { marginBottom: 8, color: MFX_SURFACES.panel.accent, fontWeight: 900, fontSize: ".82rem" };
