/*
 * Physical-control widgets for the Performance screen.
 *
 * Geometry comes from the user's Freeform layout. Function and value come
 * directly from the active PiPedal pedalboard MIDI bindings, so the same pot
 * can display a different effect parameter after a preset change without a
 * duplicate MultiFX assignment database.
 */

import {
    CSSProperties,
    PointerEvent as ReactPointerEvent,
    PointerEventHandler,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from "react";
import { createPortal } from "react-dom";
import {
    controllerPerformanceControlDescriptors,
    ControllerLayoutConfig,
    ControllerLayoutRect,
    ControllerPerformanceControlDescriptor,
    minimumPerformanceControlSize
} from "./ControllerConfig";
import MidiBinding from "./MidiBinding";
import {
    ControlValueChangedHandle,
    PiPedalModelFactory
} from "./PiPedalModel";
import { Pedalboard } from "./Pedalboard";
import {
    loadMultiFXUIBehaviorSettings,
    MULTIFX_UI_BEHAVIOR_CHANGED_EVENT,
    MultiFXUIBehaviorSettings
} from "./MultiFXUIBehavior";
import "./MultiFXPerformanceAppearance.css";

interface Props {
    controllerConfig: ControllerLayoutConfig;
}

interface ResolvedParameter {
    instanceId: number;
    symbol: string;
    effect: string;
    parameter: string;
    value: string;
    range: number;
    setRange: (range: number) => void;
}

interface ActiveControlAdjustment {
    pointerId: number;
    descriptor: ControllerPerformanceControlDescriptor;
    assignments: ResolvedParameter[];
    startClientY: number;
    startRange: number;
    bounds: DOMRect;
    keepPopoutOpen: boolean;
}

/**
 * Keep a role's chosen font size and scroll only when its text is wider than
 * the available control. This mirrors preset-tile behavior without shrinking
 * a long effect or parameter name until it becomes unreadable.
 */
function ControlMarqueeText({
    className,
    text,
    delaySeconds = 2.5,
    pixelsPerSecond = 45,
    endPauseSeconds = 1
}: {
    className: string;
    text: string;
    delaySeconds?: number;
    pixelsPerSecond?: number;
    endPauseSeconds?: number;
}) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLSpanElement>(null);
    const [overflowDistance, setOverflowDistance] = useState(0);

    useLayoutEffect(() => {
        const viewport = viewportRef.current;
        const textElement = textRef.current;
        if (!viewport || !textElement) return;
        let frame = 0;
        const measure = () => {
            frame = 0;
            textElement.style.transform = "translateX(0)";
            setOverflowDistance(Math.max(
                0,
                textElement.scrollWidth - viewport.clientWidth
            ));
        };
        const scheduleMeasure = () => {
            if (frame) window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(measure);
        };
        const observer = new ResizeObserver(scheduleMeasure);
        observer.observe(viewport);
        observer.observe(textElement);
        scheduleMeasure();
        void document.fonts?.ready
            .then(scheduleMeasure)
            .catch(() => undefined);
        return () => {
            observer.disconnect();
            if (frame) window.cancelAnimationFrame(frame);
        };
    }, [text]);

    useEffect(() => {
        const textElement = textRef.current;
        if (!textElement || overflowDistance <= 0 || pixelsPerSecond <= 0) {
            return;
        }
        const startPause = Math.max(0, delaySeconds);
        const scrollSeconds = overflowDistance / pixelsPerSecond;
        const endPause = Math.max(0, endPauseSeconds);
        const totalSeconds = Math.max(
            0.1,
            startPause + scrollSeconds + endPause
        );
        const animation = textElement.animate([
            { transform: "translateX(0)", offset: 0 },
            {
                transform: "translateX(0)",
                offset: startPause / totalSeconds
            },
            {
                transform: `translateX(-${overflowDistance}px)`,
                offset: (startPause + scrollSeconds) / totalSeconds
            },
            { transform: `translateX(-${overflowDistance}px)`, offset: 1 }
        ], {
            duration: totalSeconds * 1000,
            iterations: Infinity,
            easing: "linear"
        });
        return () => animation.cancel();
    }, [overflowDistance, delaySeconds, pixelsPerSecond, endPauseSeconds]);

    return (
        <div ref={viewportRef} className={className} aria-label={text}>
            <span
                ref={textRef}
                className="mfx-performance-control__marquee-text"
                aria-hidden="true"
            >
                {text}
            </span>
        </div>
    );
}

/** Pots, sliders and expression pedals expose an absolute analog value. */
function isAdjustableAnalog(
    descriptor: ControllerPerformanceControlDescriptor
): boolean {
    return descriptor.kind === "pot"
        || descriptor.kind === "slider"
        || descriptor.kind === "expression";
}

function clampUnit(value: number): number {
    return Math.min(1, Math.max(0, value));
}

/** Keep old or hand-edited narrow rectangles readable on Performance View.
 * The corrected size is display-only; Layout remains the source of truth. */
function readableControlRect(
    rect: ControllerLayoutRect,
    descriptor: ControllerPerformanceControlDescriptor
): ControllerLayoutRect {
    const minimum = minimumPerformanceControlSize(descriptor.kind);
    const width = Math.min(1, Math.max(minimum.width, rect.width));
    const height = Math.min(1, Math.max(minimum.height, rect.height));
    return {
        x: Math.max(0, Math.min(1 - width, rect.x)),
        y: Math.max(0, Math.min(1 - height, rect.y)),
        width,
        height
    };
}

function bindingSignature(pedalboard: Pedalboard): string {
    const parts: string[] = [];
    for (const item of pedalboard.itemsGenerator()) {
        for (const binding of item.midiBindings) {
            if (binding.bindingType !== MidiBinding.BINDING_TYPE_CONTROL) {
                continue;
            }
            parts.push([
                item.instanceId,
                binding.symbol,
                binding.control,
                binding.minValue,
                binding.maxValue
            ].join(":"));
        }
    }
    return parts.sort().join("|");
}

function resolveParameters(
    descriptor: ControllerPerformanceControlDescriptor
): ResolvedParameter[] {
    const model = PiPedalModelFactory.getInstance();
    const result: ResolvedParameter[] = [];
    for (const item of model.pedalboard.get().itemsGenerator()) {
        const plugin = model.getUiPlugin(item.uri);
        for (const binding of item.midiBindings) {
            if (binding.bindingType !== MidiBinding.BINDING_TYPE_CONTROL
                || binding.control !== descriptor.midiCc) {
                continue;
            }
            const control = plugin?.getControl(binding.symbol);
            if (!control) continue;
            const rawValue = item.getControlValue(binding.symbol);
            const bindingMinimum = Number.isFinite(binding.minValue)
                ? binding.minValue
                : 0;
            const bindingMaximum = Number.isFinite(binding.maxValue)
                ? binding.maxValue
                : 1;
            const bindingSpan = bindingMaximum - bindingMinimum;
            const parameterRange = control.valueToRange(rawValue);
            result.push({
                instanceId: item.instanceId,
                symbol: binding.symbol,
                effect: item.title || plugin?.name || "Effect",
                parameter: control.name,
                // Use PiPedal's canonical display formatting so important
                // units such as dB, Hz, ms and percent remain visible.
                value: control.formatDisplayValue(rawValue),
                // Show the physical control's position inside the binding's
                // configured Min/Max range. This also follows Reverse because
                // a reversed binding has a negative span.
                range: clampUnit(Math.abs(bindingSpan) > Number.EPSILON
                    ? (parameterRange - bindingMinimum) / bindingSpan
                    : parameterRange),
                setRange: (range) => {
                    const targetParameterRange = bindingMinimum
                        + bindingSpan * clampUnit(range);
                    model.setPedalboardControl(
                        item.instanceId,
                        binding.symbol,
                        control.rangeToValue(targetParameterRange)
                    );
                }
            });
        }
    }
    return result;
}

/** Render every placed hardware control with its active-preset assignment. */
export default function MultiFXPerformanceControls({
    controllerConfig
}: Props) {
    const model = PiPedalModelFactory.getInstance();
    const [structureSignature, setStructureSignature] = useState(
        () => bindingSignature(model.pedalboard.get())
    );
    const [presetId, setPresetId] = useState(
        () => model.presets.get().selectedInstanceId
    );
    const [, setValueRevision] = useState(0);
    const [uiBehavior, setUIBehavior] = useState<MultiFXUIBehaviorSettings>(
        () => loadMultiFXUIBehaviorSettings()
    );
    const [popoutControlId, setPopoutControlId] = useState<string | null>(null);
    const popoutTimerRef = useRef<number | null>(null);
    const activeAdjustmentRef = useRef<ActiveControlAdjustment | null>(null);

    const descriptors = useMemo(
        () => controllerPerformanceControlDescriptors(
            controllerConfig.hardware
        ),
        [controllerConfig.hardware]
    );

    const showControlPopout = useCallback((controlId: string) => {
        setPopoutControlId(controlId);
        if (popoutTimerRef.current !== null) {
            window.clearTimeout(popoutTimerRef.current);
        }
        popoutTimerRef.current = window.setTimeout(() => {
            popoutTimerRef.current = null;
            setPopoutControlId(null);
        }, loadMultiFXUIBehaviorSettings().controlPopoutDurationMs);
    }, []);

    /** Keep the enlarged control visible for the entire pointer gesture. */
    const holdControlPopout = useCallback((controlId: string) => {
        setPopoutControlId(controlId);
        if (popoutTimerRef.current !== null) {
            window.clearTimeout(popoutTimerRef.current);
            popoutTimerRef.current = null;
        }
    }, []);

    /** Apply one physical position to every parameter sharing this MIDI CC. */
    const applyControlRange = useCallback((
        assignments: ResolvedParameter[],
        range: number
    ) => {
        const nextRange = clampUnit(range);
        for (const assignment of assignments) {
            assignment.setRange(nextRange);
        }
    }, []);

    const beginControlAdjustment = useCallback((
        event: ReactPointerEvent<HTMLDivElement>,
        descriptor: ControllerPerformanceControlDescriptor,
        assignments: ResolvedParameter[],
        keepPopoutOpen: boolean
    ) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;

        // The control layer owns this gesture. In particular, a newly opened
        // pop-out must never start a preset click or drag underneath it.
        event.preventDefault();
        event.stopPropagation();

        if (keepPopoutOpen) holdControlPopout(descriptor.id);
        if (!isAdjustableAnalog(descriptor) || assignments.length === 0) return;

        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // Pointer capture is optional on older touch browsers.
        }

        const bounds = event.currentTarget.getBoundingClientRect();
        const active: ActiveControlAdjustment = {
            pointerId: event.pointerId,
            descriptor,
            assignments,
            startClientY: event.clientY,
            startRange: assignments[0].range,
            bounds,
            keepPopoutOpen
        };
        activeAdjustmentRef.current = active;

        // Sliders and expression pedals follow the touched track position.
        // Pots use relative vertical dragging so tapping a knob cannot make it
        // jump abruptly to an unrelated value.
        if (descriptor.kind === "slider" || descriptor.kind === "expression") {
            applyControlRange(
                assignments,
                1 - (event.clientY - bounds.top) / Math.max(1, bounds.height)
            );
        }
    }, [applyControlRange, holdControlPopout]);

    const moveControlAdjustment = useCallback((
        event: ReactPointerEvent<HTMLDivElement>
    ) => {
        const active = activeAdjustmentRef.current;
        if (!active || active.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();

        let nextRange: number;
        if (active.descriptor.kind === "slider"
            || active.descriptor.kind === "expression") {
            nextRange = 1 - (event.clientY - active.bounds.top)
                / Math.max(1, active.bounds.height);
        } else {
            // One near-card-height upward drag covers the complete pot range.
            const sensitivity = Math.max(90, active.bounds.height * 0.9);
            nextRange = active.startRange
                + (active.startClientY - event.clientY) / sensitivity;
        }
        applyControlRange(active.assignments, nextRange);
        if (active.keepPopoutOpen) holdControlPopout(active.descriptor.id);
    }, [applyControlRange, holdControlPopout]);

    const finishControlAdjustment = useCallback((
        event: ReactPointerEvent<HTMLDivElement>
    ) => {
        const active = activeAdjustmentRef.current;
        if (!active || active.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        activeAdjustmentRef.current = null;
        try {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
        } catch {
            // The browser may have released capture while cancelling a touch.
        }
        if (active.keepPopoutOpen) showControlPopout(active.descriptor.id);
    }, [showControlPopout]);

    useEffect(() => {
        const settingsChanged = () =>
            setUIBehavior(loadMultiFXUIBehaviorSettings());
        window.addEventListener(
            MULTIFX_UI_BEHAVIOR_CHANGED_EVENT,
            settingsChanged
        );
        return () => window.removeEventListener(
            MULTIFX_UI_BEHAVIOR_CHANGED_EVENT,
            settingsChanged
        );
    }, []);

    useEffect(() => {
        const pedalboardChanged = (pedalboard: Pedalboard) =>
            setStructureSignature(bindingSignature(pedalboard));
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
        const relevantCcs = new Set(descriptors.map((item) => item.midiCc));
        for (const item of model.pedalboard.get().itemsGenerator()) {
            const descriptorBySymbol = new Map<string, string>();
            for (const binding of item.midiBindings) {
                if (binding.bindingType !== MidiBinding.BINDING_TYPE_CONTROL
                    || !relevantCcs.has(binding.control)) continue;
                const descriptor = descriptors.find(
                    (candidate) => candidate.midiCc === binding.control
                        && candidate.kind !== "button"
                );
                if (descriptor) {
                    descriptorBySymbol.set(binding.symbol, descriptor.id);
                }
            }
            if (descriptorBySymbol.size === 0) continue;
            handles.push(model.addControlValueChangeListener(
                item.instanceId,
                (symbol) => {
                    const descriptorId = descriptorBySymbol.get(symbol);
                    if (descriptorId) {
                        setValueRevision((value) => value + 1);
                        if (loadMultiFXUIBehaviorSettings()
                            .physicalControlPopout) {
                            showControlPopout(descriptorId);
                        }
                    }
                }
            ));
        }
        return () => {
            for (const handle of handles) {
                model.removeControlValueChangeListener(handle);
            }
        };
    }, [
        model,
        descriptors,
        structureSignature,
        presetId,
        showControlPopout
    ]);

    useEffect(() => () => {
        if (popoutTimerRef.current !== null) {
            window.clearTimeout(popoutTimerRef.current);
        }
    }, []);

    const popoutDescriptor = descriptors.find(
        (descriptor) => descriptor.id === popoutControlId
    );
    const popoutAssignments = popoutDescriptor
        ? resolveParameters(popoutDescriptor)
        : [];
    const popoutPrimary = popoutAssignments[0];

    return (
        <>
            <div
                className="mfx-performance-controls"
                aria-label="Hardware controls"
            >
                {descriptors.map((descriptor) => {
                    const rect = controllerConfig.performanceLayout.controls[
                        descriptor.id
                    ];
                    if (!rect) return null;
                    const displayRect = readableControlRect(rect, descriptor);
                    const assignments = resolveParameters(descriptor);
                    const primary = assignments[0];
                    return (
                        <PerformanceControlCard
                            key={descriptor.id}
                            descriptor={descriptor}
                            range={primary?.range ?? 0}
                            active={Boolean(primary)}
                            functionLabel={primary
                                ? `${primary.effect} · ${primary.parameter}`
                                : "UNASSIGNED"}
                            valueLabel={primary?.value
                                ?? `CC ${descriptor.midiCc}`}
                            assignmentCount={assignments.length}
                            marqueeDelaySeconds={
                                controllerConfig.sizing.marqueeDelaySeconds
                            }
                            marqueePixelsPerSecond={
                                controllerConfig.sizing.marqueePixelsPerSecond
                            }
                            marqueeEndPauseSeconds={
                                controllerConfig.sizing.marqueeEndPauseSeconds
                            }
                            onPointerDown={isAdjustableAnalog(descriptor)
                                ? (event) => beginControlAdjustment(
                                    event,
                                    descriptor,
                                    assignments,
                                    uiBehavior.touchControlPopout
                                )
                                : uiBehavior.touchControlPopout
                                    && descriptor.kind !== "button"
                                    ? () => showControlPopout(descriptor.id)
                                    : undefined}
                            onPointerMove={isAdjustableAnalog(descriptor)
                                ? moveControlAdjustment
                                : undefined}
                            onPointerUp={isAdjustableAnalog(descriptor)
                                ? finishControlAdjustment
                                : undefined}
                            onPointerCancel={isAdjustableAnalog(descriptor)
                                ? finishControlAdjustment
                                : undefined}
                            style={{
                                left: `${displayRect.x * 100}%`,
                                top: `${displayRect.y * 100}%`,
                                width: `${displayRect.width * 100}%`,
                                height: `${displayRect.height * 100}%`
                            }}
                        />
                    );
                })}
            </div>

            {popoutDescriptor && createPortal(
                <div
                    className="mfx-performance-control-popout"
                    aria-label={`${popoutDescriptor.label} enlarged control`}
                    aria-modal="true"
                    role="dialog"
                    onPointerDown={(event) => {
                        // The full-screen backdrop is an interaction shield.
                        // It prevents preset clicks/drags through the pop-out.
                        if (event.target === event.currentTarget) {
                            event.preventDefault();
                        }
                        event.stopPropagation();
                    }}
                    onClick={(event) => event.stopPropagation()}
                >
                    <PerformanceControlCard
                        descriptor={popoutDescriptor}
                        range={popoutPrimary?.range ?? 0}
                        active={Boolean(popoutPrimary)}
                        functionLabel={popoutPrimary
                            ? `${popoutPrimary.effect} · ${popoutPrimary.parameter}`
                            : "UNASSIGNED"}
                        valueLabel={popoutPrimary?.value
                            ?? `CC ${popoutDescriptor.midiCc}`}
                        assignmentCount={popoutAssignments.length}
                        marqueeDelaySeconds={
                            controllerConfig.sizing.marqueeDelaySeconds
                        }
                        marqueePixelsPerSecond={
                            controllerConfig.sizing.marqueePixelsPerSecond
                        }
                        marqueeEndPauseSeconds={
                            controllerConfig.sizing.marqueeEndPauseSeconds
                        }
                        className="mfx-performance-control--popout"
                        onPointerDown={isAdjustableAnalog(popoutDescriptor)
                            ? (event) => beginControlAdjustment(
                                event,
                                popoutDescriptor,
                                popoutAssignments,
                                true
                            )
                            : undefined}
                        onPointerMove={isAdjustableAnalog(popoutDescriptor)
                            ? moveControlAdjustment
                            : undefined}
                        onPointerUp={isAdjustableAnalog(popoutDescriptor)
                            ? finishControlAdjustment
                            : undefined}
                        onPointerCancel={isAdjustableAnalog(popoutDescriptor)
                            ? finishControlAdjustment
                            : undefined}
                        style={{
                            position: "relative",
                            left: "auto",
                            top: "auto",
                            width: `min(calc(100vw - 32px), ${Math.round(
                                190 * uiBehavior.controlPopoutScale
                            )}px)`,
                            height: `min(calc(100vh - 32px), ${Math.round(
                                230 * uiBehavior.controlPopoutScale
                            )}px)`
                        }}
                    />
                </div>,
                document.body
            )}
        </>
    );
}

export function PerformanceControlCard({
    descriptor,
    range,
    active,
    functionLabel,
    valueLabel,
    assignmentCount = 0,
    marqueeDelaySeconds,
    marqueePixelsPerSecond,
    marqueeEndPauseSeconds,
    className,
    style,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel
}: {
    descriptor: ControllerPerformanceControlDescriptor;
    range: number;
    active: boolean;
    functionLabel: string;
    valueLabel: string;
    assignmentCount?: number;
    marqueeDelaySeconds?: number;
    marqueePixelsPerSecond?: number;
    marqueeEndPauseSeconds?: number;
    className?: string;
    style?: CSSProperties;
    onPointerDown?: PointerEventHandler<HTMLDivElement>;
    onPointerMove?: PointerEventHandler<HTMLDivElement>;
    onPointerUp?: PointerEventHandler<HTMLDivElement>;
    onPointerCancel?: PointerEventHandler<HTMLDivElement>;
}) {
    return (
        <div
            className={`mfx-performance-control${className
                ? ` ${className}`
                : ""}`}
            data-control-kind={descriptor.kind}
            data-assigned={active ? "true" : "false"}
            data-adjustable={isAdjustableAnalog(descriptor) ? "true" : "false"}
            style={style}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
        >
            <ControlMarqueeText
                className="mfx-performance-control__source"
                text={descriptor.label}
                delaySeconds={marqueeDelaySeconds}
                pixelsPerSecond={marqueePixelsPerSecond}
                endPauseSeconds={marqueeEndPauseSeconds}
            />
            <ControlGraphic
                descriptor={descriptor}
                range={range}
                active={active}
            />
            <ControlMarqueeText
                className="mfx-performance-control__function"
                text={`${functionLabel}${assignmentCount > 1
                    ? ` +${assignmentCount - 1}`
                    : ""}`}
                delaySeconds={marqueeDelaySeconds}
                pixelsPerSecond={marqueePixelsPerSecond}
                endPauseSeconds={marqueeEndPauseSeconds}
            />
            <ControlMarqueeText
                className="mfx-performance-control__value"
                text={valueLabel}
                delaySeconds={marqueeDelaySeconds}
                pixelsPerSecond={marqueePixelsPerSecond}
                endPauseSeconds={marqueeEndPauseSeconds}
            />
        </div>
    );
}

export function ControlGraphic({
    descriptor,
    range,
    active
}: {
    descriptor: ControllerPerformanceControlDescriptor;
    range: number;
    active: boolean;
}) {
    if (descriptor.kind === "slider" || descriptor.kind === "expression") {
        return (
            <div className="mfx-hardware-slider" aria-hidden="true">
                <div
                    className="mfx-hardware-slider__fill"
                    style={{ height: `${range * 100}%` }}
                />
                <div
                    className="mfx-hardware-slider__thumb"
                    style={{ bottom: `calc(${range * 100}% - 5px)` }}
                />
            </div>
        );
    }

    if (descriptor.kind === "button") {
        return (
            <div
                className="mfx-hardware-button"
                data-active={active && range >= 0.5 ? "true" : "false"}
                aria-hidden="true"
            />
        );
    }

    const degrees = -135 + range * 270;
    return (
        <div
            className="mfx-hardware-knob"
            data-encoder={descriptor.kind === "encoder" ? "true" : "false"}
            aria-hidden="true"
        >
            <div
                className="mfx-hardware-knob__pointer"
                style={{ transform: `rotate(${degrees}deg)` }}
            />
            <div
                className="mfx-hardware-knob__arc"
                style={{
                    background: `conic-gradient(from 225deg, var(--mfx-surface-panel-accent) 0deg ${range * 270}deg, transparent ${range * 270}deg 360deg)`
                }}
            />
        </div>
    );
}
