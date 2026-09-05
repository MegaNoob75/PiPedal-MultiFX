import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    MFX_COLORS,
    MFX_SURFACES,
    loadMultiFXTheme,
    multiFXSurfaceBackground,
    saveMultiFXTheme
} from "./MultiFXTheme";
import {
    clearPresetAssignmentCache,
    replacePresetAssignments,
    resetPresetAssignments
} from "./MultiFXPresetAssignments";
import { CONTROLLER_STORAGE_KEY } from "./ControllerConfig";
import {
    MULTIFX_BACKUP_FORMAT,
    MULTIFX_BACKUP_LOCAL_STORAGE_KEYS,
    MULTIFX_BACKUP_VERSION,
    MultiFXBackupFile,
    MultiFXBackupSettings,
    validateMultiFXBackup
} from "./MultiFXBackup";
import {
    readMultiFXRuntimeState,
    updateMultiFXRuntimeState
} from "./MultiFXRuntimeSync";
import {
    loadMultiFXUIBehaviorSettings,
    MULTIFX_UI_BEHAVIOR_STORAGE_KEY,
    MultiFXUIBehaviorSettings,
    saveMultiFXUIBehaviorSettings
} from "./MultiFXUIBehavior";


function readStoredJson(key: string): unknown | undefined {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return undefined;

    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return undefined;
    }
}

function writeStoredJson(
    key: string,
    value: unknown | null | undefined
) {
    if (value === undefined || value === null) {
        window.localStorage.removeItem(key);
        return;
    }

    window.localStorage.setItem(
        key,
        JSON.stringify(value, null, 2)
    );
}

function downloadJson(
    fileName: string,
    value: unknown
) {
    const blob = new Blob(
        [JSON.stringify(value, null, 2)],
        { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}

interface MultiFXUISettingsProps {
    onExitToOriginal: () => void;
}

export default function MultiFXUISettings({
    onExitToOriginal
}: MultiFXUISettingsProps) {
    const [message, setMessage] = useState("");
    const [resetConfirmOpen, setResetConfirmOpen] =
        useState(false);
    const messageTimerRef = useRef<number | null>(null);
    const reloadTimerRef = useRef<number | null>(null);
    const [uiBehavior, setUIBehavior] = useState<MultiFXUIBehaviorSettings>(
        () => loadMultiFXUIBehaviorSettings()
    );
    const [parameterFeedbackDurationMs, setParameterFeedbackDurationMs] =
        useState(() =>
            loadMultiFXTheme().appearance.motion.feedbackDurationMs
        );

    useEffect(() => {
        return () => {
            if (messageTimerRef.current !== null) {
                window.clearTimeout(messageTimerRef.current);
            }

            if (reloadTimerRef.current !== null) {
                window.clearTimeout(reloadTimerRef.current);
            }
        };
    }, []);

    const showMessage = (
        value: string,
        durationMs: number = loadMultiFXUIBehaviorSettings()
            .statusToastDurationMs
    ) => {
        setMessage(value);

        if (messageTimerRef.current !== null) {
            window.clearTimeout(messageTimerRef.current);
        }

        messageTimerRef.current = window.setTimeout(() => {
            messageTimerRef.current = null;
            setMessage("");
        }, durationMs);
    };

    const saveInteractionSettings = () => {
        const theme = loadMultiFXTheme();
        const updatedTheme = {
            ...theme,
            appearance: {
                ...theme.appearance,
                motion: {
                    ...theme.appearance.motion,
                    feedbackDurationMs: parameterFeedbackDurationMs
                }
            }
        };

        if (!saveMultiFXUIBehaviorSettings(uiBehavior)
            || !saveMultiFXTheme(updatedTheme)) {
            showMessage("One or more interaction settings are invalid.");
            return;
        }
        showMessage("PI-MULTIFX interaction settings saved.");
    };

    const scheduleReload = () => {
        if (reloadTimerRef.current !== null) {
            window.clearTimeout(reloadTimerRef.current);
        }

        reloadTimerRef.current = window.setTimeout(() => {
            window.location.reload();
        }, 700);
    };

    const exportBackup = async () => {
        try {
            const localSettings: MultiFXBackupSettings = {};

            for (const key of MULTIFX_BACKUP_LOCAL_STORAGE_KEYS) {
                localSettings[key] =
                    window.localStorage.getItem(key);
            }

            let controllerConfig =
                readStoredJson(CONTROLLER_STORAGE_KEY)
                    ?? null;
            let presetAssignments: unknown = undefined;
            let uiSettings: unknown =
                loadMultiFXUIBehaviorSettings();

            // Runtime state is authoritative for shared Performance/controller
            // state. A backup is explicit recovery data, so do not invent or
            // migrate state from retired browser-only formats.
            try {
                const runtime = await readMultiFXRuntimeState();

                if (runtime.controllerConfig !== undefined) {
                    controllerConfig =
                        runtime.controllerConfig;
                }

                if (runtime.presetAssignments !== undefined) {
                    presetAssignments =
                        runtime.presetAssignments;
                }

                if (runtime.uiSettings !== undefined) {
                    uiSettings = runtime.uiSettings;
                }
            } catch (error) {
                throw new Error(
                    `The PI-MULTIFX runtime service is unavailable: ${String(error)}`
                );
            }

            const backup: MultiFXBackupFile = {
                format: MULTIFX_BACKUP_FORMAT,
                version: MULTIFX_BACKUP_VERSION,
                createdAt: new Date().toISOString(),
                settings: localSettings,
                sharedState: {
                    controllerConfig,
                    presetAssignments,
                    uiSettings
                }
            };

            downloadJson(
                "pipedal-multifx-backup.json",
                backup
            );

            showMessage("PI-MULTIFX settings backup created.");
        } catch (error) {
            showMessage(
                `Could not create backup: ${String(error)}`
            );
        }
    };

    const restoreBackup = async (file: File) => {
        try {
            const text = await file.text();
            const value: unknown = JSON.parse(text);

            if (!validateMultiFXBackup(value)) {
                showMessage(
                    "That file is not a valid PI-MULTIFX settings backup."
                );
                return;
            }

            for (const key of MULTIFX_BACKUP_LOCAL_STORAGE_KEYS) {
                const storedValue = value.settings[key];

                if (
                    storedValue === undefined
                    || storedValue === null
                ) {
                    window.localStorage.removeItem(key);
                } else {
                    window.localStorage.setItem(
                        key,
                        storedValue
                    );
                }
            }


            const sharedState = value.sharedState;

            const patch: {
                controllerConfig?: unknown | null;
                presetAssignments?: unknown;
                uiSettings?: unknown | null;
            } = {};

            if (
                Object.prototype.hasOwnProperty.call(
                    sharedState,
                    "controllerConfig"
                )
            ) {
                patch.controllerConfig =
                    sharedState.controllerConfig;
                writeStoredJson(
                    CONTROLLER_STORAGE_KEY,
                    sharedState.controllerConfig
                );
            }

            if (
                Object.prototype.hasOwnProperty.call(
                    sharedState,
                    "presetAssignments"
                )
                && sharedState.presetAssignments !== undefined
            ) {
                await replacePresetAssignments(
                    sharedState.presetAssignments
                );
            }


            if (Object.prototype.hasOwnProperty.call(
                sharedState,
                "uiSettings"
            )) {
                patch.uiSettings = sharedState.uiSettings;
                writeStoredJson(
                    MULTIFX_UI_BEHAVIOR_STORAGE_KEY,
                    sharedState.uiSettings
                );
            }

            // The bridge is the authority. Restore shared state there before
            // reloading so another browser cannot immediately overwrite this
            // client with the old Performance map/controller layout.
            if (Object.keys(patch).length > 0) {
                await updateMultiFXRuntimeState(patch);
            }

            if (
                Object.prototype.hasOwnProperty.call(
                    patch,
                    "controllerConfig"
                )
            ) {
                window.dispatchEvent(
                    new Event(
                        "multifx-controller-config-changed"
                    )
                );
            }

            showMessage(
                "PI-MULTIFX settings restored. Reloading...",
                3000
            );
            scheduleReload();
        } catch (error) {
            showMessage(
                `Could not restore backup: ${String(error)}`
            );
        }
    };

    const resetMultiFXSettings = async () => {
        try {
            for (const key of MULTIFX_BACKUP_LOCAL_STORAGE_KEYS) {
                window.localStorage.removeItem(key);
            }

            window.localStorage.removeItem(
                CONTROLLER_STORAGE_KEY
            );
            window.localStorage.removeItem(
                MULTIFX_UI_BEHAVIOR_STORAGE_KEY
            );

            await resetPresetAssignments();
            clearPresetAssignmentCache();
            await updateMultiFXRuntimeState({
                controllerConfig: null,
                theme: null,
                uiSettings: null
            });
            window.dispatchEvent(
                new Event(
                    "multifx-controller-config-changed"
                )
            );

            setResetConfirmOpen(false);
            showMessage(
                "PI-MULTIFX settings reset. Reloading...",
                3000
            );
            scheduleReload();
        } catch (error) {
            showMessage(
                `Could not reset PI-MULTIFX settings: ${String(error)}`
            );
        }
    };

    return (
        <div style={screenStyle}>
            <div style={headerStyle}>
                <div>
                    <div style={titleStyle}>
                        PI-MULTIFX UI SETTINGS
                    </div>
                    <div style={subtitleStyle}>
                        Original PiPedal access, backup, restore and interface options
                    </div>
                </div>
            </div>

            {message && createPortal(
                <div
                    role="status"
                    aria-live="polite"
                    style={toastStyle}
                >
                    {message}
                </div>,
                document.body
            )}

            <div style={contentStyle}>
                <section style={sectionStyle}>
                    <div style={sectionTitleStyle}>
                        INTERFACE
                    </div>

                    <div style={sectionDescriptionStyle}>
                        Switch this browser from PI-MULTIFX to the original
                        PiPedal interface. Your current preset and settings
                        remain unchanged.
                    </div>

                    <button
                        type="button"
                        onClick={onExitToOriginal}
                        style={{ ...primaryButtonStyle, marginTop: 12 }}
                    >
                        OPEN ORIGINAL PIPEDAL
                    </button>
                </section>

                <section style={sectionStyle}>
                    <div style={sectionTitleStyle}>
                        BACKUP / RESTORE
                    </div>

                    <div style={sectionDescriptionStyle}>
                        Save or restore PI-MULTIFX-only configuration,
                        including the shared Performance preset assignments and
                        controller layout. PiPedal presets, banks, audio,
                        MIDI, Wi-Fi and system settings are not included.
                    </div>

                    <div style={buttonGridStyle}>
                        <button
                            type="button"
                            onClick={() => void exportBackup()}
                            style={primaryButtonStyle}
                        >
                            BACKUP PI-MULTIFX SETTINGS
                            <span style={buttonSubtextStyle}>
                                Download one JSON backup file
                            </span>
                        </button>

                        <label style={buttonStyle}>
                            RESTORE PI-MULTIFX SETTINGS
                            <span style={buttonSubtextStyle}>
                                Restore from a PI-MULTIFX backup
                            </span>
                            <input
                                type="file"
                                accept="application/json,.json"
                                style={{ display: "none" }}
                                onChange={(event) => {
                                    const file =
                                        event.target.files?.[0];

                                    if (file) {
                                        void restoreBackup(file);
                                    }

                                    event.currentTarget.value = "";
                                }}
                            />
                        </label>
                    </div>
                </section>

                <section style={sectionStyle}>
                    <div style={sectionTitleStyle}>
                        PERFORMANCE INTERACTION
                    </div>

                    <div style={sectionDescriptionStyle}>
                        Control temporary Performance pop-outs and PI-MULTIFX
                        feedback timing. These choices are shared by the PC
                        and pedalboard display. Existing theme and controller
                        settings stay in their current editors.
                    </div>

                    <div style={settingsGridStyle}>
                        <SettingsToggle
                            label="Physical control pop-out"
                            description="Enlarge a placed pot, slider, expression pedal or encoder when its bound value moves."
                            checked={uiBehavior.physicalControlPopout}
                            onChange={(physicalControlPopout) =>
                                setUIBehavior((current) => ({
                                    ...current,
                                    physicalControlPopout
                                }))
                            }
                        />
                        <SettingsToggle
                            label="Touch control pop-out"
                            description="Open the same enlarged display when a placed control is tapped."
                            checked={uiBehavior.touchControlPopout}
                            onChange={(touchControlPopout) =>
                                setUIBehavior((current) => ({
                                    ...current,
                                    touchControlPopout
                                }))
                            }
                        />
                        <SettingsToggle
                            label="Parameter feedback popup"
                            description="Show the parameter name and value overlay for bound controller changes."
                            checked={uiBehavior.parameterFeedbackEnabled}
                            onChange={(parameterFeedbackEnabled) =>
                                setUIBehavior((current) => ({
                                    ...current,
                                    parameterFeedbackEnabled
                                }))
                            }
                        />
                        <SettingsNumber
                            label="Control pop-out time"
                            suffix="ms"
                            value={uiBehavior.controlPopoutDurationMs}
                            minimum={500}
                            maximum={10000}
                            step={100}
                            onChange={(controlPopoutDurationMs) =>
                                setUIBehavior((current) => ({
                                    ...current,
                                    controlPopoutDurationMs
                                }))
                            }
                        />
                        <SettingsNumber
                            label="Control pop-out size"
                            suffix="×"
                            value={uiBehavior.controlPopoutScale}
                            minimum={1.2}
                            maximum={2.5}
                            step={0.05}
                            onChange={(controlPopoutScale) =>
                                setUIBehavior((current) => ({
                                    ...current,
                                    controlPopoutScale
                                }))
                            }
                        />
                        <SettingsNumber
                            label="Parameter popup time"
                            suffix="ms"
                            value={parameterFeedbackDurationMs}
                            minimum={500}
                            maximum={10000}
                            step={100}
                            onChange={setParameterFeedbackDurationMs}
                        />
                        <SettingsNumber
                            label="Status / toast time"
                            suffix="ms"
                            value={uiBehavior.statusToastDurationMs}
                            minimum={500}
                            maximum={10000}
                            step={100}
                            onChange={(statusToastDurationMs) =>
                                setUIBehavior((current) => ({
                                    ...current,
                                    statusToastDurationMs
                                }))
                            }
                        />
                    </div>

                    <button
                        type="button"
                        onClick={saveInteractionSettings}
                        style={primaryButtonStyle}
                    >
                        SAVE INTERACTION SETTINGS
                    </button>
                </section>

                <section style={sectionStyle}>
                    <div style={sectionTitleStyle}>
                        SYNC BEHAVIOR
                    </div>

                    <div style={sectionDescriptionStyle}>
                        Performance/controller state and the top-level
                        Performance / Default view are shared between the PC
                        and pedalboard. Menus, dialogs and browser theme remain
                        local to each screen.
                    </div>

                    <div style={syncGridStyle}>
                        <SyncRow
                            label="Bank / Preset"
                            value="SHARED"
                        />
                        <SyncRow
                            label="Effect Parameters"
                            value="SHARED"
                        />
                        <SyncRow
                            label="Snapshot Selection"
                            value="SHARED"
                        />
                        <SyncRow
                            label="Snapshot Mode"
                            value="SHARED"
                        />
                        <SyncRow
                            label="Chain Bypass"
                            value="SHARED"
                        />
                        <SyncRow
                            label="Controller Assignments / Layout"
                            value="SHARED"
                        />
                        <SyncRow
                            label="Performance Preset Assignments"
                            value="SHARED"
                        />
                        <SyncRow
                            label="Performance Switch Selection"
                            value="SHARED"
                        />
                        <SyncRow
                            label="Main View"
                            value="SHARED"
                        />
                        <SyncRow
                            label="Menus / Dialogs"
                            value="LOCAL"
                        />
                        <SyncRow
                            label="Theme"
                            value="SHARED"
                        />
                        <SyncRow
                            label="Interaction / Timing"
                            value="SHARED"
                        />
                    </div>
                </section>

                <section
                    style={{
                        ...sectionStyle,
                        borderColor: MFX_COLORS.danger
                    }}
                >
                    <div
                        style={{
                            ...sectionTitleStyle,
                            color: MFX_COLORS.danger
                        }}
                    >
                        RESET PI-MULTIFX
                    </div>

                    <div style={sectionDescriptionStyle}>
                        Clear the shared Performance preset assignments,
                        shared controller configuration, theme selection
                        and custom themes. Native PiPedal data is not
                        changed.
                    </div>

                    {!resetConfirmOpen ? (
                        <button
                            type="button"
                            onClick={() =>
                                setResetConfirmOpen(true)
                            }
                            style={dangerButtonStyle}
                        >
                            RESET PI-MULTIFX SETTINGS
                        </button>
                    ) : (
                        <div style={confirmStyle}>
                            <div style={confirmTextStyle}>
                                Reset all saved PI-MULTIFX settings?
                            </div>

                            <div style={confirmButtonsStyle}>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setResetConfirmOpen(false)
                                    }
                                    style={buttonStyle}
                                >
                                    CANCEL
                                </button>

                                <button
                                    type="button"
                                    onClick={() =>
                                        void resetMultiFXSettings()
                                    }
                                    style={dangerButtonStyle}
                                >
                                    YES, RESET
                                </button>
                            </div>
                        </div>
                    )}
                </section>

                <div style={versionStyle}>
                    BACKUP FORMAT v{MULTIFX_BACKUP_VERSION}
                </div>
            </div>
        </div>
    );
}

function SyncRow({
    label,
    value
}: {
    label: string;
    value: "SHARED" | "LOCAL";
}) {
    return (
        <div style={syncRowStyle}>
            <span>{label}</span>
            <span
                style={{
                    ...syncValueStyle,
                    color:
                        value === "SHARED"
                            ? MFX_COLORS.cyan
                            : MFX_COLORS.purple
                }}
            >
                {value}
            </span>
        </div>
    );
}

function SettingsToggle({
    label,
    description,
    checked,
    onChange
}: {
    label: string;
    description: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <label style={settingCardStyle}>
            <span style={settingTextStyle}>
                <span style={settingLabelStyle}>{label}</span>
                <span style={settingDescriptionStyle}>{description}</span>
            </span>
            <input
                type="checkbox"
                checked={checked}
                onChange={(event) => onChange(event.currentTarget.checked)}
                style={checkboxStyle}
            />
        </label>
    );
}

function SettingsNumber({
    label,
    suffix,
    value,
    minimum,
    maximum,
    step,
    onChange
}: {
    label: string;
    suffix: string;
    value: number;
    minimum: number;
    maximum: number;
    step: number;
    onChange: (value: number) => void;
}) {
    return (
        <label style={settingCardStyle}>
            <span style={settingLabelStyle}>{label}</span>
            <span style={numberInputWrapStyle}>
                <input
                    type="number"
                    value={value}
                    min={minimum}
                    max={maximum}
                    step={step}
                    onChange={(event) => {
                        const next = Number(event.currentTarget.value);
                        if (Number.isFinite(next)) {
                            onChange(Math.max(minimum, Math.min(maximum, next)));
                        }
                    }}
                    style={numberInputStyle}
                />
                <span style={numberSuffixStyle}>{suffix}</span>
            </span>
        </label>
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
    padding:
        "calc(6px * var(--mfx-ui-scale, 1)) calc(70px * var(--mfx-ui-scale, 1)) calc(6px * var(--mfx-ui-scale, 1)) calc(78px * var(--mfx-ui-scale, 1))",
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

const contentStyle: React.CSSProperties = {
    flex: "1 1 auto",
    minHeight: 0,
    overflowY: "auto",
    padding: "calc(16px * var(--mfx-ui-scale, 1))",
    boxSizing: "border-box",
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "calc(12px * var(--mfx-ui-scale, 1))",
    alignContent: "start"
};

const sectionStyle: React.CSSProperties = {
    minWidth: 0,
    padding: "calc(14px * var(--mfx-ui-scale, 1))",
    borderRadius: 14,
    border: "1px solid transparent",
    background: multiFXSurfaceBackground("panel"),
    color: MFX_SURFACES.panel.text,
    boxShadow: MFX_SURFACES.panel.shadow,
    boxSizing: "border-box"
};

const sectionTitleStyle: React.CSSProperties = {
    color: MFX_SURFACES.panel.accent,
    fontSize: "0.94rem",
    fontWeight: 900,
    letterSpacing: "0.05em"
};

const sectionDescriptionStyle: React.CSSProperties = {
    marginTop: 7,
    color: MFX_SURFACES.panel.label,
    fontSize: "0.75rem",
    lineHeight: 1.4
};

const buttonGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "calc(9px * var(--mfx-ui-scale, 1))",
    marginTop: "calc(12px * var(--mfx-ui-scale, 1))"
};

const buttonStyle: React.CSSProperties = {
    minHeight: "var(--mfx-touch-height, 46px)",
    padding:
        "calc(9px * var(--mfx-ui-scale, 1)) calc(12px * var(--mfx-ui-scale, 1))",
    borderRadius: 10,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panelAlt,
    color: MFX_COLORS.text,
    font: "inherit",
    fontWeight: 900,
    textAlign: "center",
    cursor: "pointer",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center"
};

const primaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    border: `2px solid ${MFX_COLORS.cyan}`,
    background: MFX_COLORS.cyanSurface,
    color: MFX_COLORS.cyanText
};

const dangerButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    marginTop: "calc(12px * var(--mfx-ui-scale, 1))",
    border: `2px solid ${MFX_COLORS.danger}`,
    color: MFX_COLORS.danger
};

const buttonSubtextStyle: React.CSSProperties = {
    marginTop: 4,
    color: MFX_COLORS.muted,
    fontSize: "0.66rem",
    fontWeight: 600,
    lineHeight: 1.25
};

const settingsGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 8,
    margin: "calc(12px * var(--mfx-ui-scale, 1)) 0"
};

const settingCardStyle: React.CSSProperties = {
    minWidth: 0,
    minHeight: "var(--mfx-touch-height, 46px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "8px 10px",
    boxSizing: "border-box",
    border: `1px solid ${MFX_COLORS.border}`,
    borderRadius: 9,
    background: MFX_COLORS.background,
    color: MFX_COLORS.text
};

const settingTextStyle: React.CSSProperties = {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 3
};

const settingLabelStyle: React.CSSProperties = {
    color: MFX_COLORS.text,
    fontSize: ".76rem",
    fontWeight: 900
};

const settingDescriptionStyle: React.CSSProperties = {
    color: MFX_COLORS.muted,
    fontSize: ".65rem",
    lineHeight: 1.25
};

const checkboxStyle: React.CSSProperties = {
    flex: "0 0 auto",
    width: 24,
    height: 24,
    accentColor: MFX_COLORS.cyan,
    cursor: "pointer"
};

const numberInputWrapStyle: React.CSSProperties = {
    flex: "0 0 auto",
    display: "flex",
    alignItems: "center",
    gap: 5
};

const numberInputStyle: React.CSSProperties = {
    width: 82,
    minHeight: 34,
    boxSizing: "border-box",
    border: `1px solid ${MFX_COLORS.border}`,
    borderRadius: 7,
    background: MFX_COLORS.panelAlt,
    color: MFX_COLORS.text,
    font: "inherit",
    fontWeight: 900,
    textAlign: "right"
};

const numberSuffixStyle: React.CSSProperties = {
    minWidth: 18,
    color: MFX_COLORS.muted,
    fontSize: ".7rem",
    fontWeight: 900
};

const syncGridStyle: React.CSSProperties = {
    display: "grid",
    gap: 6,
    marginTop: "calc(12px * var(--mfx-ui-scale, 1))"
};

const syncRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "7px 10px",
    borderRadius: 8,
    background: MFX_COLORS.background,
    color: MFX_COLORS.text,
    fontSize: "0.74rem",
    fontWeight: 750
};

const syncValueStyle: React.CSSProperties = {
    fontSize: "0.68rem",
    fontWeight: 950,
    letterSpacing: "0.06em"
};

const confirmStyle: React.CSSProperties = {
    marginTop: "calc(12px * var(--mfx-ui-scale, 1))",
    padding: 10,
    borderRadius: 10,
    border: `1px solid ${MFX_COLORS.danger}`,
    background: MFX_COLORS.background
};

const confirmTextStyle: React.CSSProperties = {
    color: MFX_COLORS.danger,
    fontWeight: 900,
    textAlign: "center"
};

const confirmButtonsStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    marginTop: 9
};

const versionStyle: React.CSSProperties = {
    gridColumn: "1 / -1",
    color: MFX_COLORS.muted,
    fontSize: "0.68rem",
    fontWeight: 800,
    textAlign: "right",
    letterSpacing: "0.04em"
};

const toastStyle: React.CSSProperties = {
    position: "fixed",
    left: "50%",
    top: "calc(8px * var(--mfx-ui-scale, 1))",
    transform: "translateX(-50%)",
    zIndex: 2147483647,
    maxWidth: "min(72vw, 560px)",
    padding:
        "calc(8px * var(--mfx-ui-scale, 1)) calc(14px * var(--mfx-ui-scale, 1))",
    borderRadius: 10,
    border: "1px solid transparent",
    background: multiFXSurfaceBackground("toast"),
    color: MFX_SURFACES.toast.text,
    fontWeight: 900,
    textAlign: "center",
    boxShadow: MFX_SURFACES.toast.shadow,
    pointerEvents: "none"
};
