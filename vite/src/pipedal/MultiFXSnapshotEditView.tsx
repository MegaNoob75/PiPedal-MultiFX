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
import { GetControlView } from "./ControlViewFactory";
import {
    Pedalboard,
    PedalboardItem,
    Snapshot
} from "./Pedalboard";
import {
    PiPedalModelFactory,
    PresetIndex
} from "./PiPedalModel";
import { MFX_COLORS } from "./MultiFXTheme";
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

    // Snapshot data captured before the base reload must survive that reload.
    // This ref is transient editor coordination only; PiPedal remains the owner
    // of the actual snapshot array once setSnapshots() is called.
    const pendingSaveSnapshotsRef =
        useRef<Array<Snapshot | null> | null>(null);

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

    // Establish the editing session once.
    //
    // Existing snapshot: recall it natively so edits start from that sound.
    // Empty slot: if another snapshot is currently selected, a real preset
    // reload is required because selectSnapshot(-1) only clears selection and
    // does not restore base control values.
    useEffect(() => {
        const currentPresets = model.presets.get();
        const currentPedalboard = model.pedalboard.get();

        sessionRef.current = {
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

        if (session.originalSnapshot) {
            model.selectSnapshot(snapshotIndex);
            return;
        }

        const alreadyCleanBase =
            model.selectedSnapshot.get() < 0
            && !model.presets.get().presetChanged;

        if (alreadyCleanBase) {
            phaseRef.current = "ready";
            setPhase("ready");
            return;
        }

        model.loadPreset(session.presetId);
    }, [model, snapshotIndex]);

    // Native subscriptions drive the small sequencing state machine. We wait
    // only for states PiPedal can authoritatively report; there are no polling
    // loops and no duplicated active-snapshot state.
    useEffect(() => {
        const handlePedalboardChanged = (value: Pedalboard) => {
            setPedalboard(value.clone());
            advanceSnapshotEditState();
        };

        const handlePresetsChanged = () => {
            setPresets(model.presets.get().clone());
            advanceSnapshotEditState();
        };

        const handleSelectedSnapshotChanged = () => {
            advanceSnapshotEditState();
        };

        const finish = () => {
            phaseRef.current = "finishing";
            setPhase("finishing");
            finishSoon();
        };

        const cleanBaseIsLoaded = (
            session: SnapshotEditSession
        ): boolean => {
            return (
                model.presets.get().selectedInstanceId === session.presetId
                && model.selectedSnapshot.get() < 0
                && !model.presets.get().presetChanged
            );
        };

        function advanceSnapshotEditState() {
            const session = sessionRef.current;
            if (!session) {
                return;
            }

            const currentPhase = phaseRef.current;

            if (currentPhase === "preparing") {
                if (session.originalSnapshot) {
                    if (model.selectedSnapshot.get() === snapshotIndex) {
                        phaseRef.current = "ready";
                        setPhase("ready");
                    }
                } else if (cleanBaseIsLoaded(session)) {
                    phaseRef.current = "ready";
                    setPhase("ready");
                }
                return;
            }

            if (currentPhase === "save-loading-base") {
                if (!cleanBaseIsLoaded(session)) {
                    return;
                }

                const snapshots = pendingSaveSnapshotsRef.current;
                if (!snapshots) {
                    phaseRef.current = "ready";
                    setPhase("ready");
                    model.showAlert(
                        "Snapshot save data was lost before persistence."
                    );
                    return;
                }

                phaseRef.current = "save-persisting";
                setPhase("save-persisting");

                // WebSocket messages are ordered. Install the captured snapshot
                // array onto the freshly reloaded BASE pedalboard, then save
                // that base+snapshot-data preset before recalling the snapshot.
                //
                // selectedSnapshot=-1 is deliberate: saveCurrentPreset() must
                // execute while base controls—not snapshot controls—are live.
                model.setSnapshots(snapshots, -1);
                model.saveCurrentPreset();
                model.selectSnapshot(snapshotIndex);

                phaseRef.current = "save-recalling";
                setPhase("save-recalling");
                return;
            }

            if (currentPhase === "save-recalling") {
                if (
                    model.presets.get().selectedInstanceId === session.presetId
                    && !model.presets.get().presetChanged
                    && model.selectedSnapshot.get() === snapshotIndex
                ) {
                    pendingSaveSnapshotsRef.current = null;
                    finish();
                }
                return;
            }

            if (currentPhase === "cancel-loading-base") {
                if (!cleanBaseIsLoaded(session)) {
                    return;
                }

                if (session.originalSelectedSnapshot >= 0) {
                    phaseRef.current = "cancel-recalling";
                    setPhase("cancel-recalling");
                    model.selectSnapshot(
                        session.originalSelectedSnapshot
                    );
                } else {
                    finish();
                }
                return;
            }

            if (currentPhase === "cancel-recalling") {
                if (
                    model.selectedSnapshot.get()
                    === session.originalSelectedSnapshot
                ) {
                    finish();
                }
            }
        }

        model.pedalboard.addOnChangedHandler(handlePedalboardChanged);
        model.presets.addOnChangedHandler(handlePresetsChanged);
        model.selectedSnapshot.addOnChangedHandler(
            handleSelectedSnapshotChanged
        );

        handlePedalboardChanged(model.pedalboard.get());
        handlePresetsChanged();
        handleSelectedSnapshotChanged();

        return () => {
            model.pedalboard.removeOnChangedHandler(handlePedalboardChanged);
            model.presets.removeOnChangedHandler(handlePresetsChanged);
            model.selectedSnapshot.removeOnChangedHandler(
                handleSelectedSnapshotChanged
            );
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
            pendingSaveSnapshotsRef.current = snapshots;

            phaseRef.current = "save-loading-base";
            setPhase("save-loading-base");

            // A real same-preset reload is required to restore the saved base
            // controls before saveCurrentPreset() is ever allowed to run.
            model.loadPreset(session.presetId);
        } catch (error) {
            pendingSaveSnapshotsRef.current = null;
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

        pendingSaveSnapshotsRef.current = null;
        phaseRef.current = "cancel-loading-base";
        setPhase("cancel-loading-base");
        model.loadPreset(session.presetId);
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
                background: MFX_COLORS.background,
                color: MFX_COLORS.text
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
                    background: MFX_COLORS.panel
                }}
            >
                <div style={{ minWidth: 0 }}>
                    <div
                        style={{
                            color: MFX_COLORS.purpleLight,
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
