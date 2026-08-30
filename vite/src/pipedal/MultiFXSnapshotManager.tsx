/*
 * PiPedal-MultiFX — Native Snapshot Manager
 *
 * Snapshot data remains native PiPedal data. PI-MULTIFX's bridge stores only
 * transient per-preset selection/on-off intent so both displays behave alike.
 */

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Pedalboard, Snapshot } from "./Pedalboard";
import { PiPedalModelFactory } from "./PiPedalModel";
import {
    beginMultiFXPerformanceTransition,
    finishMultiFXPerformanceTransition,
    getLatestMultiFXPresetSnapshotState,
    initializeMultiFXSnapshotSession,
    isMultiFXTransitionCancellation,
    loadMultiFXBasePreset,
    persistMultiFXSnapshots,
    readMultiFXPresetSnapshotState,
    recallMultiFXSnapshot,
    writeMultiFXPresetSnapshotState
} from "./MultiFXPerformanceSession";
import {
    isSnapshotSessionConfirmed,
    PresetSnapshotSessionState,
    snapshotViewPress
} from "./MultiFXSnapshotSessionState";
import { subscribeMultiFXRuntimeState } from "./MultiFXRuntimeSync";
import {
    MFX_COLORS,
    MFX_SURFACES,
    multiFXSurfaceBackground
} from "./MultiFXTheme";

const DEFAULT_SNAPSHOT_COLORS = [
    "#22C55E",
    "#06B6D4",
    "#8B5CF6",
    "#F59E0B",
    "#EC4899",
    "#EF4444"
];

export default function MultiFXSnapshotManager() {
    const model = PiPedalModelFactory.getInstance();

    // Keep a cloned pedalboard only for rendering snapshot slot contents.
    // Selection is tracked separately from model.selectedSnapshot below.
    const [pedalboard, setPedalboard] = useState<Pedalboard>(
        () => model.pedalboard.get().clone()
    );
    const [renameIndex, setRenameIndex] = useState<number | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [message, setMessage] = useState("");
    const [operationBusy, setOperationBusy] = useState(false);
    const [selectedSnapshot, setSelectedSnapshot] = useState<number>(
        () => model.selectedSnapshot.get()
    );
    const [snapshotSessionRevision, setSnapshotSessionRevision] = useState(0);

    // Subscribe to the same native observables used by PiPedal's stock
    // SnapshotPanel. No polling or duplicated active-snapshot state is needed.
    useEffect(() => {
        const changed = (value: Pedalboard) => {
            setPedalboard(value.clone());
        };
        const selectedChanged = (value: number) => {
            setSelectedSnapshot(value);
        };

        model.pedalboard.addOnChangedHandler(changed);
        model.selectedSnapshot.addOnChangedHandler(selectedChanged);
        changed(model.pedalboard.get());
        selectedChanged(model.selectedSnapshot.get());

        return () => {
            model.pedalboard.removeOnChangedHandler(changed);
            model.selectedSnapshot.removeOnChangedHandler(selectedChanged);
        };
    }, [model]);

    useEffect(() => subscribeMultiFXRuntimeState((state) => {
        setSnapshotSessionRevision(state.revision);
    }), []);

    useEffect(() => {
        if (!message) {
            return;
        }

        const timer = window.setTimeout(
            () => setMessage(""),
            1800
        );

        return () => window.clearTimeout(timer);
    }, [message]);

    const currentPreset = model.presets.get().getItem(
        model.presets.get().selectedInstanceId
    );

    const normalizedSnapshots =
        Snapshot.cloneSnapshots(pedalboard.snapshots);
    const currentBankId = model.banks.get().selectedBank;
    const currentPresetId = model.presets.get().selectedInstanceId;
    const currentSnapshotState = snapshotSessionRevision >= 0
        ? getLatestMultiFXPresetSnapshotState(
            currentBankId,
            currentPresetId
        )
        : null;

    const persistSnapshots = (
        snapshots: Array<Snapshot | null>,
        finalState: PresetSnapshotSessionState | null,
        successMessage: string
    ) => {
        if (operationBusy) return;
        const bankId = model.banks.get().selectedBank;
        const presetId = model.presets.get().selectedInstanceId;
        const transition = beginMultiFXPerformanceTransition();
        setOperationBusy(true);
        void (async () => {
            try {
                await initializeMultiFXSnapshotSession(model, transition);
                await persistMultiFXSnapshots(
                    model,
                    bankId,
                    presetId,
                    snapshots,
                    finalState,
                    transition
                );
                setMessage(successMessage);
            } catch (error) {
                if (!isMultiFXTransitionCancellation(error)) {
                    model.showAlert(String(error));
                }
            } finally {
                finishMultiFXPerformanceTransition(transition);
                setOperationBusy(false);
            }
        })();
    };

    // Capture the LIVE pedalboard into an empty slot. This mirrors PiPedal's
    // native SnapshotPanel Save behavior and selects the new snapshot.
    const createSnapshot = (index: number) => {
        if (operationBusy) {
            return;
        }

        const livePedalboard = model.pedalboard.get();
        const snapshots =
            Snapshot.cloneSnapshots(livePedalboard.snapshots);
        const snapshot = livePedalboard.makeSnapshot();

        snapshot.name = `Snapshot ${index + 1}`;
        snapshot.color =
            DEFAULT_SNAPSHOT_COLORS[index] ?? MFX_COLORS.cyan;
        snapshot.isModified = false;
        snapshots[index] = snapshot;

        persistSnapshots(
            snapshots,
            { snapshotIndex: index, enabled: true },
            `SNAPSHOT ${index + 1} CREATED`
        );
    };

    // Replace only snapshot data while preserving its user-facing name/color.
    // No preset save and no preset reload is involved.
    const updateSnapshot = (index: number) => {
        if (operationBusy) {
            return;
        }

        const livePedalboard = model.pedalboard.get();
        const snapshots =
            Snapshot.cloneSnapshots(livePedalboard.snapshots);
        const existing = snapshots[index];

        if (!existing) {
            return;
        }

        const updated = livePedalboard.makeSnapshot();
        updated.name = existing.name;
        updated.color =
            existing.color
            || DEFAULT_SNAPSHOT_COLORS[index]
            || MFX_COLORS.cyan;
        updated.isModified = false;
        snapshots[index] = updated;

        persistSnapshots(
            snapshots,
            { snapshotIndex: index, enabled: true },
            `${updated.name || `SNAPSHOT ${index + 1}`} UPDATED`
        );
    };

    const recallSnapshot = (index: number) => {
        if (operationBusy) return;

        const snapshot = normalizedSnapshots[index];
        if (!snapshot) return;

        const transition = beginMultiFXPerformanceTransition();
        setOperationBusy(true);
        void (async () => {
            try {
                await initializeMultiFXSnapshotSession(model, transition);
                const bankId = model.banks.get().selectedBank;
                const presetId = model.presets.get().selectedInstanceId;
                const current = await readMultiFXPresetSnapshotState(
                    bankId,
                    presetId,
                    transition
                );
                const next = snapshotViewPress(current, index);
                await writeMultiFXPresetSnapshotState(
                    bankId,
                    presetId,
                    next,
                    transition
                );
                if (next) {
                    await recallMultiFXSnapshot(model, index, transition);
                    setMessage(
                        `${snapshot.name || `SNAPSHOT ${index + 1}`} ACTIVE`
                    );
                } else {
                    await loadMultiFXBasePreset(model, presetId, transition);
                    setMessage(`SNAPSHOT ${index + 1} CLEARED • BASE PRESET`);
                }
            } catch (error) {
                if (!isMultiFXTransitionCancellation(error)) {
                    model.showAlert(String(error));
                }
            } finally {
                finishMultiFXPerformanceTransition(transition);
                setOperationBusy(false);
            }
        })();
    };

    const beginRename = (index: number) => {
        if (operationBusy) {
            return;
        }

        const snapshot = normalizedSnapshots[index];
        if (!snapshot) {
            return;
        }

        setRenameIndex(index);
        setRenameValue(
            snapshot.name || `Snapshot ${index + 1}`
        );
    };

    // Metadata changes clone the Snapshot before mutation so PiPedal/React
    // never share an accidentally mutated snapshot object reference.
    const saveRename = () => {
        if (operationBusy || renameIndex === null) {
            return;
        }

        const name = renameValue.trim();
        if (!name) {
            return;
        }

        const livePedalboard = model.pedalboard.get();
        const snapshots =
            Snapshot.cloneSnapshots(livePedalboard.snapshots);
        const existing = snapshots[renameIndex];

        if (!existing) {
            return;
        }

        const renamed =
            new Snapshot().deserialize(existing);
        renamed.name = name;
        snapshots[renameIndex] = renamed;

        setRenameIndex(null);
        setRenameValue("");

        persistSnapshots(
            snapshots,
            currentSnapshotState,
            "SNAPSHOT RENAMED"
        );
    };

    const setSnapshotColor = (
        index: number,
        color: string
    ) => {
        if (operationBusy) {
            return;
        }

        const livePedalboard = model.pedalboard.get();
        const snapshots =
            Snapshot.cloneSnapshots(livePedalboard.snapshots);
        const existing = snapshots[index];

        if (!existing) {
            return;
        }

        const recolored =
            new Snapshot().deserialize(existing);
        recolored.color = color;
        snapshots[index] = recolored;

        persistSnapshots(
            snapshots,
            currentSnapshotState,
            "SNAPSHOT COLOR SAVED"
        );
    };

    // Deletion follows stock PiPedal: remove the slot with setSnapshots()
    // and explicitly select -1 so a deleted snapshot cannot remain active.
    const deleteSnapshot = (index: number) => {
        if (operationBusy) {
            return;
        }

        const livePedalboard = model.pedalboard.get();
        const snapshots =
            Snapshot.cloneSnapshots(livePedalboard.snapshots);

        snapshots[index] = null;

        if (renameIndex === index) {
            setRenameIndex(null);
            setRenameValue("");
        }

        persistSnapshots(
            snapshots,
            currentSnapshotState?.snapshotIndex === index
                ? null
                : currentSnapshotState,
            `SNAPSHOT ${index + 1} DELETED`
        );
    };

    return (
        <div style={screenStyle}>
            {message && createPortal(
                <div
                    style={toastStyle}
                    role="status"
                    aria-live="polite"
                >
                    {message}
                </div>,
                document.body
            )}

            <div style={headerStyle}>
                <div style={{ minWidth: 0 }}>
                    <div style={eyebrowStyle}>
                        SNAPSHOT MANAGER
                    </div>
                    <div style={presetNameStyle}>
                        {currentPreset?.name || "Current Preset"}
                    </div>
                </div>

                <div style={helpStyle}>
                    Snapshot changes use PiPedal's native snapshot
                    calls. PI-MULTIFX safely reloads BASE before persisting
                    snapshot data so snapshot sound can never overwrite it.
                </div>
            </div>

            <div style={noticeStyle}>
                Snapshots remain native PiPedal snapshot data.
                Create/update captures the current live sound; recall,
                rename, color, and delete follow PiPedal's own lifecycle.
            </div>

            <div style={gridStyle}>
                {normalizedSnapshots.map((snapshot, index) => {
                    const active =
                        currentSnapshotState?.snapshotIndex === index
                        && isSnapshotSessionConfirmed(
                            currentSnapshotState,
                            selectedSnapshot
                        );
                    const modified =
                        active && Boolean(snapshot?.isModified);
                    const color =
                        snapshot?.color
                        || DEFAULT_SNAPSHOT_COLORS[index]
                        || MFX_COLORS.cyan;

                    return (
                        <div
                            key={index}
                            style={{
                                ...cardStyle,
                                opacity: 1,
                                border: active
                                    ? `2px solid ${MFX_COLORS.cyan}`
                                    : `1px solid ${MFX_COLORS.border}`,
                                boxShadow: active
                                    ? `0 0 16px color-mix(in srgb, ${MFX_COLORS.cyan} 42%, transparent)`
                                    : "none"
                            }}
                        >
                            <div style={cardTopStyle}>
                                <span style={slotStyle}>
                                    SNAPSHOT {index + 1}
                                </span>

                                <span
                                    aria-hidden="true"
                                    style={{
                                        width: 16,
                                        height: 16,
                                        borderRadius: "50%",
                                        border: `2px solid ${
                                            active
                                                ? "#93C5FD"
                                                : "#555"
                                        }`,
                                        background: active
                                            ? "#3B82F6"
                                            : "#242424",
                                        boxShadow: active
                                            ? "0 0 9px rgba(59,130,246,0.95)"
                                            : "none",
                                        boxSizing: "border-box"
                                    }}
                                />
                            </div>

                            {snapshot ? (
                                <>
                                    {renameIndex === index ? (
                                        <div
                                            style={{
                                                display: "flex",
                                                gap: 7,
                                                marginTop: 10
                                            }}
                                        >
                                            <input
                                                autoFocus
                                                value={renameValue}
                                                onChange={(event) =>
                                                    setRenameValue(
                                                        event.target.value
                                                    )
                                                }
                                                onKeyDown={(event) => {
                                                    if (
                                                        event.key === "Enter"
                                                    ) {
                                                        saveRename();
                                                    }

                                                    if (
                                                        event.key === "Escape"
                                                    ) {
                                                        setRenameIndex(null);
                                                    }
                                                }}
                                                style={inputStyle}
                                            />

                                            <button
                                                type="button"
                                                onClick={saveRename}
                                                style={smallButtonStyle}
                                            >
                                                SAVE
                                            </button>
                                        </div>
                                    ) : (
                                        <div
                                            style={nameStyle}
                                            title={snapshot.name}
                                        >
                                            {snapshot.name
                                                || `Snapshot ${index + 1}`}
                                            {modified ? " *" : ""}
                                        </div>
                                    )}

                                    <div style={stateStyle}>
                                        <label
                                            title="Snapshot color"
                                            style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                cursor: "pointer"
                                            }}
                                        >
                                            <input
                                                type="color"
                                                value={normalizeColor(color)}
                                                onChange={(event) =>
                                                    setSnapshotColor(
                                                        index,
                                                        event.target.value
                                                    )
                                                }
                                                aria-label={
                                                    `Snapshot ${index + 1} color`
                                                }
                                                style={{
                                                    position: "absolute",
                                                    opacity: 0,
                                                    pointerEvents: "none"
                                                }}
                                            />
                                            <span
                                                style={{
                                                    ...colorChipStyle,
                                                    background: color
                                                }}
                                            />
                                        </label>

                                        {active
                                            ? modified
                                                ? "ACTIVE • MODIFIED"
                                                : "ACTIVE"
                                            : "READY"}
                                    </div>

                                    <div style={actionsStyle}>
                                        <ActionButton
                                            text="RECALL"
                                            cyan
                                            onClick={() =>
                                                recallSnapshot(index)
                                            }
                                        />
                                        <ActionButton
                                            text="UPDATE"
                                            onClick={() =>
                                                updateSnapshot(index)
                                            }
                                        />
                                        <ActionButton
                                            text="RENAME"
                                            onClick={() =>
                                                beginRename(index)
                                            }
                                        />
                                        <ActionButton
                                            text="DELETE"
                                            danger
                                            onClick={() =>
                                                deleteSnapshot(index)
                                            }
                                        />
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={emptyNameStyle}>
                                        EMPTY
                                    </div>
                                    <div style={emptyHelpStyle}>
                                        Capture the current effect state
                                        into this slot.
                                    </div>
                                    <div style={{ marginTop: "auto" }}>
                                        <ActionButton
                                            text="CREATE SNAPSHOT"
                                            cyan
                                            full
                                            onClick={() =>
                                                createSnapshot(index)
                                            }
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function normalizeColor(value: string): string {
    return /^#[0-9a-f]{6}$/i.test(value)
        ? value
        : "#22C55E";
}

function ActionButton({
    text,
    onClick,
    cyan = false,
    danger = false,
    full = false,
    disabled = false
}: {
    text: string;
    onClick: () => void;
    cyan?: boolean;
    danger?: boolean;
    full?: boolean;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            style={{
                ...smallButtonStyle,
                flex: full ? "1 1 100%" : "1 1 auto",
                border: `1px solid ${
                    danger
                        ? MFX_COLORS.danger
                        : cyan
                            ? MFX_COLORS.cyan
                            : MFX_COLORS.border
                }`,
                background: cyan
                    ? MFX_COLORS.cyanSurface
                    : MFX_COLORS.panelAlt,
                color: danger
                    ? MFX_COLORS.danger
                    : cyan
                        ? MFX_COLORS.cyanText
                        : MFX_COLORS.text,
                cursor: disabled ? "default" : "pointer",
                opacity: disabled ? 0.6 : 1
            }}
        >
            {text}
        </button>
    );
}

const screenStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    padding: "calc(12px * var(--mfx-ui-scale, 1))",
    boxSizing: "border-box",
    background: MFX_SURFACES.page.background,
    color: MFX_SURFACES.page.text
};

const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 18,
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid transparent",
    background: multiFXSurfaceBackground("header"),
    color: MFX_SURFACES.header.text,
    boxShadow: MFX_SURFACES.header.shadow,
    flex: "0 0 auto"
};

const eyebrowStyle: React.CSSProperties = {
    color: MFX_SURFACES.header.accent,
    fontWeight: 900,
    fontSize: "0.72rem",
    letterSpacing: "0.08em"
};

const presetNameStyle: React.CSSProperties = {
    marginTop: 3,
    color: MFX_COLORS.cyanText,
    fontWeight: 900,
    fontSize: "clamp(1rem, 2.8vw, 1.4rem)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
};

const helpStyle: React.CSSProperties = {
    marginLeft: "auto",
    maxWidth: "55%",
    color: MFX_SURFACES.header.label,
    fontSize: "0.72rem",
    fontWeight: 700,
    textAlign: "right"
};

const noticeStyle: React.CSSProperties = {
    marginTop: 8,
    padding: "7px 10px",
    borderRadius: 9,
    border: `1px solid ${MFX_COLORS.border}`,
    color: MFX_COLORS.muted,
    background: MFX_COLORS.panelAlt,
    fontSize: "0.68rem",
    fontWeight: 700,
    flex: "0 0 auto"
};

const gridStyle: React.CSSProperties = {
    flex: "1 1 auto",
    minHeight: 0,
    marginTop: 10,
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gridTemplateRows: "repeat(2, minmax(0, 1fr))",
    gap: "calc(10px * var(--mfx-ui-scale, 1))"
};

const cardStyle: React.CSSProperties = {
    minWidth: 0,
    minHeight: 0,
    padding: "calc(11px * var(--mfx-ui-scale, 1))",
    borderRadius: 12,
    background: MFX_SURFACES.panel.background,
    color: MFX_SURFACES.panel.text,
    boxShadow: MFX_SURFACES.panel.shadow,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxSizing: "border-box"
};

const cardTopStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
};

const slotStyle: React.CSSProperties = {
    color: MFX_SURFACES.panel.accent,
    fontWeight: 900,
    fontSize: "0.66rem",
    letterSpacing: "0.06em"
};

const nameStyle: React.CSSProperties = {
    marginTop: 9,
    color: MFX_COLORS.text,
    fontWeight: 900,
    fontSize: "clamp(0.9rem, 2.3vw, 1.25rem)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
};

const emptyNameStyle: React.CSSProperties = {
    marginTop: 12,
    color: MFX_COLORS.muted,
    fontWeight: 900,
    fontSize: "1.05rem"
};

const emptyHelpStyle: React.CSSProperties = {
    marginTop: 5,
    color: MFX_COLORS.muted,
    fontSize: "0.68rem"
};

const stateStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    color: MFX_COLORS.muted,
    fontSize: "0.63rem",
    fontWeight: 800
};

const colorChipStyle: React.CSSProperties = {
    width: 9,
    height: 9,
    borderRadius: "50%",
    display: "inline-block",
    flex: "0 0 auto"
};

const actionsStyle: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: "auto",
    paddingTop: 9
};

const smallButtonStyle: React.CSSProperties = {
    minHeight: "calc(34px * var(--mfx-ui-scale, 1))",
    padding: "4px 8px",
    borderRadius: 8,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panelAlt,
    color: MFX_COLORS.text,
    font: "inherit",
    fontSize: "0.66rem",
    fontWeight: 900,
    cursor: "pointer"
};

const inputStyle: React.CSSProperties = {
    minWidth: 0,
    flex: "1 1 auto",
    height: "calc(34px * var(--mfx-ui-scale, 1))",
    padding: "4px 8px",
    boxSizing: "border-box",
    borderRadius: 8,
    border: `1px solid ${MFX_COLORS.cyan}`,
    background: MFX_COLORS.background,
    color: MFX_COLORS.text,
    font: "inherit",
    fontWeight: 800
};

const toastStyle: React.CSSProperties = {
    position: "fixed",
    left: "50%",
    top: "calc(8px * var(--mfx-ui-scale, 1))",
    transform: "translateX(-50%)",
    zIndex: 2147483647,
    maxWidth: "min(72vw, 560px)",
    padding:
        "calc(8px * var(--mfx-ui-scale, 1)) calc(14px * var(--mfx-ui-scale, 1))",
    borderRadius: 10,
    border: "1px solid transparent",
    background: multiFXSurfaceBackground("toast"),
    color: MFX_SURFACES.toast.text,
    fontWeight: 900,
    textAlign: "center",
    boxShadow: MFX_SURFACES.toast.shadow,
    pointerEvents: "none"
};
