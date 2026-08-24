/*
 * Temporary live parameter feedback for Performance View.
 *
 * PiPedal emits the authoritative parameter value after a native MIDI binding
 * runs. Listening to those notifications keeps this overlay accurate without
 * polling the controller bridge or attempting to reproduce PiPedal mapping.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    ControllerLayoutConfig
} from "./ControllerConfig";
import MidiBinding from "./MidiBinding";
import {
    ControlValueChangedHandle,
    PiPedalModelFactory
} from "./PiPedalModel";
import { Pedalboard } from "./Pedalboard";
import {
    describeMultiFXMidiBinding,
    findMultiFXMidiSource,
    isActiveMultiFXMidiBinding
} from "./MultiFXControllerMidi";
import { loadMultiFXTheme } from "./MultiFXTheme";
import { loadMultiFXUIBehaviorSettings } from "./MultiFXUIBehavior";

interface MultiFXParameterFeedbackProps {
    controllerConfig: ControllerLayoutConfig;
}

interface ParameterFeedbackValue {
    source: string;
    effect: string;
    parameter: string;
    value: string;
    range: number;
}


/**
 * A compact structural signature prevents ordinary live value changes from
 * repeatedly tearing down listeners. It changes only when bindings do.
 */
function midiBindingSignature(pedalboard: Pedalboard): string {
    const parts: string[] = [];
    for (const item of pedalboard.itemsGenerator()) {
        for (const binding of item.midiBindings) {
            if (!isActiveMultiFXMidiBinding(binding)) continue;
            parts.push([
                item.instanceId,
                binding.symbol,
                binding.bindingType,
                binding.control,
                binding.note
            ].join(":"));
        }
    }
    return parts.sort().join("|");
}

/** Show the most recently changed bound parameter and hide after inactivity. */
export default function MultiFXParameterFeedback({
    controllerConfig
}: MultiFXParameterFeedbackProps) {
    const model = PiPedalModelFactory.getInstance();
    const [feedback, setFeedback] =
        useState<ParameterFeedbackValue | null>(null);
    const [bindingSignature, setBindingSignature] = useState(
        () => midiBindingSignature(model.pedalboard.get())
    );
    const [presetId, setPresetId] = useState(
        () => model.presets.get().selectedInstanceId
    );
    const hideTimerRef = useRef<number | null>(null);

    useEffect(() => {
        const pedalboardChanged = (pedalboard: Pedalboard) =>
            setBindingSignature(midiBindingSignature(pedalboard));
        const presetsChanged = () =>
            setPresetId(model.presets.get().selectedInstanceId);
        model.pedalboard.addOnChangedHandler(pedalboardChanged);
        model.presets.addOnChangedHandler(presetsChanged);
        return () => {
            model.pedalboard.removeOnChangedHandler(pedalboardChanged);
            model.presets.removeOnChangedHandler(presetsChanged);
        };
    }, [model]);

    useEffect(() => {
        const handles: ControlValueChangedHandle[] = [];
        const pedalboard = model.pedalboard.get();

        setFeedback(null);
        if (hideTimerRef.current !== null) {
            window.clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }

        for (const item of pedalboard.itemsGenerator()) {
            const bindings = new Map<string, MidiBinding>();
            const lastDisplayedRanges = new Map<string, number>();
            for (const binding of item.midiBindings) {
                if (isActiveMultiFXMidiBinding(binding)) {
                    bindings.set(binding.symbol, binding);
                    const control = model.getUiPlugin(item.uri)
                        ?.getControl(binding.symbol);
                    if (control) {
                        lastDisplayedRanges.set(
                            binding.symbol,
                            control.valueToRange(
                                item.getControlValue(binding.symbol)
                            )
                        );
                    }
                }
            }
            if (bindings.size === 0) continue;

            const instanceId = item.instanceId;
            handles.push(model.addControlValueChangeListener(
                instanceId,
                (symbol, value) => {
                    if (!loadMultiFXUIBehaviorSettings()
                        .parameterFeedbackEnabled) {
                        return;
                    }
                    const activeBinding = bindings.get(symbol);
                    if (!activeBinding) return;

                    const currentItem = model.pedalboard.get()
                        .tryGetItem(instanceId);
                    if (!currentItem) return;
                    const plugin = model.getUiPlugin(currentItem.uri);
                    const control = plugin?.getControl(symbol);
                    if (!control) return;

                    const source = activeBinding.bindingType
                        === MidiBinding.BINDING_TYPE_CONTROL
                        ? findMultiFXMidiSource(
                            controllerConfig,
                            activeBinding.control
                        )
                        : undefined;
                    const nextRange = control.valueToRange(value);

                    // The firmware also applies MIDI hysteresis, but retaining
                    // this UI guard prevents an older controller build from
                    // flashing the overlay for adjacent-value ADC noise.
                    if (source?.kind === "analog") {
                        const analogControl = controllerConfig.hardware
                            .analogControls.find(
                                (candidate) => candidate.id === source.id
                            );
                        const previousRange = lastDisplayedRanges.get(symbol);
                        const rawBindingSpan = Math.abs(
                            activeBinding.maxValue - activeBinding.minValue
                        );
                        const bindingSpan = Number.isFinite(rawBindingSpan)
                            ? rawBindingSpan
                            : 1;
                        const minimumMovement =
                            bindingSpan
                            * Math.max(
                                0.5,
                                (analogControl?.midiHysteresis ?? 2) - 0.5
                            )
                            / 127;
                        if (
                            previousRange !== undefined
                            && Math.abs(nextRange - previousRange)
                                < minimumMovement
                        ) {
                            return;
                        }
                    }
                    lastDisplayedRanges.set(symbol, nextRange);
                    setFeedback({
                        source: source?.label
                            ?? describeMultiFXMidiBinding(
                                activeBinding,
                                controllerConfig
                            ),
                        effect: currentItem.title || plugin?.name || "Effect",
                        parameter: control.name,
                        value: control.formatDisplayValue(value),
                        range: nextRange
                    });

                    if (hideTimerRef.current !== null) {
                        window.clearTimeout(hideTimerRef.current);
                    }
                    hideTimerRef.current = window.setTimeout(() => {
                        hideTimerRef.current = null;
                        setFeedback(null);
                    }, loadMultiFXTheme().appearance.motion.feedbackDurationMs);
                }
            ));
        }

        return () => {
            for (const handle of handles) {
                model.removeControlValueChangeListener(handle);
            }
        };
    }, [model, controllerConfig, presetId, bindingSignature]);

    useEffect(() => () => {
        if (hideTimerRef.current !== null) {
            window.clearTimeout(hideTimerRef.current);
        }
    }, []);

    if (!feedback) return null;

    return createPortal(
        <div
            role="status"
            aria-live="polite"
            style={{
                position: "fixed",
                left: "50%",
                bottom: 18,
                transform: "translateX(-50%)",
                zIndex: 2147483646,
                width: "min(560px, calc(100vw - 28px))",
                padding: "11px 14px 10px",
                boxSizing: "border-box",
                borderRadius: 12,
                border: "2px solid transparent",
                background:
                    "var(--mfx-surface-toast-bg) padding-box, var(--mfx-surface-toast-border) border-box",
                color: "var(--mfx-surface-toast-text)",
                boxShadow: "var(--mfx-surface-toast-shadow)",
                pointerEvents: "none"
            }}
        >
            <div style={headingRowStyle}>
                <div style={{ minWidth: 0 }}>
                    <div style={{
                        ...sourceStyle,
                        color: "var(--mfx-surface-toast-label)"
                    }}>
                        {feedback.source}
                    </div>
                    <div style={{
                        ...parameterStyle,
                        color: "var(--mfx-surface-toast-accent)"
                    }}>
                        {feedback.effect} · {feedback.parameter}
                    </div>
                </div>
                <div style={{
                    ...valueStyle,
                    color: "var(--mfx-surface-toast-accent)"
                }}>
                    {feedback.value}
                </div>
            </div>
            <div style={{
                ...progressTrackStyle,
                background: "var(--mfx-role-utility-normal-bg)"
            }}>
                <div style={{
                    width: `${Math.round(
                        Math.min(1, Math.max(0, feedback.range)) * 100
                    )}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: "var(--mfx-surface-toast-accent)",
                    transition: "width 70ms linear"
                }} />
            </div>
        </div>,
        document.body
    );
}

const headingRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12
};

const sourceStyle: React.CSSProperties = {
    fontSize: "0.67rem",
    fontWeight: 950,
    letterSpacing: "0.08em",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis"
};

const parameterStyle: React.CSSProperties = {
    marginTop: 2,
    fontWeight: 950,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis"
};

const valueStyle: React.CSSProperties = {
    flex: "0 0 auto",
    fontSize: "1.2rem",
    fontWeight: 950,
    whiteSpace: "nowrap"
};

const progressTrackStyle: React.CSSProperties = {
    height: 5,
    marginTop: 8,
    overflow: "hidden",
    borderRadius: 999
};
