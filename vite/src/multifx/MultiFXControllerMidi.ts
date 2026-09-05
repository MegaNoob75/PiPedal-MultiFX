/*
 * Logical MultiFX controller sources expressed as MIDI events.
 *
 * The firmware owns electrical inputs and emits MIDI. PiPedal owns executable
 * parameter bindings. This adapter is the small, UI-facing layer between them:
 * it turns CC numbers back into stable controller IDs and friendly labels.
 */

import { ControllerLayoutConfig } from "./ControllerConfig";
import MidiBinding from "../pipedal/MidiBinding";

export type MultiFXMidiSourceKind =
    | "analog"
    | "encoderTurn"
    | "encoderButton"
    | "switch";

export interface MultiFXMidiSource {
    id: string;
    label: string;
    kind: MultiFXMidiSourceKind;
    midiType: "control";
    midiNumber: number;
}

/** Controller firmware reserves CC40..CC51 for logical switches SW1..SW12. */
export const MULTIFX_FIRST_SWITCH_CC = 40;

/**
 * Flatten the portable hardware/controller configuration into bindable MIDI
 * sources. The stable IDs survive pin changes, while MIDI numbers are the
 * executable values consumed by PiPedal's native binding engine.
 */
export function getMultiFXMidiSources(
    config: ControllerLayoutConfig
): MultiFXMidiSource[] {
    const result: MultiFXMidiSource[] = [];

    for (const control of config.hardware.analogControls) {
        result.push({
            id: control.id,
            label: control.label,
            kind: "analog",
            midiType: "control",
            midiNumber: control.midiCc
        });
    }

    for (const encoder of config.hardware.encoders) {
        result.push({
            id: `${encoder.id}:turn`,
            label: `${encoder.label} TURN`,
            kind: "encoderTurn",
            midiType: "control",
            midiNumber: encoder.turnCc
        });
        if (encoder.buttonInput !== null) {
            result.push({
                id: `${encoder.id}:button`,
                label: `${encoder.label} BUTTON`,
                kind: "encoderButton",
                midiType: "control",
                midiNumber: encoder.buttonCc
            });
        }
    }

    for (const control of config.switches) {
        if (control.hardwareSwitch < 1 || control.hardwareSwitch > 12) {
            continue;
        }
        result.push({
            id: control.id,
            label: control.label,
            kind: "switch",
            midiType: "control",
            midiNumber:
                MULTIFX_FIRST_SWITCH_CC + control.hardwareSwitch - 1
        });
    }

    return result;
}

/** Resolve a learned/native MIDI CC to its logical MultiFX control, if known. */
export function findMultiFXMidiSource(
    config: ControllerLayoutConfig,
    midiNumber: number
): MultiFXMidiSource | undefined {
    return getMultiFXMidiSources(config).find(
        (source) => source.midiNumber === midiNumber
    );
}

/** Friendly assignment text used by both the binding editor and Performance. */
export function describeMultiFXMidiBinding(
    binding: MidiBinding,
    config: ControllerLayoutConfig
): string {
    if (binding.bindingType === MidiBinding.BINDING_TYPE_NONE) {
        return "None";
    }
    if (binding.bindingType === MidiBinding.BINDING_TYPE_CONTROL) {
        const source = findMultiFXMidiSource(config, binding.control);
        return source
            ? `${source.label} · CC ${binding.control}`
            : `MIDI CC ${binding.control}`;
    }
    if (binding.bindingType === MidiBinding.BINDING_TYPE_NOTE) {
        return `MIDI NOTE ${binding.note}`;
    }
    if (binding.bindingType === MidiBinding.BINDING_TYPE_TAP_TEMPO) {
        return `TAP TEMPO · NOTE ${binding.note}`;
    }
    return "None";
}

/** True when the binding is active and should receive live-value feedback. */
export function isActiveMultiFXMidiBinding(binding: MidiBinding): boolean {
    return binding.bindingType !== MidiBinding.BINDING_TYPE_NONE;
}
