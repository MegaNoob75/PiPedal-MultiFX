/*
 * PiPedal-MultiFX shared runtime transport.
 *
 * One singleton poller owns the bridge connection. Components subscribe to the
 * same normalized snapshot instead of running independent GET loops. Persistent
 * durable shared state is limited to controllerConfig, presetAssignments and
 * the active theme; Snapshot Mode, per-preset snapshot selections, and Chain
 * Bypass remain transient runtime state and reset with the bridge.
 */

import {
    applyMultiFXTheme,
    loadMultiFXTheme,
    MULTIFX_THEME_CHANGED_EVENT,
    MultiFXThemeDefinition,
    THEME_STORAGE_KEY,
    validateMultiFXTheme
} from "./MultiFXTheme";
import {
    loadMultiFXUIBehaviorSettings,
    MULTIFX_UI_BEHAVIOR_CHANGED_EVENT,
    MULTIFX_UI_BEHAVIOR_STORAGE_KEY,
    MultiFXUIBehaviorSettings,
    validateMultiFXUIBehaviorSettings
} from "./MultiFXUIBehavior";

export type MultiFXControllerInputCapability = "digital" | "analog";
export type MultiFXControllerLearnCapability =
    | MultiFXControllerInputCapability
    | "encoder"
    | "encoderPush";

export type MultiFXControllerInput = {
    id: string;
    type: "gpio" | "mux" | "gpioExpander" | "externalAdc" | "other";
    instance: number;
    channel: number;
    moduleId: string | null;
    capabilities: MultiFXControllerInputCapability[];
    outputCapable: boolean;
    label: string;
    available: boolean;
    reserved: boolean;
    caution: boolean;
    recommended: boolean;
    assignedTo: string | null;
    reason: string | null;
};

export type MultiFXControllerDriver = {
    id: string;
    label: string;
};

export type MultiFXControllerApplyStatus = {
    status: "idle" | "applying" | "applied" | "error";
    token: number | null;
    message: string;
};

export type MultiFXControllerHardware = {
    connected: boolean;
    protocolVersion: number | null;
    boardId: string | null;
    boardName: string | null;
    drivers: MultiFXControllerDriver[];
    moduleScanSupported: boolean;
    limits: {
        modules: number;
        analogControls: number;
        encoders: number;
    };
    inputs: MultiFXControllerInput[];
    apply: MultiFXControllerApplyStatus;
};

export type MultiFXControllerLearn = {
    status: "idle" | "waiting" | "learned" | "timeout" | "cancelled" | "conflict" | "error";
    token: number | null;
    capability: MultiFXControllerLearnCapability | null;
    input: MultiFXControllerInput | null;
    secondaryInput: MultiFXControllerInput | null;
    message: string;
};

export type MultiFXControllerModuleScan = {
    status: "idle" | "scanning" | "complete" | "error";
    token: number | null;
    sdaPin: number | null;
    sclPin: number | null;
    devices: Array<{
        address: number;
        family: "mcp23017" | "ads1x15";
    }>;
    message: string;
};

export type MultiFXRuntimeState = {
    version: number;
    revision: number;
    instanceId: string;

    snapshotMode: boolean;
    snapshotModeBankId: number | null;
    snapshotPresetId: number | null;
    snapshotSessionInitialized: boolean;
    presetSnapshotStates: Record<string, MultiFXPresetSnapshotState>;
    chainBypassed: boolean;
    chainBypassBankId: number | null;
    chainBypassPresetId: number | null;
    chainBypassSnapshotIndex: number | null;
    chainBypassWasPresetChanged: boolean;
    chainBypassEnabledStates: Record<string, boolean>;

    controllerConfig?: unknown | null;
    presetAssignments?: unknown;
    theme?: unknown | null;
    uiSettings?: unknown | null;
    controllerHardware: MultiFXControllerHardware;
    controllerLearn: MultiFXControllerLearn;
    controllerModuleScan: MultiFXControllerModuleScan;
};

export type MultiFXPresetAssignmentUpdate = {
    bankId: number;
    switchId: string;
    presetId: number | null;
};

export type MultiFXPresetSnapshotState = {
    snapshotIndex: number;
    enabled: boolean;
};

export type MultiFXPresetSnapshotStateUpdate = {
    bankId: number;
    presetId: number;
    snapshotIndex: number | null;
    enabled: boolean;
};

export type MultiFXRuntimeStatePatch = Partial<Pick<
    MultiFXRuntimeState,
    | "snapshotMode"
    | "snapshotModeBankId"
    | "snapshotPresetId"
    | "snapshotSessionInitialized"
    | "chainBypassed"
    | "chainBypassBankId"
    | "chainBypassPresetId"
    | "chainBypassSnapshotIndex"
    | "chainBypassWasPresetChanged"
    | "chainBypassEnabledStates"
    | "controllerConfig"
    | "theme"
    | "uiSettings"
>> & {
    presetSnapshotStateUpdate?: MultiFXPresetSnapshotStateUpdate;
    resetPresetSnapshotStates?: boolean;
    presetAssignmentUpdate?: MultiFXPresetAssignmentUpdate;
    presetAssignmentSwap?: { bankId: number; leftSwitchId: string; rightSwitchId: string };
    replacePresetAssignments?: unknown;
    resetPresetAssignments?: boolean;
    deletePresetAssignmentsBank?: number;
    deletePresetAssignmentsPreset?: { bankId: number; presetId: number };
    controllerLearnStart?: {
        capability: MultiFXControllerLearnCapability;
        hardwareSwitch: number;
    };
    controllerLearnCancel?: { token: number };
    controllerModuleScanStart?: { sdaPin: number; sclPin: number };
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

const MAX_PRESET_SNAPSHOT_STATES = 512;

function nonnegativeIntegerOrNull(value: unknown): number | null {
    return typeof value === "number"
        && Number.isSafeInteger(value)
        && value >= 0
        ? value
        : null;
}

function snapshotIndexOrNull(value: unknown): number | null {
    return typeof value === "number"
        && Number.isInteger(value)
        && value >= 0
        && value <= 5
        ? value
        : null;
}

function normalizePresetSnapshotStates(
    value: unknown
): Record<string, MultiFXPresetSnapshotState> {
    const result: Record<string, MultiFXPresetSnapshotState> = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return result;
    }

    for (const [key, rawState] of Object.entries(
        value as Record<string, unknown>
    )) {
        if (Object.keys(result).length >= MAX_PRESET_SNAPSHOT_STATES) break;
        const match = /^(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(key);
        if (!match || !rawState || typeof rawState !== "object"
            || Array.isArray(rawState)) continue;
        const bankId = Number(match[1]);
        const presetId = Number(match[2]);
        if (!Number.isSafeInteger(bankId) || !Number.isSafeInteger(presetId)) {
            continue;
        }
        const source = rawState as Record<string, unknown>;
        const snapshotIndex = snapshotIndexOrNull(source.snapshotIndex);
        if (snapshotIndex === null || typeof source.enabled !== "boolean") {
            continue;
        }
        result[`${bankId}:${presetId}`] = {
            snapshotIndex,
            enabled: source.enabled
        };
    }
    return result;
}

function normalizeControllerInput(
    value: unknown
): MultiFXControllerInput | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Record<string, unknown>;
    const type = source.type === "gpio"
        || source.type === "mux"
        || source.type === "gpioExpander"
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
        moduleId: typeof source.moduleId === "string" && source.moduleId.trim()
            ? source.moduleId
            : null,
        capabilities,
        outputCapable: Boolean(source.outputCapable),
        label: typeof source.label === "string" && source.label.trim()
            ? source.label
            : `${type} ${instance}:${channel}`,
        available: Boolean(source.available),
        reserved: Boolean(source.reserved),
        caution: Boolean(source.caution),
        recommended: Boolean(source.recommended),
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
    const rawDrivers = Array.isArray(source.drivers) ? source.drivers : [];
    const drivers = rawDrivers.flatMap((value): MultiFXControllerDriver[] => {
        if (!value || typeof value !== "object") return [];
        const item = value as Record<string, unknown>;
        if (typeof item.id !== "string" || !item.id.trim()) return [];
        return [{
            id: item.id,
            label: typeof item.label === "string" && item.label.trim()
                ? item.label
                : item.id
        }];
    });
    const rawLimits = source.limits && typeof source.limits === "object"
        ? source.limits as Record<string, unknown>
        : {};
    const rawApply = source.apply && typeof source.apply === "object"
        ? source.apply as Record<string, unknown>
        : {};
    const applyStatuses = new Set(["idle", "applying", "applied", "error"]);
    return {
        connected: Boolean(source.connected),
        protocolVersion: typeof source.protocolVersion === "number"
            && Number.isInteger(source.protocolVersion)
            ? source.protocolVersion
            : null,
        boardId: typeof source.boardId === "string" && source.boardId.trim()
            ? source.boardId
            : null,
        boardName: typeof source.boardName === "string" && source.boardName.trim()
            ? source.boardName
            : null,
        drivers,
        moduleScanSupported: Boolean(source.moduleScanSupported),
        limits: {
            modules: Math.max(0, Math.trunc(Number(rawLimits.modules) || 0)),
            analogControls: Math.max(0, Math.trunc(Number(rawLimits.analogControls) || 0)),
            encoders: Math.max(0, Math.trunc(Number(rawLimits.encoders) || 0))
        },
        inputs,
        apply: {
            status: typeof rawApply.status === "string"
                && applyStatuses.has(rawApply.status)
                ? rawApply.status as MultiFXControllerApplyStatus["status"]
                : "idle",
            token: typeof rawApply.token === "number"
                && Number.isInteger(rawApply.token)
                ? rawApply.token
                : null,
            message: typeof rawApply.message === "string" ? rawApply.message : ""
        }
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
        || source.capability === "encoder"
        || source.capability === "encoderPush"
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
        secondaryInput: normalizeControllerInput(source.secondaryInput),
        message: typeof source.message === "string" ? source.message : ""
    };
}

function normalizeControllerModuleScan(
    value: unknown
): MultiFXControllerModuleScan {
    const source = value && typeof value === "object"
        ? value as Record<string, unknown>
        : {};
    const statuses = new Set(["idle", "scanning", "complete", "error"]);
    const rawDevices = Array.isArray(source.devices) ? source.devices : [];
    const devices: MultiFXControllerModuleScan["devices"] = [];
    for (const value of rawDevices) {
        if (!value || typeof value !== "object") continue;
        const device = value as Record<string, unknown>;
        if (typeof device.address !== "number"
            || !Number.isInteger(device.address)
            || (device.family !== "mcp23017"
                && device.family !== "ads1x15")) continue;
        devices.push({
            address: device.address,
            family: device.family
        });
    }
    return {
        status: typeof source.status === "string"
            && statuses.has(source.status)
            ? source.status as MultiFXControllerModuleScan["status"]
            : "idle",
        token: numberOrNull(source.token),
        sdaPin: numberOrNull(source.sdaPin),
        sclPin: numberOrNull(source.sclPin),
        devices,
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

    const presetSnapshotStates = normalizePresetSnapshotStates(
        source.presetSnapshotStates
    );

    return {
        version: typeof source.version === "number" ? source.version : 0,
        revision: typeof source.revision === "number" ? source.revision : 0,
        instanceId:
            typeof source.instanceId === "string" && source.instanceId
                ? source.instanceId
                : "unknown",
        snapshotMode: Boolean(source.snapshotMode),
        snapshotModeBankId: nonnegativeIntegerOrNull(
            source.snapshotModeBankId
        ),
        snapshotPresetId: numberOrNull(source.snapshotPresetId),
        snapshotSessionInitialized:
            typeof source.snapshotSessionInitialized === "boolean"
                ? source.snapshotSessionInitialized
                : false,
        presetSnapshotStates,
        chainBypassed: Boolean(source.chainBypassed),
        chainBypassBankId: nonnegativeIntegerOrNull(
            source.chainBypassBankId
        ),
        chainBypassPresetId: numberOrNull(source.chainBypassPresetId),
        chainBypassSnapshotIndex: snapshotIndexOrNull(
            source.chainBypassSnapshotIndex
        ),
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
        theme: Object.prototype.hasOwnProperty.call(source, "theme")
            ? source.theme
            : undefined,
        uiSettings: Object.prototype.hasOwnProperty.call(source, "uiSettings")
            ? source.uiSettings
            : undefined,
        controllerHardware: normalizeControllerHardware(
            source.controllerHardware
        ),
        controllerLearn: normalizeControllerLearn(source.controllerLearn),
        controllerModuleScan: normalizeControllerModuleScan(
            source.controllerModuleScan
        )
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
const CONTROLLER_STORAGE_KEY = "pipedal-multifx-controller-config-v4";
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

/* The bridge remains the shared source for themes received from another
   display. Local theme edits stay local until the user explicitly presses
   SYNC THEME, so unfinished previews are not pushed to every screen. */
let themeSyncStarted = false;
let themeBootstrapSent = false;

function applyRemoteTheme(value: unknown) {
    const valid = validateMultiFXTheme(value);
    if (!valid || sameJson(loadMultiFXTheme(), valid)) return;

    window.localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify(valid, null, 2)
    );
    applyMultiFXTheme(valid);
    window.dispatchEvent(new Event(MULTIFX_THEME_CHANGED_EVENT));
}

/** Send a complete, validated theme to the bridge and connected displays. */
export async function syncMultiFXTheme(
    theme: MultiFXThemeDefinition
): Promise<MultiFXRuntimeState> {
    const valid = validateMultiFXTheme(theme);
    if (!valid) throw new Error("Theme is invalid and could not be synced.");
    return updateMultiFXRuntimeState({ theme: valid });
}

function startThemeSync() {
    if (themeSyncStarted || typeof window === "undefined") return;
    themeSyncStarted = true;

    subscribeMultiFXRuntimeState((runtime) => {
        if (runtime.theme !== undefined && runtime.theme !== null) {
            applyRemoteTheme(runtime.theme);
            return;
        }
        if (!themeBootstrapSent) {
            themeBootstrapSent = true;
            void syncMultiFXTheme(loadMultiFXTheme()).catch(() => undefined);
        }
    });
}

/* Interaction preferences are shared independently of the visual theme. This
   keeps pop-out/timing behavior identical without mixing system behavior into
   a theme preset. */
let applyingRemoteUIBehavior = false;
let uiBehaviorSyncStarted = false;
let uiBehaviorBootstrapSent = false;

function applyRemoteUIBehavior(value: unknown) {
    const valid = validateMultiFXUIBehaviorSettings(value);
    if (!valid || sameJson(loadMultiFXUIBehaviorSettings(), valid)) return;

    applyingRemoteUIBehavior = true;
    try {
        window.localStorage.setItem(
            MULTIFX_UI_BEHAVIOR_STORAGE_KEY,
            JSON.stringify(valid, null, 2)
        );
        window.dispatchEvent(new Event(MULTIFX_UI_BEHAVIOR_CHANGED_EVENT));
    } finally {
        applyingRemoteUIBehavior = false;
    }
}

function publishLocalUIBehavior(settings: MultiFXUIBehaviorSettings) {
    void updateMultiFXRuntimeState({ uiSettings: settings })
        .catch(() => undefined);
}

function startUIBehaviorSync() {
    if (uiBehaviorSyncStarted || typeof window === "undefined") return;
    uiBehaviorSyncStarted = true;

    window.addEventListener(MULTIFX_UI_BEHAVIOR_CHANGED_EVENT, () => {
        if (!applyingRemoteUIBehavior) {
            publishLocalUIBehavior(loadMultiFXUIBehaviorSettings());
        }
    });

    subscribeMultiFXRuntimeState((runtime) => {
        if (runtime.uiSettings !== undefined
            && runtime.uiSettings !== null) {
            applyRemoteUIBehavior(runtime.uiSettings);
            return;
        }
        if (!uiBehaviorBootstrapSent) {
            uiBehaviorBootstrapSent = true;
            publishLocalUIBehavior(loadMultiFXUIBehaviorSettings());
        }
    });
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
    startThemeSync();
    startUIBehaviorSync();
}
