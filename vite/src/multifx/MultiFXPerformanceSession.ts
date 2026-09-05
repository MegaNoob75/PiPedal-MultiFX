/*
 * One transition coordinator for PI-MULTIFX preset/snapshot performance state.
 *
 * PiPedal remains the authority for the sound that is actually loaded. The
 * bridge runtime stores only the user's transient intent for this controller
 * session, shared by the touchscreen and PC browser.
 */

import { PiPedalModel, State } from "../pipedal/PiPedalModel";
import { Snapshot } from "../pipedal/Pedalboard";
import {
    getLatestMultiFXRuntimeState,
    MultiFXPresetSnapshotState,
    MultiFXRuntimeState,
    readMultiFXRuntimeState,
    updateMultiFXRuntimeState
} from "./MultiFXRuntimeSync";
import {
    presetSnapshotSessionKey,
    PresetSnapshotSessionState,
    snapshotSessionNeedsBaseReload
} from "./MultiFXSnapshotSessionState";

const TRANSITION_TIMEOUT_MS = 8000;
const PEDALBOARD_SETTLE_QUIET_MS = 120;
const PEDALBOARD_SETTLE_MAX_MS = 1000;

export type MultiFXPerformanceTransition = {
    id: number;
    signal: AbortSignal;
    sharedReady: Promise<void>;
};

let nextTransitionId = 0;
let activeTransition: {
    id: number;
    controller: AbortController;
} | null = null;

const performanceOwnerId = (() => {
    if (typeof window === "undefined") return `test-${Math.random()}`;
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
})();

export class MultiFXTransitionCancelledError extends Error {
    constructor() {
        super("A newer PI-MULTIFX performance action replaced this one.");
        this.name = "MultiFXTransitionCancelledError";
    }
}

export function beginMultiFXPerformanceTransition(): MultiFXPerformanceTransition {
    activeTransition?.controller.abort();
    const controller = new AbortController();
    const id = ++nextTransitionId;
    activeTransition = { id, controller };
    const transition: MultiFXPerformanceTransition = {
        id,
        signal: controller.signal,
        sharedReady: Promise.resolve()
    };
    transition.sharedReady = updateMultiFXRuntimeState({
        performanceOperationStart: {
            ownerId: performanceOwnerId,
            operationId: id
        }
    }, controller.signal).then(() => undefined);
    return transition;
}

export function finishMultiFXPerformanceTransition(
    transition: MultiFXPerformanceTransition
): void {
    if (activeTransition?.id === transition.id) {
        activeTransition = null;
    }
    void transition.sharedReady
        .catch(() => undefined)
        .then(() => updateMultiFXRuntimeState({
            performanceOperationFinish: {
                ownerId: performanceOwnerId,
                operationId: transition.id
            }
        }))
        .catch(() => undefined);
}

export function cancelMultiFXPerformanceTransition(
    transition: MultiFXPerformanceTransition
): void {
    if (activeTransition?.id === transition.id) {
        activeTransition.controller.abort();
    }
    finishMultiFXPerformanceTransition(transition);
}

export function isMultiFXPerformanceTransitionActive(): boolean {
    return activeTransition !== null;
}

export function isMultiFXTransitionCancellation(error: unknown): boolean {
    return error instanceof MultiFXTransitionCancelledError
        || (error instanceof DOMException && error.name === "AbortError");
}

function assertTransitionCurrent(
    transition: MultiFXPerformanceTransition
): void {
    if (
        transition.signal.aborted
        || activeTransition?.id !== transition.id
    ) {
        throw new MultiFXTransitionCancelledError();
    }
}

async function ensureSharedTransition(
    transition: MultiFXPerformanceTransition
): Promise<void> {
    await transition.sharedReady;
    assertTransitionCurrent(transition);
    await updateMultiFXRuntimeState({
        performanceOperationTouch: {
            ownerId: performanceOwnerId,
            operationId: transition.id
        }
    }, transition.signal);
    assertTransitionCurrent(transition);
}

function attachAbort(
    signal: AbortSignal,
    reject: (reason: unknown) => void,
    cleanup: () => void
): () => void {
    const onAbort = () => {
        cleanup();
        reject(new MultiFXTransitionCancelledError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    return () => signal.removeEventListener("abort", onAbort);
}

function timeoutError(action: string): Error {
    return new Error(`PiPedal did not confirm ${action} within 8 seconds.`);
}

async function waitForFreshPresetLoad(
    model: PiPedalModel,
    presetId: number,
    transition: MultiFXPerformanceTransition
): Promise<void> {
    await ensureSharedTransition(transition);

    await new Promise<void>((resolve, reject) => {
        let settled = false;
        let armed = false;
        let sawPedalboard = false;
        let sawPresets = false;
        let removeAbort: () => void = () => undefined;

        const timer = globalThis.setTimeout(
            () => fail(timeoutError("the preset load")),
            TRANSITION_TIMEOUT_MS
        );

        const cleanup = () => {
            globalThis.clearTimeout(timer);
            removeAbort();
            model.pedalboard.removeOnChangedHandler(onPedalboard);
            model.presets.removeOnChangedHandler(onPresets);
            model.presetChanged.removeOnChangedHandler(check);
            model.state.removeOnChangedHandler(onState);
        };
        const finish = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        };
        const fail = (reason: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(reason);
        };
        const check = () => {
            if (!armed || !sawPedalboard || !sawPresets) return;
            if (
                model.presets.get().selectedInstanceId === presetId
                && !model.presetChanged.get()
            ) {
                finish();
            }
        };
        const onPedalboard = () => {
            if (armed) sawPedalboard = true;
            check();
        };
        const onPresets = () => {
            if (armed) sawPresets = true;
            check();
        };
        const onState = (state: State) => {
            if (armed && state === State.Error) {
                fail(new Error("PiPedal disconnected while loading the preset."));
            }
        };

        model.pedalboard.addOnChangedHandler(onPedalboard);
        model.presets.addOnChangedHandler(onPresets);
        model.presetChanged.addOnChangedHandler(check);
        model.state.addOnChangedHandler(onState);
        removeAbort = attachAbort(transition.signal, reject, cleanup);

        armed = true;
        model.loadPreset(presetId);
    });

    assertTransitionCurrent(transition);
}

async function waitForFreshSnapshotSelection(
    model: PiPedalModel,
    snapshotIndex: number,
    transition: MultiFXPerformanceTransition,
    action: string
): Promise<void> {
    await ensureSharedTransition(transition);

    await new Promise<void>((resolve, reject) => {
        let settled = false;
        let armed = false;
        let sawPedalboard = false;
        let removeAbort: () => void = () => undefined;
        const timer = globalThis.setTimeout(
            () => fail(timeoutError(action)),
            TRANSITION_TIMEOUT_MS
        );

        const cleanup = () => {
            globalThis.clearTimeout(timer);
            removeAbort();
            model.pedalboard.removeOnChangedHandler(onPedalboard);
            model.selectedSnapshot.removeOnChangedHandler(check);
            model.state.removeOnChangedHandler(onState);
        };
        const finish = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        };
        const fail = (reason: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(reason);
        };
        const check = () => {
            if (!armed || !sawPedalboard) return;
            if (model.selectedSnapshot.get() === snapshotIndex) finish();
        };
        const onPedalboard = () => {
            if (armed) sawPedalboard = true;
            check();
        };
        const onState = (state: State) => {
            if (armed && state === State.Error) {
                fail(new Error(`PiPedal disconnected while ${action}.`));
            }
        };

        model.pedalboard.addOnChangedHandler(onPedalboard);
        model.selectedSnapshot.addOnChangedHandler(check);
        model.state.addOnChangedHandler(onState);
        removeAbort = attachAbort(transition.signal, reject, cleanup);

        armed = true;
        model.selectSnapshot(snapshotIndex);
    });

    assertTransitionCurrent(transition);
}

async function waitForPedalboardSettled(
    model: PiPedalModel,
    transition: MultiFXPerformanceTransition
): Promise<void> {
    await ensureSharedTransition(transition);

    await new Promise<void>((resolve, reject) => {
        let settled = false;
        let quietTimer: ReturnType<typeof globalThis.setTimeout>;
        let removeAbort: () => void = () => undefined;
        const maximumTimer = globalThis.setTimeout(
            finish,
            PEDALBOARD_SETTLE_MAX_MS
        );

        const cleanup = () => {
            globalThis.clearTimeout(quietTimer);
            globalThis.clearTimeout(maximumTimer);
            removeAbort();
            model.pedalboard.removeOnChangedHandler(onPedalboard);
        };
        function finish() {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        }
        const fail = (reason: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(reason);
        };
        const armQuietTimer = () => {
            globalThis.clearTimeout(quietTimer);
            quietTimer = globalThis.setTimeout(
                finish,
                PEDALBOARD_SETTLE_QUIET_MS
            );
        };
        const onPedalboard = () => armQuietTimer();

        model.pedalboard.addOnChangedHandler(onPedalboard);
        removeAbort = attachAbort(transition.signal, fail, cleanup);
        armQuietTimer();
    });

    assertTransitionCurrent(transition);
}

export async function loadMultiFXBasePreset(
    model: PiPedalModel,
    presetId: number,
    transition: MultiFXPerformanceTransition
): Promise<void> {
    await waitForFreshPresetLoad(model, presetId, transition);

    // A saved PiPedal preset can retain a selectedSnapshot marker. The fresh
    // preset load restores the saved base pedalboard; clearing that marker only
    // after the load prevents it from masquerading as an active session choice.
    if (model.selectedSnapshot.get() >= 0) {
        await waitForFreshSnapshotSelection(
            model,
            -1,
            transition,
            "clearing the saved snapshot marker"
        );
    }

    // Loading stateful plugins and clearing a saved native snapshot marker can
    // produce more pedalboard notifications after the first load acknowledgement.
    // Do not let callers record a clean comparison until that sequence is quiet.
    await waitForPedalboardSettled(model, transition);
    await updateMultiFXRuntimeState({
        cleanBaseReady: {
            bankId: model.banks.get().selectedBank,
            presetId
        }
    }, transition.signal);
    assertTransitionCurrent(transition);
}

export async function recallMultiFXSnapshot(
    model: PiPedalModel,
    snapshotIndex: number,
    transition: MultiFXPerformanceTransition
): Promise<void> {
    await ensureSharedTransition(transition);
    const snapshot = model.pedalboard.get().snapshots[snapshotIndex];
    if (!snapshot) {
        throw new Error(`Snapshot ${snapshotIndex + 1} is empty.`);
    }
    if (model.selectedSnapshot.get() === snapshotIndex) return;
    await waitForFreshSnapshotSelection(
        model,
        snapshotIndex,
        transition,
        `recalling Snapshot ${snapshotIndex + 1}`
    );
}

export async function applyMultiFXPresetSnapshotState(
    model: PiPedalModel,
    presetId: number,
    snapshotState: PresetSnapshotSessionState | null,
    transition: MultiFXPerformanceTransition
): Promise<void> {
    await loadMultiFXBasePreset(model, presetId, transition);
    if (snapshotState?.enabled) {
        await recallMultiFXSnapshot(
            model,
            snapshotState.snapshotIndex,
            transition
        );
    }
}

async function replaceSnapshotsAndWait(
    model: PiPedalModel,
    snapshots: Array<Snapshot | null>,
    transition: MultiFXPerformanceTransition
): Promise<void> {
    await ensureSharedTransition(transition);
    await new Promise<void>((resolve, reject) => {
        let settled = false;
        let armed = false;
        let sawPedalboard = false;
        let removeAbort: () => void = () => undefined;
        const timer = globalThis.setTimeout(
            () => fail(timeoutError("the snapshot update")),
            TRANSITION_TIMEOUT_MS
        );
        const cleanup = () => {
            globalThis.clearTimeout(timer);
            removeAbort();
            model.pedalboard.removeOnChangedHandler(onPedalboard);
            model.presetChanged.removeOnChangedHandler(check);
            model.state.removeOnChangedHandler(onState);
        };
        const finish = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        };
        const fail = (reason: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(reason);
        };
        const check = () => {
            if (armed && sawPedalboard && model.presetChanged.get()) finish();
        };
        const onPedalboard = () => {
            if (armed) sawPedalboard = true;
            check();
        };
        const onState = (state: State) => {
            if (armed && state === State.Error) {
                fail(new Error("PiPedal disconnected while updating snapshots."));
            }
        };

        model.pedalboard.addOnChangedHandler(onPedalboard);
        model.presetChanged.addOnChangedHandler(check);
        model.state.addOnChangedHandler(onState);
        removeAbort = attachAbort(transition.signal, reject, cleanup);
        armed = true;
        // The server marker is already -1 because loadMultiFXBasePreset ran
        // first. Passing -1 therefore keeps both client and server on BASE.
        model.setSnapshots(snapshots, -1);
    });
    assertTransitionCurrent(transition);
}

export async function saveCurrentPresetAndWait(
    model: PiPedalModel,
    transition: MultiFXPerformanceTransition
): Promise<void> {
    await ensureSharedTransition(transition);
    await new Promise<void>((resolve, reject) => {
        let settled = false;
        let armed = false;
        let sawPresetChanged = false;
        let removeAbort: () => void = () => undefined;
        const timer = globalThis.setTimeout(
            () => fail(timeoutError("the preset save")),
            TRANSITION_TIMEOUT_MS
        );
        const cleanup = () => {
            globalThis.clearTimeout(timer);
            removeAbort();
            model.presetChanged.removeOnChangedHandler(onPresetChanged);
            model.state.removeOnChangedHandler(onState);
        };
        const finish = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        };
        const fail = (reason: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(reason);
        };
        const onPresetChanged = () => {
            if (armed) sawPresetChanged = true;
            if (sawPresetChanged && !model.presetChanged.get()) finish();
        };
        const onState = (state: State) => {
            if (armed && state === State.Error) {
                fail(new Error("PiPedal disconnected while saving the preset."));
            }
        };

        model.presetChanged.addOnChangedHandler(onPresetChanged);
        model.state.addOnChangedHandler(onState);
        removeAbort = attachAbort(transition.signal, reject, cleanup);
        armed = true;
        model.saveCurrentPreset();
    });
    assertTransitionCurrent(transition);
    await updateMultiFXRuntimeState({
        cleanBaseReady: {
            bankId: model.banks.get().selectedBank,
            presetId: model.presets.get().selectedInstanceId
        }
    }, transition.signal);
    assertTransitionCurrent(transition);
}

/** Save snapshot data while keeping the preset's base controls as the base. */
export async function persistMultiFXSnapshots(
    model: PiPedalModel,
    bankId: number,
    presetId: number,
    snapshots: Array<Snapshot | null>,
    finalState: PresetSnapshotSessionState | null,
    transition: MultiFXPerformanceTransition
): Promise<void> {
    await loadMultiFXBasePreset(model, presetId, transition);
    await replaceSnapshotsAndWait(model, snapshots, transition);
    await saveCurrentPresetAndWait(model, transition);
    await writeMultiFXPresetSnapshotState(
        bankId,
        presetId,
        finalState,
        transition
    );
    if (finalState?.enabled) {
        await recallMultiFXSnapshot(
            model,
            finalState.snapshotIndex,
            transition
        );
    }
}

export function getMultiFXPresetSnapshotState(
    runtime: MultiFXRuntimeState | null,
    bankId: number,
    presetId: number
): PresetSnapshotSessionState | null {
    if (!runtime) return null;
    const state = runtime.presetSnapshotStates[
        presetSnapshotSessionKey(bankId, presetId)
    ];
    return state ? { ...state } : null;
}

export function getLatestMultiFXPresetSnapshotState(
    bankId: number,
    presetId: number
): PresetSnapshotSessionState | null {
    return getMultiFXPresetSnapshotState(
        getLatestMultiFXRuntimeState(),
        bankId,
        presetId
    );
}

export async function readMultiFXPresetSnapshotState(
    bankId: number,
    presetId: number,
    transition: MultiFXPerformanceTransition
): Promise<PresetSnapshotSessionState | null> {
    await ensureSharedTransition(transition);
    const runtime = getLatestMultiFXRuntimeState()
        ?? await readMultiFXRuntimeState(transition.signal);
    assertTransitionCurrent(transition);
    return getMultiFXPresetSnapshotState(runtime, bankId, presetId);
}

export async function writeMultiFXPresetSnapshotState(
    bankId: number,
    presetId: number,
    snapshotState: PresetSnapshotSessionState | null,
    transition: MultiFXPerformanceTransition
): Promise<MultiFXRuntimeState> {
    await ensureSharedTransition(transition);
    const state = await updateMultiFXRuntimeState({
        presetSnapshotStateUpdate: {
            bankId,
            presetId,
            snapshotIndex: snapshotState?.snapshotIndex ?? null,
            enabled: snapshotState?.enabled ?? false
        }
    }, transition.signal);
    assertTransitionCurrent(transition);
    return state;
}

export async function initializeMultiFXSnapshotSession(
    model: PiPedalModel,
    transition: MultiFXPerformanceTransition
): Promise<boolean> {
    await ensureSharedTransition(transition);
    const runtime = getLatestMultiFXRuntimeState()
        ?? await readMultiFXRuntimeState(transition.signal);
    const bankId = model.banks.get().selectedBank;
    const presetId = model.presets.get().selectedInstanceId;
    const rememberedState = getMultiFXPresetSnapshotState(
        runtime,
        bankId,
        presetId
    );

    // Reload only when PiPedal is carrying a snapshot marker that is not a
    // confirmed MultiFX session choice. An unconditional reload would silently
    // discard legitimate unsaved BASE edits made in PiPedal's original UI.
    const baseWasReloaded = snapshotSessionNeedsBaseReload(
        runtime.snapshotSessionInitialized,
        presetId,
        model.selectedSnapshot.get(),
        rememberedState
    );
    if (baseWasReloaded) {
        await loadMultiFXBasePreset(model, presetId, transition);
    }

    if (!runtime.snapshotSessionInitialized) {
        await updateMultiFXRuntimeState({
            snapshotSessionInitialized: true,
            resetPresetSnapshotStates: true
        }, transition.signal);
    } else if (baseWasReloaded && rememberedState) {
        // The native sound and shared intent disagreed. BASE is authoritative
        // after reconciliation, so do not leave a ghost remembered snapshot.
        await writeMultiFXPresetSnapshotState(
            bankId,
            presetId,
            null,
            transition
        );
    }
    assertTransitionCurrent(transition);
    return baseWasReloaded;
}

export function asRuntimeSnapshotState(
    state: PresetSnapshotSessionState | null
): MultiFXPresetSnapshotState | null {
    return state ? { ...state } : null;
}
