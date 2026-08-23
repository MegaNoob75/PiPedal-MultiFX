/*
 * PiPedal-MultiFX application shell.
 *
 * Navigation is local to this browser. Musical state, controller configuration,
 * Snapshot Mode, Chain Bypass and Performance preset assignments are shared.
 * Every path into a BASE-preset editor goes through the same safety gate.
 */

import { useEffect, useRef, useState } from "react";
import "./MultiFXNativeTheme.css";
import FootControllerView, { NewPresetDraft } from "./FootControllerView";
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
import { PiPedalModelFactory } from "./PiPedalModel";
import { setPresetAssignment } from "./MultiFXPresetAssignments";
import { installMultiFXResponsiveSizing } from "./MultiFXResponsive";
import { updateMultiFXRuntimeState } from "./MultiFXRuntimeSync";
import { prepareBasePresetForWrite } from "./MultiFXPresetSafety";
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

export default function MultiFXApp({ onExitToOriginal }: MultiFXAppProps) {
    const [view, setView] = useState<MultiFXView>("performance");
    const [menuOpen, setMenuOpen] = useState(false);
    const historyRef = useRef<MultiFXView[]>([]);

    const [editSubpage, setEditSubpage] = useState<"chain" | "settings">("chain");
    const [editEffectTitle, setEditEffectTitle] = useState<string>();
    const [editBackRequest, setEditBackRequest] = useState(0);
    const [newPresetDraft, setNewPresetDraft] = useState<NewPresetDraft | null>(null);
    const [savePresetDialogOpen, setSavePresetDialogOpen] = useState(false);
    const [newPresetName, setNewPresetName] = useState("");
    const [savingNewPresetDraft, setSavingNewPresetDraft] = useState(false);
    const openingBaseEditorRef = useRef(false);

    // Snapshot Mode is shared Performance state, but this boolean is only the
    // shell's local knowledge of whether the Performance sub-view is open.
    const [performanceSnapshotMode, setPerformanceSnapshotMode] = useState(false);
    const [snapshotExitRequest, setSnapshotExitRequest] = useState(0);
    const [snapshotEditIndex, setSnapshotEditIndex] = useState<number | null>(null);
    const [snapshotSaveRequest, setSnapshotSaveRequest] = useState(0);
    const [snapshotCancelRequest, setSnapshotCancelRequest] = useState(0);

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

    const goTo = (nextView: MultiFXView, addToHistory = true) => {
        setMenuOpen(false);
        if (nextView === view) return;
        if (addToHistory) historyRef.current.push(view);
        if (nextView === "edit") {
            setEditSubpage("chain");
            setEditEffectTitle(undefined);
        }
        setView(nextView);
    };

    const openNormalPerformance = async () => {
        setMenuOpen(false);
        if (performanceSnapshotMode && view === "performance") {
            setSnapshotExitRequest((value) => value + 1);
        }
        setPerformanceSnapshotMode(false);
        try {
            await updateMultiFXRuntimeState({
                snapshotMode: false,
                snapshotPresetId: null
            });
        } catch {
            // Navigation remains usable if the companion bridge is restarting.
        }
        if (view !== "performance") {
            historyRef.current.push(view);
            setView("performance");
        }
    };

    const openBasePresetEditor = async (
        draft?: NewPresetDraft,
        requestedPresetId?: number
    ) => {
        if (openingBaseEditorRef.current) return;
        openingBaseEditorRef.current = true;
        setMenuOpen(false);

        const model = PiPedalModelFactory.getInstance();
        const targetPresetId =
            draft?.presetId
            ?? requestedPresetId
            ?? model.presets.get().selectedInstanceId;

        try {
            if (targetPresetId < 0) throw new Error("No preset is available to edit.");
            await prepareBasePresetForWrite(model, targetPresetId);
            setPerformanceSnapshotMode(false);
            setNewPresetDraft(draft ?? null);
            goTo("edit");
        } catch (error) {
            model.showAlert(String(error));
        } finally {
            openingBaseEditorRef.current = false;
        }
    };

    const finishBackNavigation = () => {
        const previous = historyRef.current.pop();
        if (previous !== undefined) setView(previous);
        else if (view !== "performance") setView("performance");
    };

    const cancelNewPresetDraft = async () => {
        const draft = newPresetDraft;
        if (!draft) {
            finishBackNavigation();
            return;
        }
        const model = PiPedalModelFactory.getInstance();
        try {
            await model.deletePresetItems(new Set<number>([draft.presetId]));
            if (
                draft.previousPresetId >= 0
                && model.presets.get().getItem(draft.previousPresetId)
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
        if (!newPresetDraft) return;
        const preset = PiPedalModelFactory.getInstance().presets.get()
            .getItem(newPresetDraft.presetId);
        setNewPresetName(preset?.name?.trim() || "New Preset");
        setSavePresetDialogOpen(true);
    };

    const saveNewPresetDraft = async () => {
        const draft = newPresetDraft;
        if (!draft || savingNewPresetDraft) return;
        const name = newPresetName.trim();
        const model = PiPedalModelFactory.getInstance();
        if (!name) {
            model.showAlert("Enter a name for the new preset.");
            return;
        }

        setSavingNewPresetDraft(true);
        try {
            // Re-run the shared safety gate in case temporary Performance state
            // changed while the editor was open.
            await prepareBasePresetForWrite(model, draft.presetId);
            const currentPreset = model.presets.get().getItem(draft.presetId);
            if (currentPreset && currentPreset.name !== name) {
                await model.renamePresetItem(draft.presetId, name);
            }
            model.saveCurrentPreset();

            // Assign the new native preset to exactly one logical switch. No
            // page/slot-array reshaping is involved.
            await setPresetAssignment(
                draft.bankId,
                draft.targetSwitchId,
                draft.presetId
            );

            setSavePresetDialogOpen(false);
            setNewPresetDraft(null);
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

    const goBack = () => {
        setMenuOpen(false);
        if (view === "performance" && performanceSnapshotMode) {
            setSnapshotExitRequest((value) => value + 1);
            return;
        }
        if (view === "snapshotEdit") {
            setSnapshotCancelRequest((value) => value + 1);
            return;
        }
        if (view === "edit" && editSubpage === "settings") {
            setEditBackRequest((value) => value + 1);
            return;
        }
        if (view === "edit" && newPresetDraft) {
            void cancelNewPresetDraft();
            return;
        }
        finishBackNavigation();
    };

    const exitToOriginal = async () => {
        setMenuOpen(false);
        const model = PiPedalModelFactory.getInstance();
        const presetId = model.presets.get().selectedInstanceId;
        try {
            if (presetId >= 0) await prepareBasePresetForWrite(model, presetId);
            setPerformanceSnapshotMode(false);
            onExitToOriginal();
        } catch (error) {
            model.showAlert(String(error));
        }
    };

    const shellBackVisible = view !== "performance" || performanceSnapshotMode;
    const viewTitle: Record<MultiFXView, string> = {
        performance: performanceSnapshotMode ? "SNAPSHOTS" : "PERFORMANCE",
        banks: "BANKS / PRESETS",
        edit: editSubpage === "settings"
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
        <div style={rootStyle}>
            <div style={shellStyle}>
                <button type="button" onClick={() => {
                    if (newPresetDraft || view === "snapshotEdit") return;
                    setMenuOpen((open) => !open);
                }} style={mfxButtonStyle}>MFX</button>

                <div style={shellTitleStyle}>{viewTitle[view]}</div>

                <div style={shellActionsStyle}>
                    {view === "edit" && !newPresetDraft && editSubpage === "chain" && (
                        <button type="button" onClick={() => goTo("snapshots")} style={accentButtonStyle}>
                            SNAPSHOTS
                        </button>
                    )}
                    {view === "snapshotEdit" && snapshotEditIndex !== null && (
                        <button type="button" onClick={() => setSnapshotSaveRequest((v) => v + 1)} style={accentButtonStyle}>
                            SAVE SNAPSHOT
                        </button>
                    )}
                    {view === "edit" && newPresetDraft && (
                        <button type="button" onClick={openSaveNewPresetDialog} style={accentButtonStyle}>
                            SAVE PRESET
                        </button>
                    )}
                    {shellBackVisible ? (
                        <button type="button" onClick={goBack} style={backButtonStyle}>←</button>
                    ) : <div style={{ width: 48 }} />}
                </div>
            </div>

            <div style={pageHostStyle}>
                {view === "performance" && (
                    <FootControllerView
                        onOpenEditor={(draft, presetId) => void openBasePresetEditor(draft, presetId)}
                        onEditSnapshot={(index) => {
                            setSnapshotEditIndex(index);
                            goTo("snapshotEdit");
                        }}
                        onSnapshotModeChange={setPerformanceSnapshotMode}
                        snapshotExitRequest={snapshotExitRequest}
                    />
                )}
                {view === "banks" && <MultiFXBankPresetView onClose={goBack} />}
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
                {view === "snapshots" && <MultiFXSnapshotManager />}
                {view === "snapshotEdit" && snapshotEditIndex !== null && (
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
                {view === "controller" && <MultiFXControllerSettings />}
                {view === "theme" && <MultiFXThemeManager />}
                {view === "multiFXUI" && <MultiFXUISettings />}
                {view === "systemSettings" && <MultiFXSettingsView onClose={goBack} />}
                {view === "about" && <MultiFXAboutView />}
            </div>

            {savePresetDialogOpen && newPresetDraft && (
                <div style={dialogBackdropStyle} onClick={() => {
                    if (!savingNewPresetDraft) setSavePresetDialogOpen(false);
                }}>
                    <div role="dialog" aria-modal="true" style={dialogStyle}
                        onClick={(event) => event.stopPropagation()}>
                        <div style={{ color: MFX_COLORS.cyan, fontWeight: 900 }}>SAVE NEW PRESET</div>
                        <input autoFocus value={newPresetName}
                            onChange={(event) => setNewPresetName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && !savingNewPresetDraft) void saveNewPresetDraft();
                                if (event.key === "Escape") setSavePresetDialogOpen(false);
                            }}
                            style={inputStyle} />
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                            <button type="button" disabled={savingNewPresetDraft}
                                onClick={() => setSavePresetDialogOpen(false)} style={normalButtonStyle}>CANCEL</button>
                            <button type="button" disabled={savingNewPresetDraft}
                                onClick={() => void saveNewPresetDraft()} style={accentButtonStyle}>
                                {savingNewPresetDraft ? "SAVING..." : "SAVE"}
                            </button>
                        </div>
                    </div>
                </div>
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

function MultiFXMenu(props: MultiFXMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const getButtons = (): HTMLButtonElement[] => {
            const menu = menuRef.current;
            if (!menu) return [];
            return Array.from(
                menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")
            );
        };

        const focusInitialButton = () => {
            const buttons = getButtons();
            if (buttons.length === 0) return;
            const activeIndex = buttons.findIndex(
                (button) => button.getAttribute("aria-current") === "page"
            );
            buttons[activeIndex >= 0 ? activeIndex : 0]
                ?.focus({ preventScroll: true });
        };

        const frame = window.requestAnimationFrame(focusInitialButton);

        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                event.key !== "ArrowDown"
                && event.key !== "ArrowUp"
                && event.key !== "Enter"
                && event.key !== " "
                && event.key !== "Escape"
            ) {
                return;
            }

            const buttons = getButtons();
            if (buttons.length === 0) return;

            event.preventDefault();
            event.stopPropagation();

            if (event.key === "Escape") {
                props.onClose();
                return;
            }

            const focusedIndex = buttons.findIndex(
                (button) => button === document.activeElement
            );
            const currentIndex = focusedIndex >= 0 ? focusedIndex : 0;

            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                const direction = event.key === "ArrowDown" ? 1 : -1;
                const nextIndex =
                    (currentIndex + direction + buttons.length) % buttons.length;
                buttons[nextIndex]?.focus({ preventScroll: true });
                buttons[nextIndex]?.scrollIntoView({
                    block: "nearest",
                    behavior: "smooth"
                });
                return;
            }

            buttons[currentIndex]?.click();
        };

        window.addEventListener("keydown", handleKeyDown, true);
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [props.onClose]);

    const settingsActive = ["settings", "controller", "theme", "multiFXUI", "systemSettings"]
        .includes(props.currentView);
    return (
        <>
            <div onClick={props.onClose} style={menuBackdropStyle} />
            <div
                ref={menuRef}
                data-mfx-shell-menu="true"
                style={menuStyle}
            >
                <div style={menuBrandStyle}>
                    <FxAmplifierIcon style={{ width: 30, height: 30, fill: "currentColor" }} />
                    <div><b>PiPedal</b><div style={{ color: MFX_COLORS.purpleLight, fontWeight: 900 }}>MULTIFX</div></div>
                </div>
                <ShellMenuButton label="PERFORMANCE" subtitle="Preset and foot-controller view"
                    active={props.currentView === "performance"} onClick={props.onPerformance} />
                <ShellMenuButton label="BANKS / PRESETS" subtitle="Organize banks and presets"
                    active={props.currentView === "banks"} onClick={props.onBanks} />
                <ShellMenuButton label="PRESET EDITOR" subtitle="Plugins, controls and signal chain"
                    active={props.currentView === "edit"} onClick={props.onEdit} />
                <MenuDivider />
                <ShellMenuButton label="SETTINGS" subtitle="Controller, theme, MultiFX UI and PiPedal system"
                    active={settingsActive} onClick={props.onSettings} />
                <ShellMenuButton label="ABOUT" subtitle="About PiPedal MultiFX"
                    active={props.currentView === "about"} onClick={props.onAbout} />
                <MenuDivider />
                <ShellMenuButton label="ORIGINAL PIPEDAL" subtitle="Switch this browser to the original interface"
                    onClick={props.onOriginal} />
            </div>
        </>
    );
}

function MenuDivider() {
    return <div style={{ height: 1, margin: "8px 2px", background: MFX_COLORS.border }} />;
}

function ShellMenuButton({ label, subtitle, active = false, onClick }: {
    label: string; subtitle: string; active?: boolean; onClick: () => void;
}) {
    return (
        <button
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={onClick}
            style={{
            display: "block", width: "100%", minHeight: 54, marginBottom: 5,
            padding: "7px 11px", borderRadius: 9,
            border: active ? `2px solid ${MFX_COLORS.cyan}` : `1px solid ${MFX_COLORS.border}`,
            background: active ? MFX_COLORS.cyanSurface : MFX_COLORS.panelAlt,
            color: active ? MFX_COLORS.cyanText : MFX_COLORS.text,
            textAlign: "left", font: "inherit", cursor: "pointer"
        }}>
            <div style={{ fontWeight: 900 }}>{label}</div>
            <div style={{ marginTop: 2, color: active ? MFX_COLORS.cyan : MFX_COLORS.muted, fontSize: "0.72rem" }}>
                {subtitle}
            </div>
        </button>
    );
}

const rootStyle: React.CSSProperties = { position: "absolute", inset: 0, overflow: "hidden", background: MFX_COLORS.background, color: MFX_COLORS.text };
const shellStyle: React.CSSProperties = { position: "absolute", left: 0, right: 0, top: 0, height: 54, zIndex: 100000, display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 10, padding: "6px 8px", boxSizing: "border-box", borderBottom: `1px solid ${MFX_COLORS.border}`, background: MFX_COLORS.panel };
const shellTitleStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center", fontWeight: 900, letterSpacing: "0.08em" };
const shellActionsStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const pageHostStyle: React.CSSProperties = { position: "absolute", left: 0, right: 0, top: 54, bottom: 0, overflow: "hidden" };
const mfxButtonStyle: React.CSSProperties = { minWidth: 58, minHeight: 40, borderRadius: 10, border: `2px solid ${MFX_COLORS.purple}`, background: MFX_COLORS.purpleSurface, color: MFX_COLORS.purpleLight, font: "inherit", fontWeight: 900, cursor: "pointer" };
const backButtonStyle: React.CSSProperties = { ...mfxButtonStyle, minWidth: 48, width: 48, fontSize: "1.55rem" };
const normalButtonStyle: React.CSSProperties = { minHeight: 40, padding: "0 12px", borderRadius: 9, border: `1px solid ${MFX_COLORS.border}`, background: MFX_COLORS.panelAlt, color: MFX_COLORS.text, font: "inherit", fontWeight: 900, cursor: "pointer" };
const accentButtonStyle: React.CSSProperties = { ...normalButtonStyle, border: `2px solid ${MFX_COLORS.cyan}`, background: MFX_COLORS.cyanSurface, color: MFX_COLORS.cyanText };
const dialogBackdropStyle: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 100100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.62)" };
const dialogStyle: React.CSSProperties = { width: "min(420px, calc(100vw - 32px))", padding: 18, borderRadius: 14, border: `2px solid ${MFX_COLORS.cyan}`, background: MFX_COLORS.panel, display: "flex", flexDirection: "column", gap: 14 };
const inputStyle: React.CSSProperties = { width: "100%", height: 44, padding: "0 12px", boxSizing: "border-box", borderRadius: 9, border: `2px solid ${MFX_COLORS.border}`, outline: "none", background: MFX_COLORS.panelAlt, color: MFX_COLORS.text, font: "inherit", fontWeight: 800 };
const menuBackdropStyle: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 99998, background: "rgba(0,0,0,0.48)" };
const menuStyle: React.CSSProperties = { position: "fixed", left: 8, top: 58, zIndex: 100002, width: "min(286px, calc(100vw - 16px))", maxHeight: "calc(100% - 68px)", overflowY: "auto", padding: 10, borderRadius: 12, border: `2px solid ${MFX_COLORS.purple}`, background: MFX_COLORS.panel, boxShadow: "0 12px 34px rgba(0,0,0,0.72)" };
const menuBrandStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 9, padding: "6px 8px 10px", color: MFX_COLORS.text };
