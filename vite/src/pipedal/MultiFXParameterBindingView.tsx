/*
 * Touch-oriented controller binding editor for one MultiFX effect instance.
 *
 * This component intentionally edits PiPedal's native MidiBinding objects.
 * MultiFX supplies controller names, Learn workflow, and presentation, while
 * PiPedal remains responsible for realtime parameter changes and preset data.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
    CONTROLLER_CONFIG_CHANGED_EVENT,
    ControllerLayoutConfig,
    defaultControllerConfig,
    loadControllerConfig,
    saveControllerConfig
} from "./ControllerConfig";
import { UiControl, UiPlugin } from "./Lv2Plugin";
import MidiBinding from "./MidiBinding";
import {
    MidiControlType,
    getMidiControlType
} from "./MidiBindingView";
import {
    ListenHandle,
    MidiMessage,
    PiPedalModelFactory
} from "./PiPedalModel";
import { PedalboardItem } from "./Pedalboard";
import {
    describeMultiFXMidiBinding,
    findMultiFXMidiSource,
    getMultiFXMidiSources
} from "./MultiFXControllerMidi";
import {
    MFX_COLORS,
    MFX_SURFACES,
    multiFXSurfaceBackground
} from "./MultiFXTheme";

interface MultiFXParameterBindingViewProps {
    item: PedalboardItem;
    uiPlugin: UiPlugin;
    draftMode: boolean;
}

const LEARN_TIMEOUT_MS = 12000;
const ANALOG_LEARN_MOVEMENT = 4;

/**
 * Edit the native MIDI binding attached to one parameter of one plugin
 * instance. Saving the PiPedal preset makes the assignment persistent and
 * naturally keeps assignments independent between cloned presets.
 */
export default function MultiFXParameterBindingView({
    item,
    uiPlugin,
    draftMode
}: MultiFXParameterBindingViewProps) {
    const model = PiPedalModelFactory.getInstance();
    const controls = useMemo(
        () => uiPlugin.controls.filter((control) => control.is_input),
        [uiPlugin]
    );
    const [selectedSymbol, setSelectedSymbol] = useState(
        () => controls[0]?.symbol ?? ""
    );
    const [controllerConfig, setControllerConfig] =
        useState<ControllerLayoutConfig>(defaultControllerConfig);
    const [configWarning, setConfigWarning] = useState<string>();
    const [learning, setLearning] = useState(false);
    const [status, setStatus] = useState<string>();
    const [presetChanged, setPresetChanged] = useState(
        () => model.presets.get().presetChanged
    );

    const listenHandleRef = useRef<ListenHandle | undefined>(undefined);
    const learnTimerRef = useRef<number | undefined>(undefined);
    const learnBaselinesRef = useRef<Map<number, number>>(new Map());
    const saveRequestedRef = useRef(false);

    const selectedControl = controls.find(
        (control) => control.symbol === selectedSymbol
    );
    const binding = selectedControl
        ? item.getMidiBinding(selectedControl.symbol)
        : null;
    const midiSources = useMemo(
        () => getMultiFXMidiSources(controllerConfig),
        [controllerConfig]
    );

    useEffect(() => {
        if (
            controls.length > 0
            && !controls.some((control) => control.symbol === selectedSymbol)
        ) {
            setSelectedSymbol(controls[0].symbol);
        }
    }, [controls, selectedSymbol]);

    useEffect(() => {
        let cancelled = false;
        const reload = async () => {
            const result = await loadControllerConfig();
            if (!cancelled) {
                setControllerConfig(result.config);
                setConfigWarning(result.error);
            }
        };
        const changed = () => void reload();
        window.addEventListener(CONTROLLER_CONFIG_CHANGED_EVENT, changed);
        void reload();
        return () => {
            cancelled = true;
            window.removeEventListener(
                CONTROLLER_CONFIG_CHANGED_EVENT,
                changed
            );
        };
    }, []);

    useEffect(() => {
        const changed = () => {
            const isChanged = model.presets.get().presetChanged;
            setPresetChanged(isChanged);
            if (saveRequestedRef.current && !isChanged) {
                saveRequestedRef.current = false;
                setStatus("Preset saved with its controller bindings.");
            }
        };
        model.presets.addOnChangedHandler(changed);
        changed();
        return () => model.presets.removeOnChangedHandler(changed);
    }, [model]);

    const cancelLearn = (message?: string) => {
        if (listenHandleRef.current) {
            model.cancelListenForMidiEvent(listenHandleRef.current);
            listenHandleRef.current = undefined;
        }
        if (learnTimerRef.current !== undefined) {
            window.clearTimeout(learnTimerRef.current);
            learnTimerRef.current = undefined;
        }
        learnBaselinesRef.current.clear();
        setLearning(false);
        if (message) setStatus(message);
    };

    useEffect(() => () => {
        if (listenHandleRef.current) {
            model.cancelListenForMidiEvent(listenHandleRef.current);
            listenHandleRef.current = undefined;
        }
        if (learnTimerRef.current !== undefined) {
            window.clearTimeout(learnTimerRef.current);
        }
    }, [model]);

    /** Always read the current item before editing so live value updates are retained. */
    const currentBinding = (symbol: string): MidiBinding => {
        const currentItem = model.pedalboard.get().tryGetItem(item.instanceId);
        return (currentItem ?? item).getMidiBinding(symbol).clone();
    };

    const applyBinding = (
        symbol: string,
        update: (next: MidiBinding) => void,
        message = "Binding updated. Save the preset to keep it."
    ) => {
        const next = currentBinding(symbol);
        update(next);
        model.setMidiBinding(item.instanceId, next);
        setStatus(message);
    };

    const completeLearn = (
        control: UiControl,
        midiMessage: MidiMessage
    ) => {
        const source = midiMessage.isControl()
            ? findMultiFXMidiSource(controllerConfig, midiMessage.cc1)
            : undefined;

        // PiPedal exposes a rotary flag in its JSON model, but this repository's
        // realtime MIDI mapper does not currently apply relative encoder
        // deltas. Refuse the assignment instead of creating one that jumps
        // between parameter endpoints and appears broken on stage.
        if (source?.kind === "encoderTurn") {
            cancelLearn(
                "Relative encoder parameter binding is not supported by the current PiPedal realtime mapper. No assignment was changed. Pots, sliders, expression controls, buttons, and switches are supported."
            );
            return;
        }

        applyBinding(
            control.symbol,
            (next) => {
                if (midiMessage.isControl()) {
                    next.bindingType = MidiBinding.BINDING_TYPE_CONTROL;
                    next.control = midiMessage.cc1;
                    next.linearControlType = source?.kind === "encoderTurn"
                        ? MidiBinding.CIRCULAR_CONTROL_TYPE
                        : MidiBinding.LINEAR_CONTROL_TYPE;
                } else {
                    next.bindingType = MidiBinding.BINDING_TYPE_NOTE;
                    next.note = midiMessage.cc1;
                }

                const type = getMidiControlType(uiPlugin, control.symbol);
                if (
                    type === MidiControlType.Toggle
                    || type === MidiControlType.Trigger
                ) {
                    next.switchControlType =
                        MidiBinding.TRIGGER_ON_RISING_EDGE;
                }
            },
            `${source?.label ?? (midiMessage.isControl()
                ? `MIDI CC ${midiMessage.cc1}`
                : `MIDI note ${midiMessage.cc1}`)} assigned to ${control.name}. Save the preset to keep it.`
        );
        cancelLearn();
    };

    /**
     * Ignore idle analog jitter by requiring several values of real movement.
     * Buttons and relative encoders only emit on deliberate actions, so those
     * can complete immediately.
     */
    const considerLearnMessage = (
        control: UiControl,
        midiMessage: MidiMessage
    ) => {
        if (midiMessage.isNote()) {
            const type = getMidiControlType(uiPlugin, control.symbol);
            if (
                type === MidiControlType.Toggle
                || type === MidiControlType.Trigger
                || type === MidiControlType.MomentarySwitch
            ) {
                completeLearn(control, midiMessage);
            }
            return;
        }
        if (!midiMessage.isControl()) return;

        const source = findMultiFXMidiSource(
            controllerConfig,
            midiMessage.cc1
        );
        if (
            source?.kind === "switch"
            || source?.kind === "encoderButton"
        ) {
            if (midiMessage.cc2 >= 64) completeLearn(control, midiMessage);
            return;
        }
        if (source?.kind === "encoderTurn") {
            if (midiMessage.cc2 !== 0) completeLearn(control, midiMessage);
            return;
        }

        const baseline = learnBaselinesRef.current.get(midiMessage.cc1);
        if (baseline === undefined) {
            learnBaselinesRef.current.set(midiMessage.cc1, midiMessage.cc2);
            return;
        }
        if (Math.abs(midiMessage.cc2 - baseline) >= ANALOG_LEARN_MOVEMENT) {
            completeLearn(control, midiMessage);
        }
    };

    const startLearn = () => {
        if (!selectedControl) return;
        if (learning) {
            cancelLearn("Learn cancelled.");
            return;
        }

        learnBaselinesRef.current.clear();
        setLearning(true);
        setStatus(
            `Move the control you want to assign to ${selectedControl.name}…`
        );
        const target = selectedControl;
        listenHandleRef.current = model.listenForMidiEvent(
            (message) => considerLearnMessage(target, message)
        );
        learnTimerRef.current = window.setTimeout(
            () => cancelLearn("Learn timed out. No control was assigned."),
            LEARN_TIMEOUT_MS
        );
    };

    const removeBinding = () => {
        if (!selectedControl) return;
        applyBinding(
            selectedControl.symbol,
            (next) => {
                next.bindingType = MidiBinding.BINDING_TYPE_NONE;
            },
            `${selectedControl.name} is unassigned. Save the preset to keep it.`
        );
    };

    const savePreset = () => {
        saveRequestedRef.current = true;
        model.saveCurrentPreset();
        setStatus("Saving the current preset…");
    };

    const reverseBinding = () => {
        if (!selectedControl || !binding) return;
        applyBinding(selectedControl.symbol, (next) => {
            const oldMinimum = next.minValue;
            next.minValue = next.maxValue;
            next.maxValue = oldMinimum;
        });
    };

    const setParameterLimit = (which: "minimum" | "maximum", value: number) => {
        if (!selectedControl || !binding || !Number.isFinite(value)) return;
        const clamped = Math.min(
            Math.max(value, selectedControl.min_value),
            selectedControl.max_value
        );
        const normalized = selectedControl.valueToRange(clamped);
        const reversed = binding.minValue > binding.maxValue;
        applyBinding(selectedControl.symbol, (next) => {
            if (which === "minimum") {
                if (reversed) next.maxValue = normalized;
                else next.minValue = normalized;
            } else if (reversed) {
                next.minValue = normalized;
            } else {
                next.maxValue = normalized;
            }
        });
    };

    /**
     * Calibrate the MIDI range seen by this one preset binding. For example,
     * a physical pot whose highest message is 126 can still reach the exact
     * plugin maximum when its INPUT HIGH value is set to 126.
     */
    const setControllerInputLimit = (
        which: "minimum" | "maximum",
        value: number
    ) => {
        if (!selectedControl || !binding || !Number.isFinite(value)) return;
        const rounded = Math.round(Math.min(Math.max(value, 0), 127));
        applyBinding(selectedControl.symbol, (next) => {
            if (which === "minimum") {
                next.minControlValue = Math.min(
                    rounded,
                    next.maxControlValue - 1
                );
            } else {
                next.maxControlValue = Math.max(
                    rounded,
                    next.minControlValue + 1
                );
            }
        });
    };

    const conflictText = useMemo(() => {
        if (
            !binding
            || binding.bindingType !== MidiBinding.BINDING_TYPE_CONTROL
        ) {
            return undefined;
        }
        const conflicts: string[] = [];
        for (const otherItem of model.pedalboard.get().itemsGenerator()) {
            for (const otherBinding of otherItem.midiBindings) {
                if (
                    otherBinding.bindingType !== MidiBinding.BINDING_TYPE_CONTROL
                    || otherBinding.control !== binding.control
                    || (
                        otherItem.instanceId === item.instanceId
                        && otherBinding.symbol === binding.symbol
                    )
                ) {
                    continue;
                }
                const plugin = model.getUiPlugin(otherItem.uri);
                const parameter = plugin?.getControl(otherBinding.symbol);
                conflicts.push(
                    `${otherItem.title || plugin?.name || "Effect"} · ${parameter?.name || otherBinding.symbol}`
                );
            }
        }
        return conflicts.length > 0
            ? `This controller also changes ${conflicts.join(", ")}.`
            : undefined;
    }, [binding, item.instanceId, model]);

    const activeSource = binding
        && binding.bindingType === MidiBinding.BINDING_TYPE_CONTROL
        ? findMultiFXMidiSource(controllerConfig, binding.control)
        : undefined;
    const activeAnalogControl = activeSource?.kind === "analog"
        ? controllerConfig.hardware.analogControls.find(
            (control) => control.id === activeSource.id
        )
        : undefined;

    /**
     * Store physical response globally for this analog control. The normal
     * controller-config sync applies it through the bridge; subsequent
     * adjustments therefore require no firmware upload.
     */
    const setAnalogResponse = (midiHysteresis: number) => {
        if (!activeAnalogControl) return;
        const nextConfig = structuredClone(controllerConfig);
        const control = nextConfig.hardware.analogControls.find(
            (candidate) => candidate.id === activeAnalogControl.id
        );
        if (!control) return;
        control.midiHysteresis = midiHysteresis;
        const saved = saveControllerConfig(nextConfig);
        if (saved.error) {
            setConfigWarning(saved.error);
            return;
        }
        setControllerConfig(saved.config);
        setConfigWarning(undefined);
        setStatus(
            `${activeAnalogControl.label} response updated. The controller is applying the hardware setting; no preset save is needed.`
        );
    };
    const reversed = Boolean(
        binding && binding.minValue > binding.maxValue
    );
    const lowerRange = binding
        ? Math.min(binding.minValue, binding.maxValue)
        : 0;
    const upperRange = binding
        ? Math.max(binding.minValue, binding.maxValue)
        : 1;
    const displayMinimum = selectedControl
        ? selectedControl.rangeToValue(lowerRange)
        : 0;
    const displayMaximum = selectedControl
        ? selectedControl.rangeToValue(upperRange)
        : 1;
    const valueStep = selectedControl?.integer_property
        ? 1
        : Math.max(
            Math.abs(
                (selectedControl?.max_value ?? 1)
                - (selectedControl?.min_value ?? 0)
            ) / 100,
            0.001
        );
    const canEditRange = Boolean(
        selectedControl
        && binding
        && binding.bindingType === MidiBinding.BINDING_TYPE_CONTROL
        && (
            getMidiControlType(uiPlugin, selectedControl.symbol)
            === MidiControlType.Dial
            || getMidiControlType(uiPlugin, selectedControl.symbol)
            === MidiControlType.Select
        )
    );

    return (
        <div className="mfx-binding-page" style={pageStyle}>
            <section style={panelStyle}>
                <div style={sectionTitleStyle}>EFFECT PARAMETERS</div>
                <div style={sectionHelpStyle}>
                    Select the parameter you want a physical control to change.
                </div>

                <div style={parameterListStyle}>
                    {controls.map((control) => {
                        const controlBinding = item.getMidiBinding(control.symbol);
                        const selected = control.symbol === selectedSymbol;
                        return (
                            <button
                                key={control.symbol}
                                type="button"
                                onClick={() => {
                                    cancelLearn();
                                    setSelectedSymbol(control.symbol);
                                    setStatus(undefined);
                                }}
                                style={{
                                    ...parameterButtonStyle,
                                    borderColor: selected
                                        ? MFX_COLORS.cyan
                                        : MFX_COLORS.border,
                                    background: selected
                                        ? MFX_COLORS.cyanSurface
                                        : MFX_COLORS.panelAlt
                                }}
                            >
                                <span style={parameterNameStyle}>
                                    {control.name}
                                </span>
                                <span style={{
                                    ...parameterAssignmentStyle,
                                    color: controlBinding.bindingType
                                        === MidiBinding.BINDING_TYPE_NONE
                                        ? MFX_COLORS.muted
                                        : MFX_COLORS.cyan
                                }}>
                                    {describeMultiFXMidiBinding(
                                        controlBinding,
                                        controllerConfig
                                    )}
                                </span>
                            </button>
                        );
                    })}
                    {controls.length === 0 && (
                        <div style={emptyStyle}>
                            This effect does not expose bindable input parameters.
                        </div>
                    )}
                </div>
            </section>

            <section style={panelStyle}>
                <div style={sectionTitleStyle}>SELECTED PARAMETER</div>
                <div style={selectedParameterStyle}>
                    {selectedControl?.name ?? "None"}
                </div>

                <div style={fieldLabelStyle}>CONTROLLER</div>
                <div style={assignmentCardStyle}>
                    <div style={{ minWidth: 0 }}>
                        <div style={assignmentNameStyle}>
                            {binding
                                ? describeMultiFXMidiBinding(
                                    binding,
                                    controllerConfig
                                )
                                : "None"}
                        </div>
                        <div style={assignmentDetailStyle}>
                            {activeSource
                                ? `${activeSource.kind === "analog"
                                    ? "ANALOG"
                                    : activeSource.kind === "encoderTurn"
                                        ? "RELATIVE ENCODER"
                                        : "BUTTON / SWITCH"} · ${activeSource.id}`
                                : binding?.bindingType === MidiBinding.BINDING_TYPE_NONE
                                    ? "No physical control assigned"
                                    : "External MIDI controller"}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={startLearn}
                        disabled={!selectedControl}
                        style={{
                            ...actionButtonStyle,
                            borderColor: learning
                                ? MFX_COLORS.danger
                                : MFX_COLORS.cyan,
                            color: learning
                                ? MFX_COLORS.danger
                                : MFX_COLORS.cyan
                        }}
                    >
                        {learning ? "CANCEL" : "LEARN"}
                    </button>
                </div>

                <div style={fieldLabelStyle}>SCOPE</div>
                <div style={scopeCardStyle}>
                    <span style={scopeBadgeStyle}>PRESET</span>
                    <span style={scopeTextStyle}>
                        This assignment belongs only to the current preset.
                        Cloned presets receive their own editable copy.
                    </span>
                </div>

                {canEditRange && selectedControl && (
                    <>
                        <div style={fieldLabelStyle}>PARAMETER RANGE</div>
                        <div style={rangeGridStyle}>
                            <NumberField
                                label="MINIMUM"
                                value={displayMinimum}
                                min={selectedControl.min_value}
                                max={displayMaximum}
                                step={valueStep}
                                unit={selectedControl.getDisplayUnits()}
                                onChange={(value) =>
                                    setParameterLimit("minimum", value)}
                            />
                            <NumberField
                                label="MAXIMUM"
                                value={displayMaximum}
                                min={displayMinimum}
                                max={selectedControl.max_value}
                                step={valueStep}
                                unit={selectedControl.getDisplayUnits()}
                                onChange={(value) =>
                                    setParameterLimit("maximum", value)}
                            />
                        </div>

                        <button
                            type="button"
                            onClick={reverseBinding}
                            style={{
                                ...toggleButtonStyle,
                                borderColor: reversed
                                    ? MFX_COLORS.cyan
                                    : MFX_COLORS.border,
                                background: reversed
                                    ? MFX_COLORS.cyanSurface
                                    : MFX_COLORS.panelAlt
                            }}
                        >
                            <span>REVERSE</span>
                            <span style={{
                                color: reversed
                                    ? MFX_COLORS.cyan
                                    : MFX_COLORS.muted
                            }}>
                                {reversed ? "ON" : "OFF"}
                            </span>
                        </button>
                    </>
                )}

                {canEditRange && activeAnalogControl && binding && (
                    <>
                        <div style={fieldLabelStyle}>CONTROLLER INPUT RANGE</div>
                        <div style={rangeGridStyle}>
                            <NumberField
                                label="INPUT LOW"
                                value={binding.minControlValue}
                                min={0}
                                max={binding.maxControlValue - 1}
                                step={1}
                                unit="MIDI"
                                onChange={(value) =>
                                    setControllerInputLimit("minimum", value)}
                            />
                            <NumberField
                                label="INPUT HIGH"
                                value={binding.maxControlValue}
                                min={binding.minControlValue + 1}
                                max={127}
                                step={1}
                                unit="MIDI"
                                onChange={(value) =>
                                    setControllerInputLimit("maximum", value)}
                            />
                        </div>
                        <div style={calibrationHelpStyle}>
                            If the parameter cannot reach its maximum and the
                            pot stops at MIDI 126, set INPUT HIGH to 126. This
                            calibration is saved with this preset binding.
                        </div>

                    </>
                )}

                {activeAnalogControl && (
                    <>
                        <div style={fieldLabelStyle}>ANALOG RESPONSE</div>
                        <label style={responseCardStyle}>
                            <span style={responseTextStyle}>
                                <strong>{activeAnalogControl.label}</strong>
                                <span>
                                    Global hardware setting for this physical
                                    control. Fine reacts to every MIDI step;
                                    higher modes reject more electrical noise.
                                </span>
                            </span>
                            <select
                                value={activeAnalogControl.midiHysteresis}
                                onChange={(event) => setAnalogResponse(
                                    Number(event.target.value)
                                )}
                                style={responseSelectStyle}
                                aria-label="Analog response"
                            >
                                <option value={1}>Fine · 1 step</option>
                                <option value={2}>Balanced · 2 steps</option>
                                <option value={3}>Stable · 3 steps</option>
                                <option value={4}>Extra stable · 4 steps</option>
                            </select>
                        </label>
                    </>
                )}

                {activeSource?.kind === "encoderTurn" && (
                    <div style={warningStyle}>
                        This existing relative encoder assignment is visible,
                        but the current PiPedal realtime mapper does not apply
                        relative encoder deltas correctly. Use an analog control
                        until native relative mapping is implemented.
                    </div>
                )}
                {activeSource?.kind === "switch" && (
                    <div style={warningStyle}>
                        This switch may also run its configured Performance
                        action when pressed.
                    </div>
                )}
                {conflictText && <div style={warningStyle}>{conflictText}</div>}
                {configWarning && <div style={warningStyle}>{configWarning}</div>}
                {status && (
                    <div
                        role="status"
                        style={{
                            ...statusStyle,
                            borderColor: learning
                                ? MFX_COLORS.purple
                                : MFX_COLORS.border
                        }}
                    >
                        {status}
                    </div>
                )}

                <div style={footerActionsStyle}>
                    <button
                        type="button"
                        onClick={removeBinding}
                        disabled={!binding || binding.bindingType
                            === MidiBinding.BINDING_TYPE_NONE}
                        style={removeButtonStyle}
                    >
                        REMOVE BINDING
                    </button>
                    {!draftMode && (
                        <button
                            type="button"
                            onClick={savePreset}
                            disabled={!presetChanged}
                            style={{
                                ...saveButtonStyle,
                                opacity: presetChanged ? 1 : 0.55
                            }}
                        >
                            {presetChanged ? "SAVE PRESET" : "PRESET SAVED"}
                        </button>
                    )}
                </div>

                {draftMode && (
                    <div style={draftHelpStyle}>
                        Use SAVE PRESET in the top bar to name and keep this new
                        preset with its bindings.
                    </div>
                )}
                <div style={sourceCountStyle}>
                    {midiSources.filter(
                        (source) => source.kind !== "encoderTurn"
                    ).length} supported controller inputs available for Learn
                </div>
            </section>
        </div>
    );
}

function NumberField({
    label,
    value,
    min,
    max,
    step,
    unit,
    onChange
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    unit: string;
    onChange: (value: number) => void;
}) {
    return (
        <label style={numberFieldStyle}>
            <span style={numberLabelStyle}>{label}</span>
            <span style={numberInputRowStyle}>
                <input
                    type="number"
                    value={Number(value.toPrecision(7))}
                    min={min}
                    max={max}
                    step={step}
                    onChange={(event) => onChange(Number(event.target.value))}
                    style={numberInputStyle}
                />
                {unit && <span style={unitStyle}>{unit}</span>}
            </span>
        </label>
    );
}

const pageStyle: React.CSSProperties = {
    flex: "1 1 auto",
    minHeight: 0,
    overflowY: "auto",
    display: "grid",
    gridTemplateColumns:
        "repeat(auto-fit, minmax(min(100%, 330px), 1fr))",
    alignItems: "start",
    gap: 12,
    padding: 12,
    boxSizing: "border-box",
    color: MFX_SURFACES.page.text,
    background: MFX_SURFACES.page.background
};

const panelStyle: React.CSSProperties = {
    minWidth: 0,
    padding: 14,
    borderRadius: 12,
    border: "1px solid transparent",
    background: multiFXSurfaceBackground("panel"),
    color: MFX_SURFACES.panel.text,
    boxShadow: MFX_SURFACES.panel.shadow,
    boxSizing: "border-box"
};

const sectionTitleStyle: React.CSSProperties = {
    color: MFX_SURFACES.panel.accent,
    fontWeight: 950,
    fontSize: "0.78rem",
    letterSpacing: "0.08em"
};

const sectionHelpStyle: React.CSSProperties = {
    marginTop: 4,
    color: MFX_SURFACES.panel.label,
    fontSize: "0.72rem"
};

const parameterListStyle: React.CSSProperties = {
    display: "grid",
    gap: 7,
    marginTop: 12,
    maxHeight: "calc(100vh - 245px)",
    overflowY: "auto",
    paddingRight: 3
};

const parameterButtonStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 52,
    display: "grid",
    gridTemplateColumns: "minmax(0,1fr) minmax(105px,.85fr)",
    alignItems: "center",
    gap: 10,
    padding: "7px 10px",
    border: "1px solid",
    borderRadius: 9,
    color: MFX_COLORS.text,
    font: "inherit",
    cursor: "pointer",
    textAlign: "left"
};

const parameterNameStyle: React.CSSProperties = {
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    fontWeight: 850
};

const parameterAssignmentStyle: React.CSSProperties = {
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    textAlign: "right",
    fontSize: "0.7rem",
    fontWeight: 850
};

const emptyStyle: React.CSSProperties = {
    padding: 16,
    borderRadius: 9,
    border: `1px dashed ${MFX_COLORS.border}`,
    color: MFX_COLORS.muted
};

const selectedParameterStyle: React.CSSProperties = {
    marginTop: 5,
    color: MFX_COLORS.cyan,
    fontSize: "1.25rem",
    fontWeight: 950,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis"
};

const fieldLabelStyle: React.CSSProperties = {
    marginTop: 15,
    marginBottom: 5,
    color: MFX_COLORS.muted,
    fontSize: "0.65rem",
    fontWeight: 900,
    letterSpacing: "0.08em"
};

const assignmentCardStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: 10,
    borderRadius: 10,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panelAlt
};

const assignmentNameStyle: React.CSSProperties = {
    color: MFX_COLORS.text,
    fontWeight: 900,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis"
};

const assignmentDetailStyle: React.CSSProperties = {
    marginTop: 2,
    color: MFX_COLORS.muted,
    fontSize: "0.66rem",
    fontWeight: 750
};

const actionButtonStyle: React.CSSProperties = {
    minWidth: 84,
    minHeight: 42,
    padding: "6px 12px",
    border: "2px solid",
    borderRadius: 9,
    background: MFX_COLORS.panel,
    font: "inherit",
    fontWeight: 950,
    cursor: "pointer"
};

const scopeCardStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: 9,
    borderRadius: 9,
    border: `1px solid ${MFX_COLORS.cyan}`,
    background: MFX_COLORS.cyanSurface
};

const scopeBadgeStyle: React.CSSProperties = {
    flex: "0 0 auto",
    color: MFX_COLORS.cyan,
    fontSize: "0.72rem",
    fontWeight: 950,
    letterSpacing: "0.08em"
};

const scopeTextStyle: React.CSSProperties = {
    color: MFX_COLORS.cyanText,
    fontSize: "0.68rem",
    lineHeight: 1.35
};

const rangeGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(2,minmax(0,1fr))",
    gap: 8
};

const numberFieldStyle: React.CSSProperties = {
    minWidth: 0,
    padding: 8,
    borderRadius: 8,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panelAlt
};

const numberLabelStyle: React.CSSProperties = {
    display: "block",
    color: MFX_COLORS.muted,
    fontSize: "0.62rem",
    fontWeight: 900
};

const numberInputRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 5,
    marginTop: 4
};

const numberInputStyle: React.CSSProperties = {
    width: "100%",
    minWidth: 0,
    minHeight: 34,
    padding: "3px 7px",
    boxSizing: "border-box",
    borderRadius: 6,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.background,
    color: MFX_COLORS.text,
    font: "inherit",
    fontWeight: 850
};

const unitStyle: React.CSSProperties = {
    flex: "0 0 auto",
    color: MFX_COLORS.muted,
    fontSize: "0.68rem",
    fontWeight: 800
};

const toggleButtonStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 42,
    marginTop: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 10px",
    border: "1px solid",
    borderRadius: 8,
    color: MFX_COLORS.text,
    font: "inherit",
    fontWeight: 900,
    cursor: "pointer"
};

const calibrationHelpStyle: React.CSSProperties = {
    marginTop: 6,
    color: MFX_COLORS.muted,
    fontSize: "0.66rem",
    lineHeight: 1.35
};

const responseCardStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "minmax(0,1fr) minmax(145px,.65fr)",
    alignItems: "center",
    gap: 10,
    padding: 9,
    borderRadius: 9,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panelAlt
};

const responseTextStyle: React.CSSProperties = {
    display: "grid",
    gap: 3,
    color: MFX_COLORS.text,
    fontSize: "0.68rem",
    lineHeight: 1.35
};

const responseSelectStyle: React.CSSProperties = {
    width: "100%",
    minWidth: 0,
    minHeight: 38,
    padding: "4px 7px",
    boxSizing: "border-box",
    borderRadius: 7,
    border: `1px solid ${MFX_COLORS.cyan}`,
    background: MFX_COLORS.background,
    color: MFX_COLORS.text,
    font: "inherit",
    fontWeight: 850
};

const warningStyle: React.CSSProperties = {
    marginTop: 9,
    padding: "7px 9px",
    borderRadius: 8,
    border: `1px solid ${MFX_COLORS.purple}`,
    background: MFX_COLORS.purpleSurface,
    color: MFX_COLORS.purpleLight,
    fontSize: "0.68rem",
    lineHeight: 1.35
};

const statusStyle: React.CSSProperties = {
    marginTop: 9,
    padding: "8px 9px",
    border: "1px solid",
    borderRadius: 8,
    background: MFX_COLORS.panelAlt,
    color: MFX_COLORS.text,
    fontSize: "0.72rem",
    fontWeight: 800
};

const footerActionsStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(2,minmax(0,1fr))",
    gap: 8,
    marginTop: 12
};

const removeButtonStyle: React.CSSProperties = {
    minHeight: 43,
    borderRadius: 9,
    border: `1px solid ${MFX_COLORS.danger}`,
    background: MFX_COLORS.panelAlt,
    color: MFX_COLORS.danger,
    font: "inherit",
    fontWeight: 900,
    cursor: "pointer"
};

const saveButtonStyle: React.CSSProperties = {
    minHeight: 43,
    borderRadius: 9,
    border: `1px solid ${MFX_COLORS.cyan}`,
    background: MFX_COLORS.cyanSurface,
    color: MFX_COLORS.cyan,
    font: "inherit",
    fontWeight: 950,
    cursor: "pointer"
};

const draftHelpStyle: React.CSSProperties = {
    marginTop: 8,
    color: MFX_COLORS.cyan,
    fontSize: "0.68rem",
    fontWeight: 800
};

const sourceCountStyle: React.CSSProperties = {
    marginTop: 6,
    color: MFX_COLORS.muted,
    fontSize: "0.6rem",
    textAlign: "right"
};
