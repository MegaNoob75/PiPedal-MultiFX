import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MFX_COLORS } from "./MultiFXTheme";
import {
    applyPresetTileStoreFromRuntime
} from "./MultiFXPresetTileMap";
import {
    readMultiFXRuntimeState,
    updateMultiFXRuntimeState
} from "./MultiFXRuntimeSync";

const BACKUP_FORMAT = "pipedal-multifx-ui-backup";
const BACKUP_VERSION = 3;

const THEME_STORAGE_KEY = "pipedal-multifx-theme-v1";
const CUSTOM_THEMES_STORAGE_KEY =
    "pipedal-multifx-custom-themes-v1";
const CONTROLLER_STORAGE_KEY =
    "pipedal-multifx-controller-config-v1";
const PRESET_TILE_STORAGE_KEY =
    "pipedal-multifx-preset-tiles-v1";

// Removed feature. Clear this key during restore/reset so an old browser does
// not keep carrying obsolete per-device Performance layout state.
const LEGACY_DEVICE_PREFERENCES_STORAGE_KEY =
    "pipedal-multifx-device-preferences-v1";

const LOCAL_STORAGE_KEYS = [
    THEME_STORAGE_KEY,
    CUSTOM_THEMES_STORAGE_KEY
] as const;

type BackupSettings = Record<string, string | null>;

type SharedBackupState = {
    controllerConfig?: unknown | null;
    presetTileStore?: unknown;
};

interface MultiFXBackupFile {
    format: typeof BACKUP_FORMAT;
    version: number;
    createdAt: string;
    settings: BackupSettings;
    sharedState?: SharedBackupState;
}

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

function getLegacySharedState(
    backup: MultiFXBackupFile
): SharedBackupState {
    const result: SharedBackupState = {};

    const controllerRaw =
        backup.settings[CONTROLLER_STORAGE_KEY];
    if (typeof controllerRaw === "string") {
        try {
            result.controllerConfig =
                JSON.parse(controllerRaw) as unknown;
        } catch {
            // Ignore malformed legacy cache data.
        }
    } else if (controllerRaw === null) {
        result.controllerConfig = null;
    }

    const tilesRaw =
        backup.settings[PRESET_TILE_STORAGE_KEY];
    if (typeof tilesRaw === "string") {
        try {
            result.presetTileStore =
                JSON.parse(tilesRaw) as unknown;
        } catch {
            // Ignore malformed legacy cache data.
        }
    }

    return result;
}

export default function MultiFXUISettings() {
    const [message, setMessage] = useState("");
    const [resetConfirmOpen, setResetConfirmOpen] =
        useState(false);
    const messageTimerRef = useRef<number | null>(null);
    const reloadTimerRef = useRef<number | null>(null);

    useEffect(() => {
        // Remove the retired per-device Performance layout cache once this
        // cleaned settings view has run.
        window.localStorage.removeItem(
            LEGACY_DEVICE_PREFERENCES_STORAGE_KEY
        );

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
        durationMs: number = 2200
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
            const localSettings: BackupSettings = {};

            for (const key of LOCAL_STORAGE_KEYS) {
                localSettings[key] =
                    window.localStorage.getItem(key);
            }

            let controllerConfig =
                readStoredJson(CONTROLLER_STORAGE_KEY)
                    ?? null;
            let presetTileStore =
                readStoredJson(PRESET_TILE_STORAGE_KEY);

            // Runtime state is authoritative for shared Performance/controller
            // state. Fall back to browser cache only if the bridge is offline.
            try {
                const runtime = await readMultiFXRuntimeState();

                if (runtime.controllerConfig !== undefined) {
                    controllerConfig =
                        runtime.controllerConfig;
                }

                if (runtime.presetTileStore !== undefined) {
                    presetTileStore =
                        runtime.presetTileStore;
                }
            } catch {
                // Offline backup still includes the most recent local cache.
            }

            const backup: MultiFXBackupFile = {
                format: BACKUP_FORMAT,
                version: BACKUP_VERSION,
                createdAt: new Date().toISOString(),
                settings: localSettings,
                sharedState: {
                    controllerConfig,
                    presetTileStore
                }
            };

            downloadJson(
                "pipedal-multifx-backup.json",
                backup
            );

            showMessage("MultiFX settings backup created.");
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

            if (!isValidBackup(value)) {
                showMessage(
                    "That file is not a valid MultiFX settings backup."
                );
                return;
            }

            for (const key of LOCAL_STORAGE_KEYS) {
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

            window.localStorage.removeItem(
                LEGACY_DEVICE_PREFERENCES_STORAGE_KEY
            );

            const sharedState =
                value.sharedState
                ?? getLegacySharedState(value);

            const patch: {
                controllerConfig?: unknown | null;
                presetTileStore?: unknown;
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
                    "presetTileStore"
                )
            ) {
                patch.presetTileStore =
                    sharedState.presetTileStore;

                if (
                    sharedState.presetTileStore
                    !== undefined
                ) {
                    applyPresetTileStoreFromRuntime(
                        sharedState.presetTileStore
                    );
                }
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
                "MultiFX settings restored. Reloading...",
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
            for (const key of LOCAL_STORAGE_KEYS) {
                window.localStorage.removeItem(key);
            }

            window.localStorage.removeItem(
                CONTROLLER_STORAGE_KEY
            );
            window.localStorage.removeItem(
                PRESET_TILE_STORAGE_KEY
            );
            window.localStorage.removeItem(
                LEGACY_DEVICE_PREFERENCES_STORAGE_KEY
            );

            const emptyTileStore = {
                version: 1 as const,
                banks: {}
            };

            // Reset the shared authority, not just this browser's cache.
            await updateMultiFXRuntimeState({
                controllerConfig: null,
                presetTileStore: emptyTileStore
            });

            applyPresetTileStoreFromRuntime(
                emptyTileStore
            );
            window.dispatchEvent(
                new Event(
                    "multifx-controller-config-changed"
                )
            );

            setResetConfirmOpen(false);
            showMessage(
                "MultiFX settings reset. Reloading...",
                3000
            );
            scheduleReload();
        } catch (error) {
            showMessage(
                `Could not reset MultiFX settings: ${String(error)}`
            );
        }
    };

    return (
        <div style={screenStyle}>
            <div style={headerStyle}>
                <div>
                    <div style={titleStyle}>
                        MULTIFX-UI SETTINGS
                    </div>
                    <div style={subtitleStyle}>
                        Backup, restore and MultiFX interface options
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
                        BACKUP / RESTORE
                    </div>

                    <div style={sectionDescriptionStyle}>
                        Save or restore MultiFX-only configuration,
                        including the shared Performance tile map and
                        controller layout. PiPedal presets, banks, audio,
                        MIDI, Wi-Fi and system settings are not included.
                    </div>

                    <div style={buttonGridStyle}>
                        <button
                            type="button"
                            onClick={() => void exportBackup()}
                            style={primaryButtonStyle}
                        >
                            BACKUP MULTIFX SETTINGS
                            <span style={buttonSubtextStyle}>
                                Download one JSON backup file
                            </span>
                        </button>

                        <label style={buttonStyle}>
                            RESTORE MULTIFX SETTINGS
                            <span style={buttonSubtextStyle}>
                                Restore from a MultiFX backup
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
                            label="Performance Tile Layout"
                            value="SHARED"
                        />
                        <SyncRow
                            label="Performance Page / Selection"
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
                            value="LOCAL"
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
                        RESET MULTIFX
                    </div>

                    <div style={sectionDescriptionStyle}>
                        Clear the shared Performance tile map,
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
                            RESET MULTIFX SETTINGS
                        </button>
                    ) : (
                        <div style={confirmStyle}>
                            <div style={confirmTextStyle}>
                                Reset all saved MultiFX settings?
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
                    BACKUP FORMAT v{BACKUP_VERSION}
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
                            : MFX_COLORS.purpleLight
                }}
            >
                {value}
            </span>
        </div>
    );
}

function isRecord(
    value: unknown
): value is Record<string, unknown> {
    return (
        typeof value === "object"
        && value !== null
        && !Array.isArray(value)
    );
}

function isValidBackup(
    value: unknown
): value is MultiFXBackupFile {
    if (!isRecord(value)) {
        return false;
    }

    if (
        value.format !== BACKUP_FORMAT
        || (
            value.version !== 1
            && value.version !== 2
            && value.version !== BACKUP_VERSION
        )
        || !isRecord(value.settings)
    ) {
        return false;
    }

    for (const [key, storedValue] of Object.entries(
        value.settings
    )) {
        if (
            typeof key !== "string"
            || (
                storedValue !== null
                && typeof storedValue !== "string"
            )
        ) {
            return false;
        }
    }

    if (
        value.sharedState !== undefined
        && !isRecord(value.sharedState)
    ) {
        return false;
    }

    return true;
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
    padding:
        "calc(6px * var(--mfx-ui-scale, 1)) calc(70px * var(--mfx-ui-scale, 1)) calc(6px * var(--mfx-ui-scale, 1)) calc(78px * var(--mfx-ui-scale, 1))",
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
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panel,
    boxSizing: "border-box"
};

const sectionTitleStyle: React.CSSProperties = {
    color: MFX_COLORS.purpleLight,
    fontSize: "0.94rem",
    fontWeight: 900,
    letterSpacing: "0.05em"
};

const sectionDescriptionStyle: React.CSSProperties = {
    marginTop: 7,
    color: MFX_COLORS.muted,
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
    border: `1px solid ${MFX_COLORS.cyan}`,
    background: MFX_COLORS.panelAlt,
    color: MFX_COLORS.cyanText,
    fontWeight: 900,
    textAlign: "center",
    boxShadow: "0 8px 22px rgba(0,0,0,0.68)",
    pointerEvents: "none"
};
