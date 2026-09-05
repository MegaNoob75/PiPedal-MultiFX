/*
 * Safety gates for transitions from temporary Performance state into a BASE
 * preset editor/save path. PiPedal remains the musical-state authority.
 */

import { PiPedalModel, State } from "../pipedal/PiPedalModel";
import {
    readMultiFXRuntimeState,
    updateMultiFXRuntimeState
} from "./MultiFXRuntimeSync";

const SAFETY_TIMEOUT_MS = 8000;

export async function waitForCleanBasePreset(
    model: PiPedalModel,
    presetId: number
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = globalThis.setTimeout(
            () => fail(
                "PiPedal did not confirm the clean base preset within 8 seconds."
            ),
            SAFETY_TIMEOUT_MS
        );
        const cleanup = () => {
            globalThis.clearTimeout(timer);
            model.presets.removeOnChangedHandler(check);
            model.selectedSnapshot.removeOnChangedHandler(check);
            model.presetChanged.removeOnChangedHandler(check);
            model.state.removeOnChangedHandler(onState);
        };
        const finish = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        };
        const fail = (message: string) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error(message));
        };
        function check() {
            if (
                model.presets.get().selectedInstanceId === presetId
                && model.selectedSnapshot.get() < 0
                && !model.presetChanged.get()
            ) {
                finish();
            }
        }
        function onState(state: State) {
            if (state === State.Error) {
                fail("PiPedal disconnected while restoring the base preset.");
            }
        }
        model.presets.addOnChangedHandler(check);
        model.selectedSnapshot.addOnChangedHandler(check);
        model.presetChanged.addOnChangedHandler(check);
        model.state.addOnChangedHandler(onState);
        check();
    });
}

export async function loadCleanBasePreset(
    model: PiPedalModel,
    presetId: number
): Promise<void> {
    model.loadPreset(presetId);
    await waitForCleanBasePreset(model, presetId);
    await updateMultiFXRuntimeState({
        cleanBaseReady: {
            bankId: model.banks.get().selectedBank,
            presetId
        }
    });
}


async function waitForEnabledStates(
    model: PiPedalModel,
    expected: Record<string, boolean>
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = globalThis.setTimeout(
            () => fail(
                "PiPedal did not confirm Chain Bypass restoration within 8 seconds."
            ),
            SAFETY_TIMEOUT_MS
        );
        const cleanup = () => {
            globalThis.clearTimeout(timer);
            model.pedalboard.removeOnChangedHandler(check);
            model.state.removeOnChangedHandler(onState);
        };
        const finish = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        };
        const fail = (message: string) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error(message));
        };
        function check() {
            const live = new Map(
                model.pedalboard.get().items
                    .filter((item) => !item.isEmpty() && !item.isSyntheticItem())
                    .map((item) => [String(item.instanceId), item.isEnabled])
            );
            if (Object.entries(expected).every(([id, enabled]) => live.get(id) === enabled)) {
                finish();
            }
        }
        function onState(state: State) {
            if (state === State.Error) fail("PiPedal disconnected while restoring Chain Bypass.");
        }
        model.pedalboard.addOnChangedHandler(check);
        model.state.addOnChangedHandler(onState);
        check();
    });
}

/**
 * Restore Chain Bypass without losing pre-existing dirty base edits.
 *
 * Chain Bypass changes only item enabled flags, so ending it restores only
 * those captured flags. Reloading the preset here would discard an active
 * snapshot (and can also discard unsaved base edits). Callers that genuinely
 * need BASE state do that independently after bypass has been restored.
 */
export async function restoreChainBypassForSafeWrite(
    model: PiPedalModel
): Promise<void> {
    const runtime = await readMultiFXRuntimeState();
    if (!runtime.chainBypassed) return;

    const currentPresetId = model.presets.get().selectedInstanceId;
    const currentBankId = model.banks.get().selectedBank;
    const samePreset =
        runtime.chainBypassBankId === currentBankId
        && runtime.chainBypassPresetId === currentPresetId;

    if (samePreset && !runtime.chainBypassWasPresetChanged) {
        // Bypass was the only reason this otherwise-clean preset became dirty.
        // A real reload clears PiPedal's sticky modified flag and also restores
        // any plugin state that changed while plugins were disabled.
        await loadCleanBasePreset(model, currentPresetId);
    } else if (samePreset) {
        // Preserve genuine edits that existed before bypass. Only the enabled
        // flags owned by the temporary overlay are restored.
        const enabled = runtime.chainBypassEnabledStates;
        for (const item of model.pedalboard.get().items) {
            if (item.isEmpty() || item.isSyntheticItem()) continue;
            const prior = enabled[String(item.instanceId)];
            if (prior !== undefined && prior !== item.isEnabled) {
                model.setPedalboardItemEnabled(item.instanceId, prior);
            }
        }
        await waitForEnabledStates(model, enabled);
    }

    await updateMultiFXRuntimeState({
        chainBypassed: false,
        chainBypassBankId: null,
        chainBypassPresetId: null,
        chainBypassSnapshotIndex: null,
        chainBypassWasPresetChanged: false,
        chainBypassEnabledStates: {}
    });
}

/** Restore all temporary Performance state before exposing a base preset write. */
export async function prepareBasePresetForWrite(
    model: PiPedalModel,
    targetPresetId: number
): Promise<void> {
    await restoreChainBypassForSafeWrite(model);

    if (
        model.selectedSnapshot.get() >= 0
        || model.presets.get().selectedInstanceId !== targetPresetId
    ) {
        await loadCleanBasePreset(model, targetPresetId);
    }

    await updateMultiFXRuntimeState({
        snapshotMode: false,
        snapshotModeBankId: null,
        snapshotPresetId: null,
        chainBypassed: false,
        chainBypassBankId: null,
        chainBypassPresetId: null,
        chainBypassSnapshotIndex: null,
        chainBypassWasPresetChanged: false,
        chainBypassEnabledStates: {}
    });
}
