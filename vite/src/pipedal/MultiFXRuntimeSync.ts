/*
 * PiPedal-MultiFX shared runtime transport.
 *
 * One singleton poller owns the bridge connection. Components subscribe to the
 * same normalized snapshot instead of running independent GET loops. Persistent
 * shared state is limited to controllerConfig and presetAssignments; Snapshot
 * Mode / Chain Bypass are transient runtime state and reset with the bridge.
 */

export type MultiFXRuntimeState = {
    version: number;
    revision: number;
    instanceId: string;

    snapshotMode: boolean;
    snapshotPresetId: number | null;
    chainBypassed: boolean;
    chainBypassPresetId: number | null;
    chainBypassWasPresetChanged: boolean;
    chainBypassEnabledStates: Record<string, boolean>;

    controllerConfig?: unknown | null;
    presetAssignments?: unknown;
};

export type MultiFXPresetAssignmentUpdate = {
    bankId: number;
    switchId: string;
    presetId: number | null;
};

export type MultiFXRuntimeStatePatch = Partial<Pick<
    MultiFXRuntimeState,
    | "snapshotMode"
    | "snapshotPresetId"
    | "chainBypassed"
    | "chainBypassPresetId"
    | "chainBypassWasPresetChanged"
    | "chainBypassEnabledStates"
    | "controllerConfig"
>> & {
    presetAssignmentUpdate?: MultiFXPresetAssignmentUpdate;
    presetAssignmentSwap?: { bankId: number; leftSwitchId: string; rightSwitchId: string };
    replacePresetAssignments?: unknown;
    resetPresetAssignments?: boolean;
    deletePresetAssignmentsBank?: number;
    deletePresetAssignmentsPreset?: { bankId: number; presetId: number };
};

export const MULTIFX_RUNTIME_POLL_MS = 250;
export const MULTIFX_RUNTIME_STATE_CHANGED_EVENT =
    "multifx-runtime-state-changed";

function runtimeStateUrl(): string {
    const hostname = window.location.hostname.includes(":")
        ? `[${window.location.hostname}]`
        : window.location.hostname;
    return `http://${hostname}:8877/multifx-state`;
}

function numberOrNull(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : null;
}

function normalizeRuntimeState(value: unknown): MultiFXRuntimeState {
    const source = value && typeof value === "object"
        ? value as Record<string, unknown>
        : {};

    const enabledStates: Record<string, boolean> = {};
    const rawEnabled = source.chainBypassEnabledStates;
    if (rawEnabled && typeof rawEnabled === "object") {
        for (const [key, enabled] of Object.entries(
            rawEnabled as Record<string, unknown>
        )) {
            if (Number.isFinite(Number(key))) {
                enabledStates[String(Number(key))] = Boolean(enabled);
            }
        }
    }

    return {
        version: typeof source.version === "number" ? source.version : 0,
        revision: typeof source.revision === "number" ? source.revision : 0,
        instanceId:
            typeof source.instanceId === "string" && source.instanceId
                ? source.instanceId
                : "unknown",
        snapshotMode: Boolean(source.snapshotMode),
        snapshotPresetId: numberOrNull(source.snapshotPresetId),
        chainBypassed: Boolean(source.chainBypassed),
        chainBypassPresetId: numberOrNull(source.chainBypassPresetId),
        chainBypassWasPresetChanged:
            Boolean(source.chainBypassWasPresetChanged),
        chainBypassEnabledStates: enabledStates,
        controllerConfig: Object.prototype.hasOwnProperty.call(
            source,
            "controllerConfig"
        ) ? source.controllerConfig : undefined,
        presetAssignments: Object.prototype.hasOwnProperty.call(
            source,
            "presetAssignments"
        ) ? source.presetAssignments : undefined
    };
}

async function fetchRuntimeState(
    method: "GET" | "POST",
    body?: MultiFXRuntimeStatePatch,
    signal?: AbortSignal
): Promise<MultiFXRuntimeState> {
    const response = await fetch(runtimeStateUrl(), {
        method,
        cache: "no-store",
        headers: method === "POST"
            ? { "Content-Type": "application/json" }
            : undefined,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal
    });

    if (!response.ok) {
        throw new Error(
            `MultiFX runtime ${method} failed: HTTP ${response.status}`
        );
    }

    return normalizeRuntimeState(await response.json());
}

let latestState: MultiFXRuntimeState | null = null;
let pollStarted = false;
let stopped = false;
let pollTimer: number | null = null;
let inFlight = false;
let pendingWrites = 0;
let writeQueue: Promise<void> = Promise.resolve();
const listeners = new Set<(state: MultiFXRuntimeState) => void>();

function publishState(state: MultiFXRuntimeState) {
    const previousKey = latestState
        ? `${latestState.instanceId}:${latestState.revision}`
        : "";
    const nextKey = `${state.instanceId}:${state.revision}`;
    latestState = state;

    if (nextKey === previousKey) return;

    for (const listener of listeners) {
        try {
            listener(state);
        } catch {
            // One UI subscriber must never stop synchronization for others.
        }
    }

    window.dispatchEvent(
        new CustomEvent(MULTIFX_RUNTIME_STATE_CHANGED_EVENT, {
            detail: state
        })
    );
}

async function pollOnce() {
    if (stopped || inFlight || pendingWrites > 0) return;
    inFlight = true;
    try {
        publishState(await fetchRuntimeState("GET"));
    } catch {
        // The bridge may start after Chromium; retry quietly.
    } finally {
        inFlight = false;
    }
}

function schedulePoll() {
    if (stopped) return;
    pollTimer = window.setTimeout(async () => {
        await pollOnce();
        schedulePoll();
    }, MULTIFX_RUNTIME_POLL_MS);
}

export function startMultiFXRuntimeSync() {
    if (pollStarted || typeof window === "undefined") return;
    pollStarted = true;
    stopped = false;
    void pollOnce();
    schedulePoll();
}

export function stopMultiFXRuntimeSyncForTests() {
    stopped = true;
    if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
    }
}

export function getLatestMultiFXRuntimeState(): MultiFXRuntimeState | null {
    return latestState;
}

export function subscribeMultiFXRuntimeState(
    listener: (state: MultiFXRuntimeState) => void,
    emitCurrent = true
): () => void {
    startMultiFXRuntimeSync();
    listeners.add(listener);
    if (emitCurrent && latestState) listener(latestState);
    return () => listeners.delete(listener);
}

export async function readMultiFXRuntimeState(
    signal?: AbortSignal
): Promise<MultiFXRuntimeState> {
    const state = await fetchRuntimeState("GET", undefined, signal);
    publishState(state);
    return state;
}

export async function updateMultiFXRuntimeState(
    patch: MultiFXRuntimeStatePatch,
    signal?: AbortSignal
): Promise<MultiFXRuntimeState> {
    pendingWrites += 1;

    let resolveResult!: (state: MultiFXRuntimeState) => void;
    let rejectResult!: (reason?: unknown) => void;
    const resultPromise = new Promise<MultiFXRuntimeState>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
    });

    writeQueue = writeQueue
        .catch(() => undefined)
        .then(async () => {
            try {
                const state = await fetchRuntimeState("POST", patch, signal);
                publishState(state);
                resolveResult(state);
            } catch (error) {
                rejectResult(error);
            } finally {
                pendingWrites = Math.max(0, pendingWrites - 1);
            }
        });

    return resultPromise;
}

/* Controller configuration sync is centralized here too. */
const CONTROLLER_STORAGE_KEY = "pipedal-multifx-controller-config-v2";
const CONTROLLER_CHANGED_EVENT = "multifx-controller-config-changed";
let applyingRemoteController = false;
let controllerSyncStarted = false;

function readLocalControllerConfig(): unknown | null {
    const raw = window.localStorage.getItem(CONTROLLER_STORAGE_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return null;
    }
}

function sameJson(left: unknown, right: unknown): boolean {
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        return false;
    }
}

function applyRemoteControllerConfig(value: unknown | null) {
    const current = readLocalControllerConfig();
    if (sameJson(current, value)) return;

    applyingRemoteController = true;
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
        applyingRemoteController = false;
    }
}

function startControllerSync() {
    if (controllerSyncStarted || typeof window === "undefined") return;
    controllerSyncStarted = true;

    window.addEventListener(CONTROLLER_CHANGED_EVENT, () => {
        if (applyingRemoteController) return;
        void updateMultiFXRuntimeState({
            controllerConfig: readLocalControllerConfig()
        }).catch(() => undefined);
    });

    subscribeMultiFXRuntimeState((state) => {
        if (state.controllerConfig !== undefined) {
            applyRemoteControllerConfig(state.controllerConfig ?? null);
        }
    });
}

if (typeof window !== "undefined") {
    startMultiFXRuntimeSync();
    startControllerSync();
}
