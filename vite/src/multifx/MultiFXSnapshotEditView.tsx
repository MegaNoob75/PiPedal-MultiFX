/*
 * PiPedal-MultiFX — Snapshot Editor
 *
 * PURPOSE
 * -------
 * Edit the SOUND stored in one native PiPedal snapshot while reusing MultiFX's
 * effect-control UI. Snapshot editing never changes preset chain topology.
 *
 * PIPEDAL OWNERSHIP / PERSISTENCE CONTRACT
 * ----------------------------------------
 * PiPedal owns all musical state. MultiFX only sequences PiPedal's native calls.
 *
 * setSnapshots() updates the current in-memory preset and marks it modified; it
 * does NOT persist the preset file by itself. saveCurrentPreset() is what writes
 * the preset. Because saveCurrentPreset() writes the current live pedalboard,
 * it must NEVER run while snapshot-modified controls are live or the snapshot
 * could be promoted into the base preset.
 *
 * Safe Save sequence:
 *   1. capture the edited live sound with makeSnapshot()
 *   2. reload the saved base preset with loadPreset()
 *   3. install the new snapshot array on that clean base with setSnapshots(...,-1)
 *   4. saveCurrentPreset() while the true base controls are live
 *   5. recall the saved snapshot with selectSnapshot(snapshotIndex)
 *
 * Safe Cancel sequence:
 *   1. reload the saved base preset to discard temporary editor changes
 *   2. if a snapshot was active before editing, recall that native snapshot
 *
 * We intentionally do NOT wait for presetChanged to become true. That older
 * assumption was unreliable and caused Snapshot Editor freezes. We only wait
 * for positive native acknowledgements: clean base load, clean save, and final
 * selected-snapshot state.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { GetControlView } from "../pipedal/ControlViewFactory";
import {
    Pedalboard,
    PedalboardItem,
    Snapshot
} from "../pipedal/Pedalboard";
import {
    PiPedalModelFactory,
    PresetIndex
} from "../pipedal/PiPedalModel";
import { MFX_COLORS, MFX_SURFACES } from "./MultiFXTheme";
import {
    beginMultiFXPerformanceTransition,
    cancelMultiFXPerformanceTransition,
    finishMultiFXPerformanceTransition,
    initializeMultiFXSnapshotSession,
    isMultiFXTransitionCancellation,
    loadMultiFXBasePreset,
    persistMultiFXSnapshots,
    recallMultiFXSnapshot,
    writeMultiFXPresetSnapshotState
} from "./MultiFXPerformanceSession";
import "./MultiFXEffectControls.css";

const DEFAULT_SNAPSHOT_COLORS = [
    "#22C55E",
    "#06B6D4",
    "#8B5CF6",
    "#F59E0B",
    "#EC4899",
    "#EF4444"
];

type SnapshotEditPhase =
    | "preparing"
    | "ready"
    | "save-loading-base"
    | "save-persisting"
    | "save-recalling"
    | "cancel-loading-base"
    | "cancel-recalling"
    | "finishing";

type MultiFXSnapshotEditViewProps = {
    snapshotIndex: number;
    saveRequest?: number;
    cancelRequest?: number;
    onComplete: () => void;
};

/*
 * Immutable facts captured when the editor opens. They are needed to restore
 * the prior native selection on Cancel and to preserve existing metadata.
 */
type SnapshotEditSession = {
    bankId: number;
    presetId: number;
    originalSelectedSnapshot: number;
    originalSnapshot: Snapshot | null;
};

export default function MultiFXSnapshotEditView({
    snapshotIndex,
    saveRequest = 0,
    cancelRequest = 0,
    onComplete
}: MultiFXSnapshotEditViewProps) {
    const model = PiPedalModelFactory.getInstance();

    const [pedalboard, setPedalboard] = useState<Pedalboard>(
        () => model.pedalboard.get().clone()
    );
    const [presets, setPresets] = useState<PresetIndex>(
        () => model.presets.get().clone()
    );
    // Phase protects the UI from duplicate commands. It is intentionally NOT
    // a second source of musical/snapshot state.
    const [phase, setPhase] = useState<SnapshotEditPhase>("preparing");
    const phaseRef = useRef<SnapshotEditPhase>("preparing");
    const sessionRef = useRef<SnapshotEditSession | null>(null);

    const completionTimerRef = useRef<number | null>(null);

    const initialSnapshot =
        model.pedalboard.get().snapshots[snapshotIndex] ?? null;

    const [snapshotName, setSnapshotName] = useState(
        initialSnapshot?.name || `Snapshot ${snapshotIndex + 1}`
    );

    const [selectedId, setSelectedId] = useState<number>(() => {
        const current = model.pedalboard.get();
        for (const item of current.itemsGenerator()) {
            if (!item.isEmpty() && !item.isSyntheticItem()) {
                return item.instanceId;
            }
        }
        return -1;
    });

    useEffect(() => {
        phaseRef.current = phase;
    }, [phase]);

    const finishSoon = () => {
        if (completionTimerRef.current !== null) {
            window.clearTimeout(completionTimerRef.current);
        }

        completionTimerRef.current = window.setTimeout(() => {
            completionTimerRef.current = null;
            onComplete();
        }, 120);
    };

    useEffect(() => {
        return () => {
            if (completionTimerRef.current !== null) {
                window.clearTimeout(completionTimerRef.current);
            }
        };
    }, []);

    // Establish the editing session through the same acknowledged transition
    // path used by Performance and Snapshot Manager.
    useEffect(() => {
        let cancelled = false;
        const currentPresets = model.presets.get();
        const currentPedalboard = model.pedalboard.get();

        sessionRef.current = {
            bankId: model.banks.get().selectedBank,
            presetId: currentPresets.selectedInstanceId,
            originalSelectedSnapshot: model.selectedSnapshot.get(),
            originalSnapshot:
                currentPedalboard.snapshots[snapshotIndex]
                    ? new Snapshot().deserialize(
                        currentPedalboard.snapshots[snapshotIndex]
                    )
                    : null
        };

        const session = sessionRef.current;
        const transition = beginMultiFXPerformanceTransition();
        void (async () => {
            try {
                await initializeMultiFXSnapshotSession(model, transition);
                if (session.originalSnapshot) {
                    await recallMultiFXSnapshot(model, snapshotIndex, transition);
                    await writeMultiFXPresetSnapshotState(
                        session.bankId,
                        session.presetId,
                        { snapshotIndex, enabled: true },
                        transition
                    );
                } else {
                    await loadMultiFXBasePreset(model, session.presetId, transition);
                }
                if (!cancelled) {
                    phaseRef.current = "ready";
                    setPhase("ready");
                }
            } catch (error) {
                if (!cancelled && !isMultiFXTransitionCancellation(error)) {
                    model.showAlert(String(error));
                    finishSoon();
                }
            } finally {
                finishMultiFXPerformanceTransition(transition);
            }
        })();
        return () => {
            cancelled = true;
            cancelMultiFXPerformanceTransition(transition);
        };
    }, [model, snapshotIndex]);

    // Native subscriptions are rendering inputs. If another browser changes
    // the preset, close this editor instead of ever saving into that new state.
    useEffect(() => {
        const handlePedalboardChanged = (value: Pedalboard) => {
            setPedalboard(value.clone());
        };

        const handlePresetsChanged = () => {
            const session = sessionRef.current;
            const next = model.presets.get().clone();
            setPresets(next);
            if (
                session
                && phaseRef.current === "ready"
                && (
                    next.selectedInstanceId !== session.presetId
                    || model.banks.get().selectedBank !== session.bankId
                )
            ) {
                phaseRef.current = "finishing";
                setPhase("finishing");
                model.showAlert(
                    "Snapshot Editor closed because another screen changed the preset."
                );
                finishSoon();
            }
        };

        model.pedalboard.addOnChangedHandler(handlePedalboardChanged);
        model.presets.addOnChangedHandler(handlePresetsChanged);

        handlePedalboardChanged(model.pedalboard.get());
        handlePresetsChanged();

        return () => {
            model.pedalboard.removeOnChangedHandler(handlePedalboardChanged);
            model.presets.removeOnChangedHandler(handlePresetsChanged);
        };
    }, [model, snapshotIndex]);

    // Capture first, then reload BASE before any preset persistence occurs.
    // The captured snapshot array is held in a ref across that native reload.
    const beginSave = () => {
        if (phaseRef.current !== "ready") {
            return;
        }

        const session = sessionRef.current;
        if (!session) {
            return;
        }
        if (
            model.presets.get().selectedInstanceId !== session.presetId
            || model.banks.get().selectedBank !== session.bankId
        ) {
            model.showAlert(
                "Snapshot save cancelled because another screen changed the preset."
            );
            finishSoon();
            return;
        }

        const name = snapshotName.trim();
        if (!name) {
            model.showAlert("Enter a snapshot name.");
            return;
        }

        try {
            const livePedalboard = model.pedalboard.get();
            const captured = livePedalboard.makeSnapshot();
            const existing = session.originalSnapshot;

            captured.name = name;
            captured.color =
                existing?.color
                || DEFAULT_SNAPSHOT_COLORS[snapshotIndex]
                || MFX_COLORS.cyan;
            captured.isModified = false;

            const snapshots = Snapshot.cloneSnapshots(
                livePedalboard.snapshots
            );
            snapshots[snapshotIndex] = captured;
            phaseRef.current = "save-loading-base";
            setPhase("save-loading-base");

            const transition = beginMultiFXPerformanceTransition();
            void persistMultiFXSnapshots(
                model,
                session.bankId,
                session.presetId,
                snapshots,
                { snapshotIndex, enabled: true },
                transition
            ).then(() => {
                phaseRef.current = "finishing";
                setPhase("finishing");
                finishSoon();
            }).catch((error) => {
                if (!isMultiFXTransitionCancellation(error)) {
                    model.showAlert(String(error));
                }
                phaseRef.current = "ready";
                setPhase("ready");
            }).finally(() => finishMultiFXPerformanceTransition(transition));
        } catch (error) {
            phaseRef.current = "ready";
            setPhase("ready");
            model.showAlert(String(error));
        }
    };

    // Cancel never writes snapshot data. A real preset reload is required to
    // discard temporary editor control changes; selectSnapshot(-1) alone only
    // clears snapshot selection and does not restore the saved base sound.
    const beginCancel = () => {
        if (
            phaseRef.current !== "ready"
            && phaseRef.current !== "preparing"
        ) {
            return;
        }

        const session = sessionRef.current;
        if (!session) {
            finishSoon();
            return;
        }
        if (
            model.presets.get().selectedInstanceId !== session.presetId
            || model.banks.get().selectedBank !== session.bankId
        ) {
            finishSoon();
            return;
        }

        phaseRef.current = "cancel-loading-base";
        setPhase("cancel-loading-base");
        const transition = beginMultiFXPerformanceTransition();
        void (async () => {
            try {
                await loadMultiFXBasePreset(model, session.presetId, transition);
                const originalIndex = session.originalSelectedSnapshot;
                const originalStillExists = originalIndex >= 0
                    && Boolean(model.pedalboard.get().snapshots[originalIndex]);
                if (originalStillExists) {
                    await recallMultiFXSnapshot(model, originalIndex, transition);
                }
                await writeMultiFXPresetSnapshotState(
                    session.bankId,
                    session.presetId,
                    originalStillExists
                        ? { snapshotIndex: originalIndex, enabled: true }
                        : null,
                    transition
                );
                phaseRef.current = "finishing";
                setPhase("finishing");
                finishSoon();
            } catch (error) {
                if (!isMultiFXTransitionCancellation(error)) {
                    model.showAlert(String(error));
                }
                phaseRef.current = "ready";
                setPhase("ready");
            } finally {
                finishMultiFXPerformanceTransition(transition);
            }
        })();
    };

    const previousSaveRequestRef = useRef(saveRequest);
    useEffect(() => {
        if (saveRequest === previousSaveRequestRef.current) {
            return;
        }

        previousSaveRequestRef.current = saveRequest;
        beginSave();
    }, [saveRequest]);

    const previousCancelRequestRef = useRef(cancelRequest);
    useEffect(() => {
        if (cancelRequest === previousCancelRequestRef.current) {
            return;
        }

        previousCancelRequestRef.current = cancelRequest;
        beginCancel();
    }, [cancelRequest]);

    // Snapshot topology is fixed by the base preset. Only existing real plugin
    // items are exposed; synthetic/empty items cannot be added or removed here.
    const editableItems = useMemo(() => {
        const result: PedalboardItem[] = [];

        for (const item of pedalboard.itemsGenerator()) {
            if (item.isEmpty() || item.isSyntheticItem()) {
                continue;
            }
            result.push(item);
        }

        return result;
    }, [pedalboard]);

    useEffect(() => {
        if (
            selectedId >= 0
            && editableItems.some(
                (item) => item.instanceId === selectedId
            )
        ) {
            return;
        }

        setSelectedId(
            editableItems[0]?.instanceId ?? -1
        );
    }, [editableItems, selectedId]);

    const selectedItem =
        editableItems.find(
            (item) => item.instanceId === selectedId
        ) ?? null;

    const currentPreset = presets.getItem(
        presets.selectedInstanceId
    );

    const busy = phase !== "ready";

    return (
        <div
            style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                background: MFX_SURFACES.page.background,
                color: MFX_SURFACES.page.text
            }}
        >
            <div
                style={{
                    flex: "0 0 auto",
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 0.7fr)",
                    gap: 12,
                    alignItems: "center",
                    padding:
                        "calc(10px * var(--mfx-ui-scale, 1)) calc(14px * var(--mfx-ui-scale, 1))",
                    borderBottom: `1px solid ${MFX_COLORS.border}`,
                    background: MFX_SURFACES.header.background,
                    color: MFX_SURFACES.header.text,
                    boxShadow: MFX_SURFACES.header.shadow
                }}
            >
                <div style={{ minWidth: 0 }}>
                    <div
                        style={{
                            color: MFX_SURFACES.header.accent,
                            fontSize: "0.72rem",
                            fontWeight: 900,
                            letterSpacing: "0.07em"
                        }}
                    >
                        SNAPSHOT {snapshotIndex + 1} • LOCKED PRESET CHAIN
                    </div>

                    <input
                        type="text"
                        value={snapshotName}
                        disabled={busy}
                        aria-label="Snapshot name"
                        onChange={(event) =>
                            setSnapshotName(event.target.value)
                        }
                        style={{
                            width: "100%",
                            minWidth: 0,
                            marginTop: 5,
                            padding: "6px 9px",
                            boxSizing: "border-box",
                            borderRadius: 8,
                            border: `1px solid ${MFX_COLORS.border}`,
                            outline: "none",
                            background: MFX_COLORS.background,
                            color: MFX_COLORS.cyanText,
                            font: "inherit",
                            fontSize: "1.05rem",
                            fontWeight: 900
                        }}
                    />
                </div>

                <div
                    style={{
                        minWidth: 0,
                        color: MFX_COLORS.muted,
                        fontSize: "0.72rem",
                        lineHeight: 1.35,
                        textAlign: "right"
                    }}
                >
                    {busy
                        ? phase === "preparing"
                            ? "Preparing snapshot sound…"
                            : phase === "save-loading-base"
                                ? "Restoring base before save…"
                                : phase === "save-persisting"
                                    ? "Persisting snapshot…"
                                    : phase === "save-recalling"
                                        ? "Recalling saved snapshot…"
                                        : phase === "cancel-loading-base"
                                            ? "Discarding editor changes…"
                                            : phase === "cancel-recalling"
                                                ? "Restoring previous snapshot…"
                                                : "Finishing…"
                        : (
                            <>
                                Base preset:{" "}
                                <strong style={{ color: MFX_COLORS.text }}>
                                    {currentPreset?.name || "Current Preset"}
                                </strong>
                                <br />
                                Change effect settings and bypass states here.
                                The plugin chain itself belongs to the preset.
                            </>
                        )}
                </div>
            </div>

            <div
                style={{
                    flex: "1 1 auto",
                    minHeight: 0,
                    display: "grid",
                    gridTemplateColumns: "minmax(250px, 36%) minmax(0, 1fr)",
                    overflow: "hidden"
                }}
            >
                <div
                    style={{
                        minWidth: 0,
                        overflowY: "auto",
                        padding:
                            "calc(10px * var(--mfx-ui-scale, 1))",
                        borderRight: `1px solid ${MFX_COLORS.border}`,
                        background: MFX_COLORS.panelAlt
                    }}
                >
                    <div
                        style={{
                            marginBottom: 8,
                            color: MFX_COLORS.muted,
                            fontSize: "0.68rem",
                            fontWeight: 900,
                            letterSpacing: "0.05em"
                        }}
                    >
                        PRESET CHAIN — STRUCTURE LOCKED
                    </div>

                    {editableItems.map((item, index) => {
                        const selected =
                            item.instanceId === selectedId;
                        const label =
                            item.title
                            || item.pluginName
                            || (
                                item.isSplit()
                                    ? "Split"
                                    : `Effect ${index + 1}`
                            );

                        return (
                            <div
                                key={item.instanceId}
                                style={{
                                    display: "grid",
                                    gridTemplateColumns:
                                        "minmax(0, 1fr) auto",
                                    gap: 8,
                                    marginBottom: 7
                                }}
                            >
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => {
                                        setSelectedId(item.instanceId);
                                        model.setPedalboardSelectedPlugin(
                                            item.instanceId
                                        );
                                    }}
                                    style={{
                                        minWidth: 0,
                                        minHeight:
                                            "var(--mfx-touch-height, 44px)",
                                        padding: "8px 10px",
                                        borderRadius: 9,
                                        border: selected
                                            ? `2px solid ${MFX_COLORS.cyan}`
                                            : `1px solid ${MFX_COLORS.border}`,
                                        background: selected
                                            ? MFX_COLORS.cyanSurface
                                            : MFX_COLORS.panel,
                                        color: selected
                                            ? MFX_COLORS.cyanText
                                            : MFX_COLORS.text,
                                        font: "inherit",
                                        fontWeight: 900,
                                        textAlign: "left",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        cursor: busy
                                            ? "default"
                                            : "pointer",
                                        opacity: busy ? 0.55 : 1
                                    }}
                                >
                                    {label}
                                </button>

                                <button
                                    type="button"
                                    disabled={busy}
                                    aria-label={
                                        item.isEnabled
                                            ? `Bypass ${label}`
                                            : `Enable ${label}`
                                    }
                                    onClick={() =>
                                        model.setPedalboardItemEnabled(
                                            item.instanceId,
                                            !item.isEnabled
                                        )
                                    }
                                    style={{
                                        width:
                                            "calc(70px * var(--mfx-ui-scale, 1))",
                                        minHeight:
                                            "var(--mfx-touch-height, 44px)",
                                        borderRadius: 9,
                                        border: item.isEnabled
                                            ? `2px solid ${MFX_COLORS.cyan}`
                                            : `1px solid ${MFX_COLORS.border}`,
                                        background: item.isEnabled
                                            ? MFX_COLORS.cyanSurface
                                            : MFX_COLORS.background,
                                        color: item.isEnabled
                                            ? MFX_COLORS.cyanText
                                            : MFX_COLORS.muted,
                                        font: "inherit",
                                        fontSize: "0.67rem",
                                        fontWeight: 900,
                                        cursor: busy
                                            ? "default"
                                            : "pointer",
                                        opacity: busy ? 0.55 : 1
                                    }}
                                >
                                    {item.isEnabled ? "ON" : "BYPASS"}
                                </button>
                            </div>
                        );
                    })}
                </div>

                <div
                    style={{
                        minWidth: 0,
                        minHeight: 0,
                        overflow: "auto",
                        background: MFX_COLORS.background,
                        opacity: busy ? 0.5 : 1,
                        pointerEvents: busy ? "none" : "auto"
                    }}
                >
                    {selectedItem
                        ? GetControlView(
                            selectedItem,
                            false,
                            (
                                instanceId: number,
                                showModGui: boolean
                            ) => {
                                model.setPedalboardItemUseModUi(
                                    instanceId,
                                    showModGui
                                );
                            }
                        )
                        : (
                            <div
                                style={{
                                    height: "100%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: 20,
                                    color: MFX_COLORS.muted,
                                    fontWeight: 800,
                                    textAlign: "center"
                                }}
                            >
                                This preset has no editable effects.
                            </div>
                        )}
                </div>
            </div>
        </div>
    );
}
