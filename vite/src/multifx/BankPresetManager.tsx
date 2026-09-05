/*
 * MultiFX bank/preset organizer.
 *
 * PiPedal owns bank and preset data. This component serializes native mutations
 * so rapid touch/encoder input cannot issue overlapping reorder/delete calls.
 * Performance assignments are cleaned only after PiPedal confirms deletion.
 */

import React, { useEffect, useRef, useState } from "react";
import { BankIndex } from "../pipedal/Banks";
import {
    PiPedalModelFactory,
    PresetIndex,
    PresetIndexEntry
} from "../pipedal/PiPedalModel";
import {
    clearPresetAssignmentsForPreset,
    deletePresetAssignmentsForBank
} from "./MultiFXPresetAssignments";
import {
    MFX_COLORS,
    MFX_SURFACES,
    multiFXSurfaceBackground
} from "./MultiFXTheme";

type EditState = {
    mode: "newBank" | "renameBank" | "renamePreset";
    title: string;
    value: string;
} | null;

type FocusedPane = "banks" | "presets";

type DragCandidate = {
    preset: PresetIndexEntry;
    sourceIndex: number;
    sourceBankId: number;
    pointerId: number;
    startX: number;
    startY: number;
};

type ActiveDrag = DragCandidate & { x: number; y: number };

export interface BankPresetManagerProps {
    bankTools?: React.ReactNode;
    onOpenBank?: (bankId: number) => Promise<void>;
    onLoadPreset?: (presetId: number) => Promise<void>;
}

const DRAG_HOLD_MS = 450;

export default function BankPresetManager({
    bankTools,
    onOpenBank,
    onLoadPreset
}: BankPresetManagerProps) {
    const model = PiPedalModelFactory.getInstance();
    const [banks, setBanks] = useState<BankIndex>(() => model.banks.get().clone());
    const [presets, setPresets] = useState<PresetIndex>(() => model.presets.get().clone());
    const [selectedBankId, setSelectedBankId] = useState(() => model.banks.get().selectedBank);
    const [selectedPresetId, setSelectedPresetId] = useState(() => model.presets.get().selectedInstanceId);
    const [focusedPane, setFocusedPane] = useState<FocusedPane>("presets");
    const [bankCursorId, setBankCursorId] = useState(() => model.banks.get().selectedBank);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [edit, setEdit] = useState<EditState>(null);
    const [confirmDeleteBank, setConfirmDeleteBank] = useState(false);
    const [confirmDeletePreset, setConfirmDeletePreset] = useState(false);

    const dragTimerRef = useRef<number | null>(null);
    const dragCandidateRef = useRef<DragCandidate | null>(null);
    const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
    const activeDragRef = useRef<ActiveDrag | null>(null);

    const selectedBank = banks.getEntry(selectedBankId);
    const selectedPreset = presets.getItem(selectedPresetId);

    const refresh = () => {
        const nextBanks = model.banks.get().clone();
        const nextPresets = model.presets.get().clone();
        setBanks(nextBanks);
        setPresets(nextPresets);
        setSelectedBankId(nextBanks.selectedBank);
        setBankCursorId((id) => nextBanks.getEntry(id) ? id : nextBanks.selectedBank);
        setSelectedPresetId((id) => nextPresets.getItem(id) ? id : nextPresets.selectedInstanceId);
    };

    useEffect(() => {
        model.banks.addOnChangedHandler(refresh);
        model.presets.addOnChangedHandler(refresh);
        refresh();
        return () => {
            model.banks.removeOnChangedHandler(refresh);
            model.presets.removeOnChangedHandler(refresh);
        };
    }, [model]);

    const showError = (error: unknown) => {
        model.showAlert(error instanceof Error ? error.message : String(error));
    };

    const runMutation = async (operation: () => Promise<void>) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        try {
            await operation();
        } catch (error) {
            refresh();
            showError(error);
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    const selectBank = async (bankId: number) => {
        if (busyRef.current || bankId === model.banks.get().selectedBank) return;
        await runMutation(async () => {
            if (onOpenBank) await onOpenBank(bankId);
            else await model.openBank(bankId);
            refresh();
        });
    };

    const loadPreset = async (presetId: number) => {
        if (busyRef.current || presetId < 0) return;
        await runMutation(async () => {
            if (onLoadPreset) await onLoadPreset(presetId);
            else model.loadPreset(presetId);
            refresh();
        });
    };

    const moveBank = async (direction: -1 | 1) => {
        const from = banks.entries.findIndex((bank) => bank.instanceId === selectedBankId);
        const to = from + direction;
        if (from < 0 || to < 0 || to >= banks.entries.length) return;
        await runMutation(async () => {
            await model.moveBank(from, to);
        });
    };

    const reorderPreset = async (from: number, to: number) => {
        if (from === to || from < 0 || to < 0 || from >= presets.presets.length || to >= presets.presets.length) return;
        await runMutation(async () => {
            const next = model.presets.get().clone();
            next.movePreset(from, to);
            setPresets(next);
            await model.updatePresets(next);
        });
    };

    const movePresetToBank = async (presetId: number, targetBankId: number) => {
        if (targetBankId === selectedBankId) return;
        await runMutation(async () => {
            // Copy first, delete second. A failure can create a duplicate but
            // cannot destroy the source preset.
            await model.copyPresetsToBank(targetBankId, [presetId]);
            await model.deletePresetItems(new Set<number>([presetId]));
            await clearPresetAssignmentsForPreset(selectedBankId, presetId);
        });
    };

    const submitEdit = async () => {
        if (!edit) return;
        const name = edit.value.trim();
        if (!name) return;

        await runMutation(async () => {
            if (edit.mode === "renameBank") {
                if (!selectedBank) return;
                if (banks.entries.some((b) => b.instanceId !== selectedBankId && b.name === name)) {
                    throw new Error("A bank with that name already exists.");
                }
                await model.renameBank(selectedBankId, name);
            } else if (edit.mode === "renamePreset") {
                if (!selectedPreset) return;
                await model.renamePresetItem(selectedPreset.instanceId, name);
            } else {
                if (!selectedBank) return;
                if (banks.entries.some((b) => b.name === name)) {
                    throw new Error("A bank with that name already exists.");
                }
                const newBankId = await model.saveBankAs(selectedBankId, name);
                if (onOpenBank) await onOpenBank(newBankId);
                else await model.openBank(newBankId);
                const copied = model.presets.get().presets.map((p) => p.instanceId);
                if (copied.length) await model.deletePresetItems(new Set(copied));
            }
            setEdit(null);
        });
    };

    const deleteBank = async () => {
        if (!selectedBank) return;
        const deletedBankId = selectedBankId;
        setConfirmDeleteBank(false);
        await runMutation(async () => {
            const next = await model.deleteBankItem(deletedBankId);
            await deletePresetAssignmentsForBank(deletedBankId);
            if (next !== -1) {
                if (onOpenBank) await onOpenBank(next);
                else await model.openBank(next);
            }
        });
    };

    const deletePreset = async () => {
        if (!selectedPreset) return;
        const deletedPresetId = selectedPreset.instanceId;
        setConfirmDeletePreset(false);
        await runMutation(async () => {
            await model.deletePresetItems(new Set<number>([deletedPresetId]));
            await clearPresetAssignmentsForPreset(selectedBankId, deletedPresetId);
        });
    };

    const clearDrag = () => {
        if (dragTimerRef.current !== null) window.clearTimeout(dragTimerRef.current);
        dragTimerRef.current = null;
        dragCandidateRef.current = null;
        activeDragRef.current = null;
        setActiveDrag(null);
    };

    const beginDrag = (event: React.PointerEvent, preset: PresetIndexEntry, sourceIndex: number) => {
        if (busyRef.current) return;
        event.stopPropagation();
        const candidate: DragCandidate = {
            preset,
            sourceIndex,
            sourceBankId: selectedBankId,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY
        };
        dragCandidateRef.current = candidate;
        dragTimerRef.current = window.setTimeout(() => {
            if (dragCandidateRef.current !== candidate) return;
            const drag = { ...candidate, x: candidate.startX, y: candidate.startY };
            activeDragRef.current = drag;
            setActiveDrag(drag);
            dragCandidateRef.current = null;
            dragTimerRef.current = null;
        }, DRAG_HOLD_MS);
    };

    const dragMove = (event: React.PointerEvent) => {
        const pending = dragCandidateRef.current;
        if (pending && pending.pointerId === event.pointerId) {
            if (Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) > 10) clearDrag();
            return;
        }
        const drag = activeDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const next = { ...drag, x: event.clientX, y: event.clientY };
        activeDragRef.current = next;
        setActiveDrag(next);
    };

    const finishDrag = (event: React.PointerEvent) => {
        const drag = activeDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
            clearDrag();
            return;
        }
        const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
        const bankElement = target?.closest("[data-mfx-bank-id]") as HTMLElement | null;
        const presetElement = target?.closest("[data-mfx-preset-index]") as HTMLElement | null;
        clearDrag();
        if (bankElement) {
            const bankId = Number(bankElement.dataset.mfxBankId);
            if (Number.isInteger(bankId) && bankId !== drag.sourceBankId) void movePresetToBank(drag.preset.instanceId, bankId);
        } else if (presetElement) {
            const index = Number(presetElement.dataset.mfxPresetIndex);
            if (Number.isInteger(index)) void reorderPreset(drag.sourceIndex, index);
        }
    };

    // pointercancel is intentionally NOT routed to finishDrag. Cancel means no
    // mutation (lost capture, scroll takeover, OS gesture, etc.).
    const cancelDrag = () => clearDrag();

    useEffect(() => () => clearDrag(), []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (edit || confirmDeleteBank || confirmDeletePreset || busyRef.current) return;
            if (!["ArrowUp", "ArrowDown", "Enter"].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            const direction = event.key === "ArrowDown" ? 1 : -1;
            if (event.key === "Enter") {
                if (focusedPane === "banks") void selectBank(bankCursorId);
                else if (selectedPresetId >= 0) void loadPreset(selectedPresetId);
                return;
            }
            if (focusedPane === "banks" && banks.entries.length) {
                let index = banks.entries.findIndex((bank) => bank.instanceId === bankCursorId);
                index = Math.max(0, Math.min(banks.entries.length - 1, Math.max(0, index) + direction));
                setBankCursorId(banks.entries[index].instanceId);
            } else if (focusedPane === "presets" && presets.presets.length) {
                let index = presets.presets.findIndex((p) => p.instanceId === selectedPresetId);
                index = Math.max(0, Math.min(presets.presets.length - 1, Math.max(0, index) + direction));
                setSelectedPresetId(presets.presets[index].instanceId);
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [banks, presets, bankCursorId, selectedPresetId, focusedPane, edit, confirmDeleteBank, confirmDeletePreset]);

    return (
        <div style={rootStyle}>
            <main style={mainStyle}>
                <section style={paneStyle} onPointerDown={() => setFocusedPane("banks")}>
                    {bankTools && <div style={toolsStyle}>{bankTools}</div>}
                    <div style={toolbarStyle}>
                        <button style={buttonStyle} onClick={() => setEdit({ mode: "newBank", title: "New Bank", value: "" })}>NEW</button>
                        <button style={buttonStyle} disabled={!selectedBank} onClick={() => selectedBank && setEdit({ mode: "renameBank", title: "Rename Bank", value: selectedBank.name })}>RENAME</button>
                        <button style={buttonStyle} onClick={() => void moveBank(-1)}>↑</button>
                        <button style={buttonStyle} onClick={() => void moveBank(1)}>↓</button>
                        <button style={dangerButtonStyle} disabled={!selectedBank} onClick={() => setConfirmDeleteBank(true)}>DELETE</button>
                        {busy && <span style={{ color: MFX_COLORS.muted }}>Updating…</span>}
                    </div>
                    <div style={listStyle}>
                        {banks.entries.map((bank) => (
                            <button key={bank.instanceId} type="button" data-mfx-bank-id={bank.instanceId}
                                onClick={() => { setBankCursorId(bank.instanceId); void selectBank(bank.instanceId); }}
                                style={rowStyle(bank.instanceId === selectedBankId || (focusedPane === "banks" && bank.instanceId === bankCursorId))}>
                                {bank.name}
                            </button>
                        ))}
                    </div>
                </section>

                <section style={paneStyle} onPointerDown={() => setFocusedPane("presets")}>
                    <div style={toolbarStyle}>
                        <button style={buttonStyle} disabled={!selectedPreset} onClick={() => selectedPreset && setEdit({ mode: "renamePreset", title: "Rename Preset", value: selectedPreset.name })}>RENAME</button>
                        <button style={buttonStyle} disabled={!selectedPreset} onClick={() => {
                            const from = presets.presets.findIndex((p) => p.instanceId === selectedPresetId); void reorderPreset(from, from - 1);
                        }}>↑</button>
                        <button style={buttonStyle} disabled={!selectedPreset} onClick={() => {
                            const from = presets.presets.findIndex((p) => p.instanceId === selectedPresetId); void reorderPreset(from, from + 1);
                        }}>↓</button>
                        <button style={dangerButtonStyle} disabled={!selectedPreset} onClick={() => setConfirmDeletePreset(true)}>DELETE</button>
                    </div>
                    <div style={listStyle}>
                        {presets.presets.map((preset, index) => (
                            <div key={preset.instanceId} data-mfx-preset-index={index}
                                style={presetRowStyle(preset.instanceId === selectedPresetId)}
                                onClick={() => setSelectedPresetId(preset.instanceId)}
                                onDoubleClick={() => void loadPreset(preset.instanceId)}>
                                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{preset.name}</span>
                                <button type="button" aria-label={`Move ${preset.name}`} title="Hold and drag to reorder or move to another bank"
                                    onPointerDown={(event) => beginDrag(event, preset, index)}
                                    onPointerMove={dragMove}
                                    onPointerUp={finishDrag}
                                    onPointerCancel={cancelDrag}
                                    style={dragHandleStyle}>☰</button>
                            </div>
                        ))}
                    </div>
                </section>
            </main>

            {edit && <EditDialog state={edit} busy={busy} onChange={(value) => setEdit({ ...edit, value })} onCancel={() => setEdit(null)} onSubmit={() => void submitEdit()} />}
            {confirmDeleteBank && <ConfirmDialog text={`Delete bank “${selectedBank?.name ?? ""}”?`} onCancel={() => setConfirmDeleteBank(false)} onConfirm={() => void deleteBank()} />}
            {confirmDeletePreset && <ConfirmDialog text={`Delete preset “${selectedPreset?.name ?? ""}”?`} onCancel={() => setConfirmDeletePreset(false)} onConfirm={() => void deletePreset()} />}
            {activeDrag && <div style={{ ...dragGhostStyle, left: activeDrag.x + 14, top: activeDrag.y + 14 }}>{activeDrag.preset.name}</div>}
        </div>
    );
}

function EditDialog({ state, busy, onChange, onCancel, onSubmit }: { state: NonNullable<EditState>; busy: boolean; onChange: (value: string) => void; onCancel: () => void; onSubmit: () => void; }) {
    return <div style={overlayStyle}><div style={dialogStyle}>
        <strong>{state.title}</strong>
        <input autoFocus value={state.value} disabled={busy} onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); if (e.key === "Escape") onCancel(); }} style={inputStyle} />
        <div style={toolbarStyle}><button style={buttonStyle} onClick={onCancel}>CANCEL</button><button style={accentButtonStyle} onClick={onSubmit}>SAVE</button></div>
    </div></div>;
}

function ConfirmDialog({ text, onCancel, onConfirm }: { text: string; onCancel: () => void; onConfirm: () => void; }) {
    return <div style={overlayStyle}><div style={dialogStyle}><strong>{text}</strong><div style={toolbarStyle}><button style={buttonStyle} onClick={onCancel}>CANCEL</button><button style={dangerButtonStyle} onClick={onConfirm}>DELETE</button></div></div></div>;
}

const rootStyle: React.CSSProperties = { position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: MFX_SURFACES.page.background, color: MFX_SURFACES.page.text };
const mainStyle: React.CSSProperties = { flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "34% 66%" };
const paneStyle: React.CSSProperties = { minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", borderRight: `1px solid ${MFX_COLORS.border}` };
const toolsStyle: React.CSSProperties = { flex: "0 0 auto", padding: 6, borderBottom: `1px solid ${MFX_COLORS.border}`, background: MFX_COLORS.panel };
const toolbarStyle: React.CSSProperties = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, padding: 6 };
const listStyle: React.CSSProperties = { flex: 1, minHeight: 0, overflowY: "auto", padding: 6 };
const buttonStyle: React.CSSProperties = { minHeight: 38, padding: "0 9px", borderRadius: 8, border: `1px solid ${MFX_COLORS.border}`, background: MFX_COLORS.panelAlt, color: MFX_COLORS.text, font: "inherit", fontWeight: 800, cursor: "pointer" };
const accentButtonStyle: React.CSSProperties = { ...buttonStyle, border: `1px solid ${MFX_COLORS.cyan}`, background: MFX_COLORS.cyanSurface, color: MFX_COLORS.cyanText };
const dangerButtonStyle: React.CSSProperties = { ...buttonStyle, border: `1px solid ${MFX_COLORS.danger}`, color: MFX_COLORS.danger };
const rowStyle = (active: boolean): React.CSSProperties => ({ display: "block", width: "100%", minHeight: 44, marginBottom: 5, padding: "7px 10px", borderRadius: 8, border: active ? `2px solid ${MFX_COLORS.cyan}` : `1px solid ${MFX_COLORS.border}`, background: active ? MFX_COLORS.cyanSurface : MFX_COLORS.panelAlt, color: active ? MFX_COLORS.cyanText : MFX_COLORS.text, textAlign: "left", font: "inherit", fontWeight: 800 });
const presetRowStyle = (active: boolean): React.CSSProperties => ({ ...rowStyle(active), display: "flex", alignItems: "center", gap: 8 });
const dragHandleStyle: React.CSSProperties = { ...buttonStyle, minWidth: 42, padding: 0, touchAction: "none" };
const overlayStyle: React.CSSProperties = { position: "absolute", inset: 0, zIndex: 1500, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)" };
const dialogStyle: React.CSSProperties = { width: "min(480px, 88vw)", padding: 18, borderRadius: 12, border: "2px solid transparent", background: multiFXSurfaceBackground("popup"), color: MFX_SURFACES.popup.text, boxShadow: MFX_SURFACES.popup.shadow, display: "flex", flexDirection: "column", gap: 14 };
const inputStyle: React.CSSProperties = { minHeight: 46, padding: "0 10px", borderRadius: 8, border: `1px solid ${MFX_COLORS.border}`, background: MFX_COLORS.background, color: MFX_COLORS.text, font: "inherit" };
const dragGhostStyle: React.CSSProperties = { position: "fixed", zIndex: 2000, pointerEvents: "none", maxWidth: 280, padding: "8px 12px", borderRadius: 8, border: `1px solid ${MFX_COLORS.cyan}`, background: MFX_COLORS.panel, color: MFX_COLORS.text, boxShadow: "0 8px 24px rgba(0,0,0,.65)" };
