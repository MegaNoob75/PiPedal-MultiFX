/*
 * PiPedal-MultiFX — Application Shell / View Router
 *
 * This file owns navigation between MultiFX screens and protects the boundary
 * between base-preset editing and performance-only snapshot state.
 *
 * OWNERSHIP RULES
 * ---------------
 * - PiPedalModel owns musical state: presets, pedalboard and snapshots.
 * - FootControllerView owns Performance interaction state.
 * - Active snapshot comes only from model.selectedSnapshot.
 * - performanceSnapshotMode only means "the Snapshot Mode UI is open".
 *
 * PRESET/SNAPSHOT SAFETY
 * ----------------------
 * Base-preset save/create operations are blocked while a native snapshot is
 * selected. Snapshot persistence is sequenced so snapshot controls are never
 * promoted into the base preset. Every route into a BASE preset editor passes
 * through openBasePresetEditor(), which reloads and positively acknowledges the
 * saved base whenever a snapshot is active or another preset must be loaded.
 *
 * Keep this shell focused on routing, dialogs and safety gates. If PiPedal
 * already provides a musical-state operation, call it instead of mirroring it.
 */

import { useEffect, useRef, useState } from "react";
import "./MultiFXNativeTheme.css";
import FootControllerView, {
    NewPresetDraft,
    normalizePresetTilePages
} from "./FootControllerView";
import MultiFXBankPresetView from "./MultiFXBankPresetView";
import MultiFXEditView from "./MultiFXEditView";
import MultiFXAboutView from "./MultiFXAboutView";
import MultiFXSettingsView from "./MultiFXSettingsView";
import MultiFXSettingsHub from "./MultiFXSettingsHub";
import MultiFXControllerSettings from "./MultiFXControllerSettings";
import MultiFXThemeManager from "./MultiFXThemeManager";
import MultiFXUISettings from "./MultiFXUISettings";
import MultiFXSnapshotManager from "./MultiFXSnapshotManager";
import MultiFXSnapshotEditView from "./MultiFXSnapshotEditView";
import FxAmplifierIcon from "./svg/fx_amplifier.svg?react";
import {
    PiPedalModelFactory,
    State
} from "./PiPedalModel";
import { savePresetTileIds } from "./MultiFXPresetTileMap";
import { installMultiFXResponsiveSizing } from "./MultiFXResponsive";
import { updateMultiFXRuntimeState } from "./MultiFXRuntimeSync";
import {
    applyMultiFXTheme,
    clearAppliedMultiFXTheme,
    loadMultiFXTheme,
    MFX_COLORS
} from "./MultiFXTheme";

export type MultiFXView =
    | "performance"
    | "banks"
    | "edit"
    | "settings"
    | "controller"
    | "theme"
    | "multiFXUI"
    | "snapshots"
    | "snapshotEdit"
    | "systemSettings"
    | "about";

interface MultiFXAppProps {
    onExitToOriginal: () => void;
}


export default function MultiFXApp({
    onExitToOriginal
}: MultiFXAppProps) {
    // Lightweight internal router. Keeping it inside MultiFX avoids modifying
    // upstream PiPedal navigation while historyRef provides appliance-style Back.
    const [view, setView] = useState<MultiFXView>("performance");
    const [menuOpen, setMenuOpen] = useState(false);
    const historyRef = useRef<MultiFXView[]>([]);

    const [editSubpage, setEditSubpage] =
        useState<"chain" | "settings">("chain");
    const [editEffectTitle, setEditEffectTitle] =
        useState<string | undefined>(undefined);
    const [editBackRequest, setEditBackRequest] = useState(0);
    const [newPresetDraft, setNewPresetDraft] =
        useState<NewPresetDraft | null>(null);
    const [savePresetDialogOpen, setSavePresetDialogOpen] =
        useState(false);
    const [newPresetName, setNewPresetName] =
        useState("");
    const [savingNewPresetDraft, setSavingNewPresetDraft] =
        useState(false);

    // Prevent overlapping editor-entry requests while PiPedal is restoring a
    // saved base preset. This is an immediate synchronous semaphore rather than
    // React state: two clicks/events can arrive before a state update is rendered,
    // but a ref changes immediately inside the first call. PiPedal remains the
    // authority for all actual preset/snapshot state.
    const openingBaseEditorRef = useRef(false);

    // UI STATE ONLY: Snapshot Mode changes which controls/tiles Performance
    // displays. It is NOT the selected snapshot; PiPedal exposes that through
    // model.selectedSnapshot.
    //
    // Snapshot Mode stays a shared Performance state, but the shell needs to
    // know when it is active so a PC browser gets the same on-screen Back
    // affordance as every other MultiFX screen.
    const [performanceSnapshotMode, setPerformanceSnapshotMode] =
        useState(false);

    const [snapshotExitRequest, setSnapshotExitRequest] =
        useState(0);

    // Command counters let the shell bar request Save/Cancel without reaching
    // into editor internals. The editor commits only through PiPedal snapshots.
    const [snapshotEditIndex, setSnapshotEditIndex] =
        useState<number | null>(null);
    const [snapshotSaveRequest, setSnapshotSaveRequest] =
        useState(0);
    const [snapshotCancelRequest, setSnapshotCancelRequest] =
        useState(0);

    useEffect(() => {
        document.body.classList.add("multifx-active");
        document.documentElement.classList.add("multifx-active");
        applyMultiFXTheme(loadMultiFXTheme());
        const removeResponsiveSizing = installMultiFXResponsiveSizing();

        return () => {
            removeResponsiveSizing();
            document.body.classList.remove("multifx-active");
            document.documentElement.classList.remove("multifx-active");
            document.body.classList.remove("multifx-settings-route");
            document.body.classList.remove("multifx-edit-route");
            clearAppliedMultiFXTheme();
        };
    }, []);

    const goTo = (
        nextView: MultiFXView,
        addToHistory: boolean = true
    ) => {
        setMenuOpen(false);

        if (nextView === view) return;

        if (addToHistory) {
            historyRef.current.push(view);
        }

        if (nextView === "edit") {
            setEditSubpage("chain");
            setEditEffectTitle(undefined);
        }

        setView(nextView);
    };

    /*
     * MFX → Performance means NORMAL Performance View.
     *
     * Snapshot Mode is implemented as a sub-mode of the Performance route, so
     * simply calling goTo("performance") is not enough: if Snapshot Mode was
     * active before navigating to Settings/Banks/etc., its shared runtime flag
     * can survive while FootControllerView is unmounted and restore the six
     * snapshot tiles as soon as Performance mounts again.
     *
     * Normalize both copies of the UI/controller-mode state here:
     *   - performanceSnapshotMode is the app-shell indicator.
     *   - the runtime-sync state keeps multiple browsers/controllers aligned.
     *
     * If FootControllerView is currently mounted, snapshotExitRequest lets it
     * run its normal local exit behavior too. None of this changes PiPedal's
     * selectedSnapshot; a recalled snapshot remains active/audible.
     */
    const openNormalPerformance = async () => {
        setMenuOpen(false);

        const snapshotUiWasActive = performanceSnapshotMode;

        // Update shell state immediately so the title/back affordance cannot
        // continue presenting Snapshot Mode while the runtime write completes.
        setPerformanceSnapshotMode(false);

        if (snapshotUiWasActive && view === "performance") {
            // FootControllerView is mounted, so let it clean up its local
            // Snapshot Mode state exactly as the touchscreen Back button does.
            setSnapshotExitRequest((request) => request + 1);
        }

        try {
            // Clear the shared MultiFX UI mode BEFORE routing back from another
            // screen. Otherwise a newly-mounted FootControllerView can poll the
            // old runtime value and immediately reopen Snapshot Mode.
            await updateMultiFXRuntimeState({
                snapshotMode: false,
                snapshotPresetId: null
            });
        } catch (error) {
            // Runtime sync is a companion service. Navigation must remain
            // usable if it is temporarily unavailable; FootControllerView will
            // still operate with its local state and retry normal polling.
            console.warn(
                "Unable to clear MultiFX Snapshot Mode runtime state.",
                error
            );
        }

        if (view !== "performance") {
            historyRef.current.push(view);
            setView("performance");
        }
    };

    /*
     * Wait for PiPedal to positively acknowledge that targetPresetId is the
     * selected, clean BASE preset. Do not use selectSnapshot(-1): PiPedal's
     * backend only clears snapshot selection for -1 and does not restore base
     * control values. A real loadPreset() is required whenever a snapshot is
     * active or a different preset is being opened for editing.
     *
     * There is deliberately no arbitrary timeout here. Completion is driven by
     * PiPedal's own observables; a connection failure rejects through State.Error.
     */
    const loadCleanBasePreset = (targetPresetId: number): Promise<void> => {
        const model = PiPedalModelFactory.getInstance();

        return new Promise<void>((resolve, reject) => {
            let settled = false;

            const cleanup = () => {
                model.presets.removeOnChangedHandler(checkReady);
                model.selectedSnapshot.removeOnChangedHandler(checkReady);
                model.presetChanged.removeOnChangedHandler(checkReady);
                model.state.removeOnChangedHandler(handleStateChanged);
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

            function checkReady() {
                if (
                    model.presets.get().selectedInstanceId === targetPresetId
                    && model.selectedSnapshot.get() < 0
                    && !model.presetChanged.get()
                ) {
                    finish();
                }
            }

            const handleStateChanged = (state: State) => {
                if (state === State.Error) {
                    fail("PiPedal connection was lost while loading the base preset.");
                }
            };

            model.presets.addOnChangedHandler(checkReady);
            model.selectedSnapshot.addOnChangedHandler(checkReady);
            model.presetChanged.addOnChangedHandler(checkReady);
            model.state.addOnChangedHandler(handleStateChanged);

            try {
                model.loadPreset(targetPresetId);
                checkReady();
            } catch (error) {
                fail(String(error));
            }
        });
    };

    /*
     * The one safe entrance to MultiFX's normal BASE Preset Editor.
     *
     * Performance snapshots are allowed to keep sounding after Snapshot Mode is
     * closed, so editor entry cannot assume the live pedalboard is the saved
     * base. If a snapshot is active, or the requested preset is not yet loaded,
     * force a real native preset load and wait for PiPedal's clean-base ack
     * before mounting any editor that exposes saveCurrentPreset().
     *
     * draft.presetId is also treated as the explicit target. newPresetItem()
     * creates the native draft first, and this gate waits for its load to finish
     * before exposing the editor.
     */
    const openBasePresetEditor = async (
        draft?: NewPresetDraft,
        requestedPresetId?: number
    ) => {
        if (openingBaseEditorRef.current) {
            return;
        }

        // Take the lock synchronously before any state update, navigation or
        // awaited PiPedal operation can yield. A second editor-entry request in
        // the same React render cycle therefore cannot start another load.
        openingBaseEditorRef.current = true;
        setMenuOpen(false);

        const model = PiPedalModelFactory.getInstance();
        const targetPresetId =
            draft?.presetId
            ?? requestedPresetId
            ?? model.presets.get().selectedInstanceId;

        try {
            if (targetPresetId < 0) {
                throw new Error("No preset is available to edit.");
            }

            const snapshotActive = model.selectedSnapshot.get() >= 0;
            const differentPresetLoaded =
                model.presets.get().selectedInstanceId !== targetPresetId;

            if (snapshotActive || differentPresetLoaded) {
                await loadCleanBasePreset(targetPresetId);
            }

            // Snapshot Mode is presentation/controller state. Once the user
            // explicitly enters a base editor, clear that UI mode everywhere
            // without inventing another snapshot state or calling
            // selectSnapshot(-1).
            setPerformanceSnapshotMode(false);

            try {
                await updateMultiFXRuntimeState({
                    snapshotMode: false,
                    snapshotPresetId: null
                });
            } catch (error) {
                console.warn(
                    "Unable to clear MultiFX Snapshot Mode runtime state before preset editing.",
                    error
                );
            }

            setNewPresetDraft(draft ?? null);
            goTo("edit");
        } catch (error) {
            model.showAlert(String(error));
        } finally {
            // Always release the semaphore, including load failures and alerts,
            // so a later legitimate editor-entry request can proceed normally.
            openingBaseEditorRef.current = false;
        }
    };

    const finishBackNavigation = () => {
        const previous = historyRef.current.pop();
        if (previous !== undefined) {
            setView(previous);
        } else if (view !== "performance") {
            setView("performance");
        }
    };

    const cancelNewPresetDraft = async () => {
        const draft = newPresetDraft;
        if (!draft) {
            finishBackNavigation();
            return;
        }

        const model = PiPedalModelFactory.getInstance();

        try {
            await model.deletePresetItems(
                new Set<number>([draft.presetId])
            );

            if (
                draft.previousPresetId >= 0
                && model.presets.get().getItem(
                    draft.previousPresetId
                )
            ) {
                model.loadPreset(draft.previousPresetId);
            }
        } catch (error) {
            model.showAlert(String(error));
        } finally {
            setNewPresetDraft(null);
            finishBackNavigation();
        }
    };

    const openSaveNewPresetDialog = () => {
        const draft = newPresetDraft;
        if (!draft) {
            return;
        }

        const model = PiPedalModelFactory.getInstance();
        const preset = model.presets.get().getItem(
            draft.presetId
        );

        setNewPresetName(
            preset?.name?.trim() || "New Preset"
        );
        setSavePresetDialogOpen(true);
    };

    // Save a newly-created BASE preset. This path is intentionally separate
    // from snapshots; the selectedSnapshot guard prevents snapshot promotion.
    const saveNewPresetDraft = async () => {
        const draft = newPresetDraft;
        if (!draft || savingNewPresetDraft) {
            return;
        }

        const presetName = newPresetName.trim();
        if (!presetName) {
            PiPedalModelFactory.getInstance().showAlert(
                "Enter a name for the new preset."
            );
            return;
        }

        const model = PiPedalModelFactory.getInstance();

        if (
            performanceSnapshotMode
            || model.selectedSnapshot.get() >= 0
        ) {
            model.showAlert(
                "A snapshot is active. Preset saving is disabled until you return to the base preset. Snapshots can only be saved with Snapshot Editor."
            );
            return;
        }

        const currentPreset = model.presets.get().getItem(
            draft.presetId
        );

        setSavingNewPresetDraft(true);

        try {
            // newPresetItem() has already created this preset on PiPedal with
            // a unique generated name. Renaming it to that exact same name
            // causes PiPedal to report "file exists already", so rename only
            // when the user actually changed the name.
            if (
                currentPreset
                && presetName !== currentPreset.name
            ) {
                await model.renamePresetItem(
                    draft.presetId,
                    presetName
                );
            }

            // Save the pedalboard edits exactly once. This is a normal save of
            // the already-created draft preset, not Save As.
            model.saveCurrentPreset();

            const nextTileIds = [...draft.tileIds];

            while (
                nextTileIds.length <= draft.targetTileIndex
            ) {
                nextTileIds.push(null);
            }

            for (
                let index = 0;
                index < nextTileIds.length;
                index++
            ) {
                if (nextTileIds[index] === draft.presetId) {
                    nextTileIds[index] = null;
                }
            }

            nextTileIds[draft.targetTileIndex] =
                draft.presetId;

            const normalizedTileIds =
                normalizePresetTilePages(
                    nextTileIds,
                    draft.presetSlotCount
                );

            const presetIds =
                model.presets.get().presets.map(
                    (preset) => preset.instanceId
                );

            savePresetTileIds(
                draft.bankId,
                normalizedTileIds,
                presetIds
            );

            setSavePresetDialogOpen(false);
            setNewPresetDraft(null);

            // Go directly back to Performance. Because the newly-created
            // preset is still the active preset, Performance will reveal
            // the page containing its assigned tile.
            historyRef.current = [];
            setEditSubpage("chain");
            setEditEffectTitle(undefined);
            setView("performance");
        } catch (error) {
            model.showAlert(String(error));
        } finally {
            setSavingNewPresetDraft(false);
        }
    };

    // Central Back dispatcher. Some child screens receive a command request
    // first so they can finish/cancel transient work before route history moves.
    const goBack = () => {
        setMenuOpen(false);

        if (view === "performance" && performanceSnapshotMode) {
            setSnapshotExitRequest((request) => request + 1);
            return;
        }

        if (view === "snapshotEdit") {
            setSnapshotCancelRequest((request) => request + 1);
            return;
        }

        if (view === "edit" && editSubpage === "settings") {
            setEditBackRequest((request) => request + 1);
            return;
        }

        if (view === "edit" && newPresetDraft) {
            void cancelNewPresetDraft();
            return;
        }

        finishBackNavigation();
    };

    // Crossing into upstream PiPedal is also a BASE-editing safety boundary.
    // Use the same positive acknowledgement rule as MultiFX's own editor.
    const exitToOriginal = async () => {
        setMenuOpen(false);

        const model = PiPedalModelFactory.getInstance();
        const currentPresetId = model.presets.get().selectedInstanceId;

        try {
            if (model.selectedSnapshot.get() >= 0) {
                await loadCleanBasePreset(currentPresetId);
            }

            setPerformanceSnapshotMode(false);

            try {
                await updateMultiFXRuntimeState({
                    snapshotMode: false,
                    snapshotPresetId: null
                });
            } catch (error) {
                console.warn(
                    "Unable to clear MultiFX Snapshot Mode runtime state before opening Original PiPedal.",
                    error
                );
            }

            onExitToOriginal();
        } catch (error) {
            model.showAlert(String(error));
        }
    };

    const shellBackVisible =
        view !== "performance"
        || performanceSnapshotMode;

    const viewTitle: Record<MultiFXView, string> = {
        // Snapshot Mode is a sub-mode of the Performance route, but it is a
        // distinct full-screen working view. Reflect that in the shell title
        // instead of misleadingly leaving "PERFORMANCE" at the top.
        performance: performanceSnapshotMode
            ? "SNAPSHOTS"
            : "PERFORMANCE",
        banks: "BANKS / PRESETS",
        edit:
            editSubpage === "settings"
                ? `EFFECT — ${editEffectTitle ?? "SETTINGS"}`
                : "PRESET EDITOR",
        settings: "SETTINGS",
        controller: "CONTROLLER",
        theme: "THEME",
        multiFXUI: "MULTIFX-UI",
        snapshots: "SNAPSHOTS",
        snapshotEdit: "SNAPSHOT EDITOR",
        systemSettings: "SYSTEM SETTINGS",
        about: "ABOUT"
    };

    return (
        <div
            style={{
                position: "absolute",
                inset: 0,
                overflow: "hidden",
                background: MFX_COLORS.background,
                color: MFX_COLORS.text,
                fontSize: "var(--mfx-font-size, 16px)"
            }}
        >
            <style>
                {`
                    .mfx-route-banks .mfx-bank-manager-host > div > div:first-child {
                        display: none !important;
                    }
                `}
            </style>

            {/* Dedicated MultiFX shell bar.
                Application pages begin below this bar so the MFX and Back
                controls never cover page content. */}
            <div
                style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    height: "calc(54px * var(--mfx-ui-scale, 1))",
                    minHeight: 54,
                    zIndex: 100000,
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    alignItems: "center",
                    gap: 10,
                    padding:
                        "calc(6px * var(--mfx-ui-scale, 1)) calc(8px * var(--mfx-ui-scale, 1))",
                    boxSizing: "border-box",
                    borderBottom: `1px solid ${MFX_COLORS.border}`,
                    background: MFX_COLORS.panel,
                    boxShadow: "0 3px 12px rgba(0,0,0,0.5)"
                }}
            >
                <button
                    type="button"
                    onClick={() => {
                        if (newPresetDraft) {
                            PiPedalModelFactory.getInstance().showAlert(
                                "Save the new preset or press Back to cancel it first."
                            );
                            return;
                        }

                        if (view === "snapshotEdit") {
                            PiPedalModelFactory.getInstance().showAlert(
                                "Save the snapshot or press Back to cancel the snapshot edit first."
                            );
                            return;
                        }

                        setMenuOpen((open) => !open);
                    }}
                    aria-label="Open MultiFX menu"
                    className="multifx-global-menu-button"
                    style={{
                        minWidth: "calc(58px * var(--mfx-ui-scale, 1))",
                        height: "var(--mfx-touch-height, 40px)",
                        minHeight: "var(--mfx-touch-height, 40px)",
                        padding:
                            "calc(5px * var(--mfx-ui-scale, 1)) calc(10px * var(--mfx-ui-scale, 1))",
                        borderRadius: 10,
                        border: `2px solid ${MFX_COLORS.purple}`,
                        background: MFX_COLORS.purpleSurface,
                        color: MFX_COLORS.purpleLight,
                        font: "inherit",
                        fontWeight: 900,
                        letterSpacing: "0.06em",
                        boxShadow: "0 3px 10px rgba(0,0,0,0.45)",
                        cursor: "pointer"
                    }}
                >
                    MFX
                </button>

                <div
                    style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        textAlign: "center",
                        color: MFX_COLORS.text,
                        fontSize: "0.9rem",
                        fontWeight: 900,
                        letterSpacing: "0.08em"
                    }}
                >
                    {viewTitle[view]}
                </div>

                {shellBackVisible ? (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8
                        }}
                    >
                        {view === "edit"
                            && !newPresetDraft
                            && editSubpage === "chain"
                            && (
                                <button
                                    type="button"
                                    onClick={() => goTo("snapshots")}
                                    aria-label="Manage snapshots"
                                    title="Manage snapshots for this preset"
                                    style={{
                                        minWidth: "calc(92px * var(--mfx-ui-scale, 1))",
                                        height: "var(--mfx-touch-height, 40px)",
                                        minHeight: "var(--mfx-touch-height, 40px)",
                                        padding: "0 10px",
                                        borderRadius: 10,
                                        border: `2px solid ${MFX_COLORS.cyan}`,
                                        background: MFX_COLORS.cyanSurface,
                                        color: MFX_COLORS.cyanText,
                                        font: "inherit",
                                        fontWeight: 900,
                                        fontSize: "0.72rem",
                                        letterSpacing: "0.04em",
                                        cursor: "pointer"
                                    }}
                                >
                                    SNAPSHOTS
                                </button>
                            )}

                        {view === "snapshotEdit"
                            && snapshotEditIndex !== null
                            && (
                                <button
                                    type="button"
                                    onClick={() =>
                                        setSnapshotSaveRequest(
                                            (request) => request + 1
                                        )
                                    }
                                    aria-label="Save snapshot"
                                    title="Save snapshot and keep it selected"
                                    style={{
                                        minWidth: "calc(112px * var(--mfx-ui-scale, 1))",
                                        height: "var(--mfx-touch-height, 40px)",
                                        minHeight: "var(--mfx-touch-height, 40px)",
                                        padding: "0 10px",
                                        borderRadius: 10,
                                        border: `2px solid ${MFX_COLORS.cyan}`,
                                        background: MFX_COLORS.cyanSurface,
                                        color: MFX_COLORS.cyanText,
                                        font: "inherit",
                                        fontWeight: 900,
                                        fontSize: "0.72rem",
                                        letterSpacing: "0.04em",
                                        cursor: "pointer"
                                    }}
                                >
                                    SAVE SNAPSHOT
                                </button>
                            )}

                        {view === "edit" && newPresetDraft && (
                            <button
                                type="button"
                                onClick={openSaveNewPresetDialog}
                                aria-label="Save new preset"
                                title="Save new preset"
                                style={{
                                    minWidth: "calc(92px * var(--mfx-ui-scale, 1))",
                                    height: "var(--mfx-touch-height, 40px)",
                                    minHeight: "var(--mfx-touch-height, 40px)",
                                    padding: "0 10px",
                                    borderRadius: 10,
                                    border: `2px solid ${MFX_COLORS.cyan}`,
                                    background: MFX_COLORS.cyanSurface,
                                    color: MFX_COLORS.cyanText,
                                    font: "inherit",
                                    fontWeight: 900,
                                    fontSize: "0.76rem",
                                    letterSpacing: "0.04em",
                                    cursor: "pointer"
                                }}
                            >
                                SAVE PRESET
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={goBack}
                            aria-label="Back"
                            title={
                                view === "edit" && newPresetDraft
                                    ? "Cancel new preset"
                                    : view === "snapshotEdit"
                                        ? "Cancel snapshot edit"
                                        : view === "performance"
                                            && performanceSnapshotMode
                                            ? "Exit Snapshot Mode"
                                            : "Back"
                            }
                            className="multifx-global-back-button"
                            style={{
                                width: "calc(48px * var(--mfx-ui-scale, 1))",
                                minWidth: "calc(48px * var(--mfx-ui-scale, 1))",
                                height: "var(--mfx-touch-height, 40px)",
                                minHeight: "var(--mfx-touch-height, 40px)",
                                padding: 0,
                                borderRadius: 10,
                                border: `2px solid ${MFX_COLORS.purple}`,
                                background: MFX_COLORS.purpleSurface,
                                color: MFX_COLORS.purpleLight,
                                font: "inherit",
                                fontWeight: 900,
                                fontSize: "1.55rem",
                                lineHeight: 1,
                                boxShadow: "0 3px 10px rgba(0,0,0,0.45)",
                                cursor: "pointer"
                            }}
                        >
                            ←
                        </button>
                    </div>
                ) : (
                    <div
                        aria-hidden="true"
                        style={{
                            width: "calc(48px * var(--mfx-ui-scale, 1))",
                            minWidth: "calc(48px * var(--mfx-ui-scale, 1))"
                        }}
                    />
                )}
            </div>

            {/* All MultiFX pages are constrained to the space below the
                shell bar. Absolute-positioned child pages now use this
                container as their positioning boundary. */}
            <div
                style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: "max(54px, calc(54px * var(--mfx-ui-scale, 1)))",
                    bottom: 0,
                    overflow: "hidden"
                }}
            >
                {view === "performance" && (
                    <FootControllerView
                        onOpenEditor={(draft, presetId) => {
                            void openBasePresetEditor(
                                draft,
                                presetId
                            );
                        }}
                        onEditSnapshot={(index) => {
                            setSnapshotEditIndex(index);
                            goTo("snapshotEdit");
                        }}
                        onSnapshotModeChange={
                            setPerformanceSnapshotMode
                        }
                        snapshotExitRequest={
                            snapshotExitRequest
                        }
                    />
                )}

                {view === "banks" && (
                    <div
                        className="mfx-route-banks"
                        style={{
                            position: "absolute",
                            inset: 0
                        }}
                    >
                        <MultiFXBankPresetView
                            onClose={goBack}
                        />
                    </div>
                )}

                {view === "edit" && (
                    <MultiFXEditView
                        backRequest={editBackRequest}
                        draftMode={newPresetDraft !== null}
                        onPageChange={(page, title) => {
                            setEditSubpage(page);
                            setEditEffectTitle(title);
                        }}
                    />
                )}

                {view === "snapshots" && (
                    <MultiFXSnapshotManager />
                )}

                {view === "snapshotEdit"
                    && snapshotEditIndex !== null
                    && (
                        <MultiFXSnapshotEditView
                            snapshotIndex={snapshotEditIndex}
                            saveRequest={snapshotSaveRequest}
                            cancelRequest={snapshotCancelRequest}
                            onComplete={() => {
                                setSnapshotEditIndex(null);
                                historyRef.current = [];
                                setView("performance");
                            }}
                        />
                    )}

                {view === "settings" && (
                    <MultiFXSettingsHub
                        onController={() => goTo("controller")}
                        onTheme={() => goTo("theme")}
                        onMultiFXUI={() => goTo("multiFXUI")}
                        onSystem={() => goTo("systemSettings")}
                    />
                )}

                {view === "controller" && (
                    <MultiFXControllerSettings />
                )}

                {view === "theme" && (
                    <MultiFXThemeManager />
                )}

                {view === "multiFXUI" && (
                    <MultiFXUISettings />
                )}

                {view === "systemSettings" && (
                    <MultiFXSettingsView
                        onClose={goBack}
                    />
                )}

                {view === "about" && (
                    <MultiFXAboutView />
                )}
            </div>

            {savePresetDialogOpen && newPresetDraft && (
                <>
                    <div
                        onClick={() => {
                            if (!savingNewPresetDraft) {
                                setSavePresetDialogOpen(false);
                            }
                        }}
                        style={{
                            position: "fixed",
                            inset: 0,
                            zIndex: 100100,
                            background: "rgba(0,0,0,0.62)",
                            backdropFilter: "blur(2px)"
                        }}
                    />

                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="Save new preset"
                        style={{
                            position: "fixed",
                            left: "50%",
                            top: "50%",
                            transform: "translate(-50%, -50%)",
                            zIndex: 100101,
                            width: "min(420px, calc(100vw - 32px))",
                            padding: 18,
                            boxSizing: "border-box",
                            borderRadius: 14,
                            border: `2px solid ${MFX_COLORS.cyan}`,
                            background: MFX_COLORS.panel,
                            color: MFX_COLORS.text,
                            boxShadow:
                                "0 18px 46px rgba(0,0,0,0.78)"
                        }}
                    >
                        <div
                            style={{
                                color: MFX_COLORS.cyan,
                                fontSize: "1rem",
                                fontWeight: 900,
                                letterSpacing: "0.06em"
                            }}
                        >
                            SAVE NEW PRESET
                        </div>

                        <div
                            style={{
                                marginTop: 12,
                                marginBottom: 6,
                                color: MFX_COLORS.muted,
                                fontSize: "0.76rem",
                                fontWeight: 800
                            }}
                        >
                            PRESET NAME
                        </div>

                        <input
                            autoFocus
                            value={newPresetName}
                            onChange={(event) =>
                                setNewPresetName(
                                    event.target.value
                                )
                            }
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    if (!savingNewPresetDraft) {
                                        void saveNewPresetDraft();
                                    }
                                } else if (
                                    event.key === "Escape"
                                ) {
                                    setSavePresetDialogOpen(false);
                                }
                            }}
                            style={{
                                width: "100%",
                                height: 44,
                                padding: "0 12px",
                                boxSizing: "border-box",
                                borderRadius: 9,
                                border: `2px solid ${MFX_COLORS.border}`,
                                outline: "none",
                                background: MFX_COLORS.panelAlt,
                                color: MFX_COLORS.text,
                                font: "inherit",
                                fontWeight: 800
                            }}
                        />

                        <div
                            style={{
                                display: "flex",
                                justifyContent: "flex-end",
                                gap: 10,
                                marginTop: 16
                            }}
                        >
                            <button
                                type="button"
                                disabled={savingNewPresetDraft}
                                onClick={() =>
                                    setSavePresetDialogOpen(false)
                                }
                                style={{
                                    minWidth: 96,
                                    minHeight: 42,
                                    padding: "0 14px",
                                    borderRadius: 9,
                                    border: `1px solid ${MFX_COLORS.border}`,
                                    background: MFX_COLORS.panelAlt,
                                    color: MFX_COLORS.text,
                                    font: "inherit",
                                    fontWeight: 900,
                                    cursor: "pointer"
                                }}
                            >
                                CANCEL
                            </button>

                            <button
                                type="button"
                                disabled={savingNewPresetDraft}
                                onClick={() =>
                                    void saveNewPresetDraft()
                                }
                                style={{
                                    minWidth: 96,
                                    minHeight: 42,
                                    padding: "0 14px",
                                    borderRadius: 9,
                                    border: `2px solid ${MFX_COLORS.cyan}`,
                                    background: MFX_COLORS.cyanSurface,
                                    color: MFX_COLORS.cyanText,
                                    font: "inherit",
                                    fontWeight: 900,
                                    cursor: "pointer"
                                }}
                            >
                                {savingNewPresetDraft
                                    ? "SAVING..."
                                    : "SAVE"}
                            </button>
                        </div>
                    </div>
                </>
            )}

            {menuOpen && (
                <MultiFXMenu
                    currentView={view}
                    onClose={() => setMenuOpen(false)}
                    onPerformance={() => void openNormalPerformance()}
                    onBanks={() => goTo("banks")}
                    onEdit={() => void openBasePresetEditor()}
                    onSettings={() => goTo("settings")}
                    onAbout={() => goTo("about")}
                    onOriginal={() => void exitToOriginal()}
                />
            )}
        </div>
    );
}

interface MultiFXMenuProps {
    currentView: MultiFXView;
    onClose: () => void;
    onPerformance: () => void;
    onBanks: () => void;
    onEdit: () => void;
    onSettings: () => void;
    onAbout: () => void;
    onOriginal: () => void;
}

function MultiFXMenu({
    currentView,
    onClose,
    onPerformance,
    onBanks,
    onEdit,
    onSettings,
    onAbout,
    onOriginal
}: MultiFXMenuProps) {
    const settingsActive =
        currentView === "settings"
        || currentView === "controller"
        || currentView === "theme"
        || currentView === "multiFXUI"
        || currentView === "systemSettings";

    return (
        <>
            <div
                onClick={onClose}
                style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 99998,
                    background: "rgba(0,0,0,0.48)",
                    backdropFilter: "blur(1px)"
                }}
            />

            <div
                style={{
                    position: "fixed",
                    left: 8,
                    top: "max(58px, calc(58px * var(--mfx-ui-scale, 1)))",
                    zIndex: 100002,
                    width: "min(calc(286px * var(--mfx-ui-scale, 1)), calc(100vw - 16px))",
                    maxHeight: "calc(100% - max(68px, calc(68px * var(--mfx-ui-scale, 1))))",
                    overflowY: "auto",
                    padding: "calc(10px * var(--mfx-ui-scale, 1))",
                    borderRadius: 12,
                    border: `2px solid ${MFX_COLORS.purple}`,
                    background: MFX_COLORS.panel,
                    boxShadow: "0 12px 34px rgba(0,0,0,0.72)"
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "calc(9px * var(--mfx-ui-scale, 1))",
                        padding:
                            "calc(6px * var(--mfx-ui-scale, 1)) calc(8px * var(--mfx-ui-scale, 1)) calc(8px * var(--mfx-ui-scale, 1))"
                    }}
                >
                    <div
                        style={{
                            width: "calc(34px * var(--mfx-ui-scale, 1))",
                            height: "calc(34px * var(--mfx-ui-scale, 1))",
                            flex: "0 0 auto",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: 8,
                            border: `1px solid ${MFX_COLORS.border}`,
                            background: MFX_COLORS.panelAlt,
                            color: MFX_COLORS.purpleLight
                        }}
                        title="PiPedal"
                    >
                        <FxAmplifierIcon
                            style={{
                                width: "72%",
                                height: "72%",
                                fill: "currentColor"
                            }}
                        />
                    </div>

                    <div style={{ minWidth: 0 }}>
                        <div
                            style={{
                                color: MFX_COLORS.text,
                                fontWeight: 800,
                                fontSize: "0.78rem",
                                letterSpacing: "0.025em"
                            }}
                        >
                            PiPedal
                        </div>

                        <div
                            style={{
                                marginTop: 1,
                                color: MFX_COLORS.purpleLight,
                                fontWeight: 950,
                                fontSize: "1rem",
                                letterSpacing: "0.07em"
                            }}
                        >
                            MULTIFX
                        </div>
                    </div>
                </div>

                <div
                    style={{
                        padding:
                            "0 calc(8px * var(--mfx-ui-scale, 1)) calc(10px * var(--mfx-ui-scale, 1))",
                        color: MFX_COLORS.muted,
                        fontSize: "0.72rem"
                    }}
                >
                    Alternative interface for PiPedal
                </div>

                <ShellMenuButton
                    label="PERFORMANCE"
                    subtitle="Preset and foot-controller view"
                    active={currentView === "performance"}
                    onClick={onPerformance}
                />

                <ShellMenuButton
                    label="BANKS / PRESETS"
                    subtitle="Organize banks and presets"
                    active={currentView === "banks"}
                    onClick={onBanks}
                />

                <ShellMenuButton
                    label="PRESET EDITOR"
                    subtitle="Plugins, controls and signal chain"
                    active={currentView === "edit"}
                    onClick={onEdit}
                />

                <MenuDivider />

                <ShellMenuButton
                    label="SETTINGS"
                    subtitle="Controller, theme, MultiFX UI and PiPedal system"
                    active={settingsActive}
                    onClick={onSettings}
                />

                <ShellMenuButton
                    label="ABOUT"
                    subtitle="About PiPedal MultiFX"
                    active={currentView === "about"}
                    onClick={onAbout}
                />

                <MenuDivider />

                <ShellMenuButton
                    label="ORIGINAL PIPEDAL"
                    subtitle="Switch to the original interface"
                    onClick={onOriginal}
                />
            </div>
        </>
    );
}

function MenuDivider() {
    return (
        <div
            style={{
                height: 1,
                margin: "8px 2px",
                background: MFX_COLORS.border
            }}
        />
    );
}

interface ShellMenuButtonProps {
    label: string;
    subtitle: string;
    active?: boolean;
    onClick: () => void;
}

function ShellMenuButton({
    label,
    subtitle,
    active = false,
    onClick
}: ShellMenuButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                display: "block",
                width: "100%",
                minHeight: "calc(54px * var(--mfx-ui-scale, 1))",
                marginBottom: 5,
                padding: "calc(7px * var(--mfx-ui-scale, 1)) calc(11px * var(--mfx-ui-scale, 1))",
                borderRadius: 9,
                border: active
                    ? `2px solid ${MFX_COLORS.cyan}`
                    : `1px solid ${MFX_COLORS.border}`,
                background: active
                    ? MFX_COLORS.cyanSurface
                    : MFX_COLORS.panelAlt,
                color: active
                    ? MFX_COLORS.cyanText
                    : MFX_COLORS.text,
                textAlign: "left",
                font: "inherit",
                cursor: "pointer"
            }}
        >
            <div
                style={{
                    fontWeight: 900,
                    letterSpacing: "0.02em"
                }}
            >
                {label}
            </div>

            <div
                style={{
                    marginTop: 2,
                    color: active
                        ? MFX_COLORS.cyan
                        : MFX_COLORS.muted,
                    fontSize: "0.72rem",
                    fontWeight: 500
                }}
            >
                {subtitle}
            </div>
        </button>
    );
}
