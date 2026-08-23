/*
 * PiPedal-MultiFX Performance preset assignments.
 *
 * Musical assignment is keyed by PiPedal bank ID + logical controller switch
 * ID. Layout position, grid/freeform geometry and controller switch count never
 * reshape or reorder saved musical assignments.
 *
 * The bridge is authoritative. localStorage is only a last-known display cache;
 * it is never allowed to repopulate server state implicitly.
 */

import {
    MultiFXRuntimeState,
    subscribeMultiFXRuntimeState,
    updateMultiFXRuntimeState
} from "./MultiFXRuntimeSync";

export const MULTIFX_PRESET_ASSIGNMENTS_CHANGED_EVENT =
    "multifx-preset-assignments-changed";

const STORAGE_KEY = "pipedal-multifx-preset-assignments-v1";

export type MultiFXPresetAssignmentBank = Record<string, number | null>;

export type MultiFXPresetAssignments = {
    version: 1;
    banks: Record<string, MultiFXPresetAssignmentBank>;
};

const EMPTY_STORE: MultiFXPresetAssignments = {
    version: 1,
    banks: {}
};

let store: MultiFXPresetAssignments = loadCache();
let runtimeSubscriptionStarted = false;
let mutationQueue: Promise<void> = Promise.resolve();

async function queueRuntimeMutation(
    operation: () => Promise<MultiFXRuntimeState>
): Promise<MultiFXRuntimeState> {
    let resolveResult!: (state: MultiFXRuntimeState) => void;
    let rejectResult!: (reason?: unknown) => void;
    const result = new Promise<MultiFXRuntimeState>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
    });

    mutationQueue = mutationQueue
        .catch(() => undefined)
        .then(async () => {
            try {
                resolveResult(await operation());
            } catch (error) {
                rejectResult(error);
            }
        });

    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAssignments(value: unknown): MultiFXPresetAssignments | null {
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.banks)) {
        return null;
    }

    const banks: Record<string, MultiFXPresetAssignmentBank> = {};
    for (const [bankKey, bankValue] of Object.entries(value.banks)) {
        if (!/^\d+$/.test(bankKey) || !isRecord(bankValue)) return null;
        const assignments: MultiFXPresetAssignmentBank = {};
        for (const [switchId, rawPresetId] of Object.entries(bankValue)) {
            if (!switchId.trim()) return null;
            if (rawPresetId === null) assignments[switchId] = null;
            else if (typeof rawPresetId === "number" && Number.isInteger(rawPresetId) && rawPresetId >= 0) {
                assignments[switchId] = rawPresetId;
            } else return null;
        }
        banks[bankKey] = assignments;
    }
    return { version: 1, banks };
}

function cloneStore(value: MultiFXPresetAssignments): MultiFXPresetAssignments {
    return structuredClone(value);
}

function loadCache(): MultiFXPresetAssignments {
    if (typeof window === "undefined") return cloneStore(EMPTY_STORE);

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        return raw ? (parseAssignments(JSON.parse(raw) as unknown) ?? cloneStore(EMPTY_STORE)) : cloneStore(EMPTY_STORE);
    } catch {
        return cloneStore(EMPTY_STORE);
    }
}

function saveCache() {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
        // Cache failure must never prevent live operation.
    }
}

function emitChanged() {
    saveCache();
    window.dispatchEvent(
        new CustomEvent(MULTIFX_PRESET_ASSIGNMENTS_CHANGED_EVENT, {
            detail: cloneStore(store)
        })
    );
}

function applyRuntimeState(state: MultiFXRuntimeState) {
    if (state.presetAssignments === undefined) return;

    const next = parseAssignments(state.presetAssignments);
    if (!next || JSON.stringify(next) === JSON.stringify(store)) return;

    store = next;
    emitChanged();
}

function ensureRuntimeSubscription() {
    if (runtimeSubscriptionStarted || typeof window === "undefined") return;
    runtimeSubscriptionStarted = true;
    subscribeMultiFXRuntimeState(applyRuntimeState);
}

export function getPresetAssignments(): MultiFXPresetAssignments {
    ensureRuntimeSubscription();
    return cloneStore(store);
}

export function getBankPresetAssignments(
    bankId: number
): MultiFXPresetAssignmentBank {
    ensureRuntimeSubscription();
    return { ...(store.banks[String(bankId)] ?? {}) };
}

export function getPresetAssignment(
    bankId: number,
    switchId: string
): number | null {
    return getBankPresetAssignments(bankId)[switchId] ?? null;
}

export async function setPresetAssignment(
    bankId: number,
    switchId: string,
    presetId: number | null
): Promise<void> {
    if (!Number.isInteger(bankId) || bankId < 0) return;
    if (!switchId.trim()) return;
    if (presetId !== null && (!Number.isInteger(presetId) || presetId < 0)) return;

    // Optimistic local update makes the pedal screen immediate. The bridge
    // response is then applied through the shared runtime subscription.
    const bankKey = String(bankId);
    store = cloneStore(store);
    store.banks[bankKey] = {
        ...(store.banks[bankKey] ?? {}),
        [switchId]: presetId
    };
    emitChanged();

    await queueRuntimeMutation(() =>
        updateMultiFXRuntimeState({
            presetAssignmentUpdate: { bankId, switchId, presetId }
        })
    );
}

export async function swapPresetAssignments(
    bankId: number,
    leftSwitchId: string,
    rightSwitchId: string
): Promise<void> {
    if (leftSwitchId === rightSwitchId) return;

    // The bridge performs the swap atomically so another browser never sees
    // the temporary half-swapped state.
    const state = await queueRuntimeMutation(() =>
        updateMultiFXRuntimeState({
            presetAssignmentSwap: { bankId, leftSwitchId, rightSwitchId }
        })
    );

    if (state.presetAssignments !== undefined) {
        const next = parseAssignments(state.presetAssignments);
        if (next && JSON.stringify(next) !== JSON.stringify(store)) {
            store = next;
            emitChanged();
        }
    }
}

export async function clearPresetAssignmentsForPreset(
    bankId: number,
    presetId: number
): Promise<void> {
    await queueRuntimeMutation(() => updateMultiFXRuntimeState({
        deletePresetAssignmentsPreset: { bankId, presetId }
    }));
}

export async function deletePresetAssignmentsForBank(
    bankId: number
): Promise<void> {
    await queueRuntimeMutation(() => updateMultiFXRuntimeState({
        deletePresetAssignmentsBank: bankId
    }));
}

export async function replacePresetAssignments(
    value: unknown
): Promise<void> {
    const normalized = parseAssignments(value);
    if (!normalized) {
        throw new Error("Preset assignment backup uses an unsupported schema.");
    }
    await queueRuntimeMutation(() =>
        updateMultiFXRuntimeState({ replacePresetAssignments: normalized })
    );
}

export async function resetPresetAssignments(): Promise<void> {
    await queueRuntimeMutation(() =>
        updateMultiFXRuntimeState({ resetPresetAssignments: true })
    );
}

export function clearPresetAssignmentCache(): void {
    store = cloneStore(EMPTY_STORE);
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Cache is optional.
    }
    emitChanged();
}

ensureRuntimeSubscription();
