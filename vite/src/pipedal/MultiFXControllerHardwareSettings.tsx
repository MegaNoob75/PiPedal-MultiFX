/*
 * Controller Hardware settings page.
 *
 * This page is intentionally nested under Controller Settings. It edits a
 * private hardware draft, so Cancel can discard electrical changes without
 * losing unsaved logical switch/action/layout work in the parent editor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ControllerAnalogControlConfig,
    ControllerEncoderConfig,
    ControllerHardwareConfig,
    ControllerInputSource,
    ControllerModuleConfig,
    ControllerModuleDriver,
    CONTROLLER_MODULE_DRIVERS,
    controllerInputSourceId,
    controllerInputSourceLabel,
    controllerModuleChannelCount,
    createControllerModule,
    defaultControllerHardwareConfig,
    isControllerMuxModule,
    MAX_CONTROLLER_ANALOG_CONTROLS,
    MAX_CONTROLLER_ENCODERS,
    MAX_CONTROLLER_MODULES,
    moduleSupportsCapability,
    validateControllerHardwareConfig
} from "./ControllerHardwareConfig";
import { ControllerLayoutConfig } from "./ControllerConfig";
import {
    getLatestMultiFXRuntimeState,
    MultiFXControllerHardware,
    MultiFXControllerInput,
    MultiFXControllerLearn,
    subscribeMultiFXRuntimeState,
    updateMultiFXRuntimeState
} from "./MultiFXRuntimeSync";
import { MFX_COLORS } from "./MultiFXTheme";

interface MultiFXControllerHardwareSettingsProps {
    controllerDraft: ControllerLayoutConfig;
    reportedHardware: MultiFXControllerHardware;
    onCancel: () => void;
    onSave: (
        hardware: ControllerHardwareConfig,
        switchInputs: readonly (ControllerInputSource | null)[]
    ) => Promise<string | undefined>;
}

type SourceOption = {
    id: string;
    source: ControllerInputSource;
    label: string;
    warning: string | null;
};

type HardwareLearnSession = {
    token: number;
    kind: "switch" | "analog" | "encoderRotation" | "encoderPush";
    targetIndex: number;
    targetId: string;
};

/** Convert a firmware-reported source back into the durable JSON source form. */
function sourceFromReportedInput(
    input: MultiFXControllerInput
): ControllerInputSource | null {
    if (input.type === "gpio") return { type: "gpio", pin: input.channel };
    if (input.moduleId) {
        return {
            type: "module",
            moduleId: input.moduleId,
            channel: input.channel
        };
    }
    return null;
}

/**
 * Build capability-aware input choices. Configured module channels remain
 * selectable while offline; direct pin choices come from the firmware when it
 * is connected and from already-used sources when it is not.
 */
function makeSourceOptions(
    capability: "digital" | "analog",
    modules: readonly ControllerModuleConfig[],
    reportedHardware: MultiFXControllerHardware,
    currentSources: readonly (ControllerInputSource | null)[]
): SourceOption[] {
    const options = new Map<string, SourceOption>();

    for (const input of reportedHardware.inputs) {
        if (!input.capabilities.includes(capability)) continue;
        const source = sourceFromReportedInput(input);
        const id = controllerInputSourceId(source);
        if (!source || !id) continue;
        options.set(id, {
            id,
            source,
            label: input.label,
            warning: input.reserved
                ? input.reason ?? "Reserved by the controller"
                : input.caution
                    ? input.reason ?? "Use with care on this board"
                    : null
        });
    }

    for (const module of modules) {
        if (!moduleSupportsCapability(module, capability)) continue;
        for (let channel = 0; channel < controllerModuleChannelCount(module); ++channel) {
            const source: ControllerInputSource = {
                type: "module",
                moduleId: module.id,
                channel
            };
            const id = controllerInputSourceId(source)!;
            if (!options.has(id)) {
                options.set(id, {
                    id,
                    source,
                    label: controllerInputSourceLabel(source, modules),
                    warning: null
                });
            }
        }
    }

    // Never hide a currently selected direct source merely because the
    // controller is temporarily disconnected or still reporting its profile.
    for (const source of currentSources) {
        const id = controllerInputSourceId(source);
        if (!source || !id || options.has(id)) continue;
        options.set(id, {
            id,
            source,
            label: controllerInputSourceLabel(source, modules),
            warning: reportedHardware.connected
                ? "Not reported by the connected controller"
                : null
        });
    }

    return [...options.values()].sort((left, right) => {
        if (left.source.type !== right.source.type) {
            return left.source.type === "gpio" ? -1 : 1;
        }
        return left.label.localeCompare(right.label, undefined, { numeric: true });
    });
}

/** Produce the next unique human-readable ID for a new configurable item. */
function nextSequence(ids: readonly string[], prefix: string): number {
    let sequence = 1;
    const used = new Set(ids);
    while (used.has(`${prefix}${sequence}`)) ++sequence;
    return sequence;
}

/** Clone hardware state before editing so the parent draft cannot be mutated. */
function cloneHardware(value: ControllerHardwareConfig): ControllerHardwareConfig {
    return structuredClone(value);
}

export default function MultiFXControllerHardwareSettings({
    controllerDraft,
    reportedHardware,
    onCancel,
    onSave
}: MultiFXControllerHardwareSettingsProps) {
    const [draft, setDraft] = useState<ControllerHardwareConfig>(() =>
        cloneHardware(controllerDraft.hardware)
    );
    const [switchInputs, setSwitchInputs] = useState<(ControllerInputSource | null)[]>(
        () => controllerDraft.switches.map((item) => structuredClone(item.input))
    );
    const [moduleDriver, setModuleDriver] = useState<ControllerModuleDriver>("hc4067");
    const [status, setStatus] = useState("No unsaved changes.");
    const [saving, setSaving] = useState(false);
    const [controllerLearn, setControllerLearn] = useState<MultiFXControllerLearn>(
        () => getLatestMultiFXRuntimeState()?.controllerLearn ?? {
            status: "idle",
            token: null,
            capability: null,
            input: null,
            secondaryInput: null,
            message: ""
        }
    );
    const [learnSession, setLearnSession] = useState<HardwareLearnSession | null>(null);
    const learnSessionRef = useRef<HardwareLearnSession | null>(null);
    const [learnFeedback, setLearnFeedback] = useState("");

    useEffect(() => subscribeMultiFXRuntimeState((runtime) => {
        setControllerLearn(runtime.controllerLearn);
    }), []);

    useEffect(() => {
        learnSessionRef.current = learnSession;
    }, [learnSession]);

    useEffect(() => () => {
        const session = learnSessionRef.current;
        if (session) {
            void updateMultiFXRuntimeState({
                controllerLearnCancel: { token: session.token }
            }).catch(() => undefined);
        }
    }, []);

    /** Stop a transient digital or analog Learn session without changing the draft. */
    const cancelLearn = useCallback(async (
        session: HardwareLearnSession | null = learnSession,
        feedback = "Learn cancelled."
    ) => {
        if (!session) return;
        learnSessionRef.current = null;
        setLearnSession(null);
        try {
            const runtime = await updateMultiFXRuntimeState({
                controllerLearnCancel: { token: session.token }
            });
            setLearnFeedback(
                runtime.controllerLearn.status === "error"
                    ? runtime.controllerLearn.message
                    : feedback
            );
        } catch {
            setLearnFeedback("Could not cancel Learn. It will time out automatically.");
        }
    }, [learnSession]);

    /** Ask the controller to identify an activated input of the requested kind. */
    const startLearn = async (
        kind: HardwareLearnSession["kind"],
        targetIndex: number
    ) => {
        const target = kind === "switch"
            ? controllerDraft.switches[targetIndex]
            : kind === "analog"
                ? draft.analogControls[targetIndex]
                : draft.encoders[targetIndex];
        if (!target) return;
        if (learnSession) await cancelLearn(learnSession, "");
        setLearnFeedback(`Waiting to start Learn for ${target.label}…`);
        try {
            const runtime = await updateMultiFXRuntimeState({
                controllerLearnStart: {
                    capability: kind === "analog"
                        ? "analog"
                        : kind === "encoderRotation"
                            ? "encoder"
                            : kind === "encoderPush" ? "encoderPush" : "digital",
                    hardwareSwitch: kind === "switch"
                        ? controllerDraft.switches[targetIndex].hardwareSwitch
                        : targetIndex + 1
                }
            });
            const token = runtime.controllerLearn.token;
            if (token === null) {
                setLearnFeedback(runtime.controllerLearn.message || "Learn could not start.");
                return;
            }
            const session = { token, kind, targetIndex, targetId: target.id };
            learnSessionRef.current = session;
            setLearnSession(session);
            // A fast controller can finish Learn before the POST response
            // returns. Publish that completed response into the same result
            // handler instead of mistaking it for a failed start.
            setControllerLearn(runtime.controllerLearn);
            if (runtime.controllerLearn.status === "waiting") {
                setLearnFeedback(
                    kind === "switch" || kind === "encoderPush"
                        ? `Waiting for the physical button for ${target.label}…`
                        : kind === "encoderRotation"
                            ? `Turn ${target.label} through several clicks…`
                            : `Move ${target.label} steadily through part of its range…`
                );
            } else {
                setLearnFeedback(runtime.controllerLearn.message || "Processing learned input…");
            }
        } catch (error) {
            setLearnFeedback(error instanceof Error ? error.message : "Learn could not start.");
        }
    };

    useEffect(() => {
        if (!learnSession || controllerLearn.token !== learnSession.token) return;
        if (controllerLearn.status === "waiting" || controllerLearn.status === "idle") return;

        if (controllerLearn.status === "learned") {
            const learnedSource = controllerLearn.input
                ? sourceFromReportedInput(controllerLearn.input)
                : null;
            const secondaryLearnedSource = controllerLearn.secondaryInput
                ? sourceFromReportedInput(controllerLearn.secondaryInput)
                : null;
            const currentEncoderIndex = draft.encoders.findIndex(
                (item) => item.id === learnSession.targetId
            );

            if (learnSession.kind === "encoderRotation") {
                if (!learnedSource || !secondaryLearnedSource
                    || currentEncoderIndex < 0) {
                    setLearnFeedback("Encoder Learn did not return two valid phase inputs. No change was made.");
                } else {
                    const learnedIds = new Set([
                        controllerInputSourceId(learnedSource),
                        controllerInputSourceId(secondaryLearnedSource)
                    ]);
                    let conflictLabel: string | null = null;
                    switchInputs.forEach((source, index) => {
                        if (learnedIds.has(controllerInputSourceId(source))) {
                            conflictLabel ??= controllerDraft.switches[index]?.label ?? "a switch";
                        }
                    });
                    draft.encoders.forEach((encoder, index) => {
                        const sources = index === currentEncoderIndex
                            ? [encoder.buttonInput]
                            : [encoder.aInput, encoder.bInput, encoder.buttonInput];
                        if (sources.some((source) => learnedIds.has(controllerInputSourceId(source)))) {
                            conflictLabel ??= encoder.label;
                        }
                    });
                    if (conflictLabel) {
                        setLearnFeedback(
                            `One of those encoder inputs is already assigned to ${conflictLabel}. Remove or disconnect the old assignment, then try again; you do not need to save first.`
                        );
                    } else {
                        setDraft((current) => ({
                            ...current,
                            templateId: "custom",
                            encoders: current.encoders.map((encoder) =>
                                encoder.id === learnSession.targetId
                                    ? {
                                        ...encoder,
                                        aInput: learnedSource,
                                        bInput: secondaryLearnedSource
                                    }
                                    : encoder
                            )
                        }));
                        setStatus("Unsaved changes.");
                        setLearnFeedback(
                            `${controllerLearn.input?.label ?? "Input A"} and ${controllerLearn.secondaryInput?.label ?? "Input B"} learned for ${draft.encoders[currentEncoderIndex]?.label ?? "encoder"}. Test direction, then Save & Apply.`
                        );
                    }
                }
            } else if (learnSession.kind === "encoderPush") {
                if (!learnedSource || currentEncoderIndex < 0) {
                    setLearnFeedback("Encoder push Learn did not return a valid input. No change was made.");
                } else {
                    const learnedId = controllerInputSourceId(learnedSource);
                    let conflictLabel: string | null = null;
                    switchInputs.forEach((source, index) => {
                        if (controllerInputSourceId(source) === learnedId) {
                            conflictLabel ??= controllerDraft.switches[index]?.label ?? "a switch";
                        }
                    });
                    draft.encoders.forEach((encoder, index) => {
                        const sources = index === currentEncoderIndex
                            ? [encoder.aInput, encoder.bInput]
                            : [encoder.aInput, encoder.bInput, encoder.buttonInput];
                        if (sources.some((source) => controllerInputSourceId(source) === learnedId)) {
                            conflictLabel ??= encoder.label;
                        }
                    });
                    if (conflictLabel) {
                        setLearnFeedback(
                            `That push input is already assigned to ${conflictLabel}. Remove or disconnect the old assignment, then try again; you do not need to save first.`
                        );
                    } else {
                        setDraft((current) => ({
                            ...current,
                            templateId: "custom",
                            encoders: current.encoders.map((encoder) =>
                                encoder.id === learnSession.targetId
                                    ? { ...encoder, buttonInput: learnedSource }
                                    : encoder
                            )
                        }));
                        setStatus("Unsaved changes.");
                        setLearnFeedback(
                            `${controllerLearn.input?.label ?? "Input"} learned as the push button for ${draft.encoders[currentEncoderIndex]?.label ?? "encoder"}. Save & Apply to keep it.`
                        );
                    }
                }
            } else if (!learnedSource) {
                setLearnFeedback("The learned input did not have a recognized source address.");
            } else {
                const learnedId = controllerInputSourceId(learnedSource);
                const currentSwitchIndex = controllerDraft.switches.findIndex(
                    (item) => item.id === learnSession.targetId
                );
                const currentAnalogIndex = draft.analogControls.findIndex(
                    (item) => item.id === learnSession.targetId
                );
                const currentTargetIndex = learnSession.kind === "switch"
                    ? currentSwitchIndex
                    : currentAnalogIndex;
                if (currentTargetIndex < 0) {
                    setLearnFeedback("The target control was removed before Learn completed. No change was made.");
                } else {
                    const conflictIndex = learnSession.kind === "switch"
                    ? switchInputs.findIndex((source, index) =>
                        index !== currentTargetIndex
                        && controllerInputSourceId(source) === learnedId
                    )
                    : draft.analogControls.findIndex((control, index) =>
                        index !== currentTargetIndex
                        && controllerInputSourceId(control.input) === learnedId
                    );
                    if (conflictIndex >= 0) {
                        setLearnFeedback(
                            `That input is already assigned to ${learnSession.kind === "switch"
                                ? controllerDraft.switches[conflictIndex]?.label ?? "another switch"
                                : draft.analogControls[conflictIndex]?.label ?? "another analog control"}. Set the old assignment to Not connected, then try Learn again. You do not need to save first.`
                        );
                    } else if (learnSession.kind === "switch") {
                        setSwitchInputs((current) => current.map((source, index) =>
                            index === currentTargetIndex ? learnedSource : source
                        ));
                        setStatus("Unsaved changes.");
                        setLearnFeedback(
                            `${controllerLearn.input?.label ?? "Input"} learned for ${controllerDraft.switches[currentTargetIndex]?.label ?? "switch"}. Save & Apply to keep it.`
                        );
                    } else {
                        setDraft((current) => ({
                            ...current,
                            templateId: "custom",
                            analogControls: current.analogControls.map((control) =>
                                control.id === learnSession.targetId
                                    ? { ...control, input: learnedSource }
                                    : control
                            )
                        }));
                        setStatus("Unsaved changes.");
                        setLearnFeedback(
                            `${controllerLearn.input?.label ?? "Input"} learned for ${draft.analogControls[currentTargetIndex]?.label ?? "analog control"}. Save & Apply to keep it.`
                        );
                    }
                }
            }
        } else {
            setLearnFeedback(controllerLearn.message || "Learn ended without changing the input.");
        }

        const completed = learnSession;
        learnSessionRef.current = null;
        setLearnSession(null);
        void updateMultiFXRuntimeState({
            controllerLearnCancel: { token: completed.token }
        }).catch(() => undefined);
    }, [controllerLearn, learnSession, switchInputs, controllerDraft.switches, draft.analogControls, draft.encoders]);

    const allCurrentSources = useMemo(() => [
        ...switchInputs,
        ...draft.analogControls.map((item) => item.input),
        ...draft.encoders.flatMap((item) => [
            item.aInput,
            item.bInput,
            item.buttonInput
        ])
    ], [switchInputs, draft.analogControls, draft.encoders]);

    const digitalOptions = useMemo(() => makeSourceOptions(
        "digital",
        draft.modules,
        reportedHardware,
        allCurrentSources
    ), [draft.modules, reportedHardware, allCurrentSources]);
    const analogOptions = useMemo(() => makeSourceOptions(
        "analog",
        draft.modules,
        reportedHardware,
        allCurrentSources
    ), [draft.modules, reportedHardware, allCurrentSources]);

    /** Mark manual edits as custom while retaining the chosen board profile. */
    const updateDraft = (next: ControllerHardwareConfig) => {
        setDraft({ ...next, templateId: "custom" });
        setStatus("Unsaved changes.");
    };

    /** Replace one module without relying on unsafe mutation of union fields. */
    const replaceModule = (index: number, module: ControllerModuleConfig) => {
        const modules = [...draft.modules];
        modules[index] = module;
        updateDraft({ ...draft, modules });
    };

    /** Remove a module and disconnect controls that referenced its channels. */
    const removeModule = (moduleId: string) => {
        setSwitchInputs((current) => current.map((source) =>
            source?.type === "module" && source.moduleId === moduleId
                ? null
                : source
        ));
        setStatus("Unsaved changes.");
        updateDraft({
            ...draft,
            modules: draft.modules.filter((item) => item.id !== moduleId),
            analogControls: draft.analogControls.map((item) =>
                item.input?.type === "module" && item.input.moduleId === moduleId
                    ? { ...item, input: null }
                    : item
            ),
            encoders: draft.encoders.filter((item) =>
                ![item.aInput, item.bInput, item.buttonInput].some((source) =>
                    source?.type === "module" && source.moduleId === moduleId
                )
            )
        });
    };

    /** Add a module only when the firmware/UI capacity still permits one. */
    const addModule = () => {
        if (draft.modules.length >= MAX_CONTROLLER_MODULES) return;
        const sequence = nextSequence(draft.modules.map((item) => item.id), "module");
        updateDraft({
            ...draft,
            modules: [...draft.modules, createControllerModule(moduleDriver, sequence)]
        });
    };

    /** Replace one analog control in the immutable page draft. */
    const replaceAnalog = (
        index: number,
        control: ControllerAnalogControlConfig
    ) => {
        const analogControls = [...draft.analogControls];
        analogControls[index] = control;
        updateDraft({ ...draft, analogControls });
    };

    /** Add a disabled pot entry so wiring can be chosen explicitly. */
    const addAnalog = () => {
        if (draft.analogControls.length >= MAX_CONTROLLER_ANALOG_CONTROLS) return;
        const sequence = nextSequence(
            draft.analogControls.map((item) => item.id),
            "analog"
        );
        const usedCcs = new Set([
            ...draft.analogControls.map((item) => item.midiCc),
            ...draft.encoders.flatMap((item) => [item.turnCc, item.buttonCc])
        ]);
        let midiCc = 10;
        while (usedCcs.has(midiCc) && midiCc < 119) ++midiCc;
        updateDraft({
            ...draft,
            analogControls: [...draft.analogControls, {
                id: `analog${sequence}`,
                label: `ANALOG ${sequence}`,
                style: "pot",
                input: null,
                midiCc,
                calibrationMin: 0,
                calibrationMax: 4095,
                inverted: false,
                filterShift: 4,
                midiHysteresis: 2
            }]
        });
    };

    /** Replace one encoder in the immutable page draft. */
    const replaceEncoder = (index: number, encoder: ControllerEncoderConfig) => {
        const encoders = [...draft.encoders];
        encoders[index] = encoder;
        updateDraft({ ...draft, encoders });
    };

    /** Add an encoder only after at least two digital choices are available. */
    const addEncoder = () => {
        if (draft.encoders.length >= MAX_CONTROLLER_ENCODERS
            || digitalOptions.length < 2) return;
        const sequence = nextSequence(draft.encoders.map((item) => item.id), "encoder");
        const usedCcs = new Set([
            ...draft.analogControls.map((item) => item.midiCc),
            ...draft.encoders.flatMap((item) => [item.turnCc, item.buttonCc])
        ]);
        let turnCc = 30;
        while (usedCcs.has(turnCc) && turnCc < 119) ++turnCc;
        usedCcs.add(turnCc);
        let buttonCc = turnCc + 1;
        while (usedCcs.has(buttonCc) && buttonCc < 119) ++buttonCc;
        updateDraft({
            ...draft,
            encoders: [...draft.encoders, {
                id: `encoder${sequence}`,
                label: `ENCODER ${sequence}`,
                aInput: digitalOptions[0].source,
                bInput: digitalOptions[1].source,
                buttonInput: null,
                turnCc,
                buttonCc,
                stepsPerDetent: 4,
                reversed: false
            }]
        });
    };

    /** Validate the combined switch + hardware draft, then request atomic apply. */
    const save = async () => {
        const error = validateControllerHardwareConfig(
            draft,
            switchInputs
        );
        if (error) {
            setStatus(error);
            return;
        }
        setSaving(true);
        setStatus("Saving changes…");
        try {
            const result = await onSave(cloneHardware(draft), structuredClone(switchInputs));
            setStatus(result || "Saved changes.");
        } catch (errorValue) {
            setStatus(String(errorValue));
        } finally {
            setSaving(false);
        }
    };

    const availableDriverIds = new Set(
        reportedHardware.drivers.map((item) => item.id)
    );

    return (
        <div style={rootStyle}>
            <div style={headerStyle}>
                <div>
                    <div style={titleStyle}>CONTROLLER HARDWARE</div>
                    <div style={subtitleStyle}>
                        Choose the board wiring, expansion modules, pots, sliders, and encoders.
                    </div>
                </div>
                <div style={connectionBadgeStyle(reportedHardware.connected)}>
                    {reportedHardware.connected
                        ? reportedHardware.boardName ?? "CONTROLLER CONNECTED"
                        : "CONTROLLER OFFLINE"}
                </div>
            </div>

            <section style={sectionStyle}>
                <div style={sectionHeadingStyle}>BOARD & TEMPLATE</div>
                <div style={twoColumnStyle}>
                    <label style={fieldStyle}>
                        <span style={fieldLabelStyle}>Board profile</span>
                        <select
                            value={draft.boardProfile}
                            onChange={(event) => updateDraft({
                                ...draft,
                                boardProfile: event.target.value
                            })}
                            style={inputStyle}
                        >
                            <option value="auto">Auto-detect from firmware</option>
                            {reportedHardware.boardId && (
                                <option value={reportedHardware.boardId}>
                                    {reportedHardware.boardName ?? reportedHardware.boardId}
                                </option>
                            )}
                        </select>
                    </label>
                    <div style={fieldStyle}>
                        <span style={fieldLabelStyle}>Starting template</span>
                        <button
                            type="button"
                            onClick={() => {
                                setDraft(cloneHardware(defaultControllerHardwareConfig));
                                setStatus("Unsaved changes — restored the ESP32-S3 reference template.");
                            }}
                            style={normalButtonStyle}
                        >
                            RESTORE POT / ENCODER TEMPLATE
                        </button>
                    </div>
                </div>
                <div style={helpStyle}>
                    This restores your current 4 pots and encoder. Switch inputs remain on the
                    Controller Settings page so their unsaved actions and layout stay intact.
                    The template is only a recommended starting point; compatible pins remain user-selectable.
                </div>
            </section>

            <section style={sectionStyle}>
                <div>
                    <div style={sectionHeadingStyle}>SWITCHES & BUTTONS</div>
                    <div style={helpStyle}>
                        Choose the digital pin or expansion-module channel for each switch.
                        Switch actions, names, and screen positions remain in Controller Settings.
                    </div>
                </div>
                <div style={switchHardwareGridStyle}>
                    {controllerDraft.switches.map((item, index) => (
                        <div key={item.id} style={switchHardwareCardStyle}>
                            <SourceSelect
                                label={item.label}
                                value={switchInputs[index] ?? null}
                                options={digitalOptions}
                                optional
                                onChange={(source) => setSwitchInputs((current) => {
                                    const next = [...current];
                                    next[index] = source;
                                    setStatus("Unsaved changes.");
                                    return next;
                                })}
                            />
                            <button
                                type="button"
                                onClick={() => learnSession?.kind === "switch" && learnSession.targetId === item.id
                                    ? void cancelLearn(learnSession)
                                    : void startLearn("switch", index)}
                                disabled={saving || (
                                    learnSession !== null && (
                                        learnSession.kind !== "switch" || learnSession.targetId !== item.id
                                    )
                                ) || (
                                    learnSession === null && (
                                        !reportedHardware.connected
                                        || (reportedHardware.protocolVersion ?? 0) < 2
                                        || digitalOptions.length === 0
                                    )
                                )}
                                style={learnButtonStyle}
                            >
                                {learnSession?.kind === "switch" && learnSession.targetId === item.id ? "CANCEL" : "LEARN"}
                            </button>
                        </div>
                    ))}
                </div>
                <div style={helpStyle}>
                    Press Learn, then press the matching physical switch or button.
                </div>
                {learnFeedback && <div style={statusStyle}>{learnFeedback}</div>}
            </section>

            <section style={sectionStyle}>
                <div style={sectionTitleRowStyle}>
                    <div>
                        <div style={sectionHeadingStyle}>EXPANSION MODULES</div>
                        <div style={helpStyle}>Advanced bus, address, and wiring fields appear only after a module is added.</div>
                    </div>
                    <div style={addRowStyle}>
                        <select
                            value={moduleDriver}
                            onChange={(event) => setModuleDriver(
                                event.target.value as ControllerModuleDriver
                            )}
                            style={inputStyle}
                        >
                            {CONTROLLER_MODULE_DRIVERS.map((driver) => (
                                <option
                                    key={driver.id}
                                    value={driver.id}
                                    disabled={reportedHardware.connected
                                        && reportedHardware.drivers.length > 0
                                        && !availableDriverIds.has(driver.id)}
                                >
                                    {driver.label}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={addModule}
                            disabled={draft.modules.length >= MAX_CONTROLLER_MODULES}
                            style={accentButtonStyle}
                        >
                            + MODULE
                        </button>
                    </div>
                </div>
                {draft.modules.length === 0 ? (
                    <div style={emptyStyle}>No expansion modules. Direct board pins remain available.</div>
                ) : draft.modules.map((module, index) => (
                    <ModuleEditor
                        key={module.id}
                        module={module}
                        onChange={(next) => replaceModule(index, next)}
                        onRemove={() => removeModule(module.id)}
                    />
                ))}
            </section>

            <section style={sectionStyle}>
                <div style={sectionTitleRowStyle}>
                    <div>
                        <div style={sectionHeadingStyle}>POTS, SLIDERS & EXPRESSION</div>
                        <div style={helpStyle}>Press Learn, wait one second, then move any physical control steadily. To swap assignments safely, set the affected controls to Not connected first; you can relearn them immediately without saving between changes.</div>
                    </div>
                    <button
                        type="button"
                        onClick={addAnalog}
                        disabled={draft.analogControls.length >= MAX_CONTROLLER_ANALOG_CONTROLS}
                        style={accentButtonStyle}
                    >
                        + ANALOG CONTROL
                    </button>
                </div>
                {draft.analogControls.map((control, index) => (
                    <div key={control.id} style={cardStyle}>
                        <div style={cardHeaderStyle}>
                            <input
                                value={control.label}
                                onChange={(event) => replaceAnalog(index, {
                                    ...control,
                                    label: event.target.value
                                })}
                                style={nameInputStyle}
                                aria-label="Analog control name"
                            />
                            <div style={addRowStyle}>
                                <button
                                    type="button"
                                    onClick={() => learnSession?.kind === "analog"
                                        && learnSession.targetId === control.id
                                        ? void cancelLearn(learnSession)
                                        : void startLearn("analog", index)}
                                    disabled={saving || (
                                        learnSession !== null && (
                                            learnSession.kind !== "analog"
                                            || learnSession.targetId !== control.id
                                        )
                                    ) || (
                                        learnSession === null && (
                                            !reportedHardware.connected
                                            || (reportedHardware.protocolVersion ?? 0) < 2
                                            || analogOptions.length === 0
                                        )
                                    )}
                                    style={learnButtonStyle}
                                >
                                    {learnSession?.kind === "analog"
                                        && learnSession.targetId === control.id ? "CANCEL" : "LEARN"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => updateDraft({
                                        ...draft,
                                        analogControls: draft.analogControls.filter((_, itemIndex) => itemIndex !== index)
                                    })}
                                    style={dangerButtonStyle}
                                >
                                    REMOVE
                                </button>
                            </div>
                        </div>
                        <div style={responsiveFieldsStyle}>
                            <SourceSelect
                                label="Input"
                                value={control.input}
                                options={analogOptions}
                                optional
                                onChange={(source) => replaceAnalog(index, { ...control, input: source })}
                            />
                            <SelectField
                                label="Control style"
                                value={control.style}
                                onChange={(value) => replaceAnalog(index, {
                                    ...control,
                                    style: value as ControllerAnalogControlConfig["style"]
                                })}
                                options={[
                                    ["pot", "Pot"],
                                    ["slider", "Slider"],
                                    ["expression", "Expression pedal"]
                                ]}
                            />
                            <NumberField label="MIDI CC" value={control.midiCc} min={0} max={119}
                                onChange={(value) => replaceAnalog(index, { ...control, midiCc: value })} />
                            <NumberField label="Calibration min" value={control.calibrationMin} min={0} max={4094}
                                onChange={(value) => replaceAnalog(index, { ...control, calibrationMin: value })} />
                            <NumberField label="Calibration max" value={control.calibrationMax} min={1} max={4095}
                                onChange={(value) => replaceAnalog(index, { ...control, calibrationMax: value })} />
                            <NumberField label="Noise filtering (0–7)" value={control.filterShift} min={0} max={7}
                                onChange={(value) => replaceAnalog(index, { ...control, filterShift: value })} />
                            <NumberField label="Response (1 fine–4 stable)" value={control.midiHysteresis} min={1} max={4}
                                onChange={(value) => replaceAnalog(index, { ...control, midiHysteresis: value })} />
                            <CheckboxField label="Reverse direction" checked={control.inverted}
                                onChange={(value) => replaceAnalog(index, { ...control, inverted: value })} />
                        </div>
                    </div>
                ))}
            </section>

            <section style={sectionStyle}>
                <div style={sectionTitleRowStyle}>
                    <div>
                        <div style={sectionHeadingStyle}>ENCODERS</div>
                        <div style={helpStyle}>Each encoder needs A and B digital inputs; its push button is optional.</div>
                    </div>
                    <button type="button" onClick={addEncoder}
                        disabled={draft.encoders.length >= MAX_CONTROLLER_ENCODERS || digitalOptions.length < 2}
                        style={accentButtonStyle}>+ ENCODER</button>
                </div>
                {draft.encoders.map((encoder, index) => (
                    <div key={encoder.id} style={cardStyle}>
                        <div style={cardHeaderStyle}>
                            <input value={encoder.label}
                                onChange={(event) => replaceEncoder(index, { ...encoder, label: event.target.value })}
                                style={nameInputStyle} aria-label="Encoder name" />
                            <div style={addRowStyle}>
                                <button type="button"
                                    onClick={() => learnSession?.kind === "encoderRotation"
                                        && learnSession.targetId === encoder.id
                                        ? void cancelLearn(learnSession)
                                        : void startLearn("encoderRotation", index)}
                                    disabled={saving || (
                                        learnSession !== null && (
                                            learnSession.kind !== "encoderRotation"
                                            || learnSession.targetId !== encoder.id
                                        )
                                    ) || (
                                        learnSession === null && (
                                            !reportedHardware.connected
                                            || (reportedHardware.protocolVersion ?? 0) < 2
                                            || digitalOptions.length < 2
                                        )
                                    )}
                                    style={learnButtonStyle}>
                                    {learnSession?.kind === "encoderRotation"
                                        && learnSession.targetId === encoder.id
                                        ? "CANCEL" : "LEARN ROTATION"}
                                </button>
                                <button type="button"
                                    onClick={() => learnSession?.kind === "encoderPush"
                                        && learnSession.targetId === encoder.id
                                        ? void cancelLearn(learnSession)
                                        : void startLearn("encoderPush", index)}
                                    disabled={saving || (
                                        learnSession !== null && (
                                            learnSession.kind !== "encoderPush"
                                            || learnSession.targetId !== encoder.id
                                        )
                                    ) || (
                                        learnSession === null && (
                                            !reportedHardware.connected
                                            || (reportedHardware.protocolVersion ?? 0) < 2
                                            || digitalOptions.length === 0
                                        )
                                    )}
                                    style={learnButtonStyle}>
                                    {learnSession?.kind === "encoderPush"
                                        && learnSession.targetId === encoder.id
                                        ? "CANCEL" : "LEARN PUSH"}
                                </button>
                                <button type="button"
                                    onClick={() => updateDraft({
                                        ...draft,
                                        encoders: draft.encoders.filter((_, itemIndex) => itemIndex !== index)
                                    })}
                                    style={dangerButtonStyle}>REMOVE</button>
                            </div>
                        </div>
                        <div style={responsiveFieldsStyle}>
                            <SourceSelect label="A input" value={encoder.aInput} options={digitalOptions}
                                onChange={(source) => source && replaceEncoder(index, { ...encoder, aInput: source })} />
                            <SourceSelect label="B input" value={encoder.bInput} options={digitalOptions}
                                onChange={(source) => source && replaceEncoder(index, { ...encoder, bInput: source })} />
                            <SourceSelect label="Push input" value={encoder.buttonInput} options={digitalOptions} optional
                                onChange={(source) => replaceEncoder(index, { ...encoder, buttonInput: source })} />
                            <NumberField label="Turn MIDI CC" value={encoder.turnCc} min={0} max={119}
                                onChange={(value) => replaceEncoder(index, { ...encoder, turnCc: value })} />
                            <NumberField label="Button MIDI CC" value={encoder.buttonCc} min={0} max={119}
                                onChange={(value) => replaceEncoder(index, { ...encoder, buttonCc: value })} />
                            <NumberField label="Transitions per detent" value={encoder.stepsPerDetent} min={1} max={4}
                                onChange={(value) => replaceEncoder(index, { ...encoder, stepsPerDetent: value })} />
                            <CheckboxField label="Reverse direction" checked={encoder.reversed}
                                onChange={(value) => replaceEncoder(index, { ...encoder, reversed: value })} />
                        </div>
                    </div>
                ))}
            </section>

            <section style={sectionStyle}>
                <div style={sectionHeadingStyle}>CONNECTION & APPLY STATUS</div>
                <div style={statusGridStyle}>
                    <StatusValue label="Firmware protocol"
                        value={reportedHardware.protocolVersion?.toString() ?? "Not detected"} />
                    <StatusValue label="Inputs reported"
                        value={reportedHardware.inputs.length.toString()} />
                    <StatusValue label="Last apply"
                        value={reportedHardware.apply.status.toUpperCase()} />
                </div>
                {reportedHardware.apply.message && (
                    <div style={helpStyle}>{reportedHardware.apply.message}</div>
                )}
            </section>

            {status && <div style={statusStyle}>{status}</div>}

            <div style={footerStyle}>
                <button type="button" onClick={onCancel} disabled={saving} style={normalButtonStyle}>
                    CANCEL
                </button>
                <button type="button" onClick={() => void save()} disabled={saving} style={saveButtonStyle}>
                    {saving ? "APPLYING…" : "SAVE & APPLY"}
                </button>
            </div>
        </div>
    );
}

interface ModuleEditorProps {
    module: ControllerModuleConfig;
    onChange: (module: ControllerModuleConfig) => void;
    onRemove: () => void;
}

/** Render only the wiring fields required by the selected module driver. */
function ModuleEditor({ module, onChange, onRemove }: ModuleEditorProps) {
    const info = CONTROLLER_MODULE_DRIVERS.find((item) => item.id === module.driver)!;
    return (
        <div style={cardStyle}>
            <div style={cardHeaderStyle}>
                <div>
                    <input value={module.label}
                        onChange={(event) => onChange({ ...module, label: event.target.value })}
                        style={nameInputStyle} aria-label="Module name" />
                    <div style={helpStyle}>{info.description}</div>
                </div>
                <button type="button" onClick={onRemove} style={dangerButtonStyle}>REMOVE</button>
            </div>
            {isControllerMuxModule(module) ? (
                <div style={responsiveFieldsStyle}>
                    <NumberField label="Signal GPIO" value={module.signalPin} min={0} max={126}
                        onChange={(value) => onChange({ ...module, signalPin: value })} />
                    {module.selectPins.map((pin, index) => (
                        <NumberField key={index} label={`Select S${index} GPIO`} value={pin} min={0} max={126}
                            onChange={(value) => {
                                const selectPins = [...module.selectPins];
                                selectPins[index] = value;
                                onChange({ ...module, selectPins });
                            }} />
                    ))}
                    <label style={fieldStyle}>
                        <span style={fieldLabelStyle}>Enable GPIO (optional)</span>
                        <input type="number" min={0} max={126}
                            value={module.enablePin ?? ""}
                            placeholder="Not connected"
                            onChange={(event) => onChange({
                                ...module,
                                enablePin: event.target.value === "" ? null : Number(event.target.value)
                            })}
                            style={inputStyle} />
                    </label>
                </div>
            ) : (
                <div style={responsiveFieldsStyle}>
                    <NumberField label="SDA GPIO" value={module.sdaPin} min={0} max={126}
                        onChange={(value) => onChange({ ...module, sdaPin: value })} />
                    <NumberField label="SCL GPIO" value={module.sclPin} min={0} max={126}
                        onChange={(value) => onChange({ ...module, sclPin: value })} />
                    <label style={fieldStyle}>
                        <span style={fieldLabelStyle}>I2C address</span>
                        <input value={`0x${module.address.toString(16).toUpperCase()}`}
                            onChange={(event) => {
                                const parsed = Number.parseInt(event.target.value.replace(/^0x/i, ""), 16);
                                if (Number.isFinite(parsed)) onChange({ ...module, address: parsed });
                            }} style={inputStyle} />
                    </label>
                </div>
            )}
        </div>
    );
}

interface SourceSelectProps {
    label: string;
    value: ControllerInputSource | null;
    options: readonly SourceOption[];
    optional?: boolean;
    onChange: (source: ControllerInputSource | null) => void;
}

/** Shared board-neutral source picker used by analog controls and encoders. */
function SourceSelect({ label, value, options, optional, onChange }: SourceSelectProps) {
    const selectedId = controllerInputSourceId(value) ?? "";
    const selected = options.find((item) => item.id === selectedId);
    return (
        <label style={fieldStyle}>
            <span style={fieldLabelStyle}>{label}</span>
            <select value={selectedId}
                onChange={(event) => onChange(
                    options.find((item) => item.id === event.target.value)?.source ?? null
                )}
                style={inputStyle}>
                {optional && <option value="">Not connected</option>}
                {!optional && options.length === 0 && <option value="">No compatible inputs</option>}
                {options.map((option) => (
                    <option key={option.id} value={option.id} disabled={Boolean(
                        option.warning?.toLowerCase().includes("reserved")
                        && selectedId !== option.id
                    )}>
                        {option.label}{option.warning ? " ⚠" : ""}
                    </option>
                ))}
            </select>
            {selected?.warning && <span style={warningStyle}>{selected.warning}</span>}
        </label>
    );
}

interface NumberFieldProps {
    label: string;
    value: number;
    min: number;
    max: number;
    onChange: (value: number) => void;
}

/** Consistent bounded numeric editor; full validation still occurs on Save. */
function NumberField({ label, value, min, max, onChange }: NumberFieldProps) {
    return (
        <label style={fieldStyle}>
            <span style={fieldLabelStyle}>{label}</span>
            <input type="number" value={value} min={min} max={max}
                onChange={(event) => onChange(Number(event.target.value))}
                style={inputStyle} />
        </label>
    );
}

interface SelectFieldProps {
    label: string;
    value: string;
    options: readonly (readonly [string, string])[];
    onChange: (value: string) => void;
}

/** Small labelled select used for non-source enum values. */
function SelectField({ label, value, options, onChange }: SelectFieldProps) {
    return (
        <label style={fieldStyle}>
            <span style={fieldLabelStyle}>{label}</span>
            <select value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle}>
                {options.map(([optionValue, optionLabel]) => (
                    <option key={optionValue} value={optionValue}>{optionLabel}</option>
                ))}
            </select>
        </label>
    );
}

/** Compact checkbox field aligned with the other electrical settings. */
function CheckboxField({
    label,
    checked,
    onChange
}: {
    label: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <label style={{ ...fieldStyle, flexDirection: "row", alignItems: "center", paddingTop: 22 }}>
            <input type="checkbox" checked={checked}
                onChange={(event) => onChange(event.target.checked)} />
            <span style={fieldLabelStyle}>{label}</span>
        </label>
    );
}

/** Read-only summary value used by the connection/test section. */
function StatusValue({ label, value }: { label: string; value: string }) {
    return <div style={statusValueStyle}><span style={fieldLabelStyle}>{label}</span><strong>{value}</strong></div>;
}

const rootStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    minHeight: 0,
    maxHeight: "100%",
    boxSizing: "border-box",
    padding: "clamp(12px, 2vw, 24px)",
    color: MFX_COLORS.text,
    background: MFX_COLORS.background,
    display: "flex",
    flexDirection: "column",
    gap: 14,
    overflowX: "hidden",
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    overscrollBehavior: "contain"
};
const headerStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" };
const titleStyle: React.CSSProperties = { color: MFX_COLORS.cyan, fontSize: "clamp(1.1rem, 2vw, 1.55rem)", fontWeight: 900, letterSpacing: "0.08em" };
const subtitleStyle: React.CSSProperties = { color: MFX_COLORS.muted, marginTop: 4, maxWidth: 760 };
const connectionBadgeStyle = (connected: boolean): React.CSSProperties => ({ border: `1px solid ${connected ? MFX_COLORS.cyan : MFX_COLORS.border}`, color: connected ? MFX_COLORS.cyan : MFX_COLORS.muted, borderRadius: 999, padding: "7px 12px", fontSize: "0.76rem", fontWeight: 800 });
const sectionStyle: React.CSSProperties = { border: `1px solid ${MFX_COLORS.border}`, background: MFX_COLORS.panel, borderRadius: 12, padding: "clamp(12px, 1.8vw, 20px)", display: "flex", flexDirection: "column", gap: 12 };
const sectionHeadingStyle: React.CSSProperties = { color: MFX_COLORS.cyan, fontWeight: 900, letterSpacing: "0.06em" };
const sectionTitleRowStyle: React.CSSProperties = { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" };
const twoColumnStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 };
const responsiveFieldsStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, alignItems: "start" };
const switchHardwareGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 };
const switchHardwareCardStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, alignItems: "end", border: `1px solid ${MFX_COLORS.border}`, borderRadius: 8, padding: 10, background: MFX_COLORS.panelAlt };
const fieldStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 5, minWidth: 0 };
const fieldLabelStyle: React.CSSProperties = { color: MFX_COLORS.muted, fontSize: "0.76rem", fontWeight: 800, letterSpacing: "0.03em" };
const inputStyle: React.CSSProperties = { boxSizing: "border-box", width: "100%", minHeight: 38, color: MFX_COLORS.text, background: MFX_COLORS.panelAlt, border: `1px solid ${MFX_COLORS.border}`, borderRadius: 7, padding: "7px 9px" };
const nameInputStyle: React.CSSProperties = { ...inputStyle, width: "min(100%, 360px)", color: MFX_COLORS.cyan, fontWeight: 900 };
const cardStyle: React.CSSProperties = { border: `1px solid ${MFX_COLORS.border}`, borderRadius: 9, background: MFX_COLORS.panelAlt, padding: 12, display: "flex", flexDirection: "column", gap: 12 };
const cardHeaderStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 };
const addRowStyle: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const helpStyle: React.CSSProperties = { color: MFX_COLORS.muted, fontSize: "0.82rem", lineHeight: 1.4 };
const warningStyle: React.CSSProperties = { color: "#fbbf24", fontSize: "0.74rem" };
const emptyStyle: React.CSSProperties = { ...helpStyle, border: `1px dashed ${MFX_COLORS.border}`, borderRadius: 8, padding: 14 };
const normalButtonStyle: React.CSSProperties = { minHeight: 38, padding: "7px 13px", borderRadius: 7, border: `1px solid ${MFX_COLORS.border}`, color: MFX_COLORS.text, background: MFX_COLORS.panelAlt, fontWeight: 850, cursor: "pointer" };
const accentButtonStyle: React.CSSProperties = { ...normalButtonStyle, borderColor: MFX_COLORS.cyan, color: MFX_COLORS.cyan };
const learnButtonStyle: React.CSSProperties = { ...accentButtonStyle, minWidth: 78 };
const dangerButtonStyle: React.CSSProperties = { ...normalButtonStyle, color: MFX_COLORS.danger, borderColor: MFX_COLORS.danger };
const saveButtonStyle: React.CSSProperties = { ...normalButtonStyle, color: "#061319", background: MFX_COLORS.cyan, borderColor: MFX_COLORS.cyan };
const footerStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 10, paddingBottom: 10 };
const statusStyle: React.CSSProperties = { border: `1px solid ${MFX_COLORS.cyan}`, color: MFX_COLORS.text, background: MFX_COLORS.panel, borderRadius: 8, padding: 11 };
const statusGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 };
const statusValueStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, border: `1px solid ${MFX_COLORS.border}`, borderRadius: 8, padding: 10 };
