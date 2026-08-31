/*
 * One transition coordinator for PI-MULTIFX preset/snapshot performance state.
 *
 * PiPedal remains the authority for the sound that is actually loaded. The
 * bridge runtime stores only the user's transient intent for this controller
 * session, shared by the touchscreen and PC browser.
 */

import { PiPedalModel, State } from "./PiPedalModel";
import { Snapshot } from "./Pedalboard";
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

export type MultiFXPerformanceTransition = {
    id: number;
    signal: AbortSignal;
};

let nextTransitionId = 0;
let activeTransition: {
    id: number;
    controller: AbortController;
} | null = null;

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
    return { id, signal: controller.signal };
}

export function finishMultiFXPerformanceTransition(
    transition: MultiFXPerformanceTransition
): void {
    if (activeTransition?.id === transition.id) {
        activeTransition = null;
    }
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
    assertTransitionCurrent(transition);

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
    assertTransitionCurrent(transition);

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
}

export async function recallMultiFXSnapshot(
    model: PiPedalModel,
    snapshotIndex: number,
    transition: MultiFXPerformanceTransition
): Promise<void> {
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
    assertTransitionCurrent(transition);
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

async function saveCurrentPresetAndWait(
    model: PiPedalModel,
    transition: MultiFXPerformanceTransition
): Promise<void> {
    assertTransitionCurrent(transition);
    await new Promise<void>((resolve, reject) => {
        let settled = false;
        let armed = false;
        let sawPresetChanged = false;
        let removeAbort: () => void = () => undefined;
        const timer = globalThis.setTimeout(
            () => fail(timeoutError("the snapshot save")),
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
                fail(new Error("PiPedal disconnected while saving snapshots."));
            }
        };

        model.presetChanged.addOnChangedHandler(onPresetChanged);
        model.state.addOnChangedHandler(onState);
        removeAbort = attachAbort(transition.signal, reject, cleanup);
        armed = true;
        model.saveCurrentPreset();
    });
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
    assertTransitionCurrent(transition);
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
    assertTransitionCurrent(transition);
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
    assertTransitionCurrent(transition);
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
