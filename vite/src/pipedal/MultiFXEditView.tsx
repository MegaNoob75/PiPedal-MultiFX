import React, { useEffect, useMemo, useRef, useState } from "react";
import PresetSelector from "./PresetSelector";
import MainPage from "./MainPage";
import { GetControlView } from "./ControlViewFactory";
import { Pedalboard, PedalboardItem } from "./Pedalboard";
import { PiPedalModelFactory } from "./PiPedalModel";
import MultiFXPluginBrowser from "./MultiFXPluginBrowser";
import MultiFXParameterBindingView from "./MultiFXParameterBindingView";
import { MFX_COLORS, MFX_HEADER_HEIGHT } from "./MultiFXTheme";
import "./MultiFXEffectControls.css";

type BrowserTarget =
    | { kind: "replace"; instanceId: number }
    | { kind: "insert"; referenceId: number; append: boolean };

type EditPage = "chain" | "settings" | "bindings";

interface DragCandidate {
    pointerId: number;
    instanceId: number;
    title: string;
    startX: number;
    startY: number;
    dragging: boolean;
}

interface DragGhost {
    instanceId: number;
    title: string;
    x: number;
    y: number;
}

interface DragTarget {
    key: string;
    gapIndex: number;
}

interface ChainNode {
    key: string;
    instanceId: number;
    item: PedalboardItem;
    kind: "input" | "plugin" | "output";
    globalIndex: number;
}

type MultiFXEditViewProps = {
    backRequest?: number;
    draftMode?: boolean;
    onPageChange?: (
        page: EditPage,
        title?: string
    ) => void;
};

export default function MultiFXEditView({
    backRequest = 0,
    draftMode = false,
    onPageChange
}: MultiFXEditViewProps) {
    const model = PiPedalModelFactory.getInstance();

    const [pedalboard, setPedalboard] = useState<Pedalboard>(
        model.pedalboard.get()
    );
    const [pedalboardRevision, setPedalboardRevision] = useState(0);
    const [selectedId, setSelectedId] = useState<number>(
        model.pedalboard.get().selectedPlugin
    );
    const selectedIdRef = useRef(selectedId);

    useEffect(() => {
        selectedIdRef.current = selectedId;
    }, [selectedId]);
    const [browserTarget, setBrowserTarget] =
        useState<BrowserTarget | null>(null);
    const [advancedMode, setAdvancedMode] = useState(false);
    const [editPage, setEditPage] = useState<EditPage>("chain");

    // Measure the available chain width so the serpentine layout scales
    // cleanly across different display sizes.
    const chainPageRef = useRef<HTMLDivElement | null>(null);
    const [chainItemsPerRow, setChainItemsPerRow] = useState(5);
    const [chainCardWidth, setChainCardWidth] = useState(142);

    const dragCandidateRef = useRef<DragCandidate | null>(null);
    const dragFrameRef = useRef<number | null>(null);
    const pendingDragPointRef = useRef<{
        x: number;
        y: number;
    } | null>(null);
    const [dragGhost, setDragGhost] = useState<DragGhost | null>(null);
    const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
    const [dragOverTrash, setDragOverTrash] = useState(false);

    useEffect(() => {
        document.body.classList.add("multifx-edit-route");

        const changed = (value: Pedalboard) => {
            setPedalboard(value);

            // PiPedal can mutate the same Pedalboard instance in place, so
            // force a lightweight revision render when a change is emitted.
            setPedalboardRevision((revision) => revision + 1);

            const selected = value.selectedPlugin;
            if (
                selected !== undefined &&
                selected !== -1 &&
                (selected === Pedalboard.START_CONTROL_ID ||
                    selected === Pedalboard.END_CONTROL_ID ||
                    value.hasItem(selected))
            ) {
                setSelectedId(selected);
            } else {
                const currentSelectedId = selectedIdRef.current;
                if (
                    currentSelectedId !== Pedalboard.START_CONTROL_ID &&
                    currentSelectedId !== Pedalboard.END_CONTROL_ID &&
                    !value.hasItem(currentSelectedId)
                ) {
                    setSelectedId(value.getFirstSelectableItem());
                    setEditPage("chain");
                }
            }
        };

        model.pedalboard.addOnChangedHandler(changed);

        return () => {
            document.body.classList.remove("multifx-edit-route");
            model.pedalboard.removeOnChangedHandler(changed);
        };
    }, [model]);

    const topItems = pedalboard.items;

    // PiPedal can mutate the same Pedalboard object in place. The revision is
    // included so these derived arrays are recomputed only when PiPedal emits
    // a real pedalboard change, rather than on unrelated editor renders.
    const visibleItems = useMemo(
        () => topItems.filter((item) => !item.isEmpty()),
        [pedalboard, pedalboardRevision]
    );

    const selectedItem = useMemo(() => {
        if (selectedId === Pedalboard.START_CONTROL_ID) {
            return pedalboard.makeStartItem();
        }

        if (selectedId === Pedalboard.END_CONTROL_ID) {
            return pedalboard.makeEndItem();
        }

        return pedalboard.maybeGetItem(selectedId);
    }, [pedalboard, pedalboardRevision, selectedId]);

    useEffect(() => {
        onPageChange?.(
            editPage,
            editPage !== "chain" && selectedItem
                ? displayName(selectedItem)
                : undefined
        );
    }, [
        editPage,
        selectedItem,
        onPageChange
    ]);

    const previousBackRequestRef = useRef(backRequest);

    useEffect(() => {
        if (backRequest === previousBackRequestRef.current) {
            return;
        }

        previousBackRequestRef.current = backRequest;

        if (editPage === "bindings") {
            setEditPage("settings");
        } else if (editPage === "settings") {
            setEditPage("chain");
        }
    }, [backRequest, editPage]);

    const chainNodes = useMemo<ChainNode[]>(() => {
        const nodes: ChainNode[] = [
            {
                key: "input",
                instanceId: Pedalboard.START_CONTROL_ID,
                item: pedalboard.makeStartItem(),
                kind: "input",
                globalIndex: 0
            }
        ];

        visibleItems.forEach((item, index) => {
            nodes.push({
                key: `plugin-${item.instanceId}`,
                instanceId: item.instanceId,
                item,
                kind: "plugin",
                globalIndex: index + 1
            });
        });

        nodes.push({
            key: "output",
            instanceId: Pedalboard.END_CONTROL_ID,
            item: pedalboard.makeEndItem(),
            kind: "output",
            globalIndex: visibleItems.length + 1
        });

        return nodes;
    }, [pedalboard, pedalboardRevision, visibleItems]);

    useEffect(() => {
        if (editPage !== "chain") return;

        const element = chainPageRef.current;
        if (!element) return;

        const updateLayout = () => {
            const style = getComputedStyle(element);
            const paddingLeft = parseFloat(style.paddingLeft) || 0;
            const paddingRight = parseFloat(style.paddingRight) || 0;
            const availableWidth = Math.max(
                1,
                element.clientWidth - paddingLeft - paddingRight
            );

            const rawScale = getComputedStyle(
                document.documentElement
            ).getPropertyValue("--mfx-ui-scale");
            const uiScale = Math.max(
                0.5,
                parseFloat(rawScale) || 1
            );

            // Target dimensions used to calculate a comfortable row fit.
            const targetCardWidth = 142 * uiScale;
            const connectorWidth = 70 * uiScale;

            // Fit as many complete card+connector slots as the width allows.
            const itemsPerRow = Math.max(
                2,
                Math.floor(
                    (availableWidth + connectorWidth) /
                        (targetCardWidth + connectorWidth)
                )
            );

            // Expand cards slightly to consume leftover horizontal space.
            const widthForCards =
                (availableWidth -
                    Math.max(0, itemsPerRow - 1) *
                        connectorWidth) /
                itemsPerRow;

            const cardWidth = Math.max(
                118 * uiScale,
                Math.min(210 * uiScale, widthForCards)
            );

            setChainItemsPerRow((current) =>
                current === itemsPerRow ? current : itemsPerRow
            );
            setChainCardWidth((current) =>
                Math.abs(current - cardWidth) < 0.5
                    ? current
                    : cardWidth
            );
        };

        let layoutFrame: number | null = null;

        const requestLayout = () => {
            if (layoutFrame !== null) {
                return;
            }

            layoutFrame = requestAnimationFrame(() => {
                layoutFrame = null;
                updateLayout();
            });
        };

        // Measure immediately, then once more after the remounted chain has
        // settled. ResizeObserver and window resize events share the same
        // requestAnimationFrame gate.
        updateLayout();
        requestLayout();

        const observer = new ResizeObserver(requestLayout);
        observer.observe(element);
        window.addEventListener("resize", requestLayout);

        return () => {
            if (layoutFrame !== null) {
                cancelAnimationFrame(layoutFrame);
            }
            observer.disconnect();
            window.removeEventListener("resize", requestLayout);
        };
    }, [editPage]);

    const chainRows = useMemo(() => {
        const rows: ChainNode[][] = [];
        for (
            let i = 0;
            i < chainNodes.length;
            i += chainItemsPerRow
        ) {
            rows.push(
                chainNodes.slice(i, i + chainItemsPerRow)
            );
        }
        return rows;
    }, [chainNodes, chainItemsPerRow]);

    const selectItem = (instanceId: number) => {
        setSelectedId(instanceId);
        model.setPedalboardSelectedPlugin(instanceId);
    };

    const openItemSettings = (instanceId: number) => {
        selectItem(instanceId);
        setEditPage("settings");
    };

    const choosePlugin = (uri: string) => {
        const target = browserTarget;
        if (!target) return;

        try {
            let destinationId: number;

            if (target.kind === "replace") {
                destinationId = target.instanceId;
            } else {
                destinationId = model.addPedalboardItem(
                    target.referenceId,
                    target.append
                );
            }

            const loadedId = model.loadPedalboardPlugin(destinationId, uri);
            setSelectedId(loadedId);
            model.setPedalboardSelectedPlugin(loadedId);
            setBrowserTarget(null);

            // Adding/replacing stays on the Chain page; tapping a tile opens settings.
            setEditPage("chain");
        } catch (error: any) {
            model.showAlert(error?.toString?.() ?? "Unable to add plugin.");
        }
    };

    const addBefore = (item: PedalboardItem) => {
        if (item.isEmpty()) {
            setBrowserTarget({
                kind: "replace",
                instanceId: item.instanceId
            });
        } else {
            setBrowserTarget({
                kind: "insert",
                referenceId: item.instanceId,
                append: false
            });
        }
    };

    const addAfter = (item: PedalboardItem) => {
        if (item.isEmpty()) {
            setBrowserTarget({
                kind: "replace",
                instanceId: item.instanceId
            });
        } else {
            setBrowserTarget({
                kind: "insert",
                referenceId: item.instanceId,
                append: true
            });
        }
    };

    const deleteSelected = () => {
        if (!selectedItem || selectedItem.isSyntheticItem()) return;

        try {
            const next = model.deletePedalboardPedal(selectedItem.instanceId);
            if (next !== null) {
                setSelectedId(next);
                model.setPedalboardSelectedPlugin(next);
            }
            setEditPage("chain");
        } catch (error: any) {
            model.showAlert(error?.toString?.() ?? "Unable to delete plugin.");
        }
    };

    const moveSelected = (direction: -1 | 1) => {
        if (!selectedItem || selectedItem.isSyntheticItem()) return;

        const index = topItems.findIndex(
            (item) => item.instanceId === selectedItem.instanceId
        );

        // Nested split-chain items are deliberately handled by Advanced mode.
        if (index < 0) {
            model.showAlert(
                "This item is inside a split. Use Advanced / Split Editor to move it between split branches."
            );
            return;
        }

        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= topItems.length) return;

        const target = topItems[targetIndex];

        try {
            if (direction < 0) {
                model.movePedalboardItemBefore(
                    selectedItem.instanceId,
                    target.instanceId
                );
            } else {
                model.movePedalboardItemAfter(
                    selectedItem.instanceId,
                    target.instanceId
                );
            }
        } catch (error: any) {
            model.showAlert(error?.toString?.() ?? "Unable to move plugin.");
        }
    };

    const selectedUiPlugin =
        selectedItem &&
        !selectedItem.isSyntheticItem() &&
        !selectedItem.isEmpty() &&
        !selectedItem.isSplit()
            ? model.getUiPlugin(selectedItem.uri)
            : null;

    const emptyItemAtGap = (gapIndex: number): PedalboardItem | null => {
        const leftVisible =
            gapIndex > 0 ? visibleItems[gapIndex - 1] : null;
        const rightVisible =
            gapIndex < visibleItems.length ? visibleItems[gapIndex] : null;

        const leftIndex = leftVisible
            ? topItems.findIndex(
                  (item) => item.instanceId === leftVisible.instanceId
              )
            : -1;
        const rightIndex = rightVisible
            ? topItems.findIndex(
                  (item) => item.instanceId === rightVisible.instanceId
              )
            : topItems.length;

        for (let index = leftIndex + 1; index < rightIndex; index++) {
            if (topItems[index]?.isEmpty()) {
                return topItems[index];
            }
        }

        return null;
    };

    const addAtGap = (gapIndex: number) => {
        const clampedGap = Math.max(
            0,
            Math.min(gapIndex, visibleItems.length)
        );

        // Hidden PiPedal empty slots can still be reused for insertion.
        const emptyItem = emptyItemAtGap(clampedGap);
        if (emptyItem) {
            setBrowserTarget({
                kind: "replace",
                instanceId: emptyItem.instanceId
            });
            return;
        }

        if (clampedGap < visibleItems.length) {
            addBefore(visibleItems[clampedGap]);
            return;
        }

        if (visibleItems.length > 0) {
            addAfter(visibleItems[visibleItems.length - 1]);
            return;
        }

        const anyEmpty = topItems.find((item) => item.isEmpty());
        if (anyEmpty) {
            setBrowserTarget({
                kind: "replace",
                instanceId: anyEmpty.instanceId
            });
            return;
        }

        // Fallback for a completely empty pedalboard.
        setBrowserTarget({
            kind: "insert",
            referenceId: Pedalboard.START_CONTROL_ID,
            append: true
        });
    };

    const addActionAfterGlobalIndex = (
        globalIndex: number
    ): (() => void) | null => {
        if (globalIndex < 0 || globalIndex >= chainNodes.length - 1) {
            return null;
        }

        return () => addAtGap(globalIndex);
    };

    const dropTargetFromPoint = (
        clientX: number,
        clientY: number
    ): DragTarget | null => {
        const element = document.elementFromPoint(
            clientX,
            clientY
        ) as HTMLElement | null;
        const dropElement = element?.closest(
            "[data-mfx-drop-gap]"
        ) as HTMLElement | null;

        if (!dropElement) return null;

        const gapIndex = Number(
            dropElement.getAttribute("data-mfx-drop-gap")
        );
        if (!Number.isFinite(gapIndex)) return null;

        return {
            key: `gap-${gapIndex}`,
            gapIndex
        };
    };

    const isTrashAtPoint = (
        clientX: number,
        clientY: number
    ): boolean => {
        const trash = document.querySelector(
            "[data-mfx-trash-drop-root='true']"
        ) as HTMLElement | null;

        if (!trash) return false;

        const rect = trash.getBoundingClientRect();
        return (
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom
        );
    };

    const deleteItemById = (instanceId: number) => {
        try {
            const next = model.deletePedalboardPedal(instanceId);
            if (next !== null) {
                setSelectedId(next);
                model.setPedalboardSelectedPlugin(next);
            }

            // Keep the removal visually immediate even with in-place updates.
            setPedalboardRevision((revision) => revision + 1);
        } catch (error: any) {
            model.showAlert(
                error?.toString?.() ?? "Unable to delete plugin."
            );
        }
    };

    const moveItemToGap = (
        instanceId: number,
        gapIndex: number
    ) => {
        const draggedItem = visibleItems.find(
            (item) => item.instanceId === instanceId
        );
        if (!draggedItem || draggedItem.isSyntheticItem()) return;

        const clampedGap = Math.max(
            0,
            Math.min(gapIndex, visibleItems.length)
        );
        const rightItem =
            clampedGap < visibleItems.length
                ? visibleItems[clampedGap]
                : null;
        const leftItem =
            clampedGap > 0
                ? visibleItems[clampedGap - 1]
                : null;

        try {
            if (
                rightItem &&
                rightItem.instanceId !== draggedItem.instanceId
            ) {
                model.movePedalboardItemBefore(
                    draggedItem.instanceId,
                    rightItem.instanceId
                );
            } else if (
                leftItem &&
                leftItem.instanceId !== draggedItem.instanceId
            ) {
                model.movePedalboardItemAfter(
                    draggedItem.instanceId,
                    leftItem.instanceId
                );
            }
        } catch (error: any) {
            model.showAlert(
                error?.toString?.() ?? "Unable to move plugin."
            );
        }
    };

    const beginPluginPointer = (
        event: React.PointerEvent<HTMLButtonElement>,
        item: PedalboardItem
    ) => {
        if (event.button !== 0) return;

        dragCandidateRef.current = {
            pointerId: event.pointerId,
            instanceId: item.instanceId,
            title: displayName(item),
            startX: event.clientX,
            startY: event.clientY,
            dragging: false
        };

        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const movePluginPointer = (
        event: React.PointerEvent<HTMLButtonElement>
    ) => {
        const candidate = dragCandidateRef.current;
        if (!candidate || candidate.pointerId !== event.pointerId) {
            return;
        }

        const distance = Math.hypot(
            event.clientX - candidate.startX,
            event.clientY - candidate.startY
        );

        if (!candidate.dragging && distance >= 10) {
            candidate.dragging = true;
        }

        if (!candidate.dragging) return;

        event.preventDefault();

        pendingDragPointRef.current = {
            x: event.clientX,
            y: event.clientY
        };

        if (dragFrameRef.current !== null) {
            return;
        }

        dragFrameRef.current = requestAnimationFrame(() => {
            dragFrameRef.current = null;

            const point = pendingDragPointRef.current;
            const activeCandidate = dragCandidateRef.current;
            if (!point || !activeCandidate?.dragging) {
                return;
            }

            const overTrash = isTrashAtPoint(
                point.x,
                point.y
            );

            setDragGhost({
                instanceId: activeCandidate.instanceId,
                title: activeCandidate.title,
                x: point.x,
                y: point.y
            });
            setDragOverTrash(overTrash);
            setDragTarget(
                overTrash
                    ? null
                    : dropTargetFromPoint(
                          point.x,
                          point.y
                      )
            );
        });
    };

    const endPluginPointer = (
        event: React.PointerEvent<HTMLButtonElement>,
        item: PedalboardItem
    ) => {
        const candidate = dragCandidateRef.current;
        if (!candidate || candidate.pointerId !== event.pointerId) {
            return;
        }

        const wasDragging = candidate.dragging;
        const droppedOnTrash =
            wasDragging &&
            isTrashAtPoint(event.clientX, event.clientY);
        const currentTarget =
            wasDragging && !droppedOnTrash
                ? dropTargetFromPoint(
                      event.clientX,
                      event.clientY
                  )
                : null;

        if (dragFrameRef.current !== null) {
            cancelAnimationFrame(dragFrameRef.current);
            dragFrameRef.current = null;
        }
        pendingDragPointRef.current = null;

        try {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(
                    event.pointerId
                );
            }
        } catch {
            // Ignore an already-released pointer capture.
        }

        dragCandidateRef.current = null;
        setDragGhost(null);
        setDragTarget(null);
        setDragOverTrash(false);

        if (wasDragging) {
            event.preventDefault();

            if (droppedOnTrash) {
                deleteItemById(item.instanceId);
            } else if (currentTarget) {
                moveItemToGap(
                    item.instanceId,
                    currentTarget.gapIndex
                );
            }
        } else {
            openItemSettings(item.instanceId);
        }
    };

    const cancelPluginPointer = (
        event: React.PointerEvent<HTMLButtonElement>
    ) => {
        const candidate = dragCandidateRef.current;
        if (!candidate || candidate.pointerId !== event.pointerId) {
            return;
        }

        if (dragFrameRef.current !== null) {
            cancelAnimationFrame(dragFrameRef.current);
            dragFrameRef.current = null;
        }
        pendingDragPointRef.current = null;
        dragCandidateRef.current = null;
        setDragGhost(null);
        setDragTarget(null);
        setDragOverTrash(false);
    };

    if (advancedMode) {
        return (
            <div className="multifx-edit-screen" style={screenStyle}>
                <EditHeader
                    subtitle="Advanced / split-chain editor"
                    advanced
                    draftMode={draftMode}
                    onToggleAdvanced={() => setAdvancedMode(false)}
                />

                <div
                    style={{
                        position: "relative",
                        flex: "1 1 auto",
                        minHeight: 0,
                        overflow: "hidden"
                    }}
                >
                    <MainPage
                        hasTinyToolBar={false}
                        enableStructureEditing={true}
                    />
                </div>
            </div>
        );
    }

    if (
        editPage === "bindings"
        && selectedItem
        && selectedUiPlugin
        && !selectedItem.isSyntheticItem()
        && !selectedItem.isEmpty()
        && !selectedItem.isSplit()
    ) {
        return (
            <div className="multifx-edit-screen" style={screenStyle}>
                <EffectSettingsHeader
                    title={displayName(selectedItem)}
                    draftMode={draftMode}
                    subtitle="Controller bindings · current preset"
                />
                <MultiFXParameterBindingView
                    item={selectedItem}
                    uiPlugin={selectedUiPlugin}
                    draftMode={draftMode}
                />
            </div>
        );
    }

    if (editPage === "settings" && selectedItem) {
        return (
            <div className="multifx-edit-screen" style={screenStyle}>
                <EffectSettingsHeader
                    title={displayName(selectedItem)}
                    draftMode={draftMode}
                    subtitle={
                        selectedUiPlugin?.plugin_display_type ??
                        (selectedItem.isStart()
                            ? "Input controls"
                            : selectedItem.isEnd()
                                ? "Output controls"
                                : selectedItem.isSplit()
                                    ? "Split controls"
                                    : "Effect settings")
                    }
                />

                <div
                    style={{
                        flex: "0 0 54px",
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        padding: "5px 10px",
                        borderBottom: `1px solid ${MFX_COLORS.border}`,
                        background: MFX_COLORS.panel,
                        boxSizing: "border-box",
                        overflowX: "auto"
                    }}
                >
                    <div
                        style={{
                            flex: "1 1 auto",
                            minWidth: 130,
                            overflow: "hidden"
                        }}
                    >
                        <div
                            style={{
                                color: MFX_COLORS.cyan,
                                fontWeight: 900,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis"
                            }}
                        >
                            {displayName(selectedItem)}
                        </div>

                        {selectedUiPlugin && (
                            <div
                                style={{
                                    color: MFX_COLORS.muted,
                                    fontSize: "0.7rem",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis"
                                }}
                            >
                                {selectedUiPlugin.plugin_display_type}
                                {selectedUiPlugin.fileProperties.length > 0
                                    ? " • model/file controls available below"
                                    : ""}
                            </div>
                        )}
                    </div>

                    {!selectedItem.isSyntheticItem() &&
                        !selectedItem.isEmpty() && (
                            <>
                                <SmallButton
                                    text={
                                        selectedItem.isEnabled
                                            ? "ON"
                                            : "BYPASS"
                                    }
                                    cyan={selectedItem.isEnabled}
                                    onClick={() =>
                                        model.setPedalboardItemEnabled(
                                            selectedItem.instanceId,
                                            !selectedItem.isEnabled
                                        )
                                    }
                                />

                                <SmallButton
                                    text="←"
                                    onClick={() => moveSelected(-1)}
                                />

                                <SmallButton
                                    text="→"
                                    onClick={() => moveSelected(1)}
                                />

                                {!selectedItem.isSplit() && (
                                    <SmallButton
                                        text="CHANGE"
                                        onClick={() =>
                                            setBrowserTarget({
                                                kind: "replace",
                                                instanceId:
                                                    selectedItem.instanceId
                                            })
                                        }
                                    />
                                )}

                                <SmallButton
                                    text="DELETE"
                                    danger
                                    onClick={deleteSelected}
                                />

                                {selectedUiPlugin
                                    && !selectedItem.isSplit() && (
                                        <SmallButton
                                            text="BIND"
                                            cyan
                                            onClick={() =>
                                                setEditPage("bindings")}
                                        />
                                    )}
                            </>
                        )}
                </div>

                <div
                    className="multifx-plugin-controls mfx-effect-control-surface"
                    style={{
                        position: "relative",
                        flex: "1 1 auto",
                        minHeight: 0,
                        overflow: "auto",
                        background: MFX_COLORS.background
                    }}
                >
                    {GetControlView(
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
                    )}
                </div>

                <MultiFXPluginBrowser
                    open={browserTarget !== null}
                    title={
                        browserTarget?.kind === "replace"
                            ? "SELECT PLUGIN"
                            : "ADD EFFECT"
                    }
                    actionLabel={
                        browserTarget?.kind === "replace"
                            ? "USE PLUGIN"
                            : "ADD HERE"
                    }
                    onCancel={() => setBrowserTarget(null)}
                    onChoose={choosePlugin}
                />
            </div>
        );
    }

    return (
        <div className="multifx-edit-screen" style={screenStyle}>
            <EditHeader
                subtitle="Tap to edit • drag to reorder • + inserts an effect"
                advanced={false}
                draftMode={draftMode}
                onToggleAdvanced={() => setAdvancedMode(true)}
            />

            <div
                ref={chainPageRef}
                className="multifx-chain-page"
                style={{
                    flex: "1 1 auto",
                    minHeight: 0,
                    overflowY: "auto",
                    overflowX: "hidden",
                    padding: "12px 14px 16px",
                    boxSizing: "border-box",
                    background: MFX_COLORS.panelAlt,
                    touchAction: "pan-y"
                }}
            >
                {chainRows.map((logicalRow, rowIndex) => {
                    const flowsLeft = rowIndex % 2 === 1;
                    const visualRow = flowsLeft
                        ? [...logicalRow].reverse()
                        : logicalRow;

                    return (
                        <React.Fragment key={`row-${rowIndex}`}>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    // Anchor each row to the side where its
                                    // serpentine signal flow begins:
                                    // row 1 L→R = left, row 2 R→L = right,
                                    // row 3 L→R = left, etc. This also keeps
                                    // OUTPUT at the right edge when it is the
                                    // only node on a right-to-left row.
                                    justifyContent: flowsLeft
                                        ? "flex-end"
                                        : "flex-start",
                                    minHeight:
                                        "calc(116px * var(--mfx-ui-scale, 1))",
                                    gap: 0
                                }}
                            >
                                {visualRow.map(
                                    (node, visualIndex) => {
                                        const nextVisual =
                                            visualRow[
                                                visualIndex + 1
                                            ];
                                        const sourceIndex =
                                            nextVisual !== undefined
                                                ? Math.min(
                                                      node.globalIndex,
                                                      nextVisual.globalIndex
                                                  )
                                                : -1;
                                        const addAction =
                                            sourceIndex >= 0
                                                ? addActionAfterGlobalIndex(
                                                      sourceIndex
                                                  )
                                                : null;

                                        return (
                                            <React.Fragment
                                                key={node.key}
                                            >
                                                <ChainCard
                                                    node={node}
                                                    cardWidth={
                                                        chainCardWidth
                                                    }
                                                    selected={
                                                        selectedId ===
                                                        node.instanceId
                                                    }
                                                    dragging={
                                                        dragGhost?.instanceId ===
                                                        node.instanceId
                                                    }
                                                    onOpen={() =>
                                                        openItemSettings(
                                                            node.instanceId
                                                        )
                                                    }
                                                    onPointerDown={
                                                        beginPluginPointer
                                                    }
                                                    onPointerMove={
                                                        movePluginPointer
                                                    }
                                                    onPointerUp={
                                                        endPluginPointer
                                                    }
                                                    onPointerCancel={
                                                        cancelPluginPointer
                                                    }
                                                    onToggleEnabled={(
                                                        item
                                                    ) =>
                                                        model.setPedalboardItemEnabled(
                                                            item.instanceId,
                                                            !item.isEnabled
                                                        )
                                                    }
                                                />

                                                {nextVisual &&
                                                    addAction && (
                                                        <FlowInsertConnector
                                                            direction={
                                                                flowsLeft
                                                                    ? "left"
                                                                    : "right"
                                                            }
                                                            gapIndex={
                                                                sourceIndex
                                                            }
                                                            dropActive={
                                                                dragTarget?.gapIndex ===
                                                                sourceIndex
                                                            }
                                                            onAdd={
                                                                addAction
                                                            }
                                                        />
                                                    )}
                                            </React.Fragment>
                                        );
                                    }
                                )}
                            </div>

                            {rowIndex < chainRows.length - 1 && (
                                <RowTurnConnector
                                    side={
                                        flowsLeft ? "left" : "right"
                                    }
                                    gapIndex={
                                        logicalRow[
                                            logicalRow.length - 1
                                        ].globalIndex
                                    }
                                    dropActive={
                                        dragTarget?.gapIndex ===
                                        logicalRow[
                                            logicalRow.length - 1
                                        ].globalIndex
                                    }
                                    onAdd={
                                        addActionAfterGlobalIndex(
                                            logicalRow[
                                                logicalRow.length - 1
                                            ].globalIndex
                                        ) ?? undefined
                                    }
                                />
                            )}
                        </React.Fragment>
                    );
                })}

                {dragGhost && (
                    <TrashDropTarget active={dragOverTrash} />
                )}

                {dragGhost && (
                    <div
                        aria-hidden="true"
                        style={{
                            position: "fixed",
                            left: dragGhost.x + 16,
                            top: dragGhost.y + 14,
                            zIndex: 50000,
                            width:
                                "calc(142px * var(--mfx-ui-scale, 1))",
                            minHeight:
                                "calc(76px * var(--mfx-ui-scale, 1))",
                            padding: "9px 11px",
                            boxSizing: "border-box",
                            borderRadius: 12,
                            border: `2px solid ${MFX_COLORS.cyan}`,
                            background: MFX_COLORS.cyanSurface,
                            color: MFX_COLORS.cyanText,
                            boxShadow:
                                "0 12px 28px rgba(0,0,0,0.65)",
                            pointerEvents: "none",
                            transform: "rotate(2deg)"
                        }}
                    >
                        <div
                            style={{
                                color: MFX_COLORS.cyan,
                                fontSize: "0.64rem",
                                fontWeight: 900,
                                letterSpacing: "0.08em"
                            }}
                        >
                            MOVE EFFECT
                        </div>
                        <div
                            style={{
                                marginTop: 5,
                                fontWeight: 900,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis"
                            }}
                        >
                            {dragGhost.title}
                        </div>
                    </div>
                )}
            </div>

            <MultiFXPluginBrowser
                open={browserTarget !== null}
                title={
                    browserTarget?.kind === "replace"
                        ? "SELECT PLUGIN"
                        : "ADD EFFECT"
                }
                actionLabel={
                    browserTarget?.kind === "replace"
                        ? "USE PLUGIN"
                        : "ADD HERE"
                }
                onCancel={() => setBrowserTarget(null)}
                onChoose={choosePlugin}
            />
        </div>
    );
}

function EditHeader({
    subtitle,
    advanced,
    draftMode,
    onToggleAdvanced
}: {
    subtitle: string;
    advanced: boolean;
    draftMode: boolean;
    onToggleAdvanced: () => void;
}) {
    return (
        <div
            className="multifx-screen-header"
            style={{
                flex: `0 0 ${MFX_HEADER_HEIGHT}px`,
                height: "var(--mfx-header-height, 56px)",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding:
                    "calc(6px * var(--mfx-ui-scale, 1)) calc(70px * var(--mfx-ui-scale, 1)) calc(6px * var(--mfx-ui-scale, 1)) calc(78px * var(--mfx-ui-scale, 1))",
                boxSizing: "border-box",
                borderBottom: `1px solid ${MFX_COLORS.border}`,
                background: MFX_COLORS.panel
            }}
        >
            <div
                style={{
                    flex: "0 1 340px",
                    minWidth: 150
                }}
            >
                {draftMode ? (
                    <div
                        style={{
                            color: MFX_COLORS.cyan,
                            fontWeight: 900,
                            fontSize: "0.78rem",
                            letterSpacing: "0.05em"
                        }}
                    >
                        NEW PRESET — NOT SAVED
                    </div>
                ) : (
                    <PresetSelector />
                )}
            </div>

            <div
                style={{
                    flex: "1 1 auto",
                    minWidth: 0,
                    textAlign: "right"
                }}
            >
                <div
                    style={{
                        color: MFX_COLORS.purpleLight,
                        fontWeight: 900,
                        letterSpacing: "0.05em",
                        whiteSpace: "nowrap"
                    }}
                >
                    PRESET EDITOR
                </div>

                <div
                    style={{
                        color: MFX_COLORS.muted,
                        fontSize: "0.66rem",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis"
                    }}
                >
                    {subtitle}
                </div>
            </div>

            <button
                type="button"
                onClick={onToggleAdvanced}
                style={{
                    minHeight: 38,
                    padding: "4px 9px",
                    borderRadius: 8,
                    border: `1px solid ${MFX_COLORS.border}`,
                    background: advanced
                        ? MFX_COLORS.purpleSurface
                        : MFX_COLORS.panelAlt,
                    color: advanced
                        ? MFX_COLORS.purpleLight
                        : MFX_COLORS.text,
                    font: "inherit",
                    fontWeight: 800,
                    fontSize: "0.72rem",
                    cursor: "pointer",
                    whiteSpace: "nowrap"
                }}
            >
                {advanced ? "MULTIFX EDITOR" : "ADVANCED / SPLIT"}
            </button>
        </div>
    );
}

function EffectSettingsHeader({
    title,
    subtitle,
    draftMode
}: {
    title: string;
    subtitle: string;
    draftMode: boolean;
}) {
    return (
        <div
            className="multifx-screen-header"
            style={{
                flex: `0 0 ${MFX_HEADER_HEIGHT}px`,
                height: "var(--mfx-header-height, 56px)",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding:
                    "calc(6px * var(--mfx-ui-scale, 1)) calc(70px * var(--mfx-ui-scale, 1)) calc(6px * var(--mfx-ui-scale, 1)) calc(78px * var(--mfx-ui-scale, 1))",
                boxSizing: "border-box",
                borderBottom: `1px solid ${MFX_COLORS.border}`,
                background: MFX_COLORS.panel
            }}
        >
            <div
                style={{
                    flex: "0 1 300px",
                    minWidth: 140
                }}
            >
                {draftMode ? (
                    <div
                        style={{
                            color: MFX_COLORS.cyan,
                            fontWeight: 900,
                            fontSize: "0.78rem",
                            letterSpacing: "0.05em"
                        }}
                    >
                        NEW PRESET — NOT SAVED
                    </div>
                ) : (
                    <PresetSelector />
                )}
            </div>

            <div
                style={{
                    flex: "1 1 auto",
                    minWidth: 0,
                    textAlign: "right"
                }}
            >
                <div
                    style={{
                        color: MFX_COLORS.cyan,
                        fontWeight: 900,
                        letterSpacing: "0.03em",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis"
                    }}
                >
                    {title}
                </div>
                <div
                    style={{
                        color: MFX_COLORS.muted,
                        fontSize: "0.66rem",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis"
                    }}
                >
                    {subtitle}
                </div>
            </div>
        </div>
    );
}

function TrashDropTarget({ active }: { active: boolean }) {
    return (
        <div
            data-mfx-trash-drop-root="true"
            aria-label="Drop effect here to remove"
            title="Drop effect here to remove"
            style={{
                position: "fixed",
                right: 0,
                top: 0,
                zIndex: 50020,
                width: "calc(88px * var(--mfx-ui-scale, 1))",
                height: "calc(72px * var(--mfx-ui-scale, 1))",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "flex-end",
                padding: "8px",
                boxSizing: "border-box",
                pointerEvents: "none"
            }}
        >
            <div
                style={{
                    width: "calc(48px * var(--mfx-ui-scale, 1))",
                    minWidth:
                        "calc(48px * var(--mfx-ui-scale, 1))",
                    height: "var(--mfx-touch-height, 40px)",
                    minHeight: "var(--mfx-touch-height, 40px)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxSizing: "border-box",
                    borderRadius: 10,
                    border: `2px solid ${
                        active
                            ? MFX_COLORS.danger
                            : MFX_COLORS.purple
                    }`,
                    background: active
                        ? "rgba(127, 29, 29, 0.96)"
                        : MFX_COLORS.purpleSurface,
                    color: active
                        ? "#FEE2E2"
                        : MFX_COLORS.purpleLight,
                    boxShadow: active
                        ? "0 0 22px rgba(248,113,113,0.90)"
                        : "0 4px 14px rgba(0,0,0,0.5)",
                    transform: active ? "scale(1.08)" : "scale(1)",
                    transition:
                        "background 90ms ease, border-color 90ms ease, " +
                        "box-shadow 90ms ease, transform 90ms ease",
                    pointerEvents: "none"
                }}
            >
                <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    style={{ pointerEvents: "none" }}
                >
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M19 6l-1 14H6L5 6" />
                    <path d="M10 10v6" />
                    <path d="M14 10v6" />
                </svg>
            </div>
        </div>
    );
}

function displayName(item: PedalboardItem): string {
    if (item.isStart()) return "Input";
    if (item.isEnd()) return "Output";
    if (item.isSplit()) return item.title || "Split";
    if (item.isEmpty()) return "Empty";
    return item.title || item.pluginName || "Plugin";
}

function ChainCard({
    node,
    cardWidth,
    selected,
    dragging,
    onOpen,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onToggleEnabled
}: {
    node: ChainNode;
    cardWidth: number;
    selected: boolean;
    dragging: boolean;
    onOpen: () => void;
    onPointerDown: (
        event: React.PointerEvent<HTMLButtonElement>,
        item: PedalboardItem
    ) => void;
    onPointerMove: (
        event: React.PointerEvent<HTMLButtonElement>
    ) => void;
    onPointerUp: (
        event: React.PointerEvent<HTMLButtonElement>,
        item: PedalboardItem
    ) => void;
    onPointerCancel: (
        event: React.PointerEvent<HTMLButtonElement>
    ) => void;
    onToggleEnabled: (item: PedalboardItem) => void;
}) {
    if (node.kind === "input" || node.kind === "output") {
        return (
            <EndpointCard
                text={node.kind === "input" ? "INPUT" : "OUTPUT"}
                cardWidth={cardWidth}
                selected={selected}
                onClick={onOpen}
            />
        );
    }

    return (
        <PluginCard
            item={node.item}
            cardWidth={cardWidth}
            selected={selected}
            dragging={dragging}
            onPointerDown={(event) =>
                onPointerDown(event, node.item)
            }
            onPointerMove={onPointerMove}
            onPointerUp={(event) =>
                onPointerUp(event, node.item)
            }
            onPointerCancel={onPointerCancel}
            onToggleEnabled={() =>
                onToggleEnabled(node.item)
            }
        />
    );
}

function EndpointCard({
    text,
    cardWidth,
    selected,
    onClick
}: {
    text: string;
    cardWidth: number;
    selected: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                flex: `0 0 ${cardWidth}px`,
                width: cardWidth,
                height: "calc(108px * var(--mfx-ui-scale, 1))",
                borderRadius: 12,
                border: selected
                    ? `2px solid ${MFX_COLORS.cyan}`
                    : `1px solid ${MFX_COLORS.border}`,
                background: selected
                    ? MFX_COLORS.cyanSurface
                    : MFX_COLORS.panel,
                color: selected
                    ? MFX_COLORS.cyanText
                    : MFX_COLORS.muted,
                font: "inherit",
                fontWeight: 900,
                cursor: "pointer"
            }}
        >
            <div style={{ fontSize: "0.9rem" }}>{text}</div>
            <div
                style={{
                    marginTop: 6,
                    color: selected
                        ? MFX_COLORS.cyan
                        : MFX_COLORS.muted,
                    fontSize: "0.68rem",
                    fontWeight: 800
                }}
            >
                {text === "INPUT" ? "SIGNAL IN" : "SIGNAL OUT"}
            </div>
        </button>
    );
}

function PluginCard({
    item,
    cardWidth,
    selected,
    dragging,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onToggleEnabled
}: {
    item: PedalboardItem;
    cardWidth: number;
    selected: boolean;
    dragging: boolean;
    onPointerDown: (
        event: React.PointerEvent<HTMLButtonElement>
    ) => void;
    onPointerMove: (
        event: React.PointerEvent<HTMLButtonElement>
    ) => void;
    onPointerUp: (
        event: React.PointerEvent<HTMLButtonElement>
    ) => void;
    onPointerCancel: (
        event: React.PointerEvent<HTMLButtonElement>
    ) => void;
    onToggleEnabled: () => void;
}) {
    return (
        <button
            type="button"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            style={{
                flex: `0 0 ${cardWidth}px`,
                width: cardWidth,
                height: "calc(108px * var(--mfx-ui-scale, 1))",
                padding: "8px",
                borderRadius: 12,
                border: dragging
                    ? `2px dashed ${MFX_COLORS.cyan}`
                    : selected
                        ? `2px solid ${MFX_COLORS.cyan}`
                        : `1px solid ${MFX_COLORS.border}`,
                background: selected
                    ? MFX_COLORS.cyanSurface
                    : MFX_COLORS.panel,
                color: selected
                    ? MFX_COLORS.cyanText
                    : MFX_COLORS.text,
                textAlign: "left",
                font: "inherit",
                cursor: dragging ? "grabbing" : "grab",
                overflow: "hidden",
                boxSizing: "border-box",
                opacity: dragging
                    ? 0.38
                    : item.isEnabled
                        ? 1
                        : 0.72,
                touchAction: "none",
                transition:
                    "opacity 100ms ease, border-color 100ms ease, " +
                    "background 100ms ease"
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6
                }}
            >
                <div
                    aria-hidden="true"
                    style={{
                        color: MFX_COLORS.muted,
                        fontSize: "0.8rem",
                        fontWeight: 900,
                        letterSpacing: "-0.2em",
                        flex: "0 0 auto"
                    }}
                >
                    ⋮⋮
                </div>
                <div
                    style={{
                        minWidth: 0,
                        flex: "1 1 auto",
                        fontWeight: 900,
                        fontSize: "0.88rem",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis"
                    }}
                >
                    {displayName(item)}
                </div>

                <span
                    role="switch"
                    aria-checked={item.isEnabled}
                    aria-label={
                        item.isEnabled
                            ? "Effect enabled. Tap to bypass."
                            : "Effect bypassed. Tap to enable."
                    }
                    title={
                        item.isEnabled
                            ? "Enabled — tap to bypass"
                            : "Bypassed — tap to enable"
                    }
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                    onPointerMove={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                    onPointerUp={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                    onPointerCancel={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onToggleEnabled();
                    }}
                    style={{
                        flex: "0 0 auto",
                        width:
                            "calc(16px * var(--mfx-ui-scale, 1))",
                        height:
                            "calc(16px * var(--mfx-ui-scale, 1))",
                        minWidth:
                            "calc(16px * var(--mfx-ui-scale, 1))",
                        minHeight:
                            "calc(16px * var(--mfx-ui-scale, 1))",
                        borderRadius: "50%",
                        border: `2px solid ${
                            item.isEnabled
                                ? "#86EFAC"
                                : "#FCA5A5"
                        }`,
                        background: item.isEnabled
                            ? "#22C55E"
                            : MFX_COLORS.danger,
                        boxShadow: item.isEnabled
                            ? "0 0 9px rgba(34,197,94,0.95)"
                            : "0 0 9px rgba(248,113,113,0.95)",
                        cursor: "pointer",
                        boxSizing: "border-box"
                    }}
                />
            </div>

            <div
                style={{
                    marginTop: 5,
                    color: selected
                        ? MFX_COLORS.cyan
                        : item.isEnabled
                            ? MFX_COLORS.muted
                            : MFX_COLORS.danger,
                    fontSize: "0.7rem",
                    fontWeight: 800
                }}
            >
                {item.isSplit()
                    ? "SPLIT"
                    : item.isEnabled
                        ? "ACTIVE"
                        : "BYPASSED"}
            </div>

            <div
                style={{
                    marginTop: 9,
                    color: MFX_COLORS.muted,
                    fontSize: "0.61rem",
                    fontWeight: 700
                }}
            >
                TAP TO EDIT • LED = BYPASS
            </div>
        </button>
    );
}

function FlowInsertConnector({
    direction,
    gapIndex,
    dropActive,
    onAdd
}: {
    direction: "left" | "right";
    gapIndex: number;
    dropActive: boolean;
    onAdd: () => void;
}) {
    return (
        <div
            data-mfx-drop-gap={gapIndex}
            style={{
                position: "relative",
                flex: "0 0 calc(70px * var(--mfx-ui-scale, 1))",
                width: "calc(70px * var(--mfx-ui-scale, 1))",
                height: "calc(108px * var(--mfx-ui-scale, 1))"
            }}
        >
            <div
                aria-hidden="true"
                style={{
                    position: "absolute",
                    left: 4,
                    right: 4,
                    top: "68%",
                    height: dropActive ? 5 : 2,
                    borderRadius: 3,
                    background: dropActive
                        ? MFX_COLORS.cyan
                        : MFX_COLORS.muted,
                    boxShadow: dropActive
                        ? `0 0 12px ${MFX_COLORS.cyan}`
                        : "none",
                    opacity: dropActive ? 1 : 0.8
                }}
            />

            <div
                aria-hidden="true"
                style={{
                    position: "absolute",
                    top: "calc(68% - 7px)",
                    [direction === "right" ? "right" : "left"]: 1,
                    color: dropActive
                        ? MFX_COLORS.cyan
                        : MFX_COLORS.muted,
                    fontSize: "1rem",
                    fontWeight: 900,
                    lineHeight: 1
                }}
            >
                {direction === "right" ? "▶" : "◀"}
            </div>

            <AddPoint
                onClick={onAdd}
                compact
                style={{
                    position: "absolute",
                    left: "50%",
                    top: 12,
                    transform: "translateX(-50%)"
                }}
            />
        </div>
    );
}

function RowTurnConnector({
    side,
    gapIndex,
    dropActive,
    onAdd
}: {
    side: "left" | "right";
    gapIndex: number;
    dropActive: boolean;
    onAdd?: () => void;
}) {
    const onRight = side === "right";

    return (
        <div
            data-mfx-drop-gap={gapIndex}
            style={{
                position: "relative",
                height: "calc(48px * var(--mfx-ui-scale, 1))",
                margin: "0 4px"
            }}
        >
            <div
                aria-hidden="true"
                style={{
                    position: "absolute",
                    top: -4,
                    bottom: 4,
                    [onRight ? "right" : "left"]:
                        "calc(7% + 12px)",
                    width: dropActive ? 5 : 2,
                    borderRadius: 3,
                    background: dropActive
                        ? MFX_COLORS.cyan
                        : MFX_COLORS.muted,
                    boxShadow: dropActive
                        ? `0 0 12px ${MFX_COLORS.cyan}`
                        : "none",
                    opacity: dropActive ? 1 : 0.8
                }}
            />

            <div
                aria-hidden="true"
                style={{
                    position: "absolute",
                    bottom: -1,
                    [onRight ? "right" : "left"]:
                        "calc(7% + 5px)",
                    color: dropActive
                        ? MFX_COLORS.cyan
                        : MFX_COLORS.muted,
                    fontSize: "1rem",
                    fontWeight: 900,
                    lineHeight: 1
                }}
            >
                ▼
            </div>

            {onAdd && (
                <AddPoint
                    onClick={onAdd}
                    compact
                    style={{
                        position: "absolute",
                        top: "50%",
                        transform: "translateY(-50%)",
                        left: onRight ? "calc(93% + 18px)" : "auto",
                        right: onRight ? "auto" : "calc(93% + 18px)"
                    }}
                />
            )}
        </div>
    );
}

function AddPoint({
    onClick,
    compact = false,
    style
}: {
    onClick: () => void;
    compact?: boolean;
    style?: React.CSSProperties;
}) {
    const size = compact ? 34 : 40;

    return (
        <button
            type="button"
            aria-label="Add effect here"
            title="Add effect here"
            onClick={onClick}
            style={{
                width: `calc(${size}px * var(--mfx-ui-scale, 1))`,
                height: `calc(${size}px * var(--mfx-ui-scale, 1))`,
                minWidth: `calc(${size}px * var(--mfx-ui-scale, 1))`,
                minHeight: `calc(${size}px * var(--mfx-ui-scale, 1))`,
                borderRadius: `calc(${size / 2}px * var(--mfx-ui-scale, 1))`,
                border: `2px solid ${MFX_COLORS.purple}`,
                background: MFX_COLORS.background,
                color: MFX_COLORS.purpleLight,
                font: "inherit",
                fontWeight: 900,
                fontSize: compact ? "1.15rem" : "1.35rem",
                lineHeight: 1,
                cursor: "pointer",
                zIndex: 2,
                padding: 0,
                ...style
            }}
        >
            +
        </button>
    );
}

function SmallButton({
    text,
    onClick,
    cyan = false,
    danger = false
}: {
    text: string;
    onClick: () => void;
    cyan?: boolean;
    danger?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                minHeight: "var(--mfx-touch-height, 40px)",
                minWidth:
                    text.length <= 2
                        ? "calc(44px * var(--mfx-ui-scale, 1))"
                        : "calc(68px * var(--mfx-ui-scale, 1))",
                padding: "5px 9px",
                borderRadius: 8,
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
                font: "inherit",
                fontWeight: 850,
                fontSize: "0.73rem",
                cursor: "pointer",
                whiteSpace: "nowrap"
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
    background: MFX_COLORS.background,
    color: MFX_COLORS.text
};
