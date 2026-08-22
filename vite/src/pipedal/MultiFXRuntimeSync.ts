export type MultiFXMainView = "performance" | "default";

export type MultiFXRuntimeState = {
    version: number;
    revision: number;

    // The top-level operating view is shared. Nested MultiFX routes, menus,
    // dialogs and theme choices remain browser-local.
    mainView: MultiFXMainView;

    snapshotMode: boolean;
    snapshotPresetId: number | null;
    chainBypassed: boolean;
    chainBypassPresetId: number | null;
    chainBypassWasPresetChanged: boolean;
    chainBypassEnabledStates: Record<string, boolean>;

    // Shared hardware-controller configuration. Undefined means the runtime
    // service has not been initialized with a controller config yet. null
    // means use the shipped controller-config.json/defaults.
    controllerConfig?: unknown | null;

    // Shared MultiFX Performance View tile map. The concrete shape is owned by
    // MultiFXPresetTileMap so this runtime transport stays decoupled from the
    // presentation/storage implementation.
    presetTileStore?: unknown;

};

export type MultiFXRuntimeStatePatch =
    Partial<Omit<MultiFXRuntimeState, "version" | "revision">>;

export const MULTIFX_RUNTIME_POLL_MS = 200;

function runtimeStateUrl(): string {
    const hostname = window.location.hostname.includes(":")
        ? `[${window.location.hostname}]`
        : window.location.hostname;

    return `http://${hostname}:8877/multifx-state`;
}

function normalizeRuntimeState(value: unknown): MultiFXRuntimeState {
    const source =
        value && typeof value === "object"
            ? value as Record<string, unknown>
            : {};

    const enabledStates: Record<string, boolean> = {};
    const rawEnabledStates = source.chainBypassEnabledStates;

    if (rawEnabledStates && typeof rawEnabledStates === "object") {
        for (const [key, enabled] of Object.entries(
            rawEnabledStates as Record<string, unknown>
        )) {
            const instanceId = Number(key);
            if (Number.isFinite(instanceId)) {
                enabledStates[String(instanceId)] = Boolean(enabled);
            }
        }
    }

    const numberOrNull = (input: unknown): number | null => {
        return typeof input === "number" && Number.isFinite(input)
            ? input
            : null;
    };


    return {
        version:
            typeof source.version === "number"
                ? source.version
                : 1,
        revision:
            typeof source.revision === "number"
                ? source.revision
                : 0,
        mainView:
            source.mainView === "default"
                ? "default"
                : "performance",
        snapshotMode: Boolean(source.snapshotMode),
        snapshotPresetId: numberOrNull(source.snapshotPresetId),
        chainBypassed: Boolean(source.chainBypassed),
        chainBypassPresetId: numberOrNull(source.chainBypassPresetId),
        chainBypassWasPresetChanged:
            Boolean(source.chainBypassWasPresetChanged),
        chainBypassEnabledStates: enabledStates,
        controllerConfig:
            Object.prototype.hasOwnProperty.call(
                source,
                "controllerConfig"
            )
                ? source.controllerConfig
                : undefined,
        presetTileStore:
            Object.prototype.hasOwnProperty.call(
                source,
                "presetTileStore"
            )
                ? source.presetTileStore
                : undefined
    };
}

export async function readMultiFXRuntimeState(
    signal?: AbortSignal
): Promise<MultiFXRuntimeState> {
    const response = await fetch(runtimeStateUrl(), {
        method: "GET",
        cache: "no-store",
        signal
    });

    if (!response.ok) {
        throw new Error(
            `MultiFX runtime state read failed: HTTP ${response.status}`
        );
    }

    return normalizeRuntimeState(await response.json());
}

export async function updateMultiFXRuntimeState(
    patch: MultiFXRuntimeStatePatch,
    signal?: AbortSignal
): Promise<MultiFXRuntimeState> {
    const response = await fetch(runtimeStateUrl(), {
        method: "POST",
        cache: "no-store",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(patch),
        signal
    });

    if (!response.ok) {
        throw new Error(
            `MultiFX runtime state update failed: HTTP ${response.status}`
        );
    }

    return normalizeRuntimeState(await response.json());
}


const CONTROLLER_STORAGE_KEY =
    "pipedal-multifx-controller-config-v1";
const CONTROLLER_CHANGED_EVENT =
    "multifx-controller-config-changed";
const CONTROLLER_SYNC_POLL_MS = 500;

let controllerSyncStarted = false;
let applyingRemoteControllerConfig = false;
let lastControllerRuntimeRevision = -1;

function readLocalControllerConfig(): unknown | null {
    const stored = window.localStorage.getItem(
        CONTROLLER_STORAGE_KEY
    );

    if (!stored) {
        return null;
    }

    try {
        return JSON.parse(stored) as unknown;
    } catch {
        return null;
    }
}

function controllerValuesEqual(
    left: unknown,
    right: unknown
): boolean {
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        return false;
    }
}

function applySharedControllerConfig(value: unknown | null) {
    const current = readLocalControllerConfig();
    if (controllerValuesEqual(current, value)) {
        return;
    }

    applyingRemoteControllerConfig = true;
    try {
        if (value === null) {
            window.localStorage.removeItem(CONTROLLER_STORAGE_KEY);
        } else {
            window.localStorage.setItem(
                CONTROLLER_STORAGE_KEY,
                JSON.stringify(value, null, 2)
            );
        }

        window.dispatchEvent(new Event(CONTROLLER_CHANGED_EVENT));
    } finally {
        applyingRemoteControllerConfig = false;
    }
}

function startControllerConfigRuntimeSync() {
    if (
        controllerSyncStarted
        || typeof window === "undefined"
    ) {
        return;
    }

    controllerSyncStarted = true;

    const publishLocalControllerConfig = () => {
        if (applyingRemoteControllerConfig) {
            return;
        }

        void updateMultiFXRuntimeState({
            controllerConfig: readLocalControllerConfig()
        }).catch(() => {
            // The frontend continues to work if the companion bridge has not
            // been upgraded yet; sync resumes automatically when available.
        });
    };

    window.addEventListener(
        CONTROLLER_CHANGED_EVENT,
        publishLocalControllerConfig
    );

    const poll = async () => {
        try {
            const state = await readMultiFXRuntimeState();

            if (state.revision !== lastControllerRuntimeRevision) {
                lastControllerRuntimeRevision = state.revision;

                if (state.controllerConfig !== undefined) {
                    applySharedControllerConfig(
                        state.controllerConfig ?? null
                    );
                } else {
                    // First upgraded client seeds the shared service from its
                    // existing controller override. If there is no override,
                    // leave the service uninitialized so the shipped config is
                    // still used normally.
                    const local = window.localStorage.getItem(
                        CONTROLLER_STORAGE_KEY
                    );
                    if (local) {
                        publishLocalControllerConfig();
                    }
                }
            }
        } catch {
            // Runtime sync is optional at boot and may come online after the
            // browser. Keep retrying silently.
        } finally {
            window.setTimeout(poll, CONTROLLER_SYNC_POLL_MS);
        }
    };

    void poll();
}

startControllerConfigRuntimeSync();
