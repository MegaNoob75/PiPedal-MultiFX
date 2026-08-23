/*
 * PiPedal-MultiFX shared runtime transport.
 *
 * One singleton poller owns the bridge connection. Components subscribe to the
 * same normalized snapshot instead of running independent GET loops. Persistent
 * shared state is limited to controllerConfig and presetAssignments; Snapshot
 * Mode / Chain Bypass are transient runtime state and reset with the bridge.
 */

export type MultiFXControllerInputCapability = "digital" | "analog";

export type MultiFXControllerInput = {
    id: string;
    type: "gpio" | "mux" | "externalAdc" | "other";
    instance: number;
    channel: number;
    capabilities: MultiFXControllerInputCapability[];
    label: string;
    available: boolean;
    reserved: boolean;
    assignedTo: string | null;
    reason: string | null;
};

export type MultiFXControllerHardware = {
    connected: boolean;
    protocolVersion: number | null;
    boardName: string | null;
    inputs: MultiFXControllerInput[];
};

export type MultiFXControllerLearn = {
    status: "idle" | "waiting" | "learned" | "timeout" | "cancelled" | "conflict" | "error";
    token: number | null;
    capability: MultiFXControllerInputCapability | null;
    input: MultiFXControllerInput | null;
    message: string;
};

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
    controllerHardware: MultiFXControllerHardware;
    controllerLearn: MultiFXControllerLearn;
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
    controllerLearnStart?: {
        capability: MultiFXControllerInputCapability;
        hardwareSwitch: number;
    };
    controllerLearnCancel?: { token: number };
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

function normalizeControllerInput(
    value: unknown
): MultiFXControllerInput | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Record<string, unknown>;
    const type = source.type === "gpio"
        || source.type === "mux"
        || source.type === "externalAdc"
        ? source.type
        : "other";
    const instance = typeof source.instance === "number"
        && Number.isInteger(source.instance)
        && source.instance >= 0
        ? source.instance
        : null;
    const channel = typeof source.channel === "number"
        && Number.isInteger(source.channel)
        && source.channel >= 0
        ? source.channel
        : null;
    if (instance === null || channel === null) return null;

    const capabilities: MultiFXControllerInputCapability[] = [];
    if (Array.isArray(source.capabilities)) {
        if (source.capabilities.includes("digital")) {
            capabilities.push("digital");
        }
        if (source.capabilities.includes("analog")) {
            capabilities.push("analog");
        }
    }
    if (capabilities.length === 0) return null;

    return {
        id: typeof source.id === "string" && source.id.trim()
            ? source.id
            : `${type}:${instance}:${channel}`,
        type,
        instance,
        channel,
        capabilities,
        label: typeof source.label === "string" && source.label.trim()
            ? source.label
            : `${type} ${instance}:${channel}`,
        available: Boolean(source.available),
        reserved: Boolean(source.reserved),
        assignedTo: typeof source.assignedTo === "string"
            && source.assignedTo.trim()
            ? source.assignedTo
            : null,
        reason: typeof source.reason === "string" && source.reason.trim()
            ? source.reason
            : null
    };
}

function normalizeControllerHardware(
    value: unknown
): MultiFXControllerHardware {
    const source = value && typeof value === "object"
        ? value as Record<string, unknown>
        : {};
    const inputs = Array.isArray(source.inputs)
        ? source.inputs
            .map(normalizeControllerInput)
            .filter((input): input is MultiFXControllerInput => input !== null)
        : [];
    return {
        connected: Boolean(source.connected),
        protocolVersion: typeof source.protocolVersion === "number"
            && Number.isInteger(source.protocolVersion)
            ? source.protocolVersion
            : null,
        boardName: typeof source.boardName === "string" && source.boardName.trim()
            ? source.boardName
            : null,
        inputs
    };
}

function normalizeControllerLearn(value: unknown): MultiFXControllerLearn {
    const source = value && typeof value === "object"
        ? value as Record<string, unknown>
        : {};
    const validStatuses = new Set([
        "idle",
        "waiting",
        "learned",
        "timeout",
        "cancelled",
        "conflict",
        "error"
    ]);
    const status = typeof source.status === "string"
        && validStatuses.has(source.status)
        ? source.status as MultiFXControllerLearn["status"]
        : "idle";
    const capability = source.capability === "digital"
        || source.capability === "analog"
        ? source.capability
        : null;

    return {
        status,
        token: typeof source.token === "number"
            && Number.isInteger(source.token)
            ? source.token
            : null,
        capability,
        input: normalizeControllerInput(source.input),
        message: typeof source.message === "string" ? source.message : ""
    };
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
        ) ? source.presetAssignments : undefined,
        controllerHardware: normalizeControllerHardware(
            source.controllerHardware
        ),
        controllerLearn: normalizeControllerLearn(source.controllerLearn)
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
