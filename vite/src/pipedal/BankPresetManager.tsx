import { useEffect, useMemo, useRef, useState } from "react";
import { BankIndex } from "./Banks";
import {
    PiPedalModelFactory,
    PresetIndex,
    PresetIndexEntry
} from "./PiPedalModel";
import { MFX_COLORS } from "./MultiFXTheme";

type PresetAssignmentTarget = {
    bankId: number;
    presetIndex: number;
    label: string;
};

type BankPresetManagerProps = {
    onClose: () => void;
    assignTarget?: PresetAssignmentTarget;
};

type EditDialogState =
    | {
        mode: "newBank" | "renameBank" | "renamePreset";
        title: string;
        value: string;
    }
    | undefined;

type DragState = {
    presetId: number;
    sourceIndex: number;
    sourceBankId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    moved: boolean;
    name: string;
};

type FocusedPane = "banks" | "presets";

const DRAG_HOLD_MS = 450;
const PRESET_ROW_LONG_PRESS_MS = 600;

// Semantic colors come from the currently selected MultiFX theme.
const PANEL = MFX_COLORS.panel;
const PANEL_ALT = MFX_COLORS.panelAlt;
const BG = MFX_COLORS.background;
const PURPLE = MFX_COLORS.purple;
const PURPLE_TEXT = MFX_COLORS.purpleLight;
const PURPLE_BG = MFX_COLORS.purpleSurface;
const CYAN = MFX_COLORS.cyan;
const CYAN_BG = MFX_COLORS.cyanSurface;
const CYAN_TEXT = MFX_COLORS.cyanText;
const TEXT = MFX_COLORS.text;
const MUTED = MFX_COLORS.muted;
const BORDER = MFX_COLORS.border;
const DANGER = MFX_COLORS.danger;

export default function BankPresetManager({
    onClose,
    assignTarget
}: BankPresetManagerProps) {
    const model = PiPedalModelFactory.getInstance();

    const [banks, setBanks] = useState<BankIndex>(
        () => model.banks.get().clone()
    );

    const [presets, setPresets] = useState<PresetIndex>(
        () => model.presets.get().clone()
    );

    const [selectedBankId, setSelectedBankId] = useState<number>(
        () => model.banks.get().selectedBank
    );

    const [selectedPresetId, setSelectedPresetId] = useState<number>(
        () => model.presets.get().selectedInstanceId
    );

    const [busy, setBusy] = useState(false);
    const [editDialog, setEditDialog] = useState<EditDialogState>();
    const [confirmDeleteBank, setConfirmDeleteBank] = useState(false);
    const [confirmDeletePreset, setConfirmDeletePreset] = useState(false);
    const [dragState, setDragState] = useState<DragState | undefined>();
    const dragStateRef = useRef<DragState | undefined>(undefined);

    // Encoder focus/cursor state for the two manager panes.
    const [focusedPane, setFocusedPane] = useState<FocusedPane>("presets");
    const [bankCursorId, setBankCursorId] = useState<number>(
        () => model.banks.get().selectedBank
    );

    // Dragging is deliberately armed only by holding the handle on the
    // right side of a preset row.
    const dragHoldTimerRef = useRef<number | undefined>(undefined);
    const pendingDragRef = useRef<{
        preset: PresetIndexEntry;
        index: number;
        pointerId: number;
        startX: number;
        startY: number;
    } | undefined>(undefined);

    // Long-pressing the preset ROW opens actions. Dragging remains exclusive
    // to the three-line handle so normal scrolling cannot accidentally move
    // presets.
    const [presetActionMenuId, setPresetActionMenuId] =
        useState<number | undefined>(undefined);
    const presetRowHoldTimerRef = useRef<number | undefined>(undefined);
    const pendingPresetRowHoldRef = useRef<{
        presetId: number;
        pointerId: number;
        startX: number;
        startY: number;
    } | undefined>(undefined);
    const suppressNextPresetRowClickRef = useRef(false);

    const selectedBank = banks.getEntry(selectedBankId);
    const selectedPreset = presets.getItem(selectedPresetId);

    const currentBankIndex = useMemo(
        () => banks.entries.findIndex(
            (bank) => bank.instanceId === selectedBankId
        ),
        [banks, selectedBankId]
    );

    const selectedPresetIndex = useMemo(
        () => presets.presets.findIndex(
            (preset) => preset.instanceId === selectedPresetId
        ),
        [presets, selectedPresetId]
    );

    const showError = (error: unknown) => {
        model.showAlert(
            error instanceof Error ? error.message : String(error)
        );
    };

    useEffect(() => {
        const handleBanksChanged = () => {
            const next = model.banks.get().clone();
            setBanks(next);

            if (!next.getEntry(selectedBankId)) {
                setSelectedBankId(next.selectedBank);
            }

            if (!next.getEntry(bankCursorId)) {
                setBankCursorId(next.selectedBank);
            }
        };

        const handlePresetsChanged = () => {
            const next = model.presets.get().clone();
            setPresets(next);

            if (next.getItem(selectedPresetId) === null) {
                setSelectedPresetId(next.selectedInstanceId);
            }
        };

        model.banks.addOnChangedHandler(handleBanksChanged);
        model.presets.addOnChangedHandler(handlePresetsChanged);

        handleBanksChanged();
        handlePresetsChanged();

        return () => {
            model.banks.removeOnChangedHandler(handleBanksChanged);
            model.presets.removeOnChangedHandler(handlePresetsChanged);
        };
    }, [model, selectedBankId, selectedPresetId, bankCursorId]);

    useEffect(() => {
        dragStateRef.current = dragState;
    }, [dragState]);

    // Keep the encoder cursor visible as it moves through either list.
    useEffect(() => {
        const selector = focusedPane === "banks"
            ? `[data-mfx-bank-id="${bankCursorId}"]`
            : `[data-mfx-preset-id="${selectedPresetId}"]`;

        const element = document.querySelector(selector) as HTMLElement | null;
        element?.scrollIntoView({
            block: "nearest",
            behavior: "smooth"
        });
    }, [focusedPane, bankCursorId, selectedPresetId]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                editDialog
                || confirmDeleteBank
                || confirmDeletePreset
                || presetActionMenuId !== undefined
            ) {
                return;
            }

            if (
                event.key !== "ArrowUp"
                && event.key !== "ArrowDown"
                && event.key !== "Enter"
            ) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                const direction = event.key === "ArrowDown" ? 1 : -1;

                if (focusedPane === "banks") {
                    if (banks.entries.length === 0) {
                        return;
                    }

                    let index = banks.entries.findIndex(
                        (bank) => bank.instanceId === bankCursorId
                    );

                    if (index < 0) {
                        index = banks.entries.findIndex(
                            (bank) => bank.instanceId === selectedBankId
                        );
                    }

                    index = Math.max(
                        0,
                        Math.min(banks.entries.length - 1, index + direction)
                    );

                    setBankCursorId(banks.entries[index].instanceId);
                } else {
                    if (presets.presets.length === 0) {
                        return;
                    }

                    let index = presets.presets.findIndex(
                        (preset) => preset.instanceId === selectedPresetId
                    );

                    if (index < 0) {
                        index = 0;
                    } else {
                        index = Math.max(
                            0,
                            Math.min(
                                presets.presets.length - 1,
                                index + direction
                            )
                        );
                    }

                    setSelectedPresetId(
                        presets.presets[index].instanceId
                    );
                }

                return;
            }

            // Encoder push selects the highlighted item.
            if (event.key === "Enter" && !event.repeat) {
                if (focusedPane === "banks") {
                    void selectBank(bankCursorId);
                } else {
                    const preset = presets.getItem(selectedPresetId);
                    if (preset) {
                        model.loadPreset(preset.instanceId);
                    }
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown, true);

        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [
        focusedPane,
        banks,
        presets,
        bankCursorId,
        selectedBankId,
        selectedPresetId,
        editDialog,
        confirmDeleteBank,
        confirmDeletePreset,
        presetActionMenuId,
        model
    ]);

    useEffect(() => {
        if (!dragState) {
            return;
        }

        const onPointerMove = (event: PointerEvent) => {
            const current = dragStateRef.current;
            if (!current) {
                return;
            }

            const dx = event.clientX - current.startX;
            const dy = event.clientY - current.startY;
            const moved = current.moved || Math.hypot(dx, dy) > 8;

            const next = {
                ...current,
                x: event.clientX,
                y: event.clientY,
                moved
            };

            dragStateRef.current = next;
            setDragState(next);
        };

        const onPointerUp = (event: PointerEvent) => {
            const current = dragStateRef.current;
            dragStateRef.current = undefined;
            setDragState(undefined);

            if (!current || !current.moved) {
                return;
            }

            const target = document.elementFromPoint(
                event.clientX,
                event.clientY
            ) as HTMLElement | null;

            const bankTarget = target?.closest(
                "[data-mfx-bank-id]"
            ) as HTMLElement | null;

            if (bankTarget) {
                const targetBankId = Number(
                    bankTarget.dataset.mfxBankId
                );

                if (
                    Number.isFinite(targetBankId)
                    && targetBankId !== current.sourceBankId
                ) {
                    void movePresetToBank(
                        current.presetId,
                        targetBankId
                    );
                }
                return;
            }

            const presetTarget = target?.closest(
                "[data-mfx-preset-index]"
            ) as HTMLElement | null;

            if (presetTarget) {
                const targetIndex = Number(
                    presetTarget.dataset.mfxPresetIndex
                );

                if (
                    Number.isFinite(targetIndex)
                    && targetIndex !== current.sourceIndex
                ) {
                    void reorderPreset(
                        current.sourceIndex,
                        targetIndex
                    );
                }
            }
        };

        window.addEventListener("pointermove", onPointerMove, true);
        window.addEventListener("pointerup", onPointerUp, true);
        window.addEventListener("pointercancel", onPointerUp, true);

        return () => {
            window.removeEventListener(
                "pointermove",
                onPointerMove,
                true
            );
            window.removeEventListener(
                "pointerup",
                onPointerUp,
                true
            );
            window.removeEventListener(
                "pointercancel",
                onPointerUp,
                true
            );
        };
    }, [dragState]);

    useEffect(() => {
        return () => {
            if (dragHoldTimerRef.current !== undefined) {
                window.clearTimeout(dragHoldTimerRef.current);
            }
            if (presetRowHoldTimerRef.current !== undefined) {
                window.clearTimeout(presetRowHoldTimerRef.current);
            }
        };
    }, []);

    const selectBank = async (bankId: number) => {
        if (busy || bankId === selectedBankId) {
            return;
        }

        setBusy(true);

        try {
            await model.openBank(bankId);
            setSelectedBankId(bankId);
            setBankCursorId(bankId);

            const next = model.presets.get().clone();
            setPresets(next);
            setSelectedPresetId(next.selectedInstanceId);
        } catch (error) {
            showError(error);
        } finally {
            setBusy(false);
        }
    };

    const moveBank = async (direction: number) => {
        const from = currentBankIndex;
        const to = from + direction;

        if (
            busy
            || from < 0
            || to < 0
            || to >= banks.entries.length
        ) {
            return;
        }

        const optimistic = banks.clone();
        optimistic.moveBank(from, to);
        setBanks(optimistic);

        try {
            await model.moveBank(from, to);
        } catch (error) {
            setBanks(model.banks.get().clone());
            showError(error);
        }
    };

    const reorderPreset = async (
        from: number,
        to: number
    ) => {
        if (
            busy
            || from < 0
            || to < 0
            || from >= presets.presets.length
            || to >= presets.presets.length
        ) {
            return;
        }

        const next = presets.clone();
        next.movePreset(from, to);
        setPresets(next);

        try {
            await model.updatePresets(next);
        } catch (error) {
            setPresets(model.presets.get().clone());
            showError(error);
        }
    };

    const movePresetBy = async (direction: number) => {
        if (selectedPresetIndex < 0) {
            return;
        }

        const to = selectedPresetIndex + direction;

        if (to < 0 || to >= presets.presets.length) {
            return;
        }

        await reorderPreset(selectedPresetIndex, to);
    };

    const movePresetToBank = async (
        presetId: number,
        targetBankId: number
    ) => {
        if (
            busy
            || targetBankId === selectedBankId
        ) {
            return;
        }

        setBusy(true);

        try {
            // Copy first, delete second. If anything fails, the worst case is
            // a duplicate preset rather than lost data.
            await model.copyPresetsToBank(
                targetBankId,
                [presetId]
            );

            await model.deletePresetItems(
                new Set<number>([presetId])
            );
        } catch (error) {
            showError(error);
        } finally {
            setBusy(false);
        }
    };

    const assignPresetToTarget = async (presetId: number) => {
        if (!assignTarget || busy) {
            return;
        }

        // Quick tile assignment is intentionally limited to the bank that
        // contains the tile. Cross-bank organization remains available
        // through the manager's explicit drag-to-bank workflow.
        if (selectedBankId !== assignTarget.bankId) {
            model.showAlert(
                "Assign to Tile is only available in the target tile's bank."
            );
            return;
        }

        const sourcePreset = presets.getItem(presetId);
        if (!sourcePreset) {
            return;
        }

        setBusy(true);
        setPresetActionMenuId(undefined);

        try {
            const from = presets.presets.findIndex(
                (preset) => preset.instanceId === presetId
            );

            if (from < 0) {
                throw new Error("Preset could not be found in this bank.");
            }

            const next = presets.clone();
            const to = Math.max(
                0,
                Math.min(
                    assignTarget.presetIndex,
                    next.presets.length - 1
                )
            );

            if (from !== to) {
                next.movePreset(from, to);
                setPresets(next);
                await model.updatePresets(next);
            }

            model.loadPreset(presetId);
            onClose();
        } catch (error) {
            showError(error);
        } finally {
            setBusy(false);
        }
    };

    const submitEditDialog = async () => {
        if (!editDialog || busy) {
            return;
        }

        const name = editDialog.value.trim();

        if (!name) {
            return;
        }

        setBusy(true);

        try {
            switch (editDialog.mode) {
                case "renameBank":
                    if (!selectedBank) {
                        return;
                    }

                    if (
                        banks.entries.some(
                            (bank) =>
                                bank.instanceId !== selectedBankId
                                && bank.name === name
                        )
                    ) {
                        model.showAlert(
                            "A bank with that name already exists."
                        );
                        return;
                    }

                    await model.renameBank(
                        selectedBankId,
                        name
                    );
                    break;

                case "renamePreset":
                    if (!selectedPreset) {
                        return;
                    }

                    await model.renamePresetItem(
                        selectedPreset.instanceId,
                        name
                    );
                    break;

                case "newBank": {
                    if (!selectedBank) {
                        return;
                    }

                    if (
                        banks.entries.some(
                            (bank) => bank.name === name
                        )
                    ) {
                        model.showAlert(
                            "A bank with that name already exists."
                        );
                        return;
                    }

                    // PiPedal's client model exposes Save Bank As rather than
                    // a separate create-empty-bank call. Create the native
                    // bank as a copy, open it, then clear its copied presets.
                    const newBankId = await model.saveBankAs(
                        selectedBankId,
                        name
                    );

                    await model.openBank(newBankId);
                    setSelectedBankId(newBankId);

                    const copiedPresets =
                        model.presets.get().presets.map(
                            (preset) => preset.instanceId
                        );

                    if (copiedPresets.length > 0) {
                        await model.deletePresetItems(
                            new Set<number>(copiedPresets)
                        );
                    }

                    setSelectedPresetId(-1);
                    break;
                }
            }

            setEditDialog(undefined);
        } catch (error) {
            showError(error);
        } finally {
            setBusy(false);
        }
    };

    const deleteBank = async () => {
        if (!selectedBank || busy) {
            return;
        }

        setConfirmDeleteBank(false);
        setBusy(true);

        try {
            const newSelection =
                await model.deleteBankItem(selectedBankId);

            if (newSelection !== -1) {
                await model.openBank(newSelection);
                setSelectedBankId(newSelection);
            }
        } catch (error) {
            showError(error);
        } finally {
            setBusy(false);
        }
    };

    const deletePreset = async () => {
        if (!selectedPreset || busy) {
            return;
        }

        setConfirmDeletePreset(false);
        setBusy(true);

        try {
            const nextSelection =
                await model.deletePresetItems(
                    new Set<number>([
                        selectedPreset.instanceId
                    ])
                );

            setSelectedPresetId(nextSelection);
        } catch (error) {
            showError(error);
        } finally {
            setBusy(false);
        }
    };

    const loadPreset = () => {
        if (selectedPreset) {
            model.loadPreset(selectedPreset.instanceId);
        }
    };

    const cancelPresetRowHold = () => {
        if (presetRowHoldTimerRef.current !== undefined) {
            window.clearTimeout(presetRowHoldTimerRef.current);
            presetRowHoldTimerRef.current = undefined;
        }

        pendingPresetRowHoldRef.current = undefined;
    };

    const beginPresetRowHold = (
        event: React.PointerEvent,
        preset: PresetIndexEntry
    ) => {
        if (busy) {
            return;
        }

        setFocusedPane("presets");
        setSelectedPresetId(preset.instanceId);
        cancelPresetRowHold();

        pendingPresetRowHoldRef.current = {
            presetId: preset.instanceId,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY
        };

        presetRowHoldTimerRef.current = window.setTimeout(() => {
            const pending = pendingPresetRowHoldRef.current;
            if (!pending || pending.pointerId !== event.pointerId) {
                return;
            }

            suppressNextPresetRowClickRef.current = true;
            setPresetActionMenuId(preset.instanceId);
            presetRowHoldTimerRef.current = undefined;
            pendingPresetRowHoldRef.current = undefined;
        }, PRESET_ROW_LONG_PRESS_MS);
    };

    const handlePresetRowHoldMove = (
        event: React.PointerEvent
    ) => {
        const pending = pendingPresetRowHoldRef.current;
        if (!pending || pending.pointerId !== event.pointerId) {
            return;
        }

        const distance = Math.hypot(
            event.clientX - pending.startX,
            event.clientY - pending.startY
        );

        // Moving the finger means the user is scrolling, not long-pressing.
        if (distance > 10) {
            cancelPresetRowHold();
        }
    };

    const handlePresetRowHoldEnd = (
        event: React.PointerEvent
    ) => {
        const pending = pendingPresetRowHoldRef.current;
        if (pending && pending.pointerId === event.pointerId) {
            cancelPresetRowHold();
        }
    };

    const cancelPendingPresetDrag = () => {
        if (dragHoldTimerRef.current !== undefined) {
            window.clearTimeout(dragHoldTimerRef.current);
            dragHoldTimerRef.current = undefined;
        }

        pendingDragRef.current = undefined;
    };

    const beginPresetDragHold = (
        event: React.PointerEvent,
        preset: PresetIndexEntry,
        index: number
    ) => {
        if (busy) {
            return;
        }

        event.stopPropagation();
        setFocusedPane("presets");
        setSelectedPresetId(preset.instanceId);

        cancelPendingPresetDrag();

        const pending = {
            preset,
            index,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY
        };

        pendingDragRef.current = pending;

        dragHoldTimerRef.current = window.setTimeout(() => {
            const current = pendingDragRef.current;
            if (
                !current
                || current.pointerId !== pending.pointerId
            ) {
                return;
            }

            const next: DragState = {
                presetId: preset.instanceId,
                sourceIndex: index,
                sourceBankId: selectedBankId,
                startX: pending.startX,
                startY: pending.startY,
                x: pending.startX,
                y: pending.startY,
                moved: true,
                name: preset.name
            };

            dragStateRef.current = next;
            setDragState(next);
            dragHoldTimerRef.current = undefined;
            pendingDragRef.current = undefined;
        }, DRAG_HOLD_MS);
    };

    const handlePresetDragHandleMove = (
        event: React.PointerEvent
    ) => {
        const pending = pendingDragRef.current;
        if (!pending || pending.pointerId !== event.pointerId) {
            return;
        }

        // If the finger moves before the hold has completed, cancel the
        // pickup. This prevents accidental reordering while touching.
        const distance = Math.hypot(
            event.clientX - pending.startX,
            event.clientY - pending.startY
        );

        if (distance > 10) {
            cancelPendingPresetDrag();
        }
    };

    const handlePresetDragHandleEnd = (
        event: React.PointerEvent
    ) => {
        const pending = pendingDragRef.current;
        if (pending && pending.pointerId === event.pointerId) {
            cancelPendingPresetDrag();
        }
    };

    const buttonStyle = (
        kind: "normal" | "accent" | "danger" = "normal"
    ): React.CSSProperties => ({
        minHeight: "calc(42px * var(--mfx-ui-scale, 1))",
        padding: "8px 12px",
        borderRadius: 9,
        border: `1px solid ${
            kind === "accent"
                ? PURPLE
                : kind === "danger"
                    ? DANGER
                    : BORDER
        }`,
        background:
            kind === "accent"
                ? PURPLE_BG
                : kind === "danger"
                    ? `color-mix(in srgb, ${DANGER} 18%, ${PANEL})`
                    : PANEL_ALT,
        color:
            kind === "accent"
                ? PURPLE_TEXT
                : kind === "danger"
                    ? DANGER
                    : TEXT,
        font: "inherit",
        fontWeight: 800,
        cursor: "pointer",
        opacity: busy ? 0.6 : 1
    });

    return (
        <div
            style={{
                position: "absolute",
                inset: 0,
                zIndex: 900,
                display: "flex",
                flexDirection: "column",
                background: BG,
                color: TEXT,
                userSelect: "none",
                touchAction: "manipulation"
            }}
        >
            <div
                style={{
                    minHeight: "calc(60px * var(--mfx-ui-scale, 1))",
                    display: "flex",
                    alignItems: "center",
                    gap: "calc(12px * var(--mfx-ui-scale, 1))",
                    padding: "calc(8px * var(--mfx-ui-scale, 1)) calc(14px * var(--mfx-ui-scale, 1)) calc(8px * var(--mfx-ui-scale, 1)) calc(82px * var(--mfx-ui-scale, 1))",
                    borderBottom: `1px solid ${BORDER}`,
                    background: PANEL
                }}
            >
                <div
                    style={{
                        flex: "1 1 auto",
                        fontWeight: 900,
                        fontSize: "1.25rem",
                        letterSpacing: "0.05em"
                    }}
                >
                    BANK / PRESET MANAGER
                </div>

                {busy && (
                    <div
                        style={{
                            color: MUTED,
                            fontSize: "0.9rem"
                        }}
                    >
                        Updating…
                    </div>
                )}

                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Back"
                    title="Back"
                    style={{
                        ...buttonStyle("accent"),
                        minWidth: "calc(48px * var(--mfx-ui-scale, 1))",
                        width: "calc(48px * var(--mfx-ui-scale, 1))",
                        padding: 0,
                        fontSize: "1.55rem",
                        lineHeight: 1
                    }}
                >
                    ←
                </button>
            </div>

            {assignTarget && (
                <div
                    style={{
                        minHeight: "calc(38px * var(--mfx-ui-scale, 1))",
                        display: "flex",
                        alignItems: "center",
                        padding: "6px 14px",
                        borderBottom: `1px solid ${PURPLE}`,
                        background: PURPLE_BG,
                        color: PURPLE_TEXT,
                        fontWeight: 900
                    }}
                >
                    ASSIGNMENT TARGET: {assignTarget.label}
                    &nbsp;— long-press a preset row to assign it.
                </div>
            )}

            <div
                style={{
                    flex: "1 1 auto",
                    minHeight: 0,
                    display: "grid",
                    gridTemplateColumns: "34% 66%"
                }}
            >
                <section
                    onPointerDown={() => setFocusedPane("banks")}
                    style={{
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        borderRight: focusedPane === "banks"
                            ? `3px solid ${PURPLE}`
                            : `1px solid ${BORDER}`,
                        boxShadow: focusedPane === "banks"
                            ? `inset 0 0 0 1px color-mix(in srgb, ${PURPLE} 38%, transparent)`
                            : "none",
                        background: PANEL_ALT
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "calc(6px * var(--mfx-ui-scale, 1))",
                            padding: "calc(8px * var(--mfx-ui-scale, 1))",
                            borderBottom: `1px solid ${BORDER}`
                        }}
                    >
                        <button
                            type="button"
                            style={buttonStyle("accent")}
                            onClick={() =>
                                setEditDialog({
                                    mode: "newBank",
                                    title: "New Bank",
                                    value: "New Bank"
                                })
                            }
                        >
                            + NEW
                        </button>

                        <button
                            type="button"
                            style={buttonStyle()}
                            disabled={!selectedBank}
                            onClick={() =>
                                selectedBank
                                && setEditDialog({
                                    mode: "renameBank",
                                    title: "Rename Bank",
                                    value: selectedBank.name
                                })
                            }
                        >
                            RENAME
                        </button>

                        <button
                            type="button"
                            style={buttonStyle("danger")}
                            disabled={!selectedBank}
                            onClick={() =>
                                setConfirmDeleteBank(true)
                            }
                        >
                            DELETE
                        </button>

                        <button
                            type="button"
                            style={buttonStyle()}
                            onClick={() => void moveBank(-1)}
                            disabled={currentBankIndex <= 0}
                        >
                            ▲
                        </button>

                        <button
                            type="button"
                            style={buttonStyle()}
                            onClick={() => void moveBank(1)}
                            disabled={
                                currentBankIndex < 0
                                || currentBankIndex
                                    >= banks.entries.length - 1
                            }
                        >
                            ▼
                        </button>
                    </div>

                    <div
                        style={{
                            flex: "1 1 auto",
                            overflowY: "auto",
                            padding: "calc(8px * var(--mfx-ui-scale, 1))",
                            touchAction: "pan-y"
                        }}
                    >
                        {banks.entries.map((bank) => {
                            const selected =
                                bank.instanceId === selectedBankId;
                            const cursor =
                                bank.instanceId === bankCursorId;

                            return (
                                <button
                                    key={bank.instanceId}
                                    type="button"
                                    data-mfx-bank-id={
                                        bank.instanceId
                                    }
                                    onClick={() => {
                                        setFocusedPane("banks");
                                        setBankCursorId(bank.instanceId);
                                        void selectBank(bank.instanceId);
                                    }}
                                    style={{
                                        display: "block",
                                        width: "100%",
                                        minHeight: "calc(50px * var(--mfx-ui-scale, 1))",
                                        marginBottom: 5,
                                        padding: "8px 10px",
                                        textAlign: "left",
                                        borderRadius: 9,
                                        border: cursor
                                            ? `2px solid ${PURPLE}`
                                            : selected
                                                ? `2px solid ${CYAN}`
                                                : `1px solid ${BORDER}`,
                                        background: selected
                                            ? CYAN_BG
                                            : cursor
                                                ? PURPLE_BG
                                                : PANEL,
                                        color: selected
                                            ? CYAN_TEXT
                                            : cursor
                                                ? PURPLE_TEXT
                                                : TEXT,
                                        font: "inherit",
                                        fontWeight: 800
                                    }}
                                >
                                    {bank.name}
                                </button>
                            );
                        })}
                    </div>

                    <div
                        style={{
                            padding: "7px 10px",
                            borderTop: `1px solid ${BORDER}`,
                            color: MUTED,
                            fontSize: "0.78rem"
                        }}
                    >
                        Drag a preset onto a bank to move it.
                    </div>
                </section>

                <section
                    onPointerDown={() => setFocusedPane("presets")}
                    style={{
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        background: BG,
                        boxShadow: focusedPane === "presets"
                            ? `inset 3px 0 0 ${PURPLE}`
                            : "none"
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "calc(6px * var(--mfx-ui-scale, 1))",
                            padding: "calc(8px * var(--mfx-ui-scale, 1))",
                            borderBottom: `1px solid ${BORDER}`
                        }}
                    >
                        <button
                            type="button"
                            style={buttonStyle("accent")}
                            disabled={!selectedPreset}
                            onClick={loadPreset}
                        >
                            LOAD
                        </button>

                        <button
                            type="button"
                            style={buttonStyle()}
                            disabled={!selectedPreset}
                            onClick={() =>
                                selectedPreset
                                && setEditDialog({
                                    mode: "renamePreset",
                                    title: "Rename Preset",
                                    value: selectedPreset.name
                                })
                            }
                        >
                            RENAME
                        </button>

                        <button
                            type="button"
                            style={buttonStyle("danger")}
                            disabled={!selectedPreset}
                            onClick={() =>
                                setConfirmDeletePreset(true)
                            }
                        >
                            DELETE
                        </button>

                        <button
                            type="button"
                            style={buttonStyle()}
                            disabled={selectedPresetIndex <= 0}
                            onClick={() =>
                                void movePresetBy(-1)
                            }
                        >
                            ▲ MOVE
                        </button>

                        <button
                            type="button"
                            style={buttonStyle()}
                            disabled={
                                selectedPresetIndex < 0
                                || selectedPresetIndex
                                    >= presets.presets.length - 1
                            }
                            onClick={() =>
                                void movePresetBy(1)
                            }
                        >
                            ▼ MOVE
                        </button>
                    </div>

                    <div
                        style={{
                            padding: "8px 12px",
                            borderBottom: `1px solid ${BORDER}`,
                            color: MUTED,
                            fontSize: "0.88rem"
                        }}
                    >
                        {selectedBank?.name ?? "No Bank"}
                        {" • "}
                        {presets.presets.length} preset
                        {presets.presets.length === 1 ? "" : "s"}
                        {assignTarget
                            && selectedBankId !== assignTarget.bankId
                            ? " • Browse only — return to the target bank to assign"
                            : ""}
                    </div>

                    <div
                        style={{
                            flex: "1 1 auto",
                            minHeight: 0,
                            overflowY: "auto",
                            padding: "calc(8px * var(--mfx-ui-scale, 1))",
                            touchAction: "pan-y"
                        }}
                    >
                        {presets.presets.map(
                            (preset, index) => {
                                const selected =
                                    preset.instanceId
                                    === selectedPresetId;
                                const active =
                                    preset.instanceId
                                    === presets.selectedInstanceId;

                                return (
                                    <div
                                        key={preset.instanceId}
                                        data-mfx-preset-index={index}
                                        data-mfx-preset-id={preset.instanceId}
                                        onPointerDown={(event) => {
                                            beginPresetRowHold(
                                                event,
                                                preset
                                            );
                                        }}
                                        onPointerMove={
                                            handlePresetRowHoldMove
                                        }
                                        onPointerUp={
                                            handlePresetRowHoldEnd
                                        }
                                        onPointerCancel={
                                            handlePresetRowHoldEnd
                                        }
                                        onClick={() => {
                                            if (
                                                suppressNextPresetRowClickRef.current
                                            ) {
                                                suppressNextPresetRowClickRef.current = false;
                                                return;
                                            }

                                            setFocusedPane("presets");
                                            setSelectedPresetId(
                                                preset.instanceId
                                            );
                                        }}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "calc(10px * var(--mfx-ui-scale, 1))",
                                            minHeight: "calc(52px * var(--mfx-ui-scale, 1))",
                                            marginBottom: 5,
                                            padding: "7px 10px",
                                            borderRadius: 9,
                                            border: active
                                                ? `2px solid ${CYAN}`
                                                : selected
                                                    ? `2px solid ${PURPLE}`
                                                    : `1px solid ${BORDER}`,
                                            background: active
                                                ? CYAN_BG
                                                : selected
                                                    ? PURPLE_BG
                                                    : PANEL,
                                            color: active
                                                ? CYAN_TEXT
                                                : selected
                                                    ? PURPLE_TEXT
                                                    : TEXT,
                                            cursor: "default",
                                            touchAction: "pan-y"
                                        }}
                                    >
                                        <div
                                            style={{
                                                width: "calc(42px * var(--mfx-ui-scale, 1))",
                                                flex: "0 0 42px",
                                                textAlign: "center",
                                                color: MUTED,
                                                fontWeight: 900
                                            }}
                                        >
                                            {index + 1}
                                        </div>

                                        <div
                                            style={{
                                                flex: "1 1 auto",
                                                minWidth: 0,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap",
                                                fontWeight: 800
                                            }}
                                        >
                                            {preset.name}
                                        </div>

                                        {active && (
                                            <div
                                                style={{
                                                    color: CYAN,
                                                    fontSize: "0.75rem",
                                                    fontWeight: 900
                                                }}
                                            >
                                                ACTIVE
                                            </div>
                                        )}

                                        <div
                                            role="button"
                                            aria-label={`Hold to move ${preset.name}`}
                                            title="Hold to move preset"
                                            onPointerDown={(event) =>
                                                beginPresetDragHold(
                                                    event,
                                                    preset,
                                                    index
                                                )
                                            }
                                            onPointerMove={
                                                handlePresetDragHandleMove
                                            }
                                            onPointerUp={
                                                handlePresetDragHandleEnd
                                            }
                                            onPointerCancel={
                                                handlePresetDragHandleEnd
                                            }
                                            onClick={(event) => {
                                                event.stopPropagation();
                                            }}
                                            style={{
                                                width: "calc(48px * var(--mfx-ui-scale, 1))",
                                                minHeight: "calc(42px * var(--mfx-ui-scale, 1))",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                color: MUTED,
                                                fontSize: "1.35rem",
                                                cursor: "grab",
                                                touchAction: "none",
                                                borderRadius: 8,
                                                border: `1px solid ${BORDER}`,
                                                background: PANEL_ALT
                                            }}
                                        >
                                            ☰
                                        </div>
                                    </div>
                                );
                            }
                        )}

                        {presets.presets.length === 0 && (
                            <div
                                style={{
                                    padding: 30,
                                    textAlign: "center",
                                    color: MUTED
                                }}
                            >
                                This bank has no presets.
                            </div>
                        )}
                    </div>
                </section>
            </div>

            {dragState?.moved && (
                <div
                    style={{
                        position: "fixed",
                        left: Math.max(
                            12,
                            Math.min(
                                dragState.x - 260,
                                window.innerWidth - 332
                            )
                        ),
                        top: Math.max(
                            12,
                            Math.min(
                                dragState.y + 14,
                                window.innerHeight - 70
                            )
                        ),
                        zIndex: 1200,
                        width: "calc(240px * var(--mfx-ui-scale, 1))",
                        maxWidth: 320,
                        padding: "9px 13px",
                        borderRadius: 9,
                        border: `2px solid ${PURPLE}`,
                        background: PURPLE_BG,
                        color: PURPLE_TEXT,
                        fontWeight: 900,
                        pointerEvents: "none",
                        boxShadow: "0 12px 30px rgba(0,0,0,0.7)"
                    }}
                >
                    {dragState.name}
                </div>
            )}

            {presetActionMenuId !== undefined && (() => {
                const actionPreset = presets.getItem(presetActionMenuId);
                if (!actionPreset) {
                    return null;
                }

                return (
                    <div
                        style={overlayStyle}
                        onClick={() => setPresetActionMenuId(undefined)}
                    >
                        <div
                            style={dialogStyle}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div style={dialogTitleStyle}>
                                {actionPreset.name}
                            </div>

                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 8
                                }}
                            >
                                {assignTarget
                                    && selectedBankId === assignTarget.bankId
                                    && (
                                        <button
                                            type="button"
                                            style={buttonStyle("accent")}
                                            onClick={() =>
                                                void assignPresetToTarget(
                                                    actionPreset.instanceId
                                                )
                                            }
                                        >
                                            ASSIGN TO {assignTarget.label.toUpperCase()}
                                        </button>
                                    )}

                                <button
                                    type="button"
                                    style={buttonStyle()}
                                    onClick={() => {
                                        model.loadPreset(
                                            actionPreset.instanceId
                                        );
                                        setPresetActionMenuId(undefined);
                                    }}
                                >
                                    LOAD PRESET
                                </button>

                                <button
                                    type="button"
                                    style={buttonStyle()}
                                    onClick={() =>
                                        setPresetActionMenuId(undefined)
                                    }
                                >
                                    CANCEL
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {editDialog && (
                <div style={overlayStyle}>
                    <div style={dialogStyle}>
                        <div style={dialogTitleStyle}>
                            {editDialog.title}
                        </div>

                        <input
                            autoFocus
                            value={editDialog.value}
                            onChange={(event) =>
                                setEditDialog({
                                    ...editDialog,
                                    value: event.target.value
                                })
                            }
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    void submitEditDialog();
                                } else if (
                                    event.key === "Escape"
                                ) {
                                    setEditDialog(undefined);
                                }
                            }}
                            style={{
                                width: "100%",
                                boxSizing: "border-box",
                                minHeight: 48,
                                padding: "8px 12px",
                                borderRadius: 8,
                                border: `2px solid ${PURPLE}`,
                                background: BG,
                                color: TEXT,
                                font: "inherit",
                                fontSize: "1.05rem"
                            }}
                        />

                        <div style={dialogButtonRowStyle}>
                            <button
                                type="button"
                                style={buttonStyle()}
                                onClick={() =>
                                    setEditDialog(undefined)
                                }
                            >
                                CANCEL
                            </button>

                            <button
                                type="button"
                                style={buttonStyle("accent")}
                                onClick={() =>
                                    void submitEditDialog()
                                }
                            >
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {confirmDeleteBank && selectedBank && (
                <div style={overlayStyle}>
                    <div style={dialogStyle}>
                        <div style={dialogTitleStyle}>
                            Delete Bank?
                        </div>

                        <div style={{ color: MUTED }}>
                            Delete “{selectedBank.name}” and its
                            presets?
                        </div>

                        <div style={dialogButtonRowStyle}>
                            <button
                                type="button"
                                style={buttonStyle()}
                                onClick={() =>
                                    setConfirmDeleteBank(false)
                                }
                            >
                                CANCEL
                            </button>

                            <button
                                type="button"
                                style={buttonStyle("danger")}
                                onClick={() =>
                                    void deleteBank()
                                }
                            >
                                DELETE
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {confirmDeletePreset && selectedPreset && (
                <div style={overlayStyle}>
                    <div style={dialogStyle}>
                        <div style={dialogTitleStyle}>
                            Delete Preset?
                        </div>

                        <div style={{ color: MUTED }}>
                            Delete “{selectedPreset.name}”?
                        </div>

                        <div style={dialogButtonRowStyle}>
                            <button
                                type="button"
                                style={buttonStyle()}
                                onClick={() =>
                                    setConfirmDeletePreset(false)
                                }
                            >
                                CANCEL
                            </button>

                            <button
                                type="button"
                                style={buttonStyle("danger")}
                                onClick={() =>
                                    void deletePreset()
                                }
                            >
                                DELETE
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const overlayStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    zIndex: 1100,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "calc(24px * var(--mfx-ui-scale, 1))",
    background: "rgba(0,0,0,0.72)"
};

const dialogStyle: React.CSSProperties = {
    width: "min(520px, 88vw)",
    padding: "calc(18px * var(--mfx-ui-scale, 1))",
    borderRadius: 12,
    border: `2px solid ${PURPLE}`,
    background: PANEL,
    boxShadow: "0 18px 50px rgba(0,0,0,0.8)"
};

const dialogTitleStyle: React.CSSProperties = {
    marginBottom: 14,
    color: PURPLE_TEXT,
    fontWeight: 900,
    fontSize: "1.3rem"
};

const dialogButtonRowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "flex-end",
    gap: "calc(8px * var(--mfx-ui-scale, 1))",
    marginTop: 16
};
