/*
 * PiPedal-MultiFX — Performance / Foot Controller View
 *
 * PiPedal owns musical state. MultiFX owns the performance presentation,
 * hardware routing, temporary chain bypass bookkeeping, and Snapshot Mode UI.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BankIndex } from "./Banks";
import {
    clearPresetAssignmentsForPreset,
    getBankPresetAssignments,
    MULTIFX_PRESET_ASSIGNMENTS_CHANGED_EVENT,
    setPresetAssignment,
    swapPresetAssignments
} from "./MultiFXPresetAssignments";
import {
    PiPedalModelFactory,
    PresetIndex,
    PresetIndexEntry,
    State
} from "./PiPedalModel";
import JackHostStatus from "./JackHostStatus";
import { Pedalboard, Snapshot } from "./Pedalboard";
import {
    CONTROLLER_LAYOUT_ELEMENT_IDS,
    CONTROLLER_LAYOUT_ELEMENT_LABELS,
    ControllerLayoutConfig,
    ControllerLayoutElement,
    ControllerLayoutElementId,
    ControllerSwitchAction,
    ControllerSwitchConfig,
    CONTROLLER_CONFIG_CHANGED_EVENT,
    defaultControllerConfig,
    loadControllerConfig
} from "./ControllerConfig";
import {
    MultiFXRuntimeState,
    MultiFXRuntimeStatePatch,
    subscribeMultiFXRuntimeState,
    updateMultiFXRuntimeState
} from "./MultiFXRuntimeSync";
import {
    prepareBasePresetForWrite,
    restoreChainBypassForSafeWrite
} from "./MultiFXPresetSafety";

type MarqueeTextProps = {
    text: string;
    color: string;
    fontSize: string;
    fontWeight: "normal" | "bold";
    marginTop?: number;
    delaySeconds: number;
    pixelsPerSecond: number;
    endPauseSeconds: number;
    centered?: boolean;
};

function MarqueeText({
    text,
    color,
    fontSize,
    fontWeight,
    marginTop = 0,
    delaySeconds,
    pixelsPerSecond,
    endPauseSeconds,
    centered = false
}: MarqueeTextProps) {
    const viewportRef = useRef<HTMLSpanElement>(null);
    const textRef = useRef<HTMLSpanElement>(null);
    const [overflowDistance, setOverflowDistance] = useState(0);

    useLayoutEffect(() => {
        const measure = () => {
            const viewport = viewportRef.current;
            const textElement = textRef.current;
            if (!viewport || !textElement) return;
            setOverflowDistance(
                Math.max(0, textElement.scrollWidth - viewport.clientWidth)
            );
        };

        measure();
        const observer = new ResizeObserver(measure);
        if (viewportRef.current) observer.observe(viewportRef.current);
        if (textRef.current) observer.observe(textRef.current);
        return () => observer.disconnect();
    }, [text, fontSize]);

    useEffect(() => {
        const textElement = textRef.current;
        if (!textElement || overflowDistance <= 0 || pixelsPerSecond <= 0) {
            return;
        }

        const scrollSeconds = overflowDistance / pixelsPerSecond;
        const totalSeconds = scrollSeconds + endPauseSeconds;
        const endOffset = totalSeconds > 0 ? scrollSeconds / totalSeconds : 1;
        const animation = textElement.animate(
            [
                { transform: "translateX(0)", offset: 0 },
                {
                    transform: `translateX(-${overflowDistance}px)`,
                    offset: Math.min(1, endOffset)
                },
                {
                    transform: `translateX(-${overflowDistance}px)`,
                    offset: 1
                }
            ],
            {
                duration: Math.max(100, totalSeconds * 1000),
                delay: delaySeconds * 1000,
                iterations: Infinity,
                easing: "linear"
            }
        );
        return () => animation.cancel();
    }, [text, overflowDistance, delaySeconds, pixelsPerSecond, endPauseSeconds]);

    return (
        <span
            ref={viewportRef}
            style={{
                display: "block",
                width: "100%",
                minWidth: 0,
                overflow: "hidden",
                whiteSpace: "nowrap",
                color,
                fontSize,
                fontWeight,
                marginTop: `${marginTop}px`,
                textAlign: centered ? "center" : "left"
            }}
        >
            <span
                ref={textRef}
                style={{
                    display: "inline-block",
                    minWidth: "max-content",
                    willChange: overflowDistance > 0 ? "transform" : "auto"
                }}
            >
                {text}
            </span>
        </span>
    );
}

type SwitchVisualState = {
    background: string;
    border: string;
    labelText: string;
    valueText: string;
    shadow: string;
};

type PresetDragCandidate = {
    pointerId: number;
    slotIndex: number;
    name: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    dragging: boolean;
};

type CleanPresetBaseline = {
    presetId: number;
    signature: string;
};

function stablePedalboardStateSignature(pedalboard: Pedalboard): string {
    const source = JSON.parse(JSON.stringify(pedalboard)) as Record<string, unknown>;

    // These are UI/runtime bookkeeping rather than the saved base sound.
    delete source.snapshots;
    delete source.selectedSnapshot;
    delete source.selectedPlugin;
    delete source.nextInstanceId;

    const normalize = (value: unknown): unknown => {
        if (Array.isArray(value)) {
            return value.map(normalize);
        }

        if (value && typeof value === "object") {
            const input = value as Record<string, unknown>;
            const output: Record<string, unknown> = {};

            for (const key of Object.keys(input).sort()) {
                // stateUpdateCount changes as plugin state is refreshed even
                // when the actual saved plugin state has returned to the same
                // value, so it must not participate in semantic dirty state.
                if (key === "stateUpdateCount") continue;
                output[key] = normalize(input[key]);
            }
            return output;
        }

        return value;
    };

    return JSON.stringify(normalize(source));
}

// Keep the saved/clean semantic state for each loaded preset for the lifetime
// of the app. Performance View can unmount while the editor is open; without
// this cache PiPedal's native sticky presetChanged flag would make a reverted
// edit look dirty when Performance View mounts again.
const cleanPresetBaselineCache = new Map<number, string>();

export type NewPresetDraft = {
    presetId: number;
    previousPresetId: number;
    bankId: number;
    targetSwitchId: string;
};

type FootControllerViewProps = {
    onOpenEditor?: (draft?: NewPresetDraft, presetId?: number) => void;
    onEditSnapshot?: (snapshotIndex: number) => void;
    onSnapshotModeChange?: (active: boolean) => void;
    snapshotExitRequest?: number;
};

export default function FootControllerView({
    onOpenEditor,
    onEditSnapshot,
    onSnapshotModeChange,
    snapshotExitRequest = 0
}: FootControllerViewProps) {
    const model = PiPedalModelFactory.getInstance();
    const [controllerConfig, setControllerConfig] =
        useState<ControllerLayoutConfig>(defaultControllerConfig);
    const [controllerConfigLoaded, setControllerConfigLoaded] = useState(false);
    const [configError, setConfigError] = useState<string | undefined>(undefined);
    const [jackStatus, setJackStatus] = useState<JackHostStatus | undefined>(
        undefined
    );
    const [presets, setPresets] = useState<PresetIndex>(() => model.presets.get().clone());
    const [banks, setBanks] = useState<BankIndex>(() => model.banks.get().clone());
    const [bankMenuOpen, setBankMenuOpen] = useState(false);
    const [presetMenuOpen, setPresetMenuOpen] = useState(false);
    const [menuIndex, setMenuIndex] = useState(0);
    const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [selectedPresetSlot, setSelectedPresetSlot] = useState(0);
    const [presetAssignmentsBySlot, setPresetAssignmentsBySlot] = useState<Array<number | null>>([]);
    const [presetAssignPickerOpen, setPresetAssignPickerOpen] = useState(false);
    const [presetAssignTargetIndex, setPresetAssignTargetIndex] = useState<number | null>(null);
    const [statusToast, setStatusToast] = useState<string | null>(null);
    const statusToastTimerRef = useRef<number | null>(null);
    const hardwareLongPressTimersRef = useRef<Map<number, number>>(new Map());
    const hardwareLongPressFiredRef = useRef<Set<number>>(new Set());
    const hardwarePressPendingRef = useRef<Set<number>>(new Set());
    const [chainBypassed, setChainBypassed] = useState(false);
    const chainBypassSnapshotRef = useRef<Map<number, boolean>>(new Map());
    const chainBypassPresetIdRef = useRef<number | null>(null);
    const chainBypassWasPresetChangedRef = useRef(false);
    const [snapshotMode, setSnapshotMode] = useState(false);
    const snapshotModePresetIdRef = useRef<number | null>(null);
    const [snapshotPedalboard, setSnapshotPedalboard] = useState<Pedalboard>(
        () => model.pedalboard.get().clone()
    );
    const [selectedSnapshot, setSelectedSnapshot] = useState<number>(
        () => model.selectedSnapshot.get()
    );

    const initialPresetState = model.presets.get();
    const [cleanPresetBaseline, setCleanPresetBaseline] =
        useState<CleanPresetBaseline | null>(() => {
            const presetId = initialPresetState.selectedInstanceId;
            if (presetId < 0 || model.selectedSnapshot.get() >= 0) {
                return null;
            }

            const cachedSignature = cleanPresetBaselineCache.get(presetId);
            if (cachedSignature !== undefined) {
                return {
                    presetId,
                    signature: cachedSignature
                };
            }

            if (initialPresetState.presetChanged) {
                return null;
            }

            const signature = stablePedalboardStateSignature(model.pedalboard.get());
            cleanPresetBaselineCache.set(presetId, signature);
            return {
                presetId,
                signature
            };
        });
    const previousNativePresetChangedRef =
        useRef(initialPresetState.presetChanged);

    const applyRuntimeState = (state: MultiFXRuntimeState) => {
        chainBypassPresetIdRef.current = state.chainBypassPresetId;
        chainBypassWasPresetChangedRef.current =
            state.chainBypassWasPresetChanged;

        const enabledStates = new Map<number, boolean>();
        for (const [instanceId, enabled] of Object.entries(
            state.chainBypassEnabledStates
        )) {
            const numericId = Number(instanceId);
            if (Number.isFinite(numericId)) {
                enabledStates.set(numericId, Boolean(enabled));
            }
        }
        chainBypassSnapshotRef.current = enabledStates;
        setChainBypassed(state.chainBypassed);
        snapshotModePresetIdRef.current = state.snapshotPresetId;
        setSnapshotMode(state.snapshotMode);
    };

    const publishRuntimeState = (patch: MultiFXRuntimeStatePatch) => {
        void updateMultiFXRuntimeState(patch)
            .then(applyRuntimeState)
            .catch((error) =>
                console.warn("MultiFX runtime sync update failed.", error)
            );
    };

    const showStatusToast = (message: string) => {
        setStatusToast(message);
        if (statusToastTimerRef.current !== null) {
            window.clearTimeout(statusToastTimerRef.current);
        }
        statusToastTimerRef.current = window.setTimeout(() => {
            statusToastTimerRef.current = null;
            setStatusToast(null);
        }, 1800);
    };

    const [presetOptionsOpen, setPresetOptionsOpen] = useState(false);
    const [presetOptionIndex, setPresetOptionIndex] = useState(0);
    const [presetRenameValue, setPresetRenameValue] = useState("");
    const [presetDeleteConfirmOpen, setPresetDeleteConfirmOpen] = useState(false);
    const [presetActionBusy, setPresetActionBusy] = useState(false);
    const [snapshotOptionsOpen, setSnapshotOptionsOpen] = useState(false);
    const [snapshotOptionsIndex, setSnapshotOptionsIndex] = useState<number | null>(null);
    const [snapshotRenameOpen, setSnapshotRenameOpen] = useState(false);
    const [snapshotRenameValue, setSnapshotRenameValue] = useState("");
    const snapshotLongPressTimerRef = useRef<number | null>(null);
    const snapshotSuppressNextClickRef = useRef(false);
    const snapshotPointerStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
    const snapshotOptionsBackdropArmedRef = useRef(true);
    const snapshotOptionsOpenedByLongPressRef = useRef(false);
    const uiSwitchLongPressTimerRef = useRef<number | null>(null);
    const uiSwitchSuppressNextClickRef = useRef(false);
    const uiSwitchPointerStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
    const pendingBankSlotRef = useRef<number | null>(null);
    const lastRevealedActivePresetIdRef = useRef<number | null>(null);
    const longPressTimerRef = useRef<number | null>(null);
    const suppressNextClickRef = useRef(false);
    const LONG_PRESS_MS = 600;
    const presetDragRef = useRef<PresetDragCandidate | null>(null);
    const [presetDrag, setPresetDrag] = useState<PresetDragCandidate | null>(null);
    const [presetDropIndex, setPresetDropIndex] = useState<number | null>(null);
    const [presetDragOverTrash, setPresetDragOverTrash] = useState(false);
    const PRESET_DRAG_THRESHOLD = 24;
    const SNAPSHOT_HOLD_MOVE_TOLERANCE = 24;

    const cancelLongPressTimer = () => {
        if (longPressTimerRef.current !== null) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

    const startPresetLongPress = (slotIndex: number) => {
        cancelLongPressTimer();
        longPressTimerRef.current = window.setTimeout(() => {
            longPressTimerRef.current = null;
            suppressNextClickRef.current = true;
            openPresetOptionsForSlot(slotIndex);
        }, LONG_PRESS_MS);
    };

    const finishPresetLongPress = () => cancelLongPressTimer();

    const cancelSnapshotLongPress = () => {
        if (snapshotLongPressTimerRef.current !== null) {
            window.clearTimeout(snapshotLongPressTimerRef.current);
            snapshotLongPressTimerRef.current = null;
        }
        snapshotPointerStartRef.current = null;
    };

    const openSnapshotOptions = (
        index: number,
        openedByLongPress = false
    ) => {
        const snapshot = model.pedalboard.get().snapshots[index];
        snapshotOptionsOpenedByLongPressRef.current = openedByLongPress;
        snapshotOptionsBackdropArmedRef.current = !openedByLongPress;
        setSnapshotOptionsIndex(index);
        setSnapshotRenameValue(snapshot?.name || `Snapshot ${index + 1}`);
        setSnapshotRenameOpen(false);
        setSnapshotOptionsOpen(true);
    };

    const startSnapshotLongPress = (
        event: React.PointerEvent<HTMLButtonElement>,
        index: number
    ) => {
        cancelSnapshotLongPress();
        snapshotSuppressNextClickRef.current = false;
        snapshotPointerStartRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY
        };
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { }
        snapshotLongPressTimerRef.current = window.setTimeout(() => {
            snapshotLongPressTimerRef.current = null;
            snapshotSuppressNextClickRef.current = true;
            snapshotPointerStartRef.current = null;
            openSnapshotOptions(index, true);
        }, LONG_PRESS_MS);
    };

    const moveSnapshotLongPress = (event: React.PointerEvent<HTMLButtonElement>) => {
        const start = snapshotPointerStartRef.current;
        if (!start || start.pointerId !== event.pointerId) return;
        const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
        if (distance > SNAPSHOT_HOLD_MOVE_TOLERANCE) cancelSnapshotLongPress();
    };

    const finishSnapshotLongPress = (event: React.PointerEvent<HTMLButtonElement>) => {
        const optionsWereOpenedByThisHold =
            snapshotOptionsOpenedByLongPressRef.current;

        cancelSnapshotLongPress();
        try {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
        } catch { }

        if (optionsWereOpenedByThisHold) {
            // The overlay was created while this pointer was still held down.
            // Ignore the release/compatibility click from that same gesture;
            // otherwise it lands on the new backdrop and immediately closes it.
            window.setTimeout(() => {
                snapshotSuppressNextClickRef.current = false;
                snapshotOptionsOpenedByLongPressRef.current = false;
                snapshotOptionsBackdropArmedRef.current = true;
            }, 160);
        }
    };

    useEffect(() => () => {
        if (statusToastTimerRef.current !== null) window.clearTimeout(statusToastTimerRef.current);
        if (snapshotLongPressTimerRef.current !== null) window.clearTimeout(snapshotLongPressTimerRef.current);
        if (uiSwitchLongPressTimerRef.current !== null) window.clearTimeout(uiSwitchLongPressTimerRef.current);
        for (const timer of hardwareLongPressTimersRef.current.values()) window.clearTimeout(timer);
        hardwareLongPressTimersRef.current.clear();
        hardwareLongPressFiredRef.current.clear();
        hardwarePressPendingRef.current.clear();
    }, []);

    const isPresetTrashAtPoint = (clientX: number, clientY: number): boolean => {
        const trash = document.querySelector(
            "[data-mfx-performance-trash='true']"
        ) as HTMLElement | null;
        if (!trash) return false;
        const rect = trash.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right
            && clientY >= rect.top && clientY <= rect.bottom;
    };

    const getPresetDropTargetAtPoint = (
        clientX: number,
        clientY: number
    ): number | null => {
        const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
        const presetSwitch = element?.closest("[data-mfx-performance-preset-index]") as HTMLElement | null;
        if (!presetSwitch) return null;

        const indexValue = Number(presetSwitch.dataset.mfxPerformancePresetIndex);
        return Number.isFinite(indexValue) ? indexValue : null;
    };

    // One shared Performance layout for every browser/device.
    // Freeform may intentionally contain logical switches that have not been
    // placed yet. They remain in controller/hardware configuration, but are not
    // part of the visible Performance layout until placed in the editor.
    const displaySwitchConfigs: ControllerSwitchConfig[] =
        !snapshotMode
        && controllerConfig.performanceLayout.mode === "freeform"
            ? controllerConfig.switches.filter(
                (item) =>
                    !controllerConfig.performanceLayout.unplacedSwitchIds.includes(
                        item.id
                    )
            )
            : controllerConfig.switches;

    // Logical preset slots come from the controller configuration, not from
    // what happens to be visually placed in Freeform mode. An unplaced switch
    // is hidden, but it remains a logical preset switch and keeps its assignment.
    const presetSwitchConfigs = controllerConfig.switches
        .filter((s) => s.action.type === "preset")
        .sort((a, b) =>
            (a.action.type === "preset" ? a.action.presetIndex : 0)
            - (b.action.type === "preset" ? b.action.presetIndex : 0)
        );

    const presetSlotCount = Math.max(1, presetSwitchConfigs.length);
    const performanceGridColumns = controllerConfig.columns;
    const performanceGridRows = Math.max(
        1,
        displaySwitchConfigs.reduce(
            (highestRow, item) =>
                Math.max(highestRow, item.row ?? 1),
            1
        )
    );

    const useFreeformPerformanceLayout =
        !snapshotMode
        && controllerConfig.performanceLayout.mode === "freeform";
    const performanceElements =
        controllerConfig.performanceLayout.elements;

    const switchIdForPresetSlot = (slotIndex: number): string | null => {
        return presetSwitchConfigs[slotIndex]?.id ?? null;
    };

    const reloadPresetAssignments = () => {
        const bank = getBankPresetAssignments(banks.selectedBank);
        setPresetAssignmentsBySlot(
            presetSwitchConfigs.map((switchConfig) =>
                bank[switchConfig.id] ?? null
            )
        );
    };

    const moveOrSwapPerformancePreset = (
        sourceSlotIndex: number,
        targetSlotIndex: number
    ) => {
        if (
            sourceSlotIndex < 0
            || sourceSlotIndex >= presetSlotCount
            || targetSlotIndex < 0
            || targetSlotIndex >= presetSlotCount
            || sourceSlotIndex === targetSlotIndex
        ) return;

        const sourceSwitchId = switchIdForPresetSlot(sourceSlotIndex);
        const targetSwitchId = switchIdForPresetSlot(targetSlotIndex);
        if (!sourceSwitchId || !targetSwitchId) return;

        const sourcePresetId = presetAssignmentsBySlot[sourceSlotIndex];
        if (sourcePresetId === null || sourcePresetId === undefined) return;

        const targetPresetId = presetAssignmentsBySlot[targetSlotIndex] ?? null;
        setPresetAssignmentsBySlot((current) => {
            const next = [...current];
            next[sourceSlotIndex] = targetPresetId;
            next[targetSlotIndex] = sourcePresetId;
            return next;
        });

        void swapPresetAssignments(
            banks.selectedBank,
            sourceSwitchId,
            targetSwitchId
        ).catch((error) => model.showAlert(String(error)));

        showStatusToast(
            targetPresetId === null
                ? "Preset moved to empty switch"
                : "Preset assignments swapped"
        );
    };

    const removePerformancePresetFromSlot = (sourceSlotIndex: number) => {
        const switchId = switchIdForPresetSlot(sourceSlotIndex);
        if (!switchId || presetAssignmentsBySlot[sourceSlotIndex] == null) return;

        setPresetAssignmentsBySlot((current) => {
            const next = [...current];
            next[sourceSlotIndex] = null;
            return next;
        });

        void setPresetAssignment(
            banks.selectedBank,
            switchId,
            null
        ).catch((error) => model.showAlert(String(error)));
        showStatusToast("Assignment cleared — PiPedal preset kept");
    };

    const assignPresetIdToSlot = (presetId: number, targetSlotIndex: number) => {
        const switchId = switchIdForPresetSlot(targetSlotIndex);
        if (!switchId) return;

        if (presetAssignmentsBySlot[targetSlotIndex] === presetId) {
            setPresetAssignPickerOpen(false);
            setPresetAssignTargetIndex(null);
            return;
        }

        setPresetAssignmentsBySlot((current) => {
            const next = [...current];
            next[targetSlotIndex] = presetId;
            return next;
        });

        void setPresetAssignment(
            banks.selectedBank,
            switchId,
            presetId
        ).catch((error) => model.showAlert(String(error)));
        showStatusToast("Preset assigned to switch");
        setPresetAssignPickerOpen(false);
        setPresetAssignTargetIndex(null);
    };

    const beginPresetDrag = (
        event: React.PointerEvent<HTMLButtonElement>,
        preset: PresetIndexEntry,
        slotIndex: number
    ) => {
        if (event.button !== 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const candidate: PresetDragCandidate = {
            pointerId: event.pointerId,
            slotIndex: slotIndex,
            name: preset.name,
            startX: event.clientX,
            startY: event.clientY,
            x: event.clientX,
            y: event.clientY,
            width: rect.width,
            height: rect.height,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            dragging: false
        };
        presetDragRef.current = candidate;
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { }
        startPresetLongPress(slotIndex);
    };

    const movePresetDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
        const candidate = presetDragRef.current;
        if (!candidate || candidate.pointerId !== event.pointerId) return;
        const distance = Math.hypot(
            event.clientX - candidate.startX,
            event.clientY - candidate.startY
        );
        if (!candidate.dragging && distance >= PRESET_DRAG_THRESHOLD) {
            candidate.dragging = true;
            cancelLongPressTimer();
            suppressNextClickRef.current = true;
        }
        if (!candidate.dragging) return;
        event.preventDefault();
        candidate.x = event.clientX;
        candidate.y = event.clientY;
        const overTrash = isPresetTrashAtPoint(event.clientX, event.clientY);
        setPresetDrag({ ...candidate });
        setPresetDragOverTrash(overTrash);
        const dropTargetIndex = overTrash
            ? null
            : getPresetDropTargetAtPoint(event.clientX, event.clientY);
        setPresetDropIndex(dropTargetIndex);
    };

    const endPresetDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
        const candidate = presetDragRef.current;
        if (!candidate || candidate.pointerId !== event.pointerId) {
            finishPresetLongPress();
            return;
        }
        finishPresetLongPress();
        const wasDragging = candidate.dragging;
        const overTrash = wasDragging && isPresetTrashAtPoint(event.clientX, event.clientY);
        const dropTargetIndex = overTrash
            ? null
            : getPresetDropTargetAtPoint(event.clientX, event.clientY);
        try {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
        } catch { }
        presetDragRef.current = null;
        setPresetDrag(null);
        setPresetDropIndex(null);
        setPresetDragOverTrash(false);
        if (!wasDragging) return;
        event.preventDefault();
        event.stopPropagation();
        if (overTrash) {
            removePerformancePresetFromSlot(candidate.slotIndex);
            return;
        }
        if (dropTargetIndex !== null) {
            moveOrSwapPerformancePreset(candidate.slotIndex, dropTargetIndex);
        }
    };

    const cancelPresetDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
        const candidate = presetDragRef.current;
        if (candidate && candidate.pointerId === event.pointerId) {
            presetDragRef.current = null;
            setPresetDrag(null);
            setPresetDropIndex(null);
            setPresetDragOverTrash(false);
        }
        finishPresetLongPress();
    };

    useEffect(() => {
        let cancelled = false;
        const loadConfig = async () => {
            setControllerConfigLoaded(false);
            const result = await loadControllerConfig();
            if (!cancelled) {
                setControllerConfig(result.config);
                setConfigError(result.error);
                setControllerConfigLoaded(true);
            }
        };
        const changed = () => void loadConfig();
        window.addEventListener(CONTROLLER_CONFIG_CHANGED_EVENT, changed);
        void loadConfig();
        return () => {
            cancelled = true;
            window.removeEventListener(CONTROLLER_CONFIG_CHANGED_EVENT, changed);
        };
    }, []);

    useEffect(() => {
        const presetsChanged = () => setPresets(model.presets.get().clone());
        const banksChanged = () => setBanks(model.banks.get().clone());
        model.presets.addOnChangedHandler(presetsChanged);
        model.banks.addOnChangedHandler(banksChanged);
        presetsChanged();
        banksChanged();
        return () => {
            model.presets.removeOnChangedHandler(presetsChanged);
            model.banks.removeOnChangedHandler(banksChanged);
        };
    }, [model]);

    useEffect(() => {
        const pedalboardChanged = (value: Pedalboard) => setSnapshotPedalboard(value.clone());
        const selectedSnapshotChanged = (value: number) => setSelectedSnapshot(value);
        model.pedalboard.addOnChangedHandler(pedalboardChanged);
        model.selectedSnapshot.addOnChangedHandler(selectedSnapshotChanged);
        pedalboardChanged(model.pedalboard.get());
        selectedSnapshotChanged(model.selectedSnapshot.get());
        return () => {
            model.pedalboard.removeOnChangedHandler(pedalboardChanged);
            model.selectedSnapshot.removeOnChangedHandler(selectedSnapshotChanged);
        };
    }, [model]);

    useEffect(() => {
        const presetId = presets.selectedInstanceId;
        if (presetId < 0) {
            setCleanPresetBaseline(null);
            previousNativePresetChangedRef.current = presets.presetChanged;
            return;
        }

        const previousChanged = previousNativePresetChangedRef.current;
        previousNativePresetChangedRef.current = presets.presetChanged;

        if (selectedSnapshot >= 0 || chainBypassed) {
            return;
        }

        const needsNewPresetBaseline =
            cleanPresetBaseline?.presetId !== presetId;
        const presetWasJustSavedOrReloaded =
            previousChanged && !presets.presetChanged;

        if (!presets.presetChanged && (needsNewPresetBaseline || presetWasJustSavedOrReloaded)) {
            // Preset and pedalboard notifications can arrive in either order.
            // Defer one turn, then read the model's current authoritative state.
            const timer = window.setTimeout(() => {
                const current = model.presets.get();
                if (
                    current.selectedInstanceId === presetId
                    && !current.presetChanged
                    && model.selectedSnapshot.get() < 0
                ) {
                    const signature =
                        stablePedalboardStateSignature(model.pedalboard.get());
                    cleanPresetBaselineCache.set(presetId, signature);
                    setCleanPresetBaseline({
                        presetId,
                        signature
                    });
                }
            }, 0);

            return () => window.clearTimeout(timer);
        }
    }, [
        model,
        presets.selectedInstanceId,
        presets.presetChanged,
        selectedSnapshot,
        chainBypassed,
        cleanPresetBaseline?.presetId
    ]);

    useEffect(() => {
        let cancelled = false;
        let waiting = false;

        const poll = async () => {
            if (
                cancelled
                || waiting
                || model.state.get() !== State.Ready
            ) {
                return;
            }

            waiting = true;
            try {
                const status = await model.getJackStatus();
                if (!cancelled) {
                    setJackStatus(status);
                }
            } catch {
                // Keep the previous status while PiPedal reconnects.
            } finally {
                waiting = false;
            }
        };

        void poll();
        const timer = window.setInterval(
            () => void poll(),
            1000
        );

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [model]);

    useEffect(() => {
        return subscribeMultiFXRuntimeState((state) => {
            const currentPresetId =
                model.presets.get().selectedInstanceId;
            const staleBypass =
                state.chainBypassed
                && state.chainBypassPresetId !== currentPresetId;
            const staleSnapshotMode =
                state.snapshotMode
                && state.snapshotPresetId !== currentPresetId;

            if (staleBypass || staleSnapshotMode) {
                const patch: MultiFXRuntimeStatePatch = {};
                if (staleBypass) {
                    patch.chainBypassed = false;
                    patch.chainBypassPresetId = null;
                    patch.chainBypassWasPresetChanged = false;
                    patch.chainBypassEnabledStates = {};
                }
                if (staleSnapshotMode) {
                    patch.snapshotMode = false;
                    patch.snapshotPresetId = null;
                }

                void updateMultiFXRuntimeState(patch)
                    .then(applyRuntimeState)
                    .catch(() => undefined);
                return;
            }

            applyRuntimeState(state);
        });
    }, [model]);

    useEffect(() => {
        if (!controllerConfigLoaded) return;

        const reload = () => reloadPresetAssignments();
        reload();
        window.addEventListener(
            MULTIFX_PRESET_ASSIGNMENTS_CHANGED_EVENT,
            reload
        );
        return () => {
            window.removeEventListener(
                MULTIFX_PRESET_ASSIGNMENTS_CHANGED_EVENT,
                reload
            );
        };
    }, [
        controllerConfigLoaded,
        banks.selectedBank,
        presetSwitchConfigs.map((item) => item.id).join("|")
    ]);

    const getPresetForSlot = (slotIndex: number): PresetIndexEntry | undefined => {
        if (slotIndex < 0 || slotIndex >= presetSlotCount) return undefined;
        const presetId = presetAssignmentsBySlot[slotIndex];
        if (presetId === null || presetId === undefined) return undefined;
        return presets.getItem(presetId) ?? undefined;
    };

    const selectedSlotPreset = getPresetForSlot(selectedPresetSlot);

    const requestPresetLoad = (presetId: number) => {
        const selectedPresetId = model.presets.get().selectedInstanceId;
        if (presetId === selectedPresetId) {
            if (selectedSnapshot < 0) return;
            snapshotModePresetIdRef.current = null;
            setSnapshotMode(false);
            publishRuntimeState({ snapshotMode: false, snapshotPresetId: null });
            model.loadPreset(selectedPresetId);
            showStatusToast("BASE PRESET");
            return;
        }
        model.loadPreset(presetId);
    };

    const openPresetOptionsForSlot = (slotIndex: number) => {
        const preset = getPresetForSlot(slotIndex);
        setSelectedPresetSlot(slotIndex);
        setPresetOptionIndex(0);
        setPresetRenameValue(preset?.name ?? "");
        setPresetDeleteConfirmOpen(false);
        setPresetOptionsOpen(true);
        setBankMenuOpen(false);
        setPresetMenuOpen(false);
    };

    const closePresetOptions = () => {
        suppressNextClickRef.current = false;
        setPresetOptionsOpen(false);
        setPresetOptionIndex(0);
        setPresetDeleteConfirmOpen(false);
    };

    const blockPresetWriteWhileSnapshotActive = (action: string): boolean => {
        const snapshotActive = snapshotMode || selectedSnapshot >= 0;
        if (!snapshotActive) return false;
        const label = selectedSnapshot >= 0 ? `Snapshot ${selectedSnapshot + 1}` : "Snapshot Mode";
        model.showAlert(
            `${label} is active. ${action} is disabled until you return to the base preset. `
            + "Snapshots can only be saved with Snapshot Editor."
        );
        return true;
    };

    const renameSelectedSlotPreset = async () => {
        const preset = getPresetForSlot(selectedPresetSlot);
        const nextName = presetRenameValue.trim();
        if (!preset || presetActionBusy || !nextName || nextName === preset.name) return;
        setPresetActionBusy(true);
        try {
            await model.renamePresetItem(preset.instanceId, nextName);
            setPresetRenameValue(nextName);
            showStatusToast("Preset renamed");
        } catch (error) {
            model.showAlert(String(error));
        } finally {
            setPresetActionBusy(false);
        }
    };

    const deleteSelectedSlotPreset = async () => {
        const preset = getPresetForSlot(selectedPresetSlot);
        if (!preset || presetActionBusy) return;
        const deletedPresetId = preset.instanceId;
        setPresetActionBusy(true);
        try {
            await model.deletePresetItems(new Set<number>([deletedPresetId]));
            await clearPresetAssignmentsForPreset(
                banks.selectedBank,
                deletedPresetId
            );
            reloadPresetAssignments();
            closePresetOptions();
            showStatusToast("Preset deleted");
        } catch (error) {
            model.showAlert(String(error));
        } finally {
            setPresetActionBusy(false);
        }
    };

    const moveMainCursor = (direction: number) => {
        const nextSlot = selectedPresetSlot + direction;
        if (nextSlot >= 0 && nextSlot < presetSlotCount) {
            setSelectedPresetSlot(nextSlot);
            return;
        }

        // Crossing the first/last preset switch moves to the adjacent PiPedal
        // bank. Banks are the only grouping layer; there is no nested paging.
        pendingBankSlotRef.current = direction > 0 ? 0 : -1;
        if (direction > 0) model.nextBank();
        else model.previousBank();
    };

    const createNewPresetFromCurrent = async () => {
        if (blockPresetWriteWhileSnapshotActive("Creating a preset")) return;
        const currentPresets = model.presets.get();
        const selectedId = currentPresets.selectedInstanceId;
        const bankId = model.banks.get().selectedBank;
        const targetSwitchId = switchIdForPresetSlot(selectedPresetSlot);
        if (!targetSwitchId || selectedId < 0) return;

        try {
            // A new preset must be copied from the real base sound, never from
            // a temporary Chain Bypass state. Dirty base edits are preserved.
            await restoreChainBypassForSafeWrite(model);
            closePresetOptions();
            const instanceId = await model.newPresetItem(selectedId);
            model.loadPreset(instanceId);
            onOpenEditor?.({
                presetId: instanceId,
                previousPresetId: selectedId,
                bankId,
                targetSwitchId
            });
        } catch (error) {
            model.showAlert(String(error));
        }
    };

    const loadSelectedSlotPreset = () => {
        const preset = getPresetForSlot(selectedPresetSlot);
        if (!preset) return;
        closePresetOptions();
        requestPresetLoad(preset.instanceId);
    };

    const editSelectedSlotPreset = () => {
        if (blockPresetWriteWhileSnapshotActive("Editing the base preset")) return;
        const preset = getPresetForSlot(selectedPresetSlot);
        if (!preset) {
            void createNewPresetFromCurrent();
            return;
        }
        closePresetOptions();
        if (preset.instanceId !== model.presets.get().selectedInstanceId) {
            requestPresetLoad(preset.instanceId);
        }
        onOpenEditor?.(undefined, preset.instanceId);
    };

    const snapshotPerformanceActive = selectedSnapshot >= 0;

    const getPresetOptions = () => {
        const preset = getPresetForSlot(selectedPresetSlot);
        if (!preset) return ["Assign Preset to This Switch", "Create New Preset", "Cancel"];
        const options = ["Load Preset", "Edit Preset"];
        if (
            preset.instanceId === model.presets.get().selectedInstanceId
            && !snapshotPerformanceActive
        ) options.push("Save Loaded Preset");
        options.push("Assign Different Preset", "Remove From Switch", "Delete Preset", "Cancel");
        return options;
    };

    const runPresetOption = (optionIndex: number) => {
        const option = getPresetOptions()[optionIndex];
        switch (option) {
            case "Load Preset": loadSelectedSlotPreset(); break;
            case "Edit Preset": editSelectedSlotPreset(); break;
            case "Save Loaded Preset":
                if (!blockPresetWriteWhileSnapshotActive("Saving the preset")) {
                    const presetId = model.presets.get().selectedInstanceId;
                    closePresetOptions();
                    void prepareBasePresetForWrite(model, presetId)
                        .then(() => model.saveCurrentPreset())
                        .catch((error) => model.showAlert(String(error)));
                }
                break;
            case "Create New Preset": void createNewPresetFromCurrent(); break;
            case "Remove From Switch": {
                closePresetOptions();
                removePerformancePresetFromSlot(selectedPresetSlot);
                break;
            }
            case "Delete Preset": setPresetDeleteConfirmOpen(true); break;
            case "Assign Different Preset":
            case "Assign Preset to This Switch":
                setPresetAssignTargetIndex(selectedPresetSlot);
                closePresetOptions();
                setPresetAssignPickerOpen(true);
                break;
            case "Cancel": closePresetOptions(); break;
        }
    };

    const getPhysicalSwitchNumber = (key: string): number => {
        if (/^[1-9]$/.test(key)) return Number(key);
        if (key === "0") return 10;
        const match = /^F(\d{1,2})$/.exec(key);
        if (!match) return -1;
        const n = Number(match[1]);
        return n >= 1 && n <= 22 ? 10 + n : -1;
    };

    const getSwitchActionContext = (
        switchConfig: ControllerSwitchConfig,
        action: ControllerSwitchAction,
        longPress: boolean
    ) => {
        if (action.type !== "preset") {
            return { preset: undefined as PresetIndexEntry | undefined, presetSlotIndex: -1 };
        }
        const presetSlotIndex = longPress
            ? Math.max(0, Math.min(presetSlotCount - 1, action.presetIndex))
            : (
                switchConfig.action.type === "preset"
                    ? switchConfig.action.presetIndex
                    : -1
            );
        return {
            preset: presetSlotIndex >= 0 ? getPresetForSlot(presetSlotIndex) : undefined,
            presetSlotIndex
        };
    };

    const runPhysicalSwitchAction = (
        switchConfig: ControllerSwitchConfig,
        action: ControllerSwitchAction,
        longPress: boolean
    ) => {
        const sourcePresetSlotIndex = switchConfig.action.type === "preset"
            ? switchConfig.action.presetIndex
            : -1;
        if (
            longPress
            && action.type !== "preset"
            && sourcePresetSlotIndex >= 0
            && !getPresetForSlot(sourcePresetSlotIndex)
        ) return;

        const context = getSwitchActionContext(switchConfig, action, longPress);
        runSwitchAction(switchConfig, context.preset, context.presetSlotIndex, action);
        if (context.presetSlotIndex >= 0) setSelectedPresetSlot(context.presetSlotIndex);
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
            const physicalSwitchNumber = getPhysicalSwitchNumber(event.key);
            const isPhysicalSwitchKey = physicalSwitchNumber > 0;
            if (
                !isPhysicalSwitchKey
                && event.key !== "ArrowUp"
                && event.key !== "ArrowDown"
                && event.key !== "Enter"
                && event.key !== "Escape"
            ) return;

            event.preventDefault();
            event.stopPropagation();

            if (isPhysicalSwitchKey) {
                if (presetOptionsOpen || bankMenuOpen || presetMenuOpen || event.repeat) return;
                const physicalSwitchConfig = controllerConfig.switches.find(
                    (s) => s.hardwareSwitch === physicalSwitchNumber
                );
                if (!physicalSwitchConfig) return;
                const longPressAction = physicalSwitchConfig.longPressAction
                    ?? { type: "none", text: "Unused" } as ControllerSwitchAction;
                if (longPressAction.type === "none") {
                    runPhysicalSwitchAction(physicalSwitchConfig, physicalSwitchConfig.action, false);
                    return;
                }
                const oldTimer = hardwareLongPressTimersRef.current.get(physicalSwitchNumber);
                if (oldTimer !== undefined) window.clearTimeout(oldTimer);
                hardwareLongPressFiredRef.current.delete(physicalSwitchNumber);
                hardwarePressPendingRef.current.add(physicalSwitchNumber);
                const timer = window.setTimeout(() => {
                    hardwareLongPressTimersRef.current.delete(physicalSwitchNumber);
                    hardwareLongPressFiredRef.current.add(physicalSwitchNumber);
                    runPhysicalSwitchAction(physicalSwitchConfig, longPressAction, true);
                }, controllerConfig.longPressMs);
                hardwareLongPressTimersRef.current.set(physicalSwitchNumber, timer);
                return;
            }

            if (presetOptionsOpen) {
                const options = getPresetOptions();
                if (event.key === "ArrowDown") setPresetOptionIndex((i) => (i + 1) % options.length);
                else if (event.key === "ArrowUp") setPresetOptionIndex((i) => (i - 1 + options.length) % options.length);
                else if (event.key === "Escape") closePresetOptions();
                else if (event.key === "Enter") runPresetOption(presetOptionIndex);
                return;
            }

            if (!bankMenuOpen && !presetMenuOpen) {
                if (event.key === "ArrowDown") moveMainCursor(1);
                else if (event.key === "ArrowUp") moveMainCursor(-1);
                else if (event.key === "Enter" && !event.repeat) {
                    const preset = getPresetForSlot(selectedPresetSlot);
                    if (preset) requestPresetLoad(preset.instanceId);
                }
                return;
            }

            const itemCount = bankMenuOpen ? banks.entries.length : presets.presets.length;
            if (itemCount === 0) return;
            if (event.key === "ArrowDown") setMenuIndex((i) => (i + 1) % itemCount);
            else if (event.key === "ArrowUp") setMenuIndex((i) => (i - 1 + itemCount) % itemCount);
            else if (event.key === "Escape") {
                setBankMenuOpen(false);
                setPresetMenuOpen(false);
            } else if (event.key === "Enter") {
                if (bankMenuOpen) {
                    const bank = banks.entries[menuIndex];
                    if (bank) {
                        setBankMenuOpen(false);
                        model.openBank(bank.instanceId).catch((error) => model.showAlert(error.toString()));
                    }
                } else {
                    const preset = presets.presets[menuIndex];
                    if (preset) {
                        setPresetMenuOpen(false);
                        requestPresetLoad(preset.instanceId);
                    }
                }
            }
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            const physicalSwitchNumber = getPhysicalSwitchNumber(event.key);
            if (physicalSwitchNumber <= 0) return;
            event.preventDefault();
            event.stopPropagation();
            const wasPending = hardwarePressPendingRef.current.delete(physicalSwitchNumber);
            const longActionFired = hardwareLongPressFiredRef.current.delete(physicalSwitchNumber);
            if (!wasPending && !longActionFired) return;
            const timer = hardwareLongPressTimersRef.current.get(physicalSwitchNumber);
            if (timer !== undefined) {
                window.clearTimeout(timer);
                hardwareLongPressTimersRef.current.delete(physicalSwitchNumber);
            }
            if (longActionFired) return;
            const switchConfig = controllerConfig.switches.find((s) => s.hardwareSwitch === physicalSwitchNumber);
            if (!switchConfig) return;
            const longPressAction = switchConfig.longPressAction
                ?? { type: "none", text: "Unused" } as ControllerSwitchAction;
            if (longPressAction.type !== "none") {
                runPhysicalSwitchAction(switchConfig, switchConfig.action, false);
            }
        };

        window.addEventListener("keydown", handleKeyDown, true);
        window.addEventListener("keyup", handleKeyUp, true);
        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
            window.removeEventListener("keyup", handleKeyUp, true);
        };
    }, [
        bankMenuOpen, presetMenuOpen, presetOptionsOpen, presetOptionIndex,
        selectedPresetSlot, presetSlotCount,
        controllerConfig, banks, presets, chainBypassed, snapshotMode,
        snapshotPedalboard, selectedSnapshot, model
    ]);

    useEffect(() => {
        if (!bankMenuOpen && !presetMenuOpen) return;
        menuItemRefs.current[menuIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [menuIndex, bankMenuOpen, presetMenuOpen]);

    useEffect(() => setSelectedPresetSlot((slot) => Math.min(Math.max(0, slot), presetSlotCount - 1)), [presetSlotCount]);

    useEffect(() => {
        const activePresetId = presets.selectedInstanceId;
        const activeIndex = presetAssignmentsBySlot.findIndex((id) => id === activePresetId);
        if (activeIndex < 0 || lastRevealedActivePresetIdRef.current === activePresetId) return;
        lastRevealedActivePresetIdRef.current = activePresetId;
        setSelectedPresetSlot(activeIndex);
    }, [presets.selectedInstanceId, presetSlotCount, presetAssignmentsBySlot]);

    useEffect(() => {
        if (!chainBypassed) return;
        const bypassPresetId = chainBypassPresetIdRef.current;
        if (bypassPresetId !== null && bypassPresetId !== presets.selectedInstanceId) {
            chainBypassSnapshotRef.current = new Map();
            chainBypassPresetIdRef.current = null;
            chainBypassWasPresetChangedRef.current = false;
            setChainBypassed(false);
            publishRuntimeState({
                chainBypassed: false,
                chainBypassPresetId: null,
                chainBypassWasPresetChanged: false,
                chainBypassEnabledStates: {}
            });
        }
    }, [presets.selectedInstanceId, chainBypassed]);

    useEffect(() => {
        if (!snapshotMode) return;
        const snapshotPresetId = snapshotModePresetIdRef.current;
        if (snapshotPresetId !== null && snapshotPresetId !== presets.selectedInstanceId) {
            snapshotModePresetIdRef.current = null;
            setSnapshotMode(false);
            publishRuntimeState({ snapshotMode: false, snapshotPresetId: null });
        }
    }, [presets.selectedInstanceId, snapshotMode]);

    useEffect(() => {
        if (pendingBankSlotRef.current === null) return;
        const requestedSlot = pendingBankSlotRef.current;
        pendingBankSlotRef.current = null;

        if (requestedSlot === -1) {
            for (let index = presetAssignmentsBySlot.length - 1; index >= 0; --index) {
                if (presetAssignmentsBySlot[index] !== null) {
                    setSelectedPresetSlot(index);
                    return;
                }
            }
        }

        const firstAssigned = presetAssignmentsBySlot.findIndex((id) => id !== null);
        setSelectedPresetSlot(firstAssigned >= 0 ? firstAssigned : 0);
    }, [presetAssignmentsBySlot]);

    const openBankMenu = () => {
        setPresetMenuOpen(false);
        setMenuIndex(Math.max(0, banks.entries.findIndex((bank) => bank.instanceId === banks.selectedBank)));
        setBankMenuOpen(true);
    };

    const openPresetMenu = () => {
        setBankMenuOpen(false);
        setMenuIndex(Math.max(0, presets.presets.findIndex((preset) => preset.instanceId === presets.selectedInstanceId)));
        setPresetMenuOpen(true);
    };

    const colors = {
        ...controllerConfig.colors,
        pageBackground: "var(--mfx-bg)",
        pageText: "var(--mfx-text)",
        headerBackground: "var(--mfx-panel)",
        headerBorder: "var(--mfx-border)",
        bankTitleText: "var(--mfx-purple-light)",
        bankNameText: "var(--mfx-text)",
        activePresetLabelText: "var(--mfx-muted)",
        activePresetNameText: "var(--mfx-cyan)",
        headerDivider: "var(--mfx-border)",
        switchBackground: "var(--mfx-panel)",
        switchBorder: "var(--mfx-border)",
        switchLabelText: "var(--mfx-muted)",
        switchValueText: "var(--mfx-text)",
        bankSwitchBackground: "var(--mfx-purple-surface)",
        bankSwitchBorder: "var(--mfx-purple)",
        bankSwitchLabelText: "var(--mfx-purple-light)",
        bankSwitchValueText: "var(--mfx-text)",
        activeSwitchBackground: "var(--mfx-cyan-surface)",
        activeSwitchBorder: "var(--mfx-cyan)",
        activeSwitchLabelText: "var(--mfx-cyan)",
        activeSwitchValueText: "var(--mfx-cyan-text)",
        activeSwitchShadow: "0 0 20px var(--mfx-cyan)",
        configErrorBackground: "var(--mfx-panel-alt)",
        configErrorBorder: "var(--mfx-danger)",
        configErrorText: "var(--mfx-danger)"
    };
    const sizing = controllerConfig.sizing;
    const currentPreset = presets.getItem(presets.selectedInstanceId);
    const currentPedalboardSignature =
        stablePedalboardStateSignature(snapshotPedalboard);
    const matchesCleanPresetBaseline =
        cleanPresetBaseline?.presetId === presets.selectedInstanceId
        && cleanPresetBaseline.signature === currentPedalboardSignature;
    const effectivePresetChanged =
        presets.presetChanged && !matchesCleanPresetBaseline;
    const showPresetChanged =
        effectivePresetChanged
        && selectedSnapshot < 0
        && (!chainBypassed || chainBypassWasPresetChangedRef.current);

    const getSwitchVisualState = (isActive: boolean): SwitchVisualState =>
        isActive
            ? {
                background: colors.activeSwitchBackground,
                border: colors.activeSwitchBorder,
                labelText: colors.activeSwitchLabelText,
                valueText: colors.activeSwitchValueText,
                shadow: colors.activeSwitchShadow
            }
            : {
                background: colors.switchBackground,
                border: colors.switchBorder,
                labelText: colors.switchLabelText,
                valueText: colors.switchValueText,
                shadow: "none"
            };

    const selectPreset = (preset: PresetIndexEntry | undefined) => {
        if (!preset) return;
        setPresetMenuOpen(false);
        requestPresetLoad(preset.instanceId);
    };

    const selectBank = (bankId: number) => {
        setBankMenuOpen(false);
        model.openBank(bankId).catch((error) => model.showAlert(error.toString()));
    };

    const dropdownPanelStyle = {
        position: "absolute" as const,
        left: "5%",
        right: "5%",
        top: "calc(100% + 6px)",
        zIndex: 100,
        maxHeight: "55vh",
        overflowY: "auto" as const,
        background: colors.headerBackground,
        border: `2px solid ${colors.bankSwitchBorder}`,
        borderRadius: `${sizing.switchBorderRadius}px`,
        boxShadow: "0 10px 28px rgba(0,0,0,.75)",
        padding: "calc(6px * var(--mfx-ui-scale, 1))"
    };

    const dropdownItemStyle = (selected: boolean, highlighted: boolean) => ({
        display: "block",
        width: "100%",
        minHeight: "calc(48px * var(--mfx-ui-scale, 1))",
        padding: "calc(10px * var(--mfx-ui-scale, 1)) calc(14px * var(--mfx-ui-scale, 1))",
        margin: "2px 0",
        background: selected ? colors.activeSwitchBackground : colors.switchBackground,
        color: selected ? colors.activeSwitchValueText : colors.switchValueText,
        border: selected ? `2px solid ${colors.activeSwitchBorder}` : `1px solid ${colors.switchBorder}`,
        outline: highlighted ? `3px solid ${colors.bankSwitchBorder}` : "none",
        outlineOffset: highlighted ? "-4px" : "0",
        borderRadius: `${Math.max(6, sizing.switchBorderRadius - 3)}px`,
        textAlign: "left" as const,
        font: "inherit",
        fontSize: sizing.switchValueFontSize,
        fontWeight: "bold" as const,
        cursor: "pointer"
    });

    const getPreset = (switchConfig: ControllerSwitchConfig): PresetIndexEntry | undefined => {
        if (switchConfig.action.type !== "preset") return undefined;
        const slotIndex = presetSwitchConfigs.findIndex((entry) => entry.id === switchConfig.id);
        return getPresetForSlot(slotIndex);
    };

    const waitForCleanBasePreset = (presetId: number): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
            let settled = false;

            const cleanup = () => {
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

            const onState = (state: State) => {
                if (state === State.Error) {
                    fail("PiPedal disconnected while restoring the base preset.");
                }
            };

            model.presets.addOnChangedHandler(check);
            model.selectedSnapshot.addOnChangedHandler(check);
            model.presetChanged.addOnChangedHandler(check);
            model.state.addOnChangedHandler(onState);
            check();
        });
    };

    const clearChainBypassRuntime = () => {
        chainBypassSnapshotRef.current = new Map();
        chainBypassPresetIdRef.current = null;
        chainBypassWasPresetChangedRef.current = false;
        setChainBypassed(false);
        publishRuntimeState({
            chainBypassed: false,
            chainBypassPresetId: null,
            chainBypassWasPresetChanged: false,
            chainBypassEnabledStates: {}
        });
    };

    const restoreChainBypass = async (): Promise<void> => {
        if (!chainBypassed) return;

        const currentPresetId = model.presets.get().selectedInstanceId;
        const samePreset = chainBypassPresetIdRef.current === currentPresetId;
        const originalWasDirty = chainBypassWasPresetChangedRef.current;
        const enabledSnapshot = new Map(chainBypassSnapshotRef.current);

        if (samePreset) {
            if (!originalWasDirty) {
                // The base was clean before bypass. A real preset reload is the
                // safest restoration because it atomically restores every
                // plugin's saved enabled/control state.
                model.loadPreset(currentPresetId);
                await waitForCleanBasePreset(currentPresetId);
            } else {
                // A dirty base cannot be reloaded without losing the user's
                // unsaved edits. Restore only the enabled flags that bypass
                // changed and leave the rest of the live pedalboard untouched.
                const items = model.pedalboard.get().items.filter(
                    (item) => !item.isEmpty() && !item.isSyntheticItem()
                );
                for (const item of items) {
                    const enabled = enabledSnapshot.get(item.instanceId);
                    if (enabled !== undefined && item.isEnabled !== enabled) {
                        model.setPedalboardItemEnabled(item.instanceId, enabled);
                    }
                }
            }
        }

        clearChainBypassRuntime();
        showStatusToast("CHAIN ACTIVE");
    };

    const toggleChainBypass = async () => {
        if (chainBypassed) {
            try {
                await restoreChainBypass();
            } catch (error) {
                model.showAlert(String(error));
            }
            return;
        }

        // Snapshot Mode and Chain Bypass are mutually exclusive temporary
        // modes. Leaving Snapshot Mode changes only the UI mode; an already
        // recalled native snapshot is still owned by PiPedal.
        if (snapshotMode) {
            snapshotModePresetIdRef.current = null;
            setSnapshotMode(false);
        }

        const pedalboard = model.pedalboard.get();
        const items = pedalboard.items.filter(
            (item) => !item.isEmpty() && !item.isSyntheticItem()
        );
        const enabledSnapshot = new Map<number, boolean>();
        for (const item of items) {
            enabledSnapshot.set(item.instanceId, item.isEnabled);
        }

        const currentPresetId = model.presets.get().selectedInstanceId;
        chainBypassSnapshotRef.current = enabledSnapshot;
        chainBypassPresetIdRef.current = currentPresetId;
        chainBypassWasPresetChangedRef.current = effectivePresetChanged;

        for (const item of items) {
            if (item.isEnabled) {
                model.setPedalboardItemEnabled(item.instanceId, false);
            }
        }

        setChainBypassed(true);
        publishRuntimeState({
            snapshotMode: false,
            snapshotPresetId: null,
            chainBypassed: true,
            chainBypassPresetId: currentPresetId,
            chainBypassWasPresetChanged: effectivePresetChanged,
            chainBypassEnabledStates: Object.fromEntries(
                Array.from(enabledSnapshot.entries()).map(
                    ([instanceId, enabled]) => [String(instanceId), enabled]
                )
            )
        });
        showStatusToast("CHAIN BYPASSED");
    };

    const toggleSnapshotMode = async () => {
        if (snapshotMode) {
            snapshotModePresetIdRef.current = null;
            setSnapshotMode(false);
            publishRuntimeState({ snapshotMode: false, snapshotPresetId: null });
            showStatusToast(
                selectedSnapshot >= 0
                    ? `SNAPSHOT ${selectedSnapshot + 1} ACTIVE`
                    : "SNAPSHOT MODE OFF"
            );
            return;
        }

        const nativeSnapshotAlreadyActive = selectedSnapshot >= 0;
        const hasUnsavedBasePresetChanges =
            effectivePresetChanged
            && !nativeSnapshotAlreadyActive
            && (!chainBypassed || chainBypassWasPresetChangedRef.current);
        if (hasUnsavedBasePresetChanges) {
            model.showAlert(
                "Save or discard the base preset changes before entering Snapshot Mode."
            );
            return;
        }

        try {
            // This used to call toggleChainBypass() and immediately continue,
            // racing the asynchronous clean-base reload. Await restoration
            // before capturing the snapshot layout or enabling Snapshot Mode.
            await restoreChainBypass();
        } catch (error) {
            model.showAlert(String(error));
            return;
        }

        const currentPresetId = model.presets.get().selectedInstanceId;
        snapshotModePresetIdRef.current = currentPresetId;
        setSnapshotPedalboard(model.pedalboard.get().clone());
        setSnapshotMode(true);
        publishRuntimeState({
            snapshotMode: true,
            snapshotPresetId: currentPresetId,
            chainBypassed: false,
            chainBypassPresetId: null,
            chainBypassWasPresetChanged: false,
            chainBypassEnabledStates: {}
        });
        showStatusToast("SNAPSHOT MODE");
    };

    useEffect(() => onSnapshotModeChange?.(snapshotMode), [snapshotMode, onSnapshotModeChange]);
    const previousSnapshotExitRequestRef = useRef(snapshotExitRequest);
    useEffect(() => {
        if (snapshotExitRequest === previousSnapshotExitRequestRef.current) return;
        previousSnapshotExitRequestRef.current = snapshotExitRequest;
        if (snapshotMode) void toggleSnapshotMode();
    }, [snapshotExitRequest, snapshotMode]);

    const runSwitchAction = (
        switchConfig: ControllerSwitchConfig,
        preset: PresetIndexEntry | undefined,
        presetSlotIndex = -1,
        action: ControllerSwitchAction = switchConfig.action
    ) => {
        switch (action.type) {
            case "preset":
                if (snapshotMode) {
                    if (presetSlotIndex >= 0 && presetSlotIndex < Snapshot.MAX_SNAPSHOTS) {
                        const snapshot = snapshotPedalboard.snapshots[presetSlotIndex];
                        if (snapshot) {
                            model.selectSnapshot(presetSlotIndex);
                            showStatusToast(snapshot.name || `SNAPSHOT ${presetSlotIndex + 1}`);
                        } else showStatusToast(`SNAPSHOT ${presetSlotIndex + 1} IS EMPTY`);
                    }
                    return;
                }
                if (preset && presetSlotIndex >= 0) {
                    // Preserve the exact duplicate switch assignment the user/hardware chose.
                    // The generic active-preset reveal effect otherwise finds
                    // the first matching preset ID and can jump to another copy.
                    lastRevealedActivePresetIdRef.current = preset.instanceId;
                    setSelectedPresetSlot(presetSlotIndex);
                }
                selectPreset(preset);
                return;
            case "bankUp":
                if (snapshotMode) void toggleSnapshotMode(); else model.nextBank();
                return;
            case "bankDown":
                if (snapshotMode) void toggleSnapshotMode(); else model.previousBank();
                return;
            case "chainBypass":
                void toggleChainBypass();
                return;
            case "snapshotMode":
                void toggleSnapshotMode();
                return;
            case "none":
                return;
        }
    };

    const getSwitchText = (switchConfig: ControllerSwitchConfig, preset: PresetIndexEntry | undefined): string => {
        switch (switchConfig.action.type) {
            case "preset": return preset?.name ?? "+";
            case "bankUp": return "BANK UP";
            case "bankDown": return "BANK DOWN";
            case "chainBypass": return chainBypassed ? "CHAIN ACTIVE" : "CHAIN BYPASS";
            case "snapshotMode": return snapshotMode ? "EXIT SNAPSHOTS" : "SNAPSHOT MODE";
            case "none": return switchConfig.action.text ?? "UNASSIGNED";
        }
    };

    const getLongPressLabel = (action: ControllerSwitchAction | undefined): string | undefined => {
        if (!action || action.type === "none") return undefined;
        switch (action.type) {
            case "preset": return `PRESET SLOT ${action.presetIndex + 1}`;
            case "bankUp": return "BANK UP";
            case "bankDown": return "BANK DOWN";
            case "chainBypass": return "CHAIN BYPASS";
            case "snapshotMode": return "SNAPSHOT MODE";
        }
    };

    const cancelUiSwitchLongPress = () => {
        if (uiSwitchLongPressTimerRef.current !== null) window.clearTimeout(uiSwitchLongPressTimerRef.current);
        uiSwitchLongPressTimerRef.current = null;
        uiSwitchPointerStartRef.current = null;
    };

    const startUiSwitchLongPress = (
        event: React.PointerEvent<HTMLButtonElement>,
        switchConfig: ControllerSwitchConfig,
        preset: PresetIndexEntry | undefined,
        presetSlotIndex: number
    ) => {
        const action = switchConfig.longPressAction ?? { type: "none", text: "Unused" } as ControllerSwitchAction;
        if (action.type === "none") return;
        cancelUiSwitchLongPress();
        uiSwitchSuppressNextClickRef.current = false;
        uiSwitchPointerStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { }
        uiSwitchLongPressTimerRef.current = window.setTimeout(() => {
            uiSwitchLongPressTimerRef.current = null;
            uiSwitchPointerStartRef.current = null;
            uiSwitchSuppressNextClickRef.current = true;
            runSwitchAction(switchConfig, preset, presetSlotIndex, action);
        }, controllerConfig.longPressMs);
    };

    const moveUiSwitchLongPress = (event: React.PointerEvent<HTMLButtonElement>) => {
        const start = uiSwitchPointerStartRef.current;
        if (!start || start.pointerId !== event.pointerId) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > SNAPSHOT_HOLD_MOVE_TOLERANCE) {
            cancelUiSwitchLongPress();
        }
    };

    const finishUiSwitchLongPress = (event: React.PointerEvent<HTMLButtonElement>) => {
        cancelUiSwitchLongPress();
        try {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        } catch { }
    };

    const renderSwitch = (switchConfig: ControllerSwitchConfig) => {
        const preset = getPreset(switchConfig);
        const isPresetAction = switchConfig.action.type === "preset";
        const freeformRect = useFreeformPerformanceLayout
            ? controllerConfig.performanceLayout.switches[switchConfig.id]
            : undefined;
        const presetSlotIndex = isPresetAction
            ? presetSwitchConfigs.findIndex((entry) => entry.id === switchConfig.id)
            : -1;
        const absolutePresetIndex = presetSlotIndex;
        const isPresetDropTarget =
            presetDrag !== null
            && absolutePresetIndex >= 0
            && presetDropIndex === absolutePresetIndex;
        const isEncoderSelected = isPresetAction && presetSlotIndex === selectedPresetSlot;
        const isActive = isPresetAction && preset?.instanceId === presets.selectedInstanceId;
        const isDisabled = switchConfig.action.type === "none";
        const longPressLabel = isPresetAction && !preset ? undefined : getLongPressLabel(switchConfig.longPressAction);


        // Use exactly the same visual palette as a preset tile.
        // A populated, unselected preset uses the normal visual state; only
        // the currently selected preset uses the active state.
        const visualState = getSwitchVisualState(Boolean(isActive));
        const primaryTextColor = visualState.valueText;
        const labelTextColor = visualState.labelText;

        return (
            <button
                key={switchConfig.id}
                type="button"
                disabled={isDisabled}
                data-mfx-performance-preset-index={absolutePresetIndex >= 0 ? absolutePresetIndex : undefined}
                data-mfx-performance-preset-id={isPresetAction && preset ? preset.instanceId : undefined}
                onPointerDown={(event) => {
                    if (isPresetAction && preset && absolutePresetIndex >= 0) beginPresetDrag(event, preset, absolutePresetIndex);
                    else if (isPresetAction && presetSlotIndex >= 0) {
                        suppressNextClickRef.current = false;
                        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { }
                        startPresetLongPress(presetSlotIndex);
                    } else startUiSwitchLongPress(event, switchConfig, preset, presetSlotIndex);
                }}
                onPointerMove={(event) => isPresetAction && preset ? movePresetDrag(event) : !isPresetAction ? moveUiSwitchLongPress(event) : undefined}
                onPointerUp={(event) => isPresetAction && preset ? endPresetDrag(event) : isPresetAction ? finishPresetLongPress() : finishUiSwitchLongPress(event)}
                onPointerCancel={(event) => isPresetAction && preset ? cancelPresetDrag(event) : isPresetAction ? finishPresetLongPress() : finishUiSwitchLongPress(event)}
                onContextMenu={(event) => { if (isPresetAction) { event.preventDefault(); event.stopPropagation(); } }}
                onClick={(event) => {
                    if (!isPresetAction && uiSwitchSuppressNextClickRef.current) {
                        uiSwitchSuppressNextClickRef.current = false; event.preventDefault(); return;
                    }
                    if (suppressNextClickRef.current) {
                        suppressNextClickRef.current = false; event.preventDefault(); return;
                    }
                    if (isPresetAction && !preset && presetSlotIndex >= 0) openPresetOptionsForSlot(presetSlotIndex);
                    else runSwitchAction(switchConfig, preset, presetSlotIndex);
                }}
                style={{
                    position: freeformRect ? "absolute" : "relative",
                    left: freeformRect ? `${freeformRect.x * 100}%` : undefined,
                    top: freeformRect ? `${freeformRect.y * 100}%` : undefined,
                    width: freeformRect ? `${freeformRect.width * 100}%` : undefined,
                    height: freeformRect ? `${freeformRect.height * 100}%` : undefined,
                    boxSizing: "border-box",
                    pointerEvents: "auto",
                    background: visualState.background,
                    border: `2px solid ${visualState.border}`,
                    outline: isEncoderSelected ? `4px solid ${colors.bankSwitchBorder}` : "none",
                    outlineOffset: isEncoderSelected ? "-6px" : "0",
                    borderRadius: `${sizing.switchBorderRadius}px`,
                    padding: sizing.switchPadding,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: isPresetAction && !preset ? "center" : "space-between",
                    alignItems: isPresetAction && !preset ? "center" : "stretch",
                    boxShadow: isPresetDropTarget
                        ? `${visualState.shadow}, inset 0 0 0 4px ${colors.activeSwitchBorder}`
                        : visualState.shadow,
                    cursor: isDisabled ? "default" : "pointer",
                    minHeight: 0,
                    overflow: "hidden",
                    opacity: isDisabled
                        ? colors.disabledSwitchOpacity
                        : presetDrag && absolutePresetIndex === presetDrag.slotIndex
                            ? 0.38
                            : 1,
                    color: "inherit",
                    textAlign: "left",
                    font: "inherit",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    touchAction: isPresetAction ? "none" : "manipulation",
                    gridRow: freeformRect ? undefined : switchConfig.row,
                    gridColumn: freeformRect ? undefined : switchConfig.column
                }}
            >
                {isPresetAction && preset && (
                    <span aria-hidden="true" style={{
                        position: "absolute", top: 6, right: 7, width: 16, height: 16,
                        borderRadius: "50%", border: `2px solid ${isActive ? chainBypassed ? "#FCA5A5" : snapshotPerformanceActive ? "#93C5FD" : showPresetChanged ? "#FDE68A" : "#86EFAC" : "#555"}`,
                        background: isActive ? chainBypassed ? "#F87171" : snapshotPerformanceActive ? "#3B82F6" : showPresetChanged ? "#FBBF24" : "#22C55E" : "#242424",
                        boxShadow: isActive ? "0 0 9px currentColor" : "none",
                        boxSizing: "border-box"
                    }} />
                )}
                {!(isPresetAction && !preset) && (
                    <span style={{ fontSize: sizing.switchLabelFontSize, fontWeight: "bold", color: labelTextColor, textTransform: "uppercase" }}>
                        {switchConfig.label}
                    </span>
                )}
                {isPresetAction && !preset ? (
                    <span style={{ color: primaryTextColor, fontSize: "clamp(1.7rem, 4vw, 2.4rem)", fontWeight: 900, lineHeight: 1 }}>+</span>
                ) : (
                    <MarqueeText
                        text={getSwitchText(switchConfig, preset)}
                        color={primaryTextColor}
                        fontSize={sizing.switchValueFontSize}
                        fontWeight="bold"
                        marginTop={sizing.switchValueMarginTop}
                        delaySeconds={sizing.marqueeDelaySeconds}
                        pixelsPerSecond={sizing.marqueePixelsPerSecond}
                        endPauseSeconds={sizing.marqueeEndPauseSeconds}
                    />
                )}
                {longPressLabel && (
                    <span style={{
                        width: "100%", marginTop: 5, color: labelTextColor,
                        fontSize: "clamp(.48rem, 1.05vw, .62rem)", fontWeight: 800,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        textTransform: "uppercase", opacity: .82
                    }}>HOLD: {longPressLabel}</span>
                )}
            </button>
        );
    };

    const openSnapshotEditor = (index: number) => {
        setSnapshotOptionsOpen(false);
        setSnapshotRenameOpen(false);
        onEditSnapshot?.(index);
    };

    const updateSnapshotMetadata = (
        mutate: (snapshots: Array<Snapshot | null>) => void,
        successMessage: string
    ) => {
        if (presetActionBusy) return;
        setPresetActionBusy(true);
        try {
            const snapshots = Snapshot.cloneSnapshots(model.pedalboard.get().snapshots);
            mutate(snapshots);
            model.setSnapshots(snapshots, -1);
            showStatusToast(successMessage);
        } catch (error) { model.showAlert(String(error)); }
        finally { setPresetActionBusy(false); }
    };

    const savePerformanceSnapshotRename = () => {
        if (snapshotOptionsIndex === null) return;
        const name = snapshotRenameValue.trim();
        if (!name) return;
        const index = snapshotOptionsIndex;
        setSnapshotOptionsOpen(false);
        setSnapshotRenameOpen(false);
        updateSnapshotMetadata((snapshots) => {
            const existing = snapshots[index];
            if (!existing) throw new Error("Snapshot no longer exists.");
            const renamed = new Snapshot().deserialize(existing);
            renamed.name = name;
            snapshots[index] = renamed;
        }, "SNAPSHOT RENAMED");
    };

    const deletePerformanceSnapshot = (index: number) => {
        setSnapshotOptionsOpen(false);
        setSnapshotRenameOpen(false);
        updateSnapshotMetadata((snapshots) => { snapshots[index] = null; }, `SNAPSHOT ${index + 1} DELETED`);
    };

    const renderSnapshotTile = (index: number) => {
        const snapshot = snapshotPedalboard.snapshots[index];
        const active = selectedSnapshot === index;
        return (
            <button key={`snapshot-${index}`} type="button"
                onPointerDown={(event) => { if (event.button === 0) startSnapshotLongPress(event, index); }}
                onPointerMove={moveSnapshotLongPress}
                onPointerUp={finishSnapshotLongPress}
                onPointerCancel={finishSnapshotLongPress}
                onContextMenu={(event) => { event.preventDefault(); openSnapshotOptions(index); }}
                onClick={(event) => {
                    if (snapshotSuppressNextClickRef.current) { snapshotSuppressNextClickRef.current = false; event.preventDefault(); return; }
                    if (!snapshot) { showStatusToast(`SNAPSHOT ${index + 1} IS EMPTY — HOLD TO CREATE`); return; }
                    model.selectSnapshot(index);
                    showStatusToast(snapshot.name || `SNAPSHOT ${index + 1}`);
                }}
                style={{
                    position: "relative", minWidth: 0, minHeight: 0, padding: sizing.switchPadding,
                    borderRadius: `${sizing.switchBorderRadius}px`,
                    border: `2px solid ${active ? colors.activeSwitchBorder : colors.switchBorder}`,
                    background: active ? colors.activeSwitchBackground : colors.switchBackground,
                    color: active ? colors.activeSwitchValueText : colors.switchValueText,
                    display: "flex", flexDirection: "column", justifyContent: snapshot ? "space-between" : "center",
                    font: "inherit", overflow: "hidden", touchAction: "none"
                }}>
                <span style={{ color: active ? colors.activeSwitchLabelText : colors.switchLabelText, fontSize: sizing.switchLabelFontSize, fontWeight: 900 }}>SNAPSHOT {index + 1}</span>
                <MarqueeText
                    text={snapshot ? snapshot.name || `Snapshot ${index + 1}` : "EMPTY"}
                    color={active ? colors.activeSwitchValueText : colors.switchValueText}
                    fontSize={snapshot ? sizing.switchValueFontSize : "1.2rem"}
                    fontWeight="bold"
                    marginTop={sizing.switchValueMarginTop}
                    delaySeconds={sizing.marqueeDelaySeconds}
                    pixelsPerSecond={sizing.marqueePixelsPerSecond}
                    endPauseSeconds={sizing.marqueeEndPauseSeconds}
                    centered={!snapshot}
                />
            </button>
        );
    };

    const bankHeaderContent = (
        <>
            <div style={{
                fontSize: useFreeformPerformanceLayout
                    ? "clamp(.45rem, min(6cqw, 12cqh), 1rem)"
                    : sizing.bankTitleFontSize,
                lineHeight: 1.05,
                color: colors.bankTitleText,
                fontWeight: "bold",
                textTransform: "uppercase",
                letterSpacing: useFreeformPerformanceLayout
                    ? "clamp(.2px, .45cqw, 2px)"
                    : 2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
            }}>
                Current Bank
            </div>
            <div style={{
                position: "relative",
                margin: useFreeformPerformanceLayout ? "1px 0 0" : "4px 0",
                width: "100%",
                minWidth: 0
            }}>
                <button
                    type="button"
                    onClick={() =>
                        bankMenuOpen
                            ? setBankMenuOpen(false)
                            : openBankMenu()
                    }
                    style={{
                        width: "100%",
                        minWidth: 0,
                        padding: useFreeformPerformanceLayout
                            ? "1px clamp(3px, 2cqw, 10px)"
                            : "2px 34px",
                        background: "transparent",
                        border: "none",
                        color: colors.bankNameText,
                        font: "inherit",
                        fontSize: useFreeformPerformanceLayout
                            ? "clamp(.5rem, min(8cqw, 18cqh), 1.35rem)"
                            : sizing.bankNameFontSize,
                        lineHeight: 1.05,
                        fontWeight: 900,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis"
                    }}
                >
                    {banks.getSelectedEntryName() || "No Bank"} ▾
                </button>
                {bankMenuOpen && (
                    <div style={dropdownPanelStyle}>
                        {banks.entries.map((bank, index) => (
                            <button
                                key={bank.instanceId}
                                ref={(element) => {
                                    menuItemRefs.current[index] = element;
                                }}
                                type="button"
                                onMouseEnter={() => setMenuIndex(index)}
                                onClick={() => selectBank(bank.instanceId)}
                                style={dropdownItemStyle(
                                    bank.instanceId === banks.selectedBank,
                                    index === menuIndex
                                )}
                            >
                                {bank.name}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </>
    );

    const activePresetHeaderContent = (
        <div style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: useFreeformPerformanceLayout
                ? "clamp(1px, 1cqw, 5px)"
                : 0,
            fontSize: useFreeformPerformanceLayout
                ? "clamp(.45rem, min(5.5cqw, 15cqh), 1rem)"
                : sizing.activePresetLabelFontSize,
            lineHeight: 1.05,
            color: colors.activePresetLabelText,
            whiteSpace: "nowrap",
            width: "100%",
            minWidth: 0,
            overflow: presetMenuOpen ? "visible" : "hidden"
        }}>
            <span style={{
                flex: "0 1 auto",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis"
            }}>
                Active Preset:
            </span>
            <button
                type="button"
                onClick={() =>
                    presetMenuOpen
                        ? setPresetMenuOpen(false)
                        : openPresetMenu()
                }
                style={{
                    padding: useFreeformPerformanceLayout
                        ? "1px clamp(2px, 1.5cqw, 8px)"
                        : "2px 8px",
                    background: "transparent",
                    border: "none",
                    color: colors.activePresetNameText,
                    font: "inherit",
                    fontWeight: "bold",
                    fontSize: useFreeformPerformanceLayout
                        ? "clamp(.5rem, min(7cqw, 20cqh), 1.25rem)"
                        : sizing.activePresetNameFontSize,
                    lineHeight: 1.05,
                    flex: "1 1 auto",
                    minWidth: 0,
                    maxWidth: useFreeformPerformanceLayout ? "none" : "75%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                }}
            >
                {currentPreset?.name || "No Preset"} ▾
            </button>
            {presetMenuOpen && (
                <div style={dropdownPanelStyle}>
                    {presets.presets.map((preset, index) => (
                        <button
                            key={preset.instanceId}
                            ref={(element) => {
                                menuItemRefs.current[index] = element;
                            }}
                            type="button"
                            onMouseEnter={() => setMenuIndex(index)}
                            onClick={() => selectPreset(preset)}
                            style={dropdownItemStyle(
                                preset.instanceId === presets.selectedInstanceId,
                                index === menuIndex
                            )}
                        >
                            {preset.name}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );

    const formatTemperature = (value: number): string =>
        value <= -40000
            ? "N/A"
            : `${(value / 1000).toFixed(1)}°C`;

    const formatCpuFrequency = (
        min: number,
        max: number
    ): string => {
        const format = (value: number): string => {
            if (value >= 100000000) {
                return `${(value / 1000000).toFixed(1)} GHz`;
            }
            if (value >= 1000000) {
                return `${(value / 1000000).toFixed(3)} GHz`;
            }
            if (value >= 1000) {
                return `${(value / 1000).toFixed(1)} MHz`;
            }
            return `${value} KHz`;
        };

        if (min <= 0 && max <= 0) return "N/A";
        if (min <= 0 || min === max) return format(max);
        return `${format(min)} – ${format(max)}`;
    };

    const formatLastXrun = (milliseconds: number): string => {
        if (milliseconds < 0) return "N/A";
        if (milliseconds < 1000) return "just now";
        const seconds = Math.floor(milliseconds / 1000);
        if (seconds < 60) return `${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        return `${Math.floor(minutes / 60)}h ago`;
    };

    const audioStatusText = (): string => {
        if (!jackStatus) return "N/A";
        if (jackStatus.restarting) return "RESTARTING";
        if (jackStatus.active) return "RUNNING";
        return jackStatus.errorMessage || "AUDIO STOPPED";
    };

    const elementValue = (
        id: ControllerLayoutElementId
    ): React.ReactNode => {
        switch (id) {
            case "cpuUsage":
                return jackStatus
                    ? `${jackStatus.cpuUsage.toFixed(1)}%`
                    : "N/A";
            case "xruns":
                return jackStatus
                    ? String(jackStatus.underruns)
                    : "N/A";
            case "lastXrun":
                return jackStatus
                    ? formatLastXrun(
                        jackStatus.msSinceLastUnderrun
                    )
                    : "N/A";
            case "temperature":
                return jackStatus
                    ? formatTemperature(
                        jackStatus.temperaturemC
                    )
                    : "N/A";
            case "cpuFrequency":
                return jackStatus
                    ? formatCpuFrequency(
                        jackStatus.cpuFreqMin,
                        jackStatus.cpuFreqMax
                    )
                    : "N/A";
            case "cpuGovernor":
                return jackStatus?.governor || "N/A";
            case "audioStatus":
                return audioStatusText();
            case "chainBypassStatus":
                return chainBypassed ? "BYPASSED" : "ACTIVE";
            case "snapshotModeStatus":
                return snapshotMode ? "ON" : "OFF";
            case "systemStatus":
                return (
                    <div style={{
                        display: "grid",
                        gridTemplateColumns: "auto auto",
                        gap: "2px 10px",
                        fontSize: "clamp(.52rem,1.1vw,.78rem)",
                        lineHeight: 1.15
                    }}>
                        <span>CPU</span>
                        <strong>
                            {jackStatus
                                ? `${jackStatus.cpuUsage.toFixed(1)}%`
                                : "N/A"}
                        </strong>
                        <span>XRuns</span>
                        <strong>
                            {jackStatus
                                ? jackStatus.underruns
                                : "N/A"}
                        </strong>
                        <span>Temp</span>
                        <strong>
                            {jackStatus
                                ? formatTemperature(
                                    jackStatus.temperaturemC
                                )
                                : "N/A"}
                        </strong>
                        <span>Audio</span>
                        <strong>{audioStatusText()}</strong>
                    </div>
                );
            default:
                return null;
        }
    };

    const elementFrameStyle = (
        element: ControllerLayoutElement,
        menuOpen = false
    ): React.CSSProperties => ({
        position: "absolute",
        left: `${element.rect.x * 100}%`,
        top: `${element.rect.y * 100}%`,
        width: `${element.rect.width * 100}%`,
        height: `${element.rect.height * 100}%`,
        boxSizing: "border-box",
        zIndex: menuOpen ? 40 : 20,
        overflow: menuOpen ? "visible" : "hidden",
        containerType: "size",
        color: colors.pageText,
        textAlign: "center",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 0,
        minHeight: 0
    });

    const renderElementShape = (
        element: ControllerLayoutElement
    ): React.ReactNode => {
        if (element.style === "minimal") {
            return null;
        }

        if (
            element.shape === "hexagon"
            || element.shape === "triangle"
        ) {
            const points =
                element.shape === "hexagon"
                    ? "25,2 75,2 98,50 75,98 25,98 2,50"
                    : "50,2 98,98 2,98";

            return (
                <svg
                    aria-hidden="true"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        overflow: "visible",
                        pointerEvents: "none"
                    }}
                >
                    <polygon
                        points={points}
                        fill={colors.switchBackground}
                        stroke={colors.switchBorder}
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                        strokeLinejoin="round"
                    />
                </svg>
            );
        }

        return (
            <div
                aria-hidden="true"
                style={{
                    position: "absolute",
                    inset: 0,
                    pointerEvents: "none",
                    background:
                        colors.switchBackground,
                    border:
                        `2px solid ${colors.switchBorder}`,
                    boxSizing: "border-box",
                    borderRadius:
                        element.shape === "circle"
                            ? "50%"
                            : element.shape === "rounded"
                                ? `${sizing.switchBorderRadius}px`
                                : element.shape === "rectangle"
                                    ? 2
                                    : 0
                }}
            />
        );
    };

    const statusElementContent = (
        element: ControllerLayoutElement
    ): React.ReactNode => (
        <div style={{
            position: "relative",
            zIndex: 1,
            width: "100%",
            minWidth: 0,
            padding:
                element.style === "minimal"
                    ? 2
                    : element.style === "compact"
                        ? 5
                        : 8,
            boxSizing: "border-box",
            overflow: "hidden"
        }}>
            {element.showLabel && (
                <div style={{
                    color: colors.switchLabelText,
                    fontSize:
                        element.style === "minimal"
                            ? "clamp(.48rem,1vw,.68rem)"
                            : "clamp(.52rem,1.15vw,.76rem)",
                    fontWeight: 800,
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis"
                }}>
                    {CONTROLLER_LAYOUT_ELEMENT_LABELS[
                        element.id
                    ]}
                </div>
            )}
            <div style={{
                marginTop: element.showLabel ? 2 : 0,
                color:
                    element.id === "audioStatus"
                    && jackStatus
                    && !jackStatus.active
                        ? "#ef4444"
                        : element.id === "xruns"
                        && jackStatus
                        && jackStatus.msSinceLastUnderrun < 15000
                            ? "#ef4444"
                            : colors.switchValueText,
                fontSize:
                    element.style === "minimal"
                        ? "clamp(.62rem,1.4vw,.95rem)"
                        : "clamp(.72rem,1.8vw,1.20rem)",
                fontWeight: 900,
                lineHeight: 1.05
            }}>
                {elementValue(element.id)}
            </div>
        </div>
    );


    return (
        <div style={{
            padding: `${controllerConfig.outerPadding}px`,
            color: colors.pageText,
            background: colors.pageBackground,
            height: "100%",
            position: "relative",
            fontFamily: "sans-serif",
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
            overflow: "hidden",
            userSelect: "none"
        }}>
            {configError && (
                <div style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 8, background: colors.configErrorBackground, border: `1px solid ${colors.configErrorBorder}`, color: colors.configErrorText }}>
                    {configError}
                </div>
            )}

            {useFreeformPerformanceLayout ? (
                <>
                    {CONTROLLER_LAYOUT_ELEMENT_IDS
                        .filter(
                            (id) =>
                                performanceElements[id].visible
                        )
                        .map((id) => {
                            const element =
                                performanceElements[id];
                            const menuOpen =
                                id === "currentBank"
                                    ? bankMenuOpen
                                    : id === "activePreset"
                                        ? presetMenuOpen
                                        : false;

                            let content: React.ReactNode;
                            if (id === "currentBank") {
                                content = (
                                    <div style={{
                                        width: "100%",
                                        minWidth: 0,
                                        position: "relative",
                                        zIndex: 1
                                    }}>
                                        {bankHeaderContent}
                                    </div>
                                );
                            } else if (id === "activePreset") {
                                content = (
                                    <div style={{
                                        position: "relative",
                                        zIndex: 1,
                                        width: "100%"
                                    }}>
                                        {activePresetHeaderContent}
                                    </div>
                                );
                            } else {
                                content =
                                    statusElementContent(element);
                            }

                            return (
                                <div
                                    key={id}
                                    style={elementFrameStyle(
                                        element,
                                        menuOpen
                                    )}
                                >
                                    {renderElementShape(
                                        element
                                    )}
                                    {content}
                                </div>
                            );
                        })}
                </>
            ) : (
                <div style={{
                    position: "relative",
                    boxSizing: "border-box",
                    background: colors.headerBackground,
                    padding: controllerConfig.headerPadding,
                    borderRadius: `${sizing.switchBorderRadius}px`,
                    border: `1px solid ${colors.headerBorder}`,
                    textAlign: "center",
                    boxShadow: colors.headerShadow,
                    flex: "0 0 auto"
                }}>
                    {bankHeaderContent}


                    <div style={{
                        borderTop: `1px solid ${colors.headerDivider}`,
                        paddingTop: 8,
                        marginTop: 6
                    }}>
                        {activePresetHeaderContent}
                    </div>
                </div>
            )}

            {presetAssignPickerOpen && presetAssignTargetIndex !== null && (
                <div style={{ position: "absolute", inset: 0, zIndex: 520, background: "rgba(0,0,0,.78)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => { setPresetAssignPickerOpen(false); setPresetAssignTargetIndex(null); }}>
                    <div style={{ width: "min(680px,94vw)", maxHeight: "84vh", overflowY: "auto", padding: 18, borderRadius: 12, border: `3px solid ${colors.bankSwitchBorder}`, background: colors.headerBackground }} onClick={(event) => event.stopPropagation()}>
                        <div style={{ color: colors.bankTitleText, fontWeight: 900, marginBottom: 10 }}>ASSIGN PRESET TO SWITCH</div>
                        {presets.presets.map((preset) => <button key={preset.instanceId} type="button" onClick={() => assignPresetIdToSlot(preset.instanceId, presetAssignTargetIndex)} style={{ ...dropdownItemStyle(preset.instanceId === presets.selectedInstanceId, false), margin: "5px 0" }}>{preset.name}</button>)}
                        <button type="button" onClick={() => { setPresetAssignPickerOpen(false); setPresetAssignTargetIndex(null); }} style={{ ...dropdownItemStyle(false, false), marginTop: 10 }}>CANCEL</button>
                    </div>
                </div>
            )}

            {snapshotOptionsOpen && snapshotOptionsIndex !== null && (
                <div
                    style={{ position: "absolute", inset: 0, zIndex: 545, background: "rgba(0,0,0,.78)", display: "flex", alignItems: "center", justifyContent: "center" }}
                    onClick={(event) => {
                        if (!snapshotOptionsBackdropArmedRef.current) {
                            event.preventDefault();
                            event.stopPropagation();
                            return;
                        }
                        snapshotOptionsOpenedByLongPressRef.current = false;
                        setSnapshotOptionsOpen(false);
                        setSnapshotRenameOpen(false);
                    }}
                >
                    <div style={{ width: "min(620px,92vw)", padding: 18, borderRadius: 12, border: `3px solid ${colors.bankSwitchBorder}`, background: colors.headerBackground }} onClick={(event) => event.stopPropagation()}>
                        <div style={{ color: colors.bankTitleText, fontWeight: 900 }}>SNAPSHOT {snapshotOptionsIndex + 1}</div>
                        {snapshotRenameOpen && <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
                            <input autoFocus value={snapshotRenameValue} onChange={(event) => setSnapshotRenameValue(event.target.value)} style={{ flex: 1, minHeight: 48, background: colors.switchBackground, color: colors.pageText, border: `2px solid ${colors.activeSwitchBorder}`, borderRadius: 8, padding: "6px 10px" }} />
                            <button type="button" onClick={savePerformanceSnapshotRename}>SAVE</button>
                        </div>}
                        {snapshotPedalboard.snapshots[snapshotOptionsIndex] ? <>
                            <button type="button" onClick={() => { model.selectSnapshot(snapshotOptionsIndex); setSnapshotOptionsOpen(false); }} style={dropdownItemStyle(true, false)}>RECALL SNAPSHOT</button>
                            <button type="button" onClick={() => openSnapshotEditor(snapshotOptionsIndex)} style={dropdownItemStyle(false, false)}>EDIT SNAPSHOT</button>
                            <button type="button" onClick={() => setSnapshotRenameOpen(true)} style={dropdownItemStyle(false, false)}>RENAME</button>
                            <button type="button" onClick={() => deletePerformanceSnapshot(snapshotOptionsIndex)} style={{ ...dropdownItemStyle(false, false), color: colors.configErrorText }}>DELETE SNAPSHOT</button>
                        </> : <button type="button" onClick={() => openSnapshotEditor(snapshotOptionsIndex)} style={dropdownItemStyle(true, false)}>EDIT NEW SNAPSHOT</button>}
                        <button type="button" onClick={() => setSnapshotOptionsOpen(false)} style={dropdownItemStyle(false, false)}>CANCEL</button>
                    </div>
                </div>
            )}

            {presetOptionsOpen && (
                <div style={{ position: "absolute", inset: 0, zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.72)" }} onClick={closePresetOptions}>
                    <div style={{ width: "min(620px,92vw)", maxHeight: "82vh", overflowY: "auto", padding: 18, borderRadius: 12, border: `3px solid ${colors.bankSwitchBorder}`, background: colors.headerBackground }} onClick={(event) => event.stopPropagation()}>
                        <div style={{ color: colors.bankTitleText, fontWeight: 900, marginBottom: 10 }}>PRESET SWITCH {selectedPresetSlot + 1}</div>
                        {selectedSlotPreset && <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                            <input value={presetRenameValue} onChange={(event) => setPresetRenameValue(event.target.value)} style={{ flex: 1, minHeight: 48, background: colors.switchBackground, color: colors.pageText, border: `2px solid ${colors.activeSwitchBorder}`, borderRadius: 8, padding: "6px 10px" }} />
                            <button type="button" onClick={() => void renameSelectedSlotPreset()}>RENAME</button>
                        </div>}
                        {getPresetOptions().map((option, index) => <button key={option} type="button" onMouseEnter={() => setPresetOptionIndex(index)} onClick={() => runPresetOption(index)} style={dropdownItemStyle(false, index === presetOptionIndex)}>{option}</button>)}
                    </div>
                </div>
            )}

            {presetDeleteConfirmOpen && selectedSlotPreset && (
                <div style={{ position: "absolute", inset: 0, zIndex: 560, background: "rgba(0,0,0,.82)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ width: "min(560px,92vw)", padding: 20, borderRadius: 12, border: `3px solid ${colors.configErrorBorder}`, background: colors.headerBackground }}>
                        <div style={{ color: colors.configErrorText, fontWeight: 900, fontSize: "1.1rem" }}>DELETE PRESET?</div>
                        <div style={{ margin: "12px 0", fontWeight: 900 }}>{selectedSlotPreset.name}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <button type="button" onClick={() => setPresetDeleteConfirmOpen(false)}>CANCEL</button>
                            <button type="button" onClick={() => void deleteSelectedSlotPreset()} style={{ color: colors.configErrorText }}>DELETE PRESET</button>
                        </div>
                    </div>
                </div>
            )}

            {statusToast && createPortal(
                <div role="status" style={{ position: "fixed", left: "50%", top: 8, transform: "translateX(-50%)", zIndex: 2147483647, padding: "8px 14px", borderRadius: 10, border: `1px solid ${colors.activeSwitchBorder}`, background: colors.headerBackground, color: colors.activePresetNameText, fontWeight: 900 }}>{statusToast}</div>,
                document.body
            )}

            {presetDrag && createPortal(
                <div
                    aria-hidden="true"
                    style={{
                        position: "fixed",
                        left: presetDrag.x - presetDrag.offsetX,
                        top: presetDrag.y - presetDrag.offsetY,
                        width: presetDrag.width,
                        height: presetDrag.height,
                        zIndex: 50010,
                        boxSizing: "border-box",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        alignItems: "center",
                        padding: sizing.switchPadding,
                        borderRadius: `${sizing.switchBorderRadius}px`,
                        border: `2px solid ${colors.activeSwitchBorder}`,
                        background: colors.switchBackground,
                        color: colors.activePresetNameText,
                        boxShadow: "0 14px 34px rgba(0,0,0,.62)",
                        opacity: 0.82,
                        transform: "scale(1.03) rotate(0.6deg)",
                        transformOrigin: `${presetDrag.offsetX}px ${presetDrag.offsetY}px`,
                        pointerEvents: "none",
                        userSelect: "none",
                        WebkitUserSelect: "none",
                        overflow: "hidden"
                    }}
                >
                    <div
                        style={{
                            width: "100%",
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                            textAlign: "center",
                            fontWeight: 950,
                            fontSize: sizing.switchValueFontSize
                        }}
                    >
                        {presetDrag.name}
                    </div>
                    <div
                        style={{
                            marginTop: 5,
                            color: colors.switchLabelText,
                            fontSize: "0.62rem",
                            fontWeight: 900,
                            letterSpacing: "0.08em"
                        }}
                    >
                        MOVE PRESET
                    </div>
                </div>,
                document.body
            )}

            {presetDrag && <div data-mfx-performance-trash="true" style={{ position: "fixed", right: 12, top: 12, zIndex: 50020, width: 72, height: 58, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12, border: `2px solid ${presetDragOverTrash ? colors.configErrorBorder : colors.bankSwitchBorder}`, background: presetDragOverTrash ? "#7f1d1d" : colors.bankSwitchBackground, pointerEvents: "none" }}>🗑</div>}

            <div style={useFreeformPerformanceLayout
                ? { position: "absolute", inset: 0, display: "block", marginTop: 0, minHeight: 0, zIndex: 10, pointerEvents: "none" }
                : {
                    display: "grid",
                    gridTemplateColumns: snapshotMode ? "repeat(3,minmax(0,1fr))" : `repeat(${performanceGridColumns},minmax(0,1fr))`,
                    gridTemplateRows: snapshotMode ? "repeat(2,minmax(0,1fr))" : `repeat(${performanceGridRows},minmax(0,1fr))`,
                    gap: `${controllerConfig.gap}px`,
                    marginTop: `${sizing.gridTopMargin}px`,
                    flex: "1 1 auto",
                    minHeight: 0
                }}>
                {snapshotMode
                    ? Array.from({ length: Snapshot.MAX_SNAPSHOTS }, (_, index) => renderSnapshotTile(index))
                    : displaySwitchConfigs.map(renderSwitch)}
            </div>
        </div>
    );
}
