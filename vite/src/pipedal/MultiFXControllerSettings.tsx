import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    clearSavedControllerConfig,
    CONTROLLER_LAYOUT_ELEMENT_IDS,
    CONTROLLER_LAYOUT_ELEMENT_LABELS,
    ControllerLayoutConfig,
    ControllerLayoutElementId,
    ControllerLayoutElementShape,
    ControllerLayoutElementStyle,
    ControllerLayoutRect,
    ControllerSwitchAction,
    ControllerSwitchConfig,
    defaultControllerConfig,
    ensureControllerPerformanceLayout,
    loadControllerConfig,
    MAX_CONTROLLER_COLUMNS,
    MAX_CONTROLLER_ROWS,
    MAX_FOOTSWITCHES,
    MAX_LONG_PRESS_MS,
    MIN_FREEFORM_HEADER_HEIGHT,
    MIN_FREEFORM_HEADER_WIDTH,
    MIN_FREEFORM_SWITCH_HEIGHT,
    MIN_FREEFORM_SWITCH_WIDTH,
    MIN_LONG_PRESS_MS,
    saveControllerConfig
} from "./ControllerConfig";
import {
    ControllerHardwareConfig,
    ControllerInputSource,
    controllerInputSourceId
} from "./ControllerHardwareConfig";
import MultiFXControllerHardwareSettings from "./MultiFXControllerHardwareSettings";
import {
    getLatestMultiFXRuntimeState,
    MultiFXControllerHardware,
    MultiFXControllerLearn,
    subscribeMultiFXRuntimeState,
    updateMultiFXRuntimeState
} from "./MultiFXRuntimeSync";
import { MFX_COLORS, MFX_HEADER_HEIGHT } from "./MultiFXTheme";

type ActionKind =
    | "none"
    | "preset"
    | "bankUp"
    | "bankDown"
    | "chainBypass"
    | "snapshotMode";

type SwitchLearnSession = {
    token: number;
    switchId: string;
};

const LAYOUT_SNAP_PIXELS_STORAGE_KEY =
    "pipedal-multifx-layout-snap-pixels-v1";
const DEFAULT_LAYOUT_SNAP_PIXELS = 10;
const MIN_LAYOUT_SNAP_PIXELS = 1;
const MAX_LAYOUT_SNAP_PIXELS = 64;

const LAYOUT_EDITOR_MODE_STORAGE_KEY =
    "pipedal-multifx-layout-editor-mode-v1";

function loadLastLayoutEditorMode(): "grid" | "freeform" {
    try {
        return window.localStorage.getItem(
            LAYOUT_EDITOR_MODE_STORAGE_KEY
        ) === "freeform"
            ? "freeform"
            : "grid";
    } catch {
        return "grid";
    }
}

function saveLastLayoutEditorMode(
    mode: "grid" | "freeform"
) {
    try {
        window.localStorage.setItem(
            LAYOUT_EDITOR_MODE_STORAGE_KEY,
            mode
        );
    } catch {
        // Browser storage is optional.
    }
}

function loadLayoutSnapPixels(): number {
    try {
        const raw = window.localStorage.getItem(
            LAYOUT_SNAP_PIXELS_STORAGE_KEY
        );
        const value = raw === null ? NaN : Number(raw);
        if (Number.isFinite(value)) {
            return Math.max(
                MIN_LAYOUT_SNAP_PIXELS,
                Math.min(
                    MAX_LAYOUT_SNAP_PIXELS,
                    Math.round(value)
                )
            );
        }
    } catch {
        // Browser storage is optional.
    }
    return DEFAULT_LAYOUT_SNAP_PIXELS;
}

function saveLayoutSnapPixels(value: number) {
    try {
        window.localStorage.setItem(
            LAYOUT_SNAP_PIXELS_STORAGE_KEY,
            String(value)
        );
    } catch {
        // Browser storage is optional.
    }
}

const LAYOUT_SNAP_ENABLED_STORAGE_KEY =
    "pipedal-multifx-layout-snap-enabled-v1";

function loadLayoutSnapEnabled(): boolean {
    try {
        const raw = window.localStorage.getItem(
            LAYOUT_SNAP_ENABLED_STORAGE_KEY
        );
        return raw === null ? true : raw !== "false";
    } catch {
        return true;
    }
}

function saveLayoutSnapEnabled(value: boolean) {
    try {
        window.localStorage.setItem(
            LAYOUT_SNAP_ENABLED_STORAGE_KEY,
            value ? "true" : "false"
        );
    } catch {
        // Browser storage is optional.
    }
}

type DragTarget =
    | {
        kind: "element";
        id: ControllerLayoutElementId;
        mode: "move" | "resize";
    }
    | { kind: "switch"; id: string; mode: "move" | "resize"; };

type DragState = DragTarget & {
    pointerId: number;
    startX: number;
    startY: number;
    startRect: ControllerLayoutRect;
    previewRect: ControllerLayoutRect;
    moved: boolean;
};

type FreeformDragVisual = {
    targetKey: string;
    rect: ControllerLayoutRect;
};

type PlacementTarget =
    | {
        kind: "element";
        id: ControllerLayoutElementId;
    }
    | {
        kind: "switch";
        id: string;
    };

type PlacementDragState = PlacementTarget & {
    pointerId: number;
    label: string;
    preferredWidth: number;
    preferredHeight: number;
    minWidth: number;
    minHeight: number;
    previewRect: ControllerLayoutRect | null;
    valid: boolean;
};

type PlacementDragVisual = PlacementTarget & {
    label: string;
    rect: ControllerLayoutRect;
    valid: boolean;
};

type GridDragState = {
    id: string;
    label: string;
    sublabel: string;
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
    sourceRow: number;
    sourceColumn: number;
    moved: boolean;
};

type GridDragVisual = {
    id: string;
    label: string;
    sublabel: string;
    x: number;
    y: number;
    width: number;
    height: number;
};

type GridDropCell = {
    row: number;
    column: number;
};


function layoutTargetKey(target: DragTarget): string {
    return target.kind === "element"
        ? `element:${target.id}`
        : `switch:${target.id}`;
}

function parseLayoutTargetKey(
    key: string
): DragTarget | undefined {
    if (key.startsWith("element:")) {
        return {
            kind: "element",
            id: key.substring(
                "element:".length
            ) as ControllerLayoutElementId,
            mode: "move"
        };
    }

    if (key.startsWith("switch:")) {
        return {
            kind: "switch",
            id: key.substring("switch:".length),
            mode: "move"
        };
    }

    return undefined;
}

function configTargetRect(
    config: ControllerLayoutConfig,
    target: DragTarget
): ControllerLayoutRect | undefined {
    return target.kind === "element"
        ? config.performanceLayout.elements[
            target.id
        ]?.rect
        : config.performanceLayout.switches[
            target.id
        ];
}

function setConfigTargetRect(
    config: ControllerLayoutConfig,
    target: DragTarget,
    rect: ControllerLayoutRect
): ControllerLayoutConfig {
    if (target.kind === "switch") {
        return {
            ...config,
            performanceLayout: {
                ...config.performanceLayout,
                switches: {
                    ...config.performanceLayout.switches,
                    [target.id]: { ...rect }
                }
            }
        };
    }

    const elements = {
        ...config.performanceLayout.elements,
        [target.id]: {
            ...config.performanceLayout.elements[
                target.id
            ],
            rect: { ...rect }
        }
    };

    return {
        ...config,
        performanceLayout: {
            ...config.performanceLayout,
            elements
        }
    };
}

function cloneConfig(config: ControllerLayoutConfig): ControllerLayoutConfig {
    return structuredClone(config);
}

function actionKind(action: ControllerSwitchAction): ActionKind {
    return action.type;
}

function makeAction(
    type: ActionKind,
    previous?: ControllerSwitchAction
): ControllerSwitchAction {
    switch (type) {
        case "preset":
            return {
                type: "preset",
                presetIndex:
                    previous?.type === "preset"
                        ? previous.presetIndex
                        : 0
            };
        case "bankUp":
            return { type: "bankUp" };
        case "bankDown":
            return { type: "bankDown" };
        case "chainBypass":
            return { type: "chainBypass" };
        case "snapshotMode":
            return { type: "snapshotMode" };
        default:
            return { type: "none", text: "Unused" };
    }
}

function actionLabel(action: ControllerSwitchAction): string {
    switch (action.type) {
        case "preset":
            return `Preset slot ${action.presetIndex + 1}`;
        case "bankUp":
            return "Bank Up";
        case "bankDown":
            return "Bank Down";
        case "chainBypass":
            return "Chain Bypass";
        case "snapshotMode":
            return "Snapshot Mode";
        case "none":
            return action.text || "Unused";
    }
}

function normalizeShortPresetOrder(
    switches: ControllerSwitchConfig[],
    movedId?: string,
    requestedIndex?: number
): ControllerSwitchConfig[] {
    const originalIndex = new Map(
        switches.map((item, index) => [item.id, index])
    );

    const presetIds = switches
        .filter((item) => item.action.type === "preset")
        .sort((left, right) => {
            const leftIndex =
                left.action.type === "preset"
                    ? left.action.presetIndex
                    : 0;
            const rightIndex =
                right.action.type === "preset"
                    ? right.action.presetIndex
                    : 0;

            if (leftIndex !== rightIndex) {
                return leftIndex - rightIndex;
            }

            return (
                (originalIndex.get(left.id) ?? 0)
                - (originalIndex.get(right.id) ?? 0)
            );
        })
        .map((item) => item.id);

    if (
        movedId
        && presetIds.includes(movedId)
        && requestedIndex !== undefined
    ) {
        const withoutMoved = presetIds.filter(
            (id) => id !== movedId
        );
        const insertAt = Math.max(
            0,
            Math.min(
                withoutMoved.length,
                Math.round(requestedIndex)
            )
        );
        withoutMoved.splice(insertAt, 0, movedId);
        presetIds.splice(0, presetIds.length, ...withoutMoved);
    }

    const presetOrder = new Map(
        presetIds.map((id, index) => [id, index])
    );

    return switches.map((item) => {
        if (item.action.type !== "preset") {
            return item;
        }

        return {
            ...item,
            action: {
                type: "preset",
                presetIndex: presetOrder.get(item.id) ?? 0
            }
        };
    });
}

function compactGridAfterRemoval(
    switches: ControllerSwitchConfig[],
    columns: number
): {
    switches: ControllerSwitchConfig[];
    rows: number;
} {
    const safeColumns = Math.max(
        1,
        Math.min(MAX_CONTROLLER_COLUMNS, columns)
    );

    // Preserve the user's visible grid ordering while closing the hole left by
    // the deleted switch. This lets the final now-empty row disappear and the
    // remaining controls grow back to the available height.
    const ordered = [...switches].sort((left, right) => {
        const leftRow = left.row ?? 1;
        const rightRow = right.row ?? 1;
        if (leftRow !== rightRow) return leftRow - rightRow;

        const leftColumn = left.column ?? 1;
        const rightColumn = right.column ?? 1;
        return leftColumn - rightColumn;
    });

    const rows = Math.max(
        1,
        Math.min(
            MAX_CONTROLLER_ROWS,
            Math.ceil(Math.max(1, ordered.length) / safeColumns)
        )
    );

    return {
        rows,
        switches: ordered.map((item, index) => ({
            ...item,
            row: Math.floor(index / safeColumns) + 1,
            column: (index % safeColumns) + 1
        }))
    };
}


function normalizeControllerPresetSlots(
    config: ControllerLayoutConfig
): ControllerLayoutConfig {
    return ensureControllerPerformanceLayout({
        ...config,
        switches: normalizeShortPresetOrder(config.switches)
    });
}


function minimumRowsFor(
    switchCount: number,
    columns: number
): number {
    return Math.max(
        1,
        Math.min(
            MAX_CONTROLLER_ROWS,
            Math.ceil(Math.max(1, switchCount) / Math.max(1, columns))
        )
    );
}

function minimumColumnsFor(
    switchCount: number,
    rows: number
): number {
    return Math.max(
        1,
        Math.min(
            MAX_CONTROLLER_COLUMNS,
            Math.ceil(Math.max(1, switchCount) / Math.max(1, rows))
        )
    );
}

function fitGridDimensions(
    switchCount: number,
    requestedColumns: number,
    requestedRows: number
): { columns: number; rows: number } {
    let columns = Math.max(
        1,
        Math.min(MAX_CONTROLLER_COLUMNS, Math.round(requestedColumns))
    );
    let rows = Math.max(
        1,
        Math.min(MAX_CONTROLLER_ROWS, Math.round(requestedRows))
    );

    while (columns * rows < switchCount && rows < MAX_CONTROLLER_ROWS) {
        rows += 1;
    }
    while (columns * rows < switchCount && columns < MAX_CONTROLLER_COLUMNS) {
        columns += 1;
    }

    return { columns, rows };
}

function normalizeGridPositions(
    config: ControllerLayoutConfig,
    columns: number,
    rows: number
): ControllerLayoutConfig {
    const occupied = new Set<string>();
    const switches = config.switches.map((item) => {
        let row = Math.max(1, Math.min(rows, item.row ?? 1));
        let column = Math.max(1, Math.min(columns, item.column ?? 1));
        let key = `${row}:${column}`;

        if (occupied.has(key)) {
            let found = false;
            for (let r = 1; r <= rows && !found; ++r) {
                for (let c = 1; c <= columns; ++c) {
                    const candidate = `${r}:${c}`;
                    if (!occupied.has(candidate)) {
                        row = r;
                        column = c;
                        key = candidate;
                        found = true;
                        break;
                    }
                }
            }
        }

        occupied.add(key);
        return { ...item, row, column };
    });

    return ensureControllerPerformanceLayout({
        ...config,
        columns,
        rows,
        switches
    });
}

function rectsOverlap(
    left: ControllerLayoutRect,
    right: ControllerLayoutRect,
    epsilon = 0.000001
): boolean {
    return (
        left.x < right.x + right.width - epsilon
        && left.x + left.width > right.x + epsilon
        && left.y < right.y + right.height - epsilon
        && left.y + left.height > right.y + epsilon
    );
}


function rectInsideBounds(rect: ControllerLayoutRect): boolean {
    return (
        rect.x >= 0
        && rect.y >= 0
        && rect.width > 0
        && rect.height > 0
        && rect.x + rect.width <= 1
        && rect.y + rect.height <= 1
    );
}


function freeformOccupiedRects(
    config: ControllerLayoutConfig,
    exclude?: PlacementTarget
): ControllerLayoutRect[] {
    const layout = config.performanceLayout;

    const elementRects = CONTROLLER_LAYOUT_ELEMENT_IDS
        .filter(
            (id) =>
                layout.elements[id].visible
                && !(
                    exclude?.kind === "element"
                    && exclude.id === id
                )
        )
        .map((id) => layout.elements[id].rect);

    const switchRects = config.switches
        .filter(
            (item) =>
                !layout.unplacedSwitchIds.includes(item.id)
                && !(
                    exclude?.kind === "switch"
                    && exclude.id === item.id
                )
        )
        .map((item) => layout.switches[item.id])
        .filter(
            (rect): rect is ControllerLayoutRect =>
                Boolean(rect)
        );

    return [...elementRects, ...switchRects];
}

function preferredFreeformSwitchSize(
    config: ControllerLayoutConfig,
    switchId: string
): {
    width: number;
    height: number;
} {
    const layout = config.performanceLayout;
    const existingRect = config.switches
        .filter(
            (item) =>
                item.id !== switchId
                && !layout.unplacedSwitchIds.includes(item.id)
        )
        .map((item) => layout.switches[item.id])
        .find(
            (rect): rect is ControllerLayoutRect =>
                Boolean(rect)
        );

    if (existingRect) {
        return {
            width: Math.max(
                MIN_FREEFORM_SWITCH_WIDTH,
                existingRect.width
            ),
            height: Math.max(
                MIN_FREEFORM_SWITCH_HEIGHT,
                existingRect.height
            )
        };
    }

    const visibleElementBottoms = CONTROLLER_LAYOUT_ELEMENT_IDS
        .map((id) => layout.elements[id])
        .filter((element) => element.visible)
        .map(
            (element) =>
                element.rect.y + element.rect.height
        );
    const headerBottom = visibleElementBottoms.length > 0
        ? Math.max(...visibleElementBottoms)
        : 0;
    const availableHeight = Math.max(
        MIN_FREEFORM_SWITCH_HEIGHT,
        1 - headerBottom
    );

    return {
        width: Math.max(
            MIN_FREEFORM_SWITCH_WIDTH,
            1 / Math.max(1, config.columns) - 0.012
        ),
        height: Math.max(
            MIN_FREEFORM_SWITCH_HEIGHT,
            availableHeight / Math.max(1, config.rows) - 0.014
        )
    };
}

function placementSizeForTarget(
    config: ControllerLayoutConfig,
    target: PlacementTarget
): {
    preferredWidth: number;
    preferredHeight: number;
    minWidth: number;
    minHeight: number;
} {
    if (target.kind === "element") {
        const element =
            config.performanceLayout.elements[target.id];
        return {
            preferredWidth: Math.max(
                MIN_FREEFORM_HEADER_WIDTH,
                element.rect.width
            ),
            preferredHeight: Math.max(
                MIN_FREEFORM_HEADER_HEIGHT,
                element.rect.height
            ),
            minWidth: MIN_FREEFORM_HEADER_WIDTH,
            minHeight: MIN_FREEFORM_HEADER_HEIGHT
        };
    }

    const preferred = preferredFreeformSwitchSize(
        config,
        target.id
    );
    return {
        preferredWidth: preferred.width,
        preferredHeight: preferred.height,
        minWidth: MIN_FREEFORM_SWITCH_WIDTH,
        minHeight: MIN_FREEFORM_SWITCH_HEIGHT
    };
}

function adaptivePlacementSizes(
    preferredWidth: number,
    preferredHeight: number,
    minWidth: number,
    minHeight: number
): Array<{ width: number; height: number }> {
    const sizes: Array<{ width: number; height: number }> = [];
    const seen = new Set<string>();

    for (let step = 0; step <= 12; ++step) {
        const scale = 1 - step * 0.075;
        const width = Math.max(
            minWidth,
            preferredWidth * scale
        );
        const height = Math.max(
            minHeight,
            preferredHeight * scale
        );
        const key = `${width.toFixed(6)}:${height.toFixed(6)}`;
        if (!seen.has(key)) {
            seen.add(key);
            sizes.push({ width, height });
        }

        if (
            width <= minWidth + 0.000001
            && height <= minHeight + 0.000001
        ) {
            break;
        }
    }

    const minimumKey =
        `${minWidth.toFixed(6)}:${minHeight.toFixed(6)}`;
    if (!seen.has(minimumKey)) {
        sizes.push({
            width: minWidth,
            height: minHeight
        });
    }

    return sizes;
}

function centeredPlacementRect(
    centerX: number,
    centerY: number,
    width: number,
    height: number
): ControllerLayoutRect {
    return {
        x: Math.min(
            1 - width,
            Math.max(0, centerX - width / 2)
        ),
        y: Math.min(
            1 - height,
            Math.max(0, centerY - height / 2)
        ),
        width,
        height
    };
}

function adaptivePlacementPreview(
    config: ControllerLayoutConfig,
    target: PlacementTarget,
    centerX: number,
    centerY: number
): {
    rect: ControllerLayoutRect;
    valid: boolean;
} {
    const size = placementSizeForTarget(config, target);
    const occupied = freeformOccupiedRects(
        config,
        target
    );
    const sizes = adaptivePlacementSizes(
        size.preferredWidth,
        size.preferredHeight,
        size.minWidth,
        size.minHeight
    );

    for (const candidateSize of sizes) {
        const rect = centeredPlacementRect(
            centerX,
            centerY,
            candidateSize.width,
            candidateSize.height
        );
        if (
            rectInsideBounds(rect)
            && occupied.every(
                (other) => !rectsOverlap(rect, other)
            )
        ) {
            return { rect, valid: true };
        }
    }

    return {
        rect: centeredPlacementRect(
            centerX,
            centerY,
            size.minWidth,
            size.minHeight
        ),
        valid: false
    };
}

function findAdaptiveFreeformPlacement(
    config: ControllerLayoutConfig,
    target: PlacementTarget
): ControllerLayoutRect | null {
    const size = placementSizeForTarget(config, target);
    const occupied = freeformOccupiedRects(
        config,
        target
    );
    const sizes = adaptivePlacementSizes(
        size.preferredWidth,
        size.preferredHeight,
        size.minWidth,
        size.minHeight
    );

    for (const candidateSize of sizes) {
        const xCandidates = new Set<number>([
            0,
            Math.max(0, 1 - candidateSize.width)
        ]);
        const yCandidates = new Set<number>([
            0,
            Math.max(0, 1 - candidateSize.height)
        ]);

        for (const other of occupied) {
            xCandidates.add(
                Math.max(
                    0,
                    Math.min(
                        1 - candidateSize.width,
                        other.x - candidateSize.width
                    )
                )
            );
            xCandidates.add(
                Math.max(
                    0,
                    Math.min(
                        1 - candidateSize.width,
                        other.x + other.width
                    )
                )
            );
            yCandidates.add(
                Math.max(
                    0,
                    Math.min(
                        1 - candidateSize.height,
                        other.y - candidateSize.height
                    )
                )
            );
            yCandidates.add(
                Math.max(
                    0,
                    Math.min(
                        1 - candidateSize.height,
                        other.y + other.height
                    )
                )
            );
        }

        // Edge-derived candidates find tight gaps exactly. A light scan fills
        // in open areas that are not aligned to another control edge.
        const scanStepX = Math.max(
            0.02,
            Math.min(0.08, candidateSize.width / 3)
        );
        const scanStepY = Math.max(
            0.02,
            Math.min(0.08, candidateSize.height / 3)
        );
        for (
            let x = 0;
            x <= 1 - candidateSize.width + 0.000001;
            x += scanStepX
        ) {
            xCandidates.add(
                Math.min(1 - candidateSize.width, x)
            );
        }
        for (
            let y = 0;
            y <= 1 - candidateSize.height + 0.000001;
            y += scanStepY
        ) {
            yCandidates.add(
                Math.min(1 - candidateSize.height, y)
            );
        }

        const sortedY = [...yCandidates].sort(
            (left, right) => left - right
        );
        const sortedX = [...xCandidates].sort(
            (left, right) => left - right
        );

        for (const y of sortedY) {
            for (const x of sortedX) {
                const rect: ControllerLayoutRect = {
                    x,
                    y,
                    width: candidateSize.width,
                    height: candidateSize.height
                };
                if (
                    rectInsideBounds(rect)
                    && occupied.every(
                        (other) =>
                            !rectsOverlap(rect, other)
                    )
                ) {
                    return rect;
                }
            }
        }
    }

    return null;
}

function applyFreeformPlacement(
    config: ControllerLayoutConfig,
    target: PlacementTarget,
    rect: ControllerLayoutRect
): ControllerLayoutConfig {
    if (target.kind === "element") {
        const currentElement =
            config.performanceLayout.elements[target.id];
        return ensureControllerPerformanceLayout({
            ...config,
            performanceLayout: {
                ...config.performanceLayout,
                elements: {
                    ...config.performanceLayout.elements,
                    [target.id]: {
                        ...currentElement,
                        visible: true,
                        rect: { ...rect }
                    }
                }
            }
        });
    }

    return ensureControllerPerformanceLayout({
        ...config,
        performanceLayout: {
            ...config.performanceLayout,
            switches: {
                ...config.performanceLayout.switches,
                [target.id]: { ...rect }
            },
            unplacedSwitchIds:
                config.performanceLayout.unplacedSwitchIds.filter(
                    (id) => id !== target.id
                )
        }
    });
}

function ensureValidFreeformLayout(
    config: ControllerLayoutConfig
): ControllerLayoutConfig {
    // Freeform geometry is manual. Normalization keeps rectangles in bounds,
    // while the editor itself prevents overlap during move/resize.
    // Never move or resize existing controls here.
    return ensureControllerPerformanceLayout(config);
}


function arrangeFreeformSwitchesFromGrid(
    config: ControllerLayoutConfig
): ControllerLayoutConfig {
    const layout = config.performanceLayout;
    const visibleElementBottoms = CONTROLLER_LAYOUT_ELEMENT_IDS
        .map((id) => layout.elements[id])
        .filter((element) => element.visible)
        .map((element) => element.rect.y + element.rect.height);
    const headerBottom = visibleElementBottoms.length > 0
        ? Math.max(...visibleElementBottoms)
        : 0;
    const columns = Math.max(1, config.columns);
    const rows = Math.max(1, config.rows);
    const availableHeight = Math.max(
        MIN_FREEFORM_SWITCH_HEIGHT,
        1 - headerBottom
    );
    const gapX = 0.012;
    const gapY = 0.014;
    const cellWidth = 1 / columns;
    const cellHeight = availableHeight / rows;

    const switches: Record<string, ControllerLayoutRect> = {};

    config.switches.forEach((item, index) => {
        const row = Math.max(
            0,
            Math.min(
                rows - 1,
                (item.row ?? Math.floor(index / columns) + 1) - 1
            )
        );
        const column = Math.max(
            0,
            Math.min(
                columns - 1,
                (item.column ?? (index % columns) + 1) - 1
            )
        );
        const width = Math.max(
            MIN_FREEFORM_SWITCH_WIDTH,
            cellWidth - gapX
        );
        const height = Math.max(
            MIN_FREEFORM_SWITCH_HEIGHT,
            cellHeight - gapY
        );

        switches[item.id] = {
            x: Math.min(
                1 - width,
                column * cellWidth + gapX / 2
            ),
            y: Math.min(
                1 - height,
                headerBottom + row * cellHeight + gapY / 2
            ),
            width,
            height
        };
    });

    return ensureControllerPerformanceLayout({
        ...config,
        performanceLayout: {
            ...layout,
            mode: "freeform",
            switches,
            unplacedSwitchIds: []
        }
    });
}

function captureGridLayoutDefault(
    config: ControllerLayoutConfig
) {
    return {
        columns: config.columns,
        rows: config.rows,
        positions: Object.fromEntries(
            config.switches.map((item) => [
                item.id,
                {
                    row: item.row ?? 1,
                    column: item.column ?? 1
                }
            ])
        )
    };
}

function captureFreeformLayoutDefault(
    config: ControllerLayoutConfig
) {
    return {
        switches: Object.fromEntries(
            Object.entries(config.performanceLayout.switches).map(
                ([id, rect]) => [id, { ...rect }]
            )
        ),
        unplacedSwitchIds: [
            ...config.performanceLayout.unplacedSwitchIds
        ],
        elements: structuredClone(
            config.performanceLayout.elements
        )
    };
}

function applySavedGridDefault(
    config: ControllerLayoutConfig
): ControllerLayoutConfig {
    const saved = config.layoutDefaults.grid;
    if (!saved) {
        const switches = config.switches.map((item, index) => ({
            ...item,
            row: Math.floor(index / config.columns) + 1,
            column: (index % config.columns) + 1
        }));
        return normalizeGridPositions(
            { ...config, switches },
            config.columns,
            config.rows
        );
    }

    const switches = config.switches.map((item) => {
        const position = saved.positions[item.id];
        return position
            ? {
                ...item,
                row: position.row,
                column: position.column
            }
            : item;
    });

    return normalizeGridPositions(
        {
            ...config,
            columns: saved.columns,
            rows: saved.rows,
            switches
        },
        saved.columns,
        saved.rows
    );
}

function applySavedFreeformDefault(
    config: ControllerLayoutConfig
): ControllerLayoutConfig {
    const saved = config.layoutDefaults.freeform;
    if (!saved) {
        return makeDefaultFreeformLayout(config);
    }

    return ensureControllerPerformanceLayout({
        ...config,
        performanceLayout: {
            ...config.performanceLayout,
            mode: "freeform",
            switches: Object.fromEntries(
                Object.entries(saved.switches).map(
                    ([id, rect]) => [
                        id,
                        { ...rect }
                    ]
                )
            ),
            unplacedSwitchIds: [
                ...saved.unplacedSwitchIds
            ],
            elements: structuredClone(saved.elements)
        }
    });
}

function makeDefaultFreeformLayout(
    config: ControllerLayoutConfig
): ControllerLayoutConfig {
    const defaultElements = structuredClone(
        defaultControllerConfig.performanceLayout.elements
    );

    return ensureControllerPerformanceLayout({
        ...config,
        performanceLayout: {
            ...config.performanceLayout,
            mode: "freeform",
            switches: {},
            unplacedSwitchIds: [
                ...config.performanceLayout.unplacedSwitchIds
            ],
            elements: defaultElements
        }
    });
}


function BufferedIntegerInput(props: {
    value: number;
    min: number;
    max: number;
    step?: number;
    onValueChange: (value: number) => void;
    style?: React.CSSProperties;
}) {
    const {
        value,
        min,
        max,
        step = 1,
        onValueChange,
        style
    } = props;
    const [text, setText] = useState(() => String(value));
    const editingRef = useRef(false);

    useEffect(() => {
        if (!editingRef.current) {
            setText(String(value));
        }
    }, [value]);

    const updateText = (nextText: string) => {
        setText(nextText);

        if (nextText.trim() === "") return;

        const numericValue = Number(nextText);
        if (!Number.isFinite(numericValue)) return;

        const normalized = Math.round(numericValue);
        if (normalized < min || normalized > max) {
            return;
        }

        onValueChange(normalized);
    };

    const finishEdit = () => {
        editingRef.current = false;

        if (text.trim() === "") {
            setText(String(value));
            return;
        }

        const numericValue = Number(text);
        if (!Number.isFinite(numericValue)) {
            setText(String(value));
            return;
        }

        const normalized = Math.max(
            min,
            Math.min(max, Math.round(numericValue))
        );

        setText(String(normalized));
        if (normalized !== value) {
            onValueChange(normalized);
        }
    };

    return (
        <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={text}
            onFocus={() => {
                editingRef.current = true;
            }}
            onChange={(event) => updateText(event.target.value)}
            onBlur={finishEdit}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    event.currentTarget.blur();
                } else if (event.key === "Escape") {
                    editingRef.current = false;
                    setText(String(value));
                    event.currentTarget.blur();
                }
            }}
            style={style}
        />
    );
}


interface MultiFXControllerSettingsProps {
    backRequest?: number;
    onClose?: () => void;
}

export default function MultiFXControllerSettings({
    backRequest = 0,
    onClose
}: MultiFXControllerSettingsProps) {
    const [config, setConfig] = useState<ControllerLayoutConfig>(
        () => ensureControllerPerformanceLayout(
            cloneConfig(defaultControllerConfig)
        )
    );
    const [selectedId, setSelectedId] = useState("");
    const [message, setMessage] = useState("");
    const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
    const [hardwareEditorOpen, setHardwareEditorOpen] = useState(false);
    const handledBackRequest = useRef(backRequest);

    // Give nested Controller pages first chance to handle the shell's Back
    // button. Only Back from the main Controller page returns to Settings.
    useEffect(() => {
        if (backRequest === handledBackRequest.current) return;
        handledBackRequest.current = backRequest;
        if (layoutEditorOpen) {
            setLayoutEditorOpen(false);
        } else if (hardwareEditorOpen) {
            setHardwareEditorOpen(false);
        } else {
            onClose?.();
        }
    }, [backRequest, hardwareEditorOpen, layoutEditorOpen, onClose]);
    const latestRuntime = getLatestMultiFXRuntimeState();
    const [controllerHardware, setControllerHardware] =
        useState<MultiFXControllerHardware>(() =>
            latestRuntime?.controllerHardware ?? {
                connected: false,
                protocolVersion: null,
                boardId: null,
                boardName: null,
                drivers: [],
                limits: { modules: 0, analogControls: 0, encoders: 0 },
                inputs: [],
                apply: { status: "idle", token: null, message: "" }
            }
        );
    const [controllerLearn, setControllerLearn] =
        useState<MultiFXControllerLearn>(() =>
            latestRuntime?.controllerLearn ?? {
                status: "idle",
                token: null,
                capability: null,
                input: null,
                secondaryInput: null,
                message: ""
            }
        );
    const [learnSession, setLearnSession] =
        useState<SwitchLearnSession | null>(null);
    const learnSessionRef = useRef<SwitchLearnSession | null>(null);
    const [, setLearnFeedback] = useState("");

    useEffect(() => {
        let cancelled = false;
        void loadControllerConfig().then((result) => {
            if (cancelled) return;
            const normalized =
                normalizeControllerPresetSlots(result.config);
            setConfig(cloneConfig(normalized));
            setSelectedId(normalized.switches[0]?.id ?? "");
            if (result.error) setMessage(result.error);
        });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => subscribeMultiFXRuntimeState((runtime) => {
        setControllerHardware(runtime.controllerHardware);
        setControllerLearn(runtime.controllerLearn);
    }), []);

    useEffect(() => {
        learnSessionRef.current = learnSession;
    }, [learnSession]);

    useEffect(() => () => {
        const session = learnSessionRef.current;
        if (session) {
            void updateMultiFXRuntimeState({
                controllerLearnCancel: { token: session.token }
            }).catch(() => undefined);
        }
    }, []);

    useEffect(() => {
        if (!message) return;
        const timer = window.setTimeout(() => setMessage(""), 2800);
        return () => window.clearTimeout(timer);
    }, [message]);

    const selected = config.switches.find((item) => item.id === selectedId);

    const reportedDigitalInputs = useMemo(
        () => controllerHardware.inputs.filter((input) =>
            input.capabilities.includes("digital")
            && !input.reserved
        ),
        [controllerHardware.inputs]
    );

    const cancelLearn = useCallback(async (
        session: SwitchLearnSession | null = learnSession,
        feedback = "Learn cancelled."
    ) => {
        if (!session) return;
        learnSessionRef.current = null;
        setLearnSession(null);
        try {
            const runtime = await updateMultiFXRuntimeState({
                controllerLearnCancel: { token: session.token }
            });
            setLearnFeedback(
                runtime.controllerLearn.status === "error"
                    ? runtime.controllerLearn.message
                    : feedback
            );
        } catch {
            setLearnFeedback(
                "Could not cancel Learn. It will still time out automatically."
            );
        }
    }, [learnSession]);

    useEffect(() => {
        if (!learnSession) {
            return;
        }
        if (controllerLearn.token !== learnSession.token) {
            if (controllerLearn.status === "waiting") {
                learnSessionRef.current = null;
                setLearnSession(null);
                setLearnFeedback(
                    "Another Controller Settings session started Learn. This draft was not changed."
                );
            }
            return;
        }
        if (controllerLearn.status === "waiting") {
            setLearnFeedback("Waiting for switch press…");
            return;
        }
        if (controllerLearn.status === "idle") return;

        if (controllerLearn.status === "learned") {
            const input = controllerLearn.input;
            let learnedSource: ControllerInputSource | null = null;
            if (input?.type === "gpio") {
                learnedSource = { type: "gpio", pin: input.channel };
            } else if (input?.moduleId) {
                learnedSource = {
                    type: "module",
                    moduleId: input.moduleId,
                    channel: input.channel
                };
            }
            if (!learnedSource) {
                setLearnFeedback(
                    `Learned ${input?.label ?? "an input"}, but its source address was not recognized.`
                );
            } else {
                const learnedId = controllerInputSourceId(learnedSource);
                const conflict = config.switches.find((item) =>
                    item.id !== learnSession.switchId
                    && controllerInputSourceId(item.input) === learnedId
                );
                if (conflict) {
                    setLearnFeedback(
                        `${input?.label ?? "That input"} is already assigned to ${conflict.label}. No change was made.`
                    );
                } else {
                    setConfig((current) => ensureControllerPerformanceLayout({
                        ...current,
                        switches: current.switches.map((item) =>
                            item.id === learnSession.switchId
                                ? { ...item, input: learnedSource }
                                : item
                        )
                    }));
                    setLearnFeedback(
                        `${input?.label ?? "Input"} learned. Press SAVE to persist it.`
                    );
                }
            }
        } else {
            setLearnFeedback(
                controllerLearn.message
                || (controllerLearn.status === "conflict"
                    ? "That input is already assigned. No change was made."
                    : "Learn ended without changing the physical input.")
            );
        }

        const completed = learnSession;
        learnSessionRef.current = null;
        setLearnSession(null);
        void updateMultiFXRuntimeState({
            controllerLearnCancel: { token: completed.token }
        }).catch(() => undefined);
    }, [controllerLearn, learnSession, config.switches]);

    useEffect(() => {
        if (learnSession && learnSession.switchId !== selectedId) {
            void cancelLearn(learnSession);
        }
    }, [selectedId, learnSession, cancelLearn]);

    const updateSelected = (patch: Partial<ControllerSwitchConfig>) => {
        if (!selected) return;
        setConfig((current) => ensureControllerPerformanceLayout({
            ...current,
            switches: current.switches.map((item) =>
                item.id === selected.id
                    ? { ...item, ...patch }
                    : item
            )
        }));
    };

    const updateAction = (
        target: "action" | "longPressAction",
        type: ActionKind
    ) => {
        if (!selected) return;

        if (target === "longPressAction") {
            updateSelected({
                longPressAction: makeAction(
                    type,
                    selected.longPressAction
                )
            });
            return;
        }

        setConfig((current) => {
            const currentSelected = current.switches.find(
                (item) => item.id === selected.id
            );
            if (!currentSelected) return current;

            const wasPreset =
                currentSelected.action.type === "preset";
            const presetCountBefore = current.switches.filter(
                (item) => item.action.type === "preset"
            ).length;

            const switches = current.switches.map((item) =>
                item.id === currentSelected.id
                    ? {
                        ...item,
                        action: makeAction(
                            type,
                            currentSelected.action
                        )
                    }
                    : item
            );

            // A newly-created preset switch belongs at the END of the
            // current Performance preset slots. Giving it presetIndex 0 made
            // it sort to the front and display an already-assigned preset.
            // Reindex every short-press preset action so visible slots remain
            // unique, contiguous and stable.
            const requestedIndex =
                type === "preset" && !wasPreset
                    ? presetCountBefore
                    : undefined;

            return ensureControllerPerformanceLayout({
                ...current,
                switches: normalizeShortPresetOrder(
                    switches,
                    currentSelected.id,
                    requestedIndex
                )
            });
        });
    };

    const updatePresetIndex = (
        target: "action" | "longPressAction",
        presetIndex: number
    ) => {
        if (!selected) return;

        if (target === "longPressAction") {
            if (selected.longPressAction?.type !== "preset") {
                return;
            }

            updateSelected({
                longPressAction: {
                    type: "preset",
                    presetIndex: Math.max(
                        0,
                        Math.round(presetIndex)
                    )
                }
            });
            return;
        }

        if (selected.action.type !== "preset") return;

        setConfig((current) => {
            const presetCount = current.switches.filter(
                (item) => item.action.type === "preset"
            ).length;

            const requested = Math.max(
                0,
                Math.min(
                    Math.max(0, presetCount - 1),
                    Math.round(presetIndex)
                )
            );

            return ensureControllerPerformanceLayout({
                ...current,
                switches: normalizeShortPresetOrder(
                    current.switches,
                    selected.id,
                    requested
                )
            });
        });
    };

    const addSwitch = () => {
        if (config.switches.length >= MAX_FOOTSWITCHES) {
            setMessage(`Maximum ${MAX_FOOTSWITCHES} switches.`);
            return;
        }

        const usedHardware = new Set(
            config.switches
                .map((item) => item.hardwareSwitch)
                .filter((value): value is number => value !== null)
        );

        let hardwareSwitch = 1;
        while (
            hardwareSwitch <= MAX_FOOTSWITCHES
            && usedHardware.has(hardwareSwitch)
        ) {
            ++hardwareSwitch;
        }

        const newCount = config.switches.length + 1;
        const dimensions = fitGridDimensions(
            newCount,
            config.columns,
            config.rows
        );

        const occupied = new Set(
            config.switches.map(
                (item) =>
                    `${Math.max(1, item.row ?? 1)}:${Math.max(1, item.column ?? 1)}`
            )
        );
        let row = 1;
        let column = 1;
        let foundCell = false;

        for (
            let candidateRow = 1;
            candidateRow <= dimensions.rows && !foundCell;
            ++candidateRow
        ) {
            for (
                let candidateColumn = 1;
                candidateColumn <= dimensions.columns;
                ++candidateColumn
            ) {
                if (
                    !occupied.has(
                        `${candidateRow}:${candidateColumn}`
                    )
                ) {
                    row = candidateRow;
                    column = candidateColumn;
                    foundCell = true;
                    break;
                }
            }
        }

        const newSwitch: ControllerSwitchConfig = {
            id: `sw${hardwareSwitch}`,
            label: `SW ${hardwareSwitch}`,
            hardwareSwitch,
            // A new switch starts as a virtual/on-screen control. The user can
            // optionally bind any compatible board or module input later.
            input: null,
            action: { type: "none", text: "Unused" },
            longPressAction: { type: "none", text: "Unused" },
            row,
            column
        };

        setConfig((current) => {
            const withSwitch = normalizeGridPositions(
                {
                    ...current,
                    switches: [...current.switches, newSwitch]
                },
                dimensions.columns,
                dimensions.rows
            );

            if (current.performanceLayout.mode !== "freeform") {
                return withSwitch;
            }

            // Freeform is manual. Adding a logical switch must not change any
            // existing geometry. The new switch is explicitly UNPLACED until
            // the user places it in the Layout editor.
            return ensureControllerPerformanceLayout({
                ...withSwitch,
                performanceLayout: {
                    ...withSwitch.performanceLayout,
                    switches: {
                        ...current.performanceLayout.switches
                    },
                    unplacedSwitchIds: Array.from(
                        new Set([
                            ...current.performanceLayout.unplacedSwitchIds,
                            newSwitch.id
                        ])
                    )
                }
            });
        });

        setSelectedId(newSwitch.id);
        if (config.performanceLayout.mode === "freeform") {
            setMessage(
                `${newSwitch.label} added as UNPLACED. Open LAYOUT to position it.`
            );
        }
    };

    const removeSelected = () => {
        if (!selected) return;
        if (learnSession) {
            void cancelLearn(learnSession, "");
        }

        const nextSelectedId =
            config.switches.find(
                (item) => item.id !== selected.id
            )?.id ?? "";

        setConfig((current) => {
            const remaining = normalizeShortPresetOrder(
                current.switches.filter(
                    (item) => item.id !== selected.id
                )
            );

            const nextLayoutSwitches = {
                ...current.performanceLayout.switches
            };
            delete nextLayoutSwitches[selected.id];

            // Grid mode closes the deleted cell while preserving the visible
            // ordering of the remaining switches. Rows then shrink to the
            // minimum needed for that column count, so Performance View tiles
            // resize immediately instead of staying compressed by an empty row.
            if (current.performanceLayout.mode === "grid") {
                const compacted = compactGridAfterRemoval(
                    remaining,
                    current.columns
                );

                return normalizeGridPositions(
                    {
                        ...current,
                        switches: compacted.switches,
                        rows: compacted.rows,
                        performanceLayout: {
                            ...current.performanceLayout,
                            switches: nextLayoutSwitches
                        }
                    },
                    current.columns,
                    compacted.rows
                );
            }

            // Freeform coordinates are deliberate user geometry. Remove only
            // the deleted switch. Existing positions remain unchanged unless a
            // invalid layout is already invalid, in which case repair it.
            return ensureValidFreeformLayout(
                ensureControllerPerformanceLayout({
                    ...current,
                    switches: remaining,
                    performanceLayout: {
                        ...current.performanceLayout,
                        switches: nextLayoutSwitches,
                        unplacedSwitchIds:
                            current.performanceLayout.unplacedSwitchIds.filter(
                                (id) => id !== selected.id
                            )
                    }
                })
            );
        });

        setSelectedId(nextSelectedId);
    };

    const save = async () => {
        if (learnSession) {
            await cancelLearn(learnSession, "");
        }
        if ((controllerHardware.protocolVersion ?? 0) >= 2) {
            const safePins = new Set(
                reportedDigitalInputs
                    .filter((input) => input.type === "gpio")
                    .map((input) => input.channel)
            );
            const unsupported = config.switches.find((item) =>
                item.input?.type === "gpio" && !safePins.has(item.input.pin)
            );
            if (unsupported) {
                const pin = unsupported.input?.type === "gpio"
                    ? unsupported.input.pin
                    : "?";
                setMessage(
                    `${unsupported.label} uses GPIO ${pin}, which ${controllerHardware.boardName ?? "the connected controller"} did not report as a compatible digital input.`
                );
                return;
            }
        }
        const normalized =
            normalizeControllerPresetSlots(config);


        const result = saveControllerConfig(normalized);
        if (result.error) {
            setMessage(result.error);
            return;
        }

        setConfig(cloneConfig(result.config));
        setMessage(
            "Saved. Switch actions, physical inputs, hardware, and layout are shared with the MultiFX runtime."
        );
    };

    /**
     * Merge the Hardware page's private draft into the still-mounted logical
     * controller draft and persist the complete configuration atomically.
     */
    const saveHardware = async (
        hardware: ControllerHardwareConfig,
        switchInputs: readonly (ControllerInputSource | null)[]
    ): Promise<string | undefined> => {
        if (learnSession) await cancelLearn(learnSession, "");
        const switches = config.switches.map((item, index) => ({
            ...item,
            input: switchInputs[index] ?? null
        }));
        const combined = normalizeControllerPresetSlots({
            ...config,
            switches,
            hardware
        });
        const result = saveControllerConfig(combined);
        if (result.error) return result.error;
        setConfig(cloneConfig(result.config));
        return "Saved changes.";
    };

    const restore = async () => {
        if (learnSession) {
            await cancelLearn(learnSession, "");
        }
        clearSavedControllerConfig();
        const result = await loadControllerConfig();
        const normalized =
            normalizeControllerPresetSlots(result.config);
        setConfig(cloneConfig(normalized));
        setSelectedId(normalized.switches[0]?.id ?? "");
        setMessage("Restored controller-config.json / built-in defaults.");
    };

    if (hardwareEditorOpen) {
        return (
            <MultiFXControllerHardwareSettings
                controllerDraft={config}
                reportedHardware={controllerHardware}
                onCancel={() => setHardwareEditorOpen(false)}
                onSave={saveHardware}
            />
        );
    }

    return (
        <div style={screenStyle}>
            <div style={headerStyle}>
                <div>
                    <div style={titleStyle}>CONTROLLER SETTINGS</div>
                    <div style={subtitleStyle}>
                        Define what each switch does and arrange the on-screen controller. Physical wiring is configured in Hardware Setup.
                    </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <div style={counterStyle}>
                        {config.switches.length} / {MAX_FOOTSWITCHES}
                    </div>
                    <button type="button" onClick={() => setHardwareEditorOpen(true)} style={layoutButtonStyle}>
                        HARDWARE SETUP
                    </button>
                </div>
            </div>

            {message && <div style={messageStyle}>{message}</div>}

            <div style={bodyStyle}>
                <section style={switchListPanelStyle}>
                    <div style={sectionTopStyle}>
                        <div>
                            <div style={sectionTitleStyle}>SWITCHES</div>
                            <div style={helpStyle}>
                                Select a logical switch to define its short-press and long-press actions.
                                Screen position is edited separately in Layout.
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() => setLayoutEditorOpen(true)}
                            style={layoutButtonStyle}
                        >
                            LAYOUT
                        </button>
                    </div>

                    <div style={switchListStyle}>
                        {config.switches.map((item) => {
                            const active = item.id === selectedId;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setSelectedId(item.id)}
                                    style={{
                                        ...switchCellStyle,
                                        borderColor: active
                                            ? MFX_COLORS.cyan
                                            : MFX_COLORS.border,
                                        boxShadow: active
                                            ? `0 0 0 2px ${MFX_COLORS.cyanSurface}`
                                            : "none"
                                    }}
                                >
                                    <span style={switchNumberStyle}>{item.label}</span>
                                    <span style={switchActionStyle}>
                                        {actionLabel(item.action)}
                                    </span>
                                    {config.performanceLayout.mode === "freeform"
                                        && config.performanceLayout.unplacedSwitchIds.includes(item.id) && (
                                            <span style={switchGpioStyle}>UNPLACED</span>
                                        )}
                                </button>
                            );
                        })}
                    </div>

                    <div style={buttonRowStyle}>
                        <button
                            type="button"
                            onClick={addSwitch}
                            disabled={config.switches.length >= MAX_FOOTSWITCHES}
                            style={buttonStyle}
                        >
                            + ADD SWITCH
                        </button>
                        <button
                            type="button"
                            onClick={removeSelected}
                            disabled={!selected}
                            style={dangerButtonStyle}
                        >
                            REMOVE
                        </button>
                    </div>

                    <div style={layoutSummaryStyle}>
                        PERFORMANCE LAYOUT: {config.performanceLayout.mode.toUpperCase()}
                        {config.performanceLayout.mode === "grid"
                            ? ` • ${config.columns} × ${config.rows}`
                            : " • drag/resizable"}
                    </div>
                </section>

                <aside style={editorPanelStyle}>
                    {selected ? (
                        <>
                            <div style={sectionTitleStyle}>{selected.label}</div>

                            <label style={fieldLabelStyle}>
                                Label
                                <input
                                    value={selected.label}
                                    onChange={(event) =>
                                        updateSelected({ label: event.target.value })
                                    }
                                    style={inputStyle}
                                />
                            </label>

                            <ActionEditor
                                title="SHORT PRESS"
                                action={selected.action}
                                onType={(type) => updateAction("action", type)}
                                onPresetIndex={(value) =>
                                    updatePresetIndex("action", value)
                                }
                            />

                            <ActionEditor
                                title="LONG PRESS"
                                action={
                                    selected.longPressAction
                                    ?? { type: "none", text: "Unused" }
                                }
                                onType={(type) =>
                                    updateAction("longPressAction", type)
                                }
                                onPresetIndex={(value) =>
                                    updatePresetIndex("longPressAction", value)
                                }
                            />

                            <label style={fieldLabelStyle}>
                                Long-press threshold
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <BufferedIntegerInput
                                        min={MIN_LONG_PRESS_MS}
                                        max={MAX_LONG_PRESS_MS}
                                        step={50}
                                        value={config.longPressMs}
                                        onValueChange={(value) =>
                                            setConfig((current) => ({
                                                ...current,
                                                longPressMs: value
                                            }))
                                        }
                                        style={{ ...inputStyle, width: 110 }}
                                    />
                                    <span style={helpStyle}>ms</span>
                                </div>
                            </label>
                        </>
                    ) : (
                        <div style={helpStyle}>Select a switch to edit it.</div>
                    )}
                </aside>
            </div>

            <div style={footerStyle}>
                <div style={footerHelpStyle}>
                    Performance View is always read-only. LAYOUT is the only place controls can move.
                </div>
                <button type="button" onClick={restore} style={secondaryButtonStyle}>
                    RESTORE DEFAULT
                </button>
                <button type="button" onClick={() => void save()} style={saveButtonStyle}>
                    SAVE
                </button>
            </div>

            {layoutEditorOpen && (
                <PerformanceLayoutEditor
                    controllerConfig={config}
                    onClose={() => setLayoutEditorOpen(false)}
                    onSaved={(savedConfig, savedMessage) => {
                        setConfig(cloneConfig(savedConfig));
                        setMessage(savedMessage);
                    }}
                />
            )}
        </div>
    );
}

function PerformanceLayoutEditor(props: {
    controllerConfig: ControllerLayoutConfig;
    onClose: () => void;
    onSaved: (config: ControllerLayoutConfig, message: string) => void;
}) {
    const canvasRef = useRef<HTMLDivElement>(null);
    const elementPaletteRef = useRef<HTMLDivElement>(null);
    const placementDragRef =
        useRef<PlacementDragState | null>(null);
    const dragRef = useRef<DragState | null>(null);
    const swapTargetRef = useRef<string | null>(null);
    const gridDragRef = useRef<GridDragState | null>(null);
    const suppressGridClickRef = useRef<string | null>(null);
    const [swapTargetId, setSwapTargetId] = useState<string | null>(null);
    const [freeformDragVisual, setFreeformDragVisual] =
        useState<FreeformDragVisual | null>(null);
    const [placementDragVisual, setPlacementDragVisual] =
        useState<PlacementDragVisual | null>(null);
    const [gridDragVisual, setGridDragVisual] =
        useState<GridDragVisual | null>(null);
    const [gridDropCell, setGridDropCell] =
        useState<GridDropCell | null>(null);
    const [selectedId, setSelectedId] = useState<string>("element:currentBank");
    const [draft, setDraft] = useState<ControllerLayoutConfig>(() => {
        const base = ensureControllerPerformanceLayout(
            cloneConfig(props.controllerConfig)
        );
        const mode = loadLastLayoutEditorMode();

        if (mode === base.performanceLayout.mode) {
            return base;
        }

        return mode === "freeform"
            ? arrangeFreeformSwitchesFromGrid(base)
            : ensureControllerPerformanceLayout({
                ...base,
                performanceLayout: {
                    ...base.performanceLayout,
                    mode: "grid",
                    unplacedSwitchIds: []
                }
            });
    });
    const [layoutMessage, setLayoutMessage] = useState("");
    const [snapPixels, setSnapPixels] = useState(
        () => loadLayoutSnapPixels()
    );
    const [snapEnabled, setSnapEnabled] = useState(
        () => loadLayoutSnapEnabled()
    );

    useEffect(() => {
        if (!layoutMessage) return;
        const timer = window.setTimeout(
            () => setLayoutMessage(""),
            2800
        );
        return () => window.clearTimeout(timer);
    }, [layoutMessage]);

    // Keep the editor preview tied to the exact controller layout that the
    // parent settings page currently owns. Add/remove operations happen in the
    // parent; when they resize/reflow the shared layout, opening or updating the
    // editor must show that same geometry instead of an older draft.
    useEffect(() => {
        const base = ensureValidFreeformLayout(
            ensureControllerPerformanceLayout(
                cloneConfig(props.controllerConfig)
            )
        );
        const preferredMode = loadLastLayoutEditorMode();
        const next =
            preferredMode === base.performanceLayout.mode
                ? base
                : preferredMode === "freeform"
                    ? arrangeFreeformSwitchesFromGrid(base)
                    : ensureControllerPerformanceLayout({
                        ...base,
                        performanceLayout: {
                            ...base.performanceLayout,
                            mode: "grid",
                            unplacedSwitchIds: []
                        }
                    });

        setDraft(next);

        setSelectedId((currentSelectedId) => {
            if (currentSelectedId.startsWith("element:")) {
                const id = currentSelectedId.substring(
                    "element:".length
                ) as ControllerLayoutElementId;
                if (next.performanceLayout.elements[id]?.visible) {
                    return currentSelectedId;
                }
            }

            if (
                next.switches.some(
                    (item) => item.id === currentSelectedId
                )
            ) {
                return currentSelectedId;
            }

            return next.performanceLayout.mode === "freeform"
                ? "element:currentBank"
                : next.switches[0]?.id ?? "";
        });
    }, [props.controllerConfig]);

    useEffect(() => {
        const pointInside = (
            element: HTMLElement | null,
            x: number,
            y: number
        ): boolean => {
            if (!element) return false;
            const rect = element.getBoundingClientRect();
            return (
                x >= rect.left
                && x <= rect.right
                && y >= rect.top
                && y <= rect.bottom
            );
        };

        const finish = (event: PointerEvent) => {
            const placementDrag =
                placementDragRef.current;
            if (
                placementDrag
                && placementDrag.pointerId === event.pointerId
            ) {
                const insideCanvas = pointInside(
                    canvasRef.current,
                    event.clientX,
                    event.clientY
                );

                if (
                    insideCanvas
                    && placementDrag.previewRect
                    && placementDrag.valid
                ) {
                    const finalRect = {
                        ...placementDrag.previewRect
                    };
                    const target: PlacementTarget =
                        placementDrag.kind === "element"
                            ? {
                                kind: "element",
                                id: placementDrag.id
                            }
                            : {
                                kind: "switch",
                                id: placementDrag.id
                            };

                    setDraft((current) =>
                        applyFreeformPlacement(
                            current,
                            target,
                            finalRect
                        )
                    );
                    setSelectedId(
                        target.kind === "element"
                            ? `element:${target.id}`
                            : target.id
                    );
                    setLayoutMessage(
                        `${placementDrag.label} placed.`
                    );
                } else if (insideCanvas) {
                    setLayoutMessage(
                        "That space is too small even at the minimum size. Move or resize an existing item, then try again."
                    );
                }

                placementDragRef.current = null;
                setPlacementDragVisual(null);
                return;
            }

            const drag = dragRef.current;
            const swapTarget = swapTargetRef.current;

            if (
                drag
                && drag.pointerId === event.pointerId
                && drag.kind === "element"
                && pointInside(
                    elementPaletteRef.current,
                    event.clientX,
                    event.clientY
                )
            ) {
                setDraft((current) => {
                    const element =
                        current.performanceLayout.elements[drag.id];
                    const elements = {
                        ...current.performanceLayout.elements,
                        [drag.id]: {
                            ...element,
                            visible: false
                        }
                    };

                    setLayoutMessage(
                        `${CONTROLLER_LAYOUT_ELEMENT_LABELS[drag.id]} removed from layout.`
                    );
                    setSelectedId("");

                    return ensureControllerPerformanceLayout({
                        ...current,
                        performanceLayout: {
                            ...current.performanceLayout,
                            elements
                        }
                    });
                });
            } else if (
                drag
                && drag.pointerId === event.pointerId
                && drag.mode === "move"
                && swapTarget
                && swapTarget !== layoutTargetKey(drag)
            ) {
                const target =
                    parseLayoutTargetKey(swapTarget);

                if (target) {
                    setDraft((current) => {
                        const targetRect =
                            configTargetRect(
                                current,
                                target
                            );

                        if (!targetRect) {
                            return current;
                        }

                        // Always swap the destination with the exact rectangle
                        // the source had when the drag began. This prevents any
                        // alignment drift and works for switch<->switch,
                        // element<->element and element<->switch.
                        let next = setConfigTargetRect(
                            current,
                            drag,
                            targetRect
                        );
                        next = setConfigTargetRect(
                            next,
                            target,
                            drag.startRect
                        );

                        return ensureControllerPerformanceLayout(
                            next
                        );
                    });

                    setSelectedId(
                        drag.kind === "element"
                            ? `element:${drag.id}`
                            : drag.id
                    );
                    setLayoutMessage(
                        "Layout items swapped."
                    );
                }
            } else if (
                drag
                && drag.pointerId === event.pointerId
                && drag.mode === "move"
                && drag.moved
            ) {
                // Freeform move uses a ghost preview while dragging. Commit
                // the final valid preview rectangle only when the pointer is
                // released, leaving the source control faded in its original
                // position during the drag just like Grid mode.
                const finalRect = { ...drag.previewRect };
                setDraft((current) =>
                    ensureControllerPerformanceLayout(
                        setConfigTargetRect(
                            current,
                            drag,
                            finalRect
                        )
                    )
                );
            }

            dragRef.current = null;
            swapTargetRef.current = null;
            setSwapTargetId(null);
            setFreeformDragVisual(null);
        };

        const cancel = () => {
            placementDragRef.current = null;
            setPlacementDragVisual(null);
            dragRef.current = null;
            swapTargetRef.current = null;
            setSwapTargetId(null);
            setFreeformDragVisual(null);
        };

        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", cancel);
        return () => {
            window.removeEventListener("pointerup", finish);
            window.removeEventListener("pointercancel", cancel);
        };
    }, []);

    const layout = draft.performanceLayout;
    const unplacedSwitches = draft.switches.filter(
        (item) => layout.unplacedSwitchIds.includes(item.id)
    );


    const beginPlacementDrag = (
        event: React.PointerEvent<HTMLElement>,
        target: PlacementTarget,
        label: string
    ) => {
        if (layout.mode !== "freeform") return;

        event.preventDefault();
        event.stopPropagation();

        const size = placementSizeForTarget(
            draft,
            target
        );

        placementDragRef.current = {
            ...target,
            pointerId: event.pointerId,
            label,
            preferredWidth: size.preferredWidth,
            preferredHeight: size.preferredHeight,
            minWidth: size.minWidth,
            minHeight: size.minHeight,
            previewRect: null,
            valid: false
        };
        setPlacementDragVisual(null);

        try {
            event.currentTarget.setPointerCapture(
                event.pointerId
            );
        } catch {
            // Pointer capture is optional.
        }

        setLayoutMessage(
            `Drag ${label} onto the layout. The ghost will shrink if needed; green means it fits.`
        );
    };

    const movePlacementDrag = (
        event: React.PointerEvent<HTMLElement>
    ) => {
        const placementDrag =
            placementDragRef.current;
        const canvas = canvasRef.current;
        if (
            !placementDrag
            || placementDrag.pointerId !== event.pointerId
            || !canvas
        ) {
            return;
        }

        event.preventDefault();

        const bounds = canvas.getBoundingClientRect();
        if (
            bounds.width <= 0
            || bounds.height <= 0
        ) {
            return;
        }

        const insideCanvas =
            event.clientX >= bounds.left
            && event.clientX <= bounds.right
            && event.clientY >= bounds.top
            && event.clientY <= bounds.bottom;

        if (!insideCanvas) {
            placementDrag.previewRect = null;
            placementDrag.valid = false;
            setPlacementDragVisual(null);
            return;
        }

        const target: PlacementTarget =
            placementDrag.kind === "element"
                ? {
                    kind: "element",
                    id: placementDrag.id
                }
                : {
                    kind: "switch",
                    id: placementDrag.id
                };

        let centerX =
            (event.clientX - bounds.left) / bounds.width;
        let centerY =
            (event.clientY - bounds.top) / bounds.height;

        if (snapEnabled) {
            const snapX =
                Math.max(1, snapPixels) / bounds.width;
            const snapY =
                Math.max(1, snapPixels) / bounds.height;
            centerX =
                Math.round(centerX / snapX) * snapX;
            centerY =
                Math.round(centerY / snapY) * snapY;
        }

        const preview = adaptivePlacementPreview(
            draft,
            target,
            Math.max(0, Math.min(1, centerX)),
            Math.max(0, Math.min(1, centerY))
        );

        placementDrag.previewRect = {
            ...preview.rect
        };
        placementDrag.valid = preview.valid;

        setPlacementDragVisual({
            ...target,
            label: placementDrag.label,
            rect: { ...preview.rect },
            valid: preview.valid
        });
    };

    const placeTargetAutomatically = (
        target: PlacementTarget,
        label: string
    ) => {
        setDraft((current) => {
            const rect = findAdaptiveFreeformPlacement(
                current,
                target
            );

            if (!rect) {
                setLayoutMessage(
                    "No open space is large enough even at the minimum size. Drag the item onto the layout to see the required space, or resize/move an existing item."
                );
                return current;
            }

            setSelectedId(
                target.kind === "element"
                    ? `element:${target.id}`
                    : target.id
            );
            setLayoutMessage(
                `${label} placed. Resize it if you want a different fit.`
            );
            return applyFreeformPlacement(
                current,
                target,
                rect
            );
        });
    };

    const placeSwitch = (switchId: string) => {
        const item = draft.switches.find(
            (candidate) => candidate.id === switchId
        );
        placeTargetAutomatically(
            {
                kind: "switch",
                id: switchId
            },
            item?.label ?? switchId
        );
    };

    const placeElement = (
        id: ControllerLayoutElementId
    ) => {
        placeTargetAutomatically(
            {
                kind: "element",
                id
            },
            CONTROLLER_LAYOUT_ELEMENT_LABELS[id]
        );
    };

    const setMode = (mode: "grid" | "freeform") => {
        // Clicking the already-active mode must never rebuild the layout.
        // In particular, re-clicking FREEFORM used to call
        // arrangeFreeformSwitchesFromGrid(), which resized/repositioned every
        // control and silently placed previously-unplaced switches.
        if (mode === draft.performanceLayout.mode) {
            return;
        }

        saveLastLayoutEditorMode(mode);
        gridDragRef.current = null;
        suppressGridClickRef.current = null;
        setGridDragVisual(null);
        setGridDropCell(null);
        setDraft((current) => {
            if (mode === "freeform") {
                return arrangeFreeformSwitchesFromGrid(current);
            }

            // Grid owns placement automatically, so every switch becomes placed.
            return ensureControllerPerformanceLayout({
                ...current,
                performanceLayout: {
                    ...current.performanceLayout,
                    mode: "grid",
                    unplacedSwitchIds: []
                }
            });
        });
        setSelectedId(
            mode === "freeform"
                ? "element:currentBank"
                : draft.switches[0]?.id ?? ""
        );
    };

    const updateGridDimensions = (
        requestedColumns: number,
        requestedRows: number
    ) => {
        setDraft((current) => {
            const dimensions = fitGridDimensions(
                current.switches.length,
                requestedColumns,
                requestedRows
            );
            return normalizeGridPositions(
                current,
                dimensions.columns,
                dimensions.rows
            );
        });
    };

    const selectedElementId =
        selectedId.startsWith("element:")
            ? selectedId.substring(
                "element:".length
            ) as ControllerLayoutElementId
            : undefined;

    const updateSelectedElement = (
        patch: Partial<
            ControllerLayoutConfig["performanceLayout"]["elements"][
                ControllerLayoutElementId
            ]
        >
    ) => {
        if (!selectedElementId) return;

        setDraft((current) => {
            const previous =
                current.performanceLayout.elements[
                    selectedElementId
                ];
            const elements = {
                ...current.performanceLayout.elements,
                [selectedElementId]: {
                    ...previous,
                    ...patch
                }
            };

            return ensureControllerPerformanceLayout({
                ...current,
                performanceLayout: {
                    ...current.performanceLayout,
                    elements
                }
            });
        });
    };


    const moveGridSwitchById = (
        switchId: string,
        row: number,
        column: number
    ) => {
        setDraft((current) => {
            const selected = current.switches.find(
                (item) => item.id === switchId
            );
            if (!selected) return current;

            const oldRow = selected.row ?? 1;
            const oldColumn = selected.column ?? 1;
            if (
                oldRow === row
                && oldColumn === column
            ) {
                return current;
            }

            const target = current.switches.find(
                (item) =>
                    (item.row ?? 1) === row
                    && (item.column ?? 1) === column
            );

            return ensureControllerPerformanceLayout({
                ...current,
                switches: current.switches.map((item) => {
                    if (item.id === selected.id) {
                        return { ...item, row, column };
                    }
                    if (target && item.id === target.id) {
                        return {
                            ...item,
                            row: oldRow,
                            column: oldColumn
                        };
                    }
                    return item;
                })
            });
        });
    };

    const moveGridSwitch = (row: number, column: number) => {
        if (!selectedId || selectedId.startsWith("element:")) return;
        moveGridSwitchById(selectedId, row, column);
    };

    const gridCellAtPoint = (
        clientX: number,
        clientY: number
    ): GridDropCell | null => {
        const element = document.elementFromPoint(
            clientX,
            clientY
        );
        const cell = element?.closest<HTMLElement>(
            "[data-grid-row][data-grid-column]"
        );

        if (
            !cell
            || !canvasRef.current
            || !canvasRef.current.contains(cell)
        ) {
            return null;
        }

        const row = Number(cell.dataset.gridRow);
        const column = Number(cell.dataset.gridColumn);
        if (
            !Number.isInteger(row)
            || !Number.isInteger(column)
        ) {
            return null;
        }

        return { row, column };
    };

    const beginGridDrag = (
        event: React.PointerEvent<HTMLButtonElement>,
        item: ControllerSwitchConfig
    ) => {
        if (layout.mode !== "grid") return;
        if (
            event.pointerType === "mouse"
            && event.button !== 0
        ) {
            return;
        }

        const bounds =
            event.currentTarget.getBoundingClientRect();

        gridDragRef.current = {
            id: item.id,
            label: item.label,
            sublabel: actionLabel(item.action),
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: event.clientX - bounds.left,
            offsetY: event.clientY - bounds.top,
            width: bounds.width,
            height: bounds.height,
            sourceRow: item.row ?? 1,
            sourceColumn: item.column ?? 1,
            moved: false
        };

        try {
            event.currentTarget.setPointerCapture(
                event.pointerId
            );
        } catch {
            // Pointer capture is optional.
        }
    };

    const moveGridDrag = (
        event: React.PointerEvent<HTMLButtonElement>
    ) => {
        const drag = gridDragRef.current;
        if (
            !drag
            || drag.pointerId !== event.pointerId
        ) {
            return;
        }

        const distance = Math.hypot(
            event.clientX - drag.startX,
            event.clientY - drag.startY
        );

        if (!drag.moved && distance < 5) {
            return;
        }

        if (!drag.moved) {
            drag.moved = true;
            setSelectedId(drag.id);
        }

        event.preventDefault();

        setGridDragVisual({
            id: drag.id,
            label: drag.label,
            sublabel: drag.sublabel,
            x: event.clientX - drag.offsetX,
            y: event.clientY - drag.offsetY,
            width: drag.width,
            height: drag.height
        });
        setGridDropCell(
            gridCellAtPoint(
                event.clientX,
                event.clientY
            )
        );
    };

    const finishGridDrag = (
        event: React.PointerEvent<HTMLButtonElement>
    ) => {
        const drag = gridDragRef.current;
        if (
            !drag
            || drag.pointerId !== event.pointerId
        ) {
            return;
        }

        if (drag.moved) {
            event.preventDefault();

            const target = gridCellAtPoint(
                event.clientX,
                event.clientY
            );

            // Pointer-up on a button is followed by a click. Consume that
            // synthetic click so it cannot run the older tap-to-move path.
            suppressGridClickRef.current = drag.id;
            window.setTimeout(() => {
                if (
                    suppressGridClickRef.current
                    === drag.id
                ) {
                    suppressGridClickRef.current = null;
                }
            }, 0);

            if (
                target
                && (
                    target.row !== drag.sourceRow
                    || target.column !== drag.sourceColumn
                )
            ) {
                moveGridSwitchById(
                    drag.id,
                    target.row,
                    target.column
                );
                setSelectedId(drag.id);
                setLayoutMessage(
                    "Grid switch moved. Dropping onto another switch swaps their cells."
                );
            }
        }

        gridDragRef.current = null;
        setGridDragVisual(null);
        setGridDropCell(null);
    };

    const cancelGridDrag = (
        event: React.PointerEvent<HTMLButtonElement>
    ) => {
        const drag = gridDragRef.current;
        if (
            drag
            && drag.pointerId === event.pointerId
        ) {
            gridDragRef.current = null;
            setGridDragVisual(null);
            setGridDropCell(null);
        }
    };

    const handleGridSwitchClick = (
        item: ControllerSwitchConfig,
        row: number,
        column: number
    ) => {
        if (
            suppressGridClickRef.current === item.id
        ) {
            suppressGridClickRef.current = null;
            return;
        }

        if (
            selectedId
            && !selectedId.startsWith("element:")
            && selectedId !== item.id
        ) {
            moveGridSwitch(row, column);
        } else {
            setSelectedId(item.id);
        }
    };

    const getRect = (
        target: DragTarget
    ): ControllerLayoutRect | undefined =>
        target.kind === "element"
            ? draft.performanceLayout.elements[target.id].rect
            : draft.performanceLayout.switches[target.id];

    const setRect = (
        target: DragTarget,
        rect: ControllerLayoutRect
    ) => {
        setDraft((current) => {
            if (target.kind === "element") {
                const elements = {
                    ...current.performanceLayout.elements,
                    [target.id]: {
                        ...current.performanceLayout.elements[
                            target.id
                        ],
                        rect
                    }
                };

                return {
                    ...current,
                    performanceLayout: {
                        ...current.performanceLayout,
                        elements
                    }
                };
            }

            return {
                ...current,
                performanceLayout: {
                    ...current.performanceLayout,
                    switches: {
                        ...current.performanceLayout.switches,
                        [target.id]: rect
                    }
                }
            };
        });
    };

    const beginDrag = (
        event: React.PointerEvent<HTMLElement>,
        target: DragTarget
    ) => {
        if (draft.performanceLayout.mode !== "freeform") return;
        const rect = getRect(target);
        if (!rect) return;

        event.preventDefault();
        event.stopPropagation();
        setSelectedId(target.id);

        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // Pointer capture is optional.
        }

        swapTargetRef.current = null;
        setSwapTargetId(null);
        dragRef.current = {
            ...target,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startRect: { ...rect },
            previewRect: { ...rect },
            moved: false
        };
        setFreeformDragVisual(null);
    };

    const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        const canvas = canvasRef.current;
        if (!drag || drag.pointerId !== event.pointerId || !canvas) return;

        const bounds = canvas.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) return;

        if (drag.mode === "move" && !drag.moved) {
            const distance = Math.hypot(
                event.clientX - drag.startX,
                event.clientY - drag.startY
            );
            if (distance < 4) return;
            drag.moved = true;
        }

        const dx = (event.clientX - drag.startX) / bounds.width;
        const dy = (event.clientY - drag.startY) / bounds.height;
        const minimumWidth = drag.kind === "element"
            ? MIN_FREEFORM_HEADER_WIDTH
            : MIN_FREEFORM_SWITCH_WIDTH;
        const minimumHeight = drag.kind === "element"
            ? MIN_FREEFORM_HEADER_HEIGHT
            : MIN_FREEFORM_SWITCH_HEIGHT;
        let next = { ...drag.startRect };

        const snapX = Math.max(1, snapPixels) / bounds.width;
        const snapY = Math.max(1, snapPixels) / bounds.height;
        const snapThresholdX = snapX * 0.60;
        const snapThresholdY = snapY * 0.60;

        const snapScalar = (
            value: number,
            step: number
        ): number => {
            if (!snapEnabled || step <= 0) {
                return value;
            }
            return Math.round(value / step) * step;
        };

        if (drag.mode === "move") {
            next.x = snapScalar(
                drag.startRect.x + dx,
                snapX
            );
            next.y = snapScalar(
                drag.startRect.y + dy,
                snapY
            );
        } else {
            next.width = snapScalar(
                Math.max(
                    minimumWidth,
                    drag.startRect.width + dx
                ),
                snapX
            );
            next.height = snapScalar(
                Math.max(
                    minimumHeight,
                    drag.startRect.height + dy
                ),
                snapY
            );
        }

        next.width = Math.min(
            1,
            Math.max(minimumWidth, next.width)
        );
        next.height = Math.min(
            1,
            Math.max(minimumHeight, next.height)
        );
        next.x = Math.min(
            1 - next.width,
            Math.max(0, next.x)
        );
        next.y = Math.min(
            1 - next.height,
            Math.max(0, next.y)
        );

        const allRects: Array<{
            id: string;
            rect: ControllerLayoutRect;
        }> = [
            ...CONTROLLER_LAYOUT_ELEMENT_IDS
                .filter(
                    (id) =>
                        draft.performanceLayout.elements[id].visible
                )
                .map((id) => ({
                    id: `element:${id}`,
                    rect:
                        draft.performanceLayout.elements[id].rect
                })),
            ...draft.switches
                .filter(
                    (item) =>
                        !draft.performanceLayout.unplacedSwitchIds.includes(
                            item.id
                        )
                )
                .map((item) => ({
                    id: `switch:${item.id}`,
                    rect:
                        draft.performanceLayout.switches[item.id]
                }))
                .filter(
                    (entry): entry is {
                        id: string;
                        rect: ControllerLayoutRect;
                    } => Boolean(entry.rect)
                )
        ];

        const targetId = layoutTargetKey(drag);
        const otherRects = allRects.filter(
            (entry) => entry.id !== targetId
        );

        // Any placed Freeform item can swap with any other placed item.
        // Entering the destination with the dragged item's center highlights
        // it; the actual exchange waits until pointer-up.
        if (drag.mode === "move") {
            const centerX =
                next.x + next.width / 2;
            const centerY =
                next.y + next.height / 2;

            const swapTarget = otherRects.find(
                (entry) =>
                    centerX >= entry.rect.x
                    && centerX <=
                        entry.rect.x
                        + entry.rect.width
                    && centerY >= entry.rect.y
                    && centerY <=
                        entry.rect.y
                        + entry.rect.height
            );

            const nextSwapTarget =
                swapTarget?.id ?? null;

            if (
                swapTargetRef.current
                !== nextSwapTarget
            ) {
                swapTargetRef.current =
                    nextSwapTarget;
                setSwapTargetId(
                    nextSwapTarget
                );
            }

            if (nextSwapTarget) {
                drag.previewRect = { ...next };
                setFreeformDragVisual({
                    targetKey: layoutTargetKey(drag),
                    rect: { ...next }
                });
                return;
            }
        } else if (
            swapTargetRef.current !== null
        ) {
            swapTargetRef.current = null;
            setSwapTargetId(null);
        }

        // Canvas edges are always magnetic snap points. Other item edges are
        // snap points too: matching left/right/top/bottom edges aids alignment,
        // while opposite edges make clean edge-to-edge placement easy.
        if (drag.mode === "move" && snapEnabled) {
            const xCandidates = [
                0,
                1 - next.width
            ];
            const yCandidates = [
                0,
                1 - next.height
            ];

            for (const { rect } of otherRects) {
                xCandidates.push(
                    rect.x,
                    rect.x + rect.width - next.width,
                    rect.x - next.width,
                    rect.x + rect.width
                );
                yCandidates.push(
                    rect.y,
                    rect.y + rect.height - next.height,
                    rect.y - next.height,
                    rect.y + rect.height
                );
            }

            let bestX = next.x;
            let bestXDistance = snapThresholdX;
            for (const candidate of xCandidates) {
                if (
                    candidate < 0
                    || candidate > 1 - next.width
                ) continue;

                const distance = Math.abs(next.x - candidate);
                if (distance <= bestXDistance) {
                    bestXDistance = distance;
                    bestX = candidate;
                }
            }

            let bestY = next.y;
            let bestYDistance = snapThresholdY;
            for (const candidate of yCandidates) {
                if (
                    candidate < 0
                    || candidate > 1 - next.height
                ) continue;

                const distance = Math.abs(next.y - candidate);
                if (distance <= bestYDistance) {
                    bestYDistance = distance;
                    bestY = candidate;
                }
            }

            next.x = bestX;
            next.y = bestY;
        }

        if (drag.mode === "resize" && snapEnabled) {
            const rightCandidates = [
                1,
                ...otherRects.flatMap(({ rect }) => [
                    rect.x,
                    rect.x + rect.width
                ])
            ];
            const bottomCandidates = [
                1,
                ...otherRects.flatMap(({ rect }) => [
                    rect.y,
                    rect.y + rect.height
                ])
            ];

            const right = next.x + next.width;
            let bestRight = right;
            let bestRightDistance = snapThresholdX;
            for (const candidate of rightCandidates) {
                const distance = Math.abs(right - candidate);
                if (distance <= bestRightDistance) {
                    bestRightDistance = distance;
                    bestRight = candidate;
                }
            }

            const bottom = next.y + next.height;
            let bestBottom = bottom;
            let bestBottomDistance = snapThresholdY;
            for (const candidate of bottomCandidates) {
                const distance = Math.abs(bottom - candidate);
                if (distance <= bestBottomDistance) {
                    bestBottomDistance = distance;
                    bestBottom = candidate;
                }
            }

            next.width = Math.max(
                minimumWidth,
                Math.min(1 - next.x, bestRight - next.x)
            );
            next.height = Math.max(
                minimumHeight,
                Math.min(1 - next.y, bestBottom - next.y)
            );
        }

        // Overlap is never allowed. Touching edges is valid, but a candidate
        // that would enter another control's rectangle is simply held at the
        // last valid position/size.
        if (
            otherRects.some(({ rect }) =>
                rectsOverlap(next, rect)
            )
        ) {
            return;
        }

        if (drag.mode === "move") {
            drag.previewRect = { ...next };
            setFreeformDragVisual({
                targetKey: layoutTargetKey(drag),
                rect: { ...next }
            });
            return;
        }

        setRect(drag, next);
    };

    const setCurrentGridAsDefault = () => {
        setDraft((current) => {
            const next = ensureControllerPerformanceLayout({
                ...current,
                layoutDefaults: {
                    ...current.layoutDefaults,
                    grid: captureGridLayoutDefault(current)
                }
            });
            const result = saveControllerConfig(next);
            if (result.error) {
                setLayoutMessage(result.error);
                return current;
            }
            setLayoutMessage("Current Grid layout set as default.");
            return result.config;
        });
    };

    const resetGridPositions = () => {
        setDraft((current) =>
            applySavedGridDefault(current)
        );
        setSelectedId(draft.switches[0]?.id ?? "");
        setLayoutMessage(
            draft.layoutDefaults.grid
                ? "Grid restored to your saved default."
                : "No custom Grid default is saved; restored built-in Grid arrangement."
        );
    };

    const setCurrentFreeformAsDefault = () => {
        setDraft((current) => {
            const next = ensureControllerPerformanceLayout({
                ...current,
                layoutDefaults: {
                    ...current.layoutDefaults,
                    freeform: captureFreeformLayoutDefault(current)
                }
            });
            const result = saveControllerConfig(next);
            if (result.error) {
                setLayoutMessage(result.error);
                return current;
            }
            setLayoutMessage("Current Freeform layout set as default.");
            return result.config;
        });
    };

    const resetFreeform = () => {
        setDraft((current) =>
            applySavedFreeformDefault(current)
        );
        setSelectedId("element:currentBank");
        setLayoutMessage(
            draft.layoutDefaults.freeform
                ? "Freeform restored to your saved default."
                : "No custom Freeform default is saved; restored built-in Freeform arrangement."
        );
    };

    const saveLayout = () => {
        saveLastLayoutEditorMode(draft.performanceLayout.mode);
        const normalized = ensureValidFreeformLayout(
            ensureControllerPerformanceLayout(draft)
        );
        const result = saveControllerConfig(normalized);
        if (result.error) {
            setLayoutMessage(result.error);
            return;
        }

        const unplacedCount =
            result.config.performanceLayout.unplacedSwitchIds.length;

        const savedMessage =
            result.config.performanceLayout.mode === "freeform"
                ? (
                    unplacedCount > 0
                        ? `Freeform layout saved with ${unplacedCount} unplaced control${unplacedCount === 1 ? "" : "s"}.`
                        : "Freeform Performance layout saved and shared."
                )
                : "Grid Performance layout saved and shared.";

        setDraft(cloneConfig(result.config));
        setLayoutMessage(savedMessage);
        props.onSaved(result.config, savedMessage);
    };

    const selectedRect = selectedElementId
        ? layout.elements[selectedElementId].rect
        : layout.switches[selectedId];

    const byPosition = new Map<string, ControllerSwitchConfig>();
    draft.switches.forEach((item) => {
        byPosition.set(`${item.row ?? 1}:${item.column ?? 1}`, item);
    });

    const freeformGhostTarget = freeformDragVisual
        ? parseLayoutTargetKey(freeformDragVisual.targetKey)
        : undefined;
    const freeformGhostElement =
        freeformGhostTarget?.kind === "element"
            ? layout.elements[freeformGhostTarget.id]
            : undefined;
    const freeformGhostSwitch =
        freeformGhostTarget?.kind === "switch"
            ? draft.switches.find(
                (item) => item.id === freeformGhostTarget.id
            )
            : undefined;

    return (
        <div style={layoutOverlayStyle}>
            <div style={layoutEditorShellStyle}>
                <div style={layoutEditorToolbarStyle}>
                    <div>
                        <div style={titleStyle}>PERFORMANCE LAYOUT</div>
                        <div style={subtitleStyle}>
                            Safe editor — remembers your last mode and supports separate Grid/Freeform defaults.
                        </div>
                    </div>

                    <div style={layoutModeGroupStyle}>
                        <button
                            type="button"
                            onClick={() => setMode("grid")}
                            style={layout.mode === "grid"
                                ? layoutModeActiveStyle
                                : layoutModeStyle}
                        >
                            GRID
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode("freeform")}
                            style={layout.mode === "freeform"
                                ? layoutModeActiveStyle
                                : layoutModeStyle}
                        >
                            FREEFORM
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={props.onClose}
                        style={secondaryButtonStyle}
                    >
                        CANCEL
                    </button>
                    <button
                        type="button"
                        onClick={saveLayout}
                        style={saveButtonStyle}
                    >
                        SAVE LAYOUT
                    </button>
                </div>

                {layoutMessage && (
                    <div style={messageStyle}>{layoutMessage}</div>
                )}

                <div style={layoutEditorBodyStyle}>
                    <aside style={layoutInspectorStyle}>
                        <div style={sectionTitleStyle}>LAYOUT MODE</div>
                        <div style={helpStyle}>
                            Grid automatically places/resizes controls. Freeform never moves existing controls automatically; newly-added controls stay Unplaced until you place them. Drag one placed switch onto another to swap their positions.
                        </div>

                        {layout.mode === "freeform" && (
                            <>
                                <div
                                    ref={elementPaletteRef}
                                    style={{
                                        marginTop: 14,
                                        padding: 8,
                                        border: `1px solid ${MFX_COLORS.border}`,
                                        borderRadius: 8,
                                        background: MFX_COLORS.panelAlt
                                    }}
                                >
                                    <div style={sectionTitleStyle}>
                                        ELEMENTS
                                    </div>
                                    <div style={{
                                        ...helpStyle,
                                        marginTop: 5,
                                        marginBottom: 8
                                    }}>
                                        Drag an unused element onto the canvas or use PLACE. New items shrink to fit available space; existing items never move automatically. Drag a placed element back here to remove it.
                                    </div>

                                    <div style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 5
                                    }}>
                                        {CONTROLLER_LAYOUT_ELEMENT_IDS.map(
                                            (id) => {
                                                const element =
                                                    layout.elements[id];
                                                return (
                                                    <div
                                                        key={id}
                                                        style={{
                                                            display: "flex",
                                                            alignItems: "stretch",
                                                            gap: 5
                                                        }}
                                                    >
                                                    <button
                                                        type="button"
                                                        onPointerDown={
                                                            element.visible
                                                                ? undefined
                                                                : (event) =>
                                                                    beginPlacementDrag(
                                                                        event,
                                                                        {
                                                                            kind: "element",
                                                                            id
                                                                        },
                                                                        CONTROLLER_LAYOUT_ELEMENT_LABELS[id]
                                                                    )
                                                        }
                                                        onPointerMove={
                                                            element.visible
                                                                ? undefined
                                                                : movePlacementDrag
                                                        }
                                                        onClick={() => {
                                                            if (
                                                                element.visible
                                                            ) {
                                                                setSelectedId(
                                                                    `element:${id}`
                                                                );
                                                            }
                                                        }}
                                                        style={{
                                                            ...secondaryButtonStyle,
                                                            width: "100%",
                                                            opacity:
                                                                element.visible
                                                                    ? 0.46
                                                                    : 1,
                                                            textAlign: "left",
                                                            padding: "8px 9px",
                                                            minHeight: 38,
                                                            touchAction: "none",
                                                            userSelect: "none",
                                                            WebkitUserSelect: "none"
                                                        }}
                                                    >
                                                        {element.visible
                                                            ? "✓ "
                                                            : "+ "}
                                                        {
                                                            CONTROLLER_LAYOUT_ELEMENT_LABELS[
                                                                id
                                                            ]
                                                        }
                                                    </button>
                                                    {!element.visible && (
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                placeElement(id)
                                                            }
                                                            style={{
                                                                ...secondaryButtonStyle,
                                                                flex: "0 0 auto",
                                                                padding: "5px 7px",
                                                                fontSize: "0.62rem"
                                                            }}
                                                        >
                                                            PLACE
                                                        </button>
                                                    )}
                                                    </div>
                                                );
                                            }
                                        )}
                                    </div>
                                </div>
                            </>
                        )}

                        {layout.mode === "grid" ? (
                            <>
                                <label style={fieldLabelStyle}>
                                    Columns
                                    <BufferedIntegerInput
                                        min={minimumColumnsFor(
                                            draft.switches.length,
                                            draft.rows
                                        )}
                                        max={MAX_CONTROLLER_COLUMNS}
                                        value={draft.columns}
                                        onValueChange={(value) =>
                                            updateGridDimensions(
                                                value,
                                                draft.rows
                                            )
                                        }
                                        style={inputStyle}
                                    />
                                </label>

                                <label style={fieldLabelStyle}>
                                    Rows
                                    <BufferedIntegerInput
                                        min={minimumRowsFor(
                                            draft.switches.length,
                                            draft.columns
                                        )}
                                        max={MAX_CONTROLLER_ROWS}
                                        value={draft.rows}
                                        onValueChange={(value) =>
                                            updateGridDimensions(
                                                draft.columns,
                                                value
                                            )
                                        }
                                        style={inputStyle}
                                    />
                                </label>

                                <div style={noteStyle}>
                                    Drag a switch to another cell to move or swap it. Tap-to-select/move remains available as a fallback.
                                </div>

                                <button
                                    type="button"
                                    onClick={setCurrentGridAsDefault}
                                    style={{
                                        ...secondaryButtonStyle,
                                        width: "100%",
                                        marginTop: 12
                                    }}
                                >
                                    SET GRID AS DEFAULT
                                </button>
                                <button
                                    type="button"
                                    onClick={resetGridPositions}
                                    style={{
                                        ...secondaryButtonStyle,
                                        width: "100%",
                                        marginTop: 8
                                    }}
                                >
                                    RESET TO GRID DEFAULT
                                </button>
                            </>
                        ) : (
                            <>
                                <label style={checkboxLabelStyle}>
                                    <input
                                        type="checkbox"
                                        checked={snapEnabled}
                                        onChange={(event) => {
                                            const enabled = event.target.checked;
                                            setSnapEnabled(enabled);
                                            saveLayoutSnapEnabled(enabled);
                                        }}
                                    />
                                    Snap to guides
                                </label>

                                <label style={fieldLabelStyle}>
                                    Snap size (pixels)
                                    <BufferedIntegerInput
                                        min={MIN_LAYOUT_SNAP_PIXELS}
                                        max={MAX_LAYOUT_SNAP_PIXELS}
                                        step={1}
                                        value={snapPixels}
                                        onValueChange={(value) => {
                                            setSnapPixels(value);
                                            saveLayoutSnapPixels(value);
                                        }}
                                        style={inputStyle}
                                    />
                                </label>

                                <div style={{ ...sectionTitleStyle, marginTop: 16 }}>
                                    UNPLACED CONTROLS
                                </div>
                                <div style={{ ...helpStyle, marginTop: 5 }}>
                                    Drag a control onto the layout to preview its fit. The ghost shrinks automatically when needed; green fits, red is too small. PLACE searches for an open spot and shrinks the new control only as much as needed.
                                </div>
                                {unplacedSwitches.length === 0 ? (
                                    <div style={helpStyle}>
                                        All controls are placed.
                                    </div>
                                ) : (
                                    <div style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 6,
                                        marginTop: 8
                                    }}>
                                        {unplacedSwitches.map((item) => (
                                            <div
                                                key={item.id}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 8,
                                                    padding: "7px 8px",
                                                    border: `1px solid ${MFX_COLORS.border}`,
                                                    borderRadius: 7,
                                                    background: MFX_COLORS.panelAlt
                                                }}
                                            >
                                                <button
                                                    type="button"
                                                    onPointerDown={(event) =>
                                                        beginPlacementDrag(
                                                            event,
                                                            {
                                                                kind: "switch",
                                                                id: item.id
                                                            },
                                                            item.label
                                                        )
                                                    }
                                                    onPointerMove={movePlacementDrag}
                                                    style={{
                                                        ...secondaryButtonStyle,
                                                        flex: "1 1 auto",
                                                        minWidth: 0,
                                                        textAlign: "left",
                                                        padding: "7px 8px",
                                                        fontSize: "0.72rem",
                                                        fontWeight: 850,
                                                        cursor: "grab",
                                                        touchAction: "none",
                                                        userSelect: "none",
                                                        WebkitUserSelect: "none"
                                                    }}
                                                >
                                                    {item.label}
                                                    <span
                                                        style={{
                                                            display: "block",
                                                            marginTop: 2,
                                                            color: MFX_COLORS.muted,
                                                            fontSize: "0.58rem",
                                                            fontWeight: 750
                                                        }}
                                                    >
                                                        DRAG ONTO LAYOUT
                                                    </span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        placeSwitch(item.id)
                                                    }
                                                    style={{
                                                        ...secondaryButtonStyle,
                                                        padding: "5px 8px",
                                                        fontSize: "0.68rem"
                                                    }}
                                                >
                                                    PLACE
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div style={{ ...sectionTitleStyle, marginTop: 16 }}>
                                    SELECTED
                                </div>
                                <div style={selectedInfoStyle}>
                                    {selectedElementId
                                        ? CONTROLLER_LAYOUT_ELEMENT_LABELS[
                                            selectedElementId
                                        ]
                                        : draft.switches.find(
                                            (item) => item.id === selectedId
                                        )?.label ?? selectedId}
                                </div>

                                {selectedElementId && (
                                    <>
                                        <label style={fieldLabelStyle}>
                                            Style
                                            <select
                                                value={
                                                    layout.elements[
                                                        selectedElementId
                                                    ].style
                                                }
                                                onChange={(event) =>
                                                    updateSelectedElement({
                                                        style:
                                                            event.target.value as ControllerLayoutElementStyle
                                                    })
                                                }
                                                style={inputStyle}
                                            >
                                                <option value="panel">
                                                    Panel
                                                </option>
                                                <option value="compact">
                                                    Compact
                                                </option>
                                                <option value="minimal">
                                                    Minimal
                                                </option>
                                            </select>
                                        </label>

                                        <label style={fieldLabelStyle}>
                                            Shape
                                            <select
                                                value={
                                                    layout.elements[
                                                        selectedElementId
                                                    ].shape
                                                }
                                                onChange={(event) =>
                                                    updateSelectedElement({
                                                        shape:
                                                            event.target.value as ControllerLayoutElementShape
                                                    })
                                                }
                                                style={inputStyle}
                                            >
                                                <option value="rectangle">
                                                    Rectangle
                                                </option>
                                                <option value="rounded">
                                                    Rounded
                                                </option>
                                                <option value="circle">
                                                    Circle
                                                </option>
                                                <option value="hexagon">
                                                    Hexagon
                                                </option>
                                                <option value="triangle">
                                                    Triangle
                                                </option>
                                            </select>
                                        </label>

                                        <label style={checkboxLabelStyle}>
                                            <input
                                                type="checkbox"
                                                checked={
                                                    layout.elements[
                                                        selectedElementId
                                                    ].showLabel
                                                }
                                                onChange={(event) =>
                                                    updateSelectedElement({
                                                        showLabel:
                                                            event.target.checked
                                                    })
                                                }
                                            />
                                            Show label
                                        </label>
                                    </>
                                )}

                                {selectedRect && (
                                    <div style={rectInfoStyle}>
                                        X {Math.round(selectedRect.x * 100)}% • Y {Math.round(selectedRect.y * 100)}%<br />
                                        W {Math.round(selectedRect.width * 100)}% • H {Math.round(selectedRect.height * 100)}%
                                    </div>
                                )}

                                <button
                                    type="button"
                                    onClick={setCurrentFreeformAsDefault}
                                    style={{
                                        ...secondaryButtonStyle,
                                        width: "100%",
                                        marginTop: 12
                                    }}
                                >
                                    SET FREEFORM AS DEFAULT
                                </button>
                                <button
                                    type="button"
                                    onClick={resetFreeform}
                                    style={{
                                        ...secondaryButtonStyle,
                                        width: "100%",
                                        marginTop: 8
                                    }}
                                >
                                    RESET TO FREEFORM DEFAULT
                                </button>
                            </>
                        )}
                    </aside>

                    <div style={layoutPreviewPanelStyle}>
                        <div style={layoutPreviewTitleStyle}>
                            {layout.mode === "freeform"
                                ? "Drag controls • resize from lower-right • drag unplaced items in from the left"
                                : "Drag a tile to move/swap it • tap-to-move also works"}
                        </div>

                        <div
                            ref={canvasRef}
                            onPointerMove={moveDrag}
                            style={{
                                ...layoutCanvasStyle,
                                backgroundImage:
                                    layout.mode === "freeform" && snapEnabled
                                        ? "linear-gradient(to right, rgba(255,255,255,0.055) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.055) 1px, transparent 1px)"
                                        : "none",
                                backgroundSize:
                                    layout.mode === "freeform" && snapEnabled
                                        ? `${snapPixels}px ${snapPixels}px`
                                        : undefined
                            }}
                        >
                            {layout.mode === "grid" ? (
                                <div
                                    style={{
                                        position: "absolute",
                                        inset: 10,
                                        display: "grid",
                                        gridTemplateColumns:
                                            `repeat(${draft.columns}, minmax(0, 1fr))`,
                                        gridTemplateRows:
                                            `repeat(${draft.rows}, minmax(0, 1fr))`,
                                        gap: 8
                                    }}
                                >
                                    {Array.from(
                                        { length: draft.rows * draft.columns },
                                        (_, index) => {
                                            const row = Math.floor(index / draft.columns) + 1;
                                            const column = (index % draft.columns) + 1;
                                            const item = byPosition.get(`${row}:${column}`);
                                            const dropTarget =
                                                gridDropCell?.row === row
                                                && gridDropCell?.column === column;

                                            if (!item) {
                                                return (
                                                    <button
                                                        key={`${row}:${column}`}
                                                        type="button"
                                                        data-grid-row={row}
                                                        data-grid-column={column}
                                                        onClick={() => moveGridSwitch(row, column)}
                                                        style={{
                                                            ...layoutPreviewEmptyStyle,
                                                            border: dropTarget
                                                                ? "2px solid #22c55e"
                                                                : layoutPreviewEmptyStyle.border,
                                                            background: dropTarget
                                                                ? "rgba(34,197,94,0.12)"
                                                                : layoutPreviewEmptyStyle.background
                                                        }}
                                                    >
                                                        {dropTarget
                                                            ? "DROP HERE"
                                                            : selectedId
                                                                ? "MOVE HERE"
                                                                : "+"}
                                                    </button>
                                                );
                                            }

                                            const active = selectedId === item.id;
                                            const dragging =
                                                gridDragVisual?.id === item.id;

                                            return (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    data-grid-row={row}
                                                    data-grid-column={column}
                                                    onPointerDown={(event) =>
                                                        beginGridDrag(
                                                            event,
                                                            item
                                                        )
                                                    }
                                                    onPointerMove={moveGridDrag}
                                                    onPointerUp={finishGridDrag}
                                                    onPointerCancel={cancelGridDrag}
                                                    onClick={() =>
                                                        handleGridSwitchClick(
                                                            item,
                                                            row,
                                                            column
                                                        )
                                                    }
                                                    style={{
                                                        ...layoutPreviewSwitchStyle,
                                                        borderColor: dropTarget
                                                            ? "#22c55e"
                                                            : active
                                                                ? MFX_COLORS.cyan
                                                                : MFX_COLORS.border,
                                                        boxShadow: dropTarget
                                                            ? "0 0 0 2px rgba(34,197,94,0.25)"
                                                            : "none",
                                                        opacity: dragging
                                                            ? 0.26
                                                            : 1,
                                                        cursor: dragging
                                                            ? "grabbing"
                                                            : "grab",
                                                        touchAction: "none",
                                                        userSelect: "none",
                                                        WebkitUserSelect: "none"
                                                    }}
                                                >
                                                    <strong>{item.label}</strong>
                                                    <span>{actionLabel(item.action)}</span>
                                                </button>
                                            );
                                        }
                                    )}

                                    {gridDragVisual && (
                                        <div
                                            aria-hidden="true"
                                            style={{
                                                ...layoutPreviewSwitchStyle,
                                                position: "fixed",
                                                zIndex: 40000,
                                                left: gridDragVisual.x,
                                                top: gridDragVisual.y,
                                                width: gridDragVisual.width,
                                                height: gridDragVisual.height,
                                                pointerEvents: "none",
                                                opacity: 0.76,
                                                boxSizing: "border-box",
                                                borderColor: MFX_COLORS.cyan,
                                                boxShadow: "0 10px 28px rgba(0,0,0,0.42)",
                                                cursor: "grabbing"
                                            }}
                                        >
                                            <strong>
                                                {gridDragVisual.label}
                                            </strong>
                                            <span>
                                                {gridDragVisual.sublabel}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <>
                                    {CONTROLLER_LAYOUT_ELEMENT_IDS
                                        .filter(
                                            (id) =>
                                                layout.elements[id].visible
                                        )
                                        .map((id) => {
                                            const element =
                                                layout.elements[id];
                                            return (
                                                <LayoutPreviewItem
                                                    key={id}
                                                    id={`element:${id}`}
                                                    label={
                                                        CONTROLLER_LAYOUT_ELEMENT_LABELS[
                                                            id
                                                        ]
                                                    }
                                                    sublabel={
                                                        element.style
                                                    }
                                                    rect={element.rect}
                                                    selected={
                                                        selectedId
                                                            === `element:${id}`
                                                    }
                                                    swapTarget={
                                                        swapTargetId
                                                            === `element:${id}`
                                                    }
                                                    dragging={
                                                        freeformDragVisual
                                                            ?.targetKey
                                                            === `element:${id}`
                                                    }
                                                    kind="element"
                                                    shape={element.shape}
                                                    visualStyle={
                                                        element.style
                                                    }
                                                    onSelect={() =>
                                                        setSelectedId(
                                                            `element:${id}`
                                                        )
                                                    }
                                                    onBeginDrag={
                                                        (
                                                            event,
                                                            target
                                                        ) =>
                                                            beginDrag(
                                                                event,
                                                                {
                                                                    ...target,
                                                                    kind:
                                                                        "element",
                                                                    id
                                                                }
                                                            )
                                                    }
                                                />
                                            );
                                        })}

                                    {draft.switches.map((item) => {
                                        if (
                                            layout.unplacedSwitchIds.includes(
                                                item.id
                                            )
                                        ) {
                                            return null;
                                        }

                                        const rect = layout.switches[item.id];
                                        if (!rect) return null;
                                        return (
                                            <LayoutPreviewItem
                                                key={item.id}
                                                id={item.id}
                                                label={item.label}
                                                sublabel={actionLabel(item.action)}
                                                rect={rect}
                                                selected={selectedId === item.id}
                                                swapTarget={
                                                    swapTargetId
                                                        === `switch:${item.id}`
                                                }
                                                dragging={
                                                    freeformDragVisual
                                                        ?.targetKey
                                                        === `switch:${item.id}`
                                                }
                                                kind="switch"
                                                onSelect={() => setSelectedId(item.id)}
                                                onBeginDrag={beginDrag}
                                            />
                                        );
                                    })}

                                    {freeformDragVisual
                                        && freeformGhostTarget?.kind === "element"
                                        && freeformGhostElement && (
                                            <LayoutPreviewItem
                                                id={`ghost-element:${freeformGhostTarget.id}`}
                                                label={
                                                    CONTROLLER_LAYOUT_ELEMENT_LABELS[
                                                        freeformGhostTarget.id
                                                    ]
                                                }
                                                sublabel={freeformGhostElement.style}
                                                rect={freeformDragVisual.rect}
                                                selected={false}
                                                kind="element"
                                                shape={freeformGhostElement.shape}
                                                visualStyle={freeformGhostElement.style}
                                                ghost
                                            />
                                        )}

                                    {freeformDragVisual
                                        && freeformGhostTarget?.kind === "switch"
                                        && freeformGhostSwitch && (
                                            <LayoutPreviewItem
                                                id={`ghost-switch:${freeformGhostSwitch.id}`}
                                                label={freeformGhostSwitch.label}
                                                sublabel={actionLabel(
                                                    freeformGhostSwitch.action
                                                )}
                                                rect={freeformDragVisual.rect}
                                                selected={false}
                                                kind="switch"
                                                ghost
                                            />
                                        )}


                                    {placementDragVisual && (
                                        <LayoutPreviewItem
                                            id={`placement-ghost:${placementDragVisual.kind}:${placementDragVisual.id}`}
                                            label={placementDragVisual.label}
                                            sublabel={`${
                                                placementDragVisual.valid
                                                    ? "DROP TO PLACE"
                                                    : "NEEDS MORE SPACE"
                                            } • ${Math.round(
                                                placementDragVisual.rect.width * 100
                                            )}% × ${Math.round(
                                                placementDragVisual.rect.height * 100
                                            )}%`}
                                            rect={placementDragVisual.rect}
                                            selected={false}
                                            kind={placementDragVisual.kind}
                                            shape={
                                                placementDragVisual.kind === "element"
                                                    ? layout.elements[
                                                        placementDragVisual.id
                                                    ].shape
                                                    : undefined
                                            }
                                            visualStyle={
                                                placementDragVisual.kind === "element"
                                                    ? layout.elements[
                                                        placementDragVisual.id
                                                    ].style
                                                    : undefined
                                            }
                                            ghost
                                            ghostValid={
                                                placementDragVisual.valid
                                            }
                                        />
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

const LAYOUT_PREVIEW_SWITCH_LABEL_TEXT_SIZE =
    "clamp(9px, min(14px, 23cqh), 14px)";
const LAYOUT_PREVIEW_LABEL_TEXT_SIZE =
    "clamp(8px, min(12px, 20cqh), 12px)";
const LAYOUT_PREVIEW_VALUE_TEXT_SIZE =
    "clamp(9px, min(16px, 32cqh), 16px)";

function LayoutPreviewMarqueeText(props: {
    text: string;
    color: string;
    fontSize: string;
    fontWeight?: React.CSSProperties["fontWeight"];
    align?: "left" | "center";
}) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLSpanElement>(null);
    const [overflowDistance, setOverflowDistance] = useState(0);

    useEffect(() => {
        const viewport = viewportRef.current;
        const textElement = textRef.current;
        if (!viewport || !textElement) return;

        let frame = 0;

        const measure = () => {
            frame = 0;
            textElement.style.transform = "translateX(0)";
            setOverflowDistance(
                Math.max(
                    0,
                    textElement.scrollWidth - viewport.clientWidth
                )
            );
        };

        const scheduleMeasure = () => {
            if (frame !== 0) {
                window.cancelAnimationFrame(frame);
            }
            frame = window.requestAnimationFrame(measure);
        };

        const observer = new ResizeObserver(scheduleMeasure);
        observer.observe(viewport);
        observer.observe(textElement);
        scheduleMeasure();

        return () => {
            observer.disconnect();
            if (frame !== 0) {
                window.cancelAnimationFrame(frame);
            }
        };
    }, [
        props.text,
        props.fontSize,
        props.fontWeight
    ]);

    useEffect(() => {
        const textElement = textRef.current;
        if (!textElement || overflowDistance <= 0) {
            return;
        }

        const pixelsPerSecond = 35;
        const startPauseSeconds = 1.5;
        const endPauseSeconds = 0.75;
        const scrollSeconds =
            overflowDistance / pixelsPerSecond;
        const totalSeconds =
            startPauseSeconds
            + scrollSeconds
            + endPauseSeconds;

        const animation = textElement.animate(
            [
                {
                    transform: "translateX(0)",
                    offset: 0
                },
                {
                    transform: "translateX(0)",
                    offset:
                        startPauseSeconds / totalSeconds
                },
                {
                    transform:
                        `translateX(-${overflowDistance}px)`,
                    offset:
                        (startPauseSeconds + scrollSeconds)
                        / totalSeconds
                },
                {
                    transform:
                        `translateX(-${overflowDistance}px)`,
                    offset: 1
                }
            ],
            {
                duration: totalSeconds * 1000,
                iterations: Infinity,
                easing: "linear"
            }
        );

        return () => animation.cancel();
    }, [overflowDistance]);

    return (
        <div
            ref={viewportRef}
            style={{
                width: "100%",
                height: "100%",
                minWidth: 0,
                minHeight: 0,
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent:
                    overflowDistance > 0
                        ? "flex-start"
                        : props.align === "center"
                            ? "center"
                            : "flex-start"
            }}
        >
            <span
                ref={textRef}
                style={{
                    display: "inline-block",
                    minWidth: "max-content",
                    whiteSpace: "nowrap",
                    color: props.color,
                    fontSize: props.fontSize,
                    fontWeight: props.fontWeight ?? 900,
                    lineHeight: 1,
                    willChange:
                        overflowDistance > 0
                            ? "transform"
                            : "auto"
                }}
            >
                {props.text}
            </span>
        </div>
    );
}

function LayoutPreviewItem(props: {
    id: string;
    label: string;
    sublabel?: string;
    rect: ControllerLayoutRect;
    selected: boolean;
    swapTarget?: boolean;
    dragging?: boolean;
    ghost?: boolean;
    ghostValid?: boolean;
    kind: "element" | "switch";
    shape?: ControllerLayoutElementShape;
    visualStyle?: ControllerLayoutElementStyle;
    onSelect?: () => void;
    onBeginDrag?: (
        event: React.PointerEvent<HTMLElement>,
        target: DragTarget
    ) => void;
}) {
    const baseTarget: DragTarget =
        props.kind === "element"
            ? {
                kind: "element",
                id: props.id.startsWith("element:")
                    ? props.id.substring(
                        "element:".length
                    ) as ControllerLayoutElementId
                    : props.id as ControllerLayoutElementId,
                mode: "move"
            }
            : {
                kind: "switch",
                id: props.id,
                mode: "move"
            };

    const shape = props.shape ?? "rounded";
    const visualStyle =
        props.visualStyle ?? "panel";
    const isMinimal =
        props.kind === "element"
        && visualStyle === "minimal";

    const borderColor =
        props.ghost && props.ghostValid !== undefined
            ? (
                props.ghostValid
                    ? "#22c55e"
                    : "#ef4444"
            )
            : props.swapTarget
                ? "#22c55e"
                : props.selected
                    ? MFX_COLORS.cyan
                    : MFX_COLORS.border;

    const renderShape = () => {
        if (isMinimal) return null;

        if (
            props.kind === "element"
            && (shape === "hexagon"
                || shape === "triangle")
        ) {
            const points =
                shape === "hexagon"
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
                        fill={MFX_COLORS.panelAlt}
                        stroke={borderColor}
                        strokeWidth={
                            props.selected
                            || props.swapTarget
                            || (
                                props.ghost
                                && props.ghostValid !== undefined
                            )
                                ? 3
                                : 2
                        }
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
                        MFX_COLORS.panelAlt,
                    border: `${
                        props.selected
                        || props.swapTarget
                        || (
                            props.ghost
                            && props.ghostValid !== undefined
                        )
                            ? 3
                            : 2
                    }px solid ${borderColor}`,
                    boxSizing: "border-box",
                    borderRadius:
                        props.kind === "element"
                        && shape === "circle"
                            ? "50%"
                            : props.kind === "element"
                            && shape === "rectangle"
                                ? 2
                                : 14
                }}
            />
        );
    };

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={props.ghost ? undefined : props.onSelect}
            onPointerDown={
                props.ghost || !props.onBeginDrag
                    ? undefined
                    : (event) =>
                        props.onBeginDrag?.(event, {
                            ...baseTarget,
                            mode: "move"
                        })
            }
            style={{
                position: "absolute",
                left: `${props.rect.x * 100}%`,
                top: `${props.rect.y * 100}%`,
                width: `${props.rect.width * 100}%`,
                height: `${props.rect.height * 100}%`,
                boxSizing: "border-box",
                containerType: "size",
                color: MFX_COLORS.text,
                opacity: props.ghost
                    ? 0.76
                    : props.dragging
                        ? 0.26
                        : 1,
                zIndex: props.ghost ? 100 : 1,
                pointerEvents: props.ghost ? "none" : undefined,
                filter: props.ghost
                    ? (
                        props.ghostValid === true
                            ? "drop-shadow(0 0 10px rgba(34,197,94,0.48)) drop-shadow(0 10px 18px rgba(0,0,0,0.42))"
                            : props.ghostValid === false
                                ? "drop-shadow(0 0 10px rgba(239,68,68,0.48)) drop-shadow(0 10px 18px rgba(0,0,0,0.42))"
                                : "drop-shadow(0 10px 18px rgba(0,0,0,0.42))"
                    )
                    : undefined,
                display: "flex",
                flexDirection: "column",
                alignItems:
                    props.kind === "element"
                        ? "center"
                        : "flex-start",
                justifyContent: "center",
                cursor: props.ghost
                    ? "grabbing"
                    : props.dragging
                        ? "grabbing"
                        : "move",
                touchAction: "none",
                userSelect: "none",
                WebkitUserSelect: "none",
                overflow: "visible",
                outline:
                    isMinimal
                    && (
                        props.selected
                        || props.swapTarget
                        || (
                            props.ghost
                            && props.ghostValid !== undefined
                        )
                    )
                        ? `2px dashed ${borderColor}`
                        : "none",
                outlineOffset: -2
            }}
        >
            {renderShape()}

            <div
                style={{
                    position: "relative",
                    zIndex: 1,
                    width: "100%",
                    height: "100%",
                    minWidth: 0,
                    minHeight: 0,
                    boxSizing: "border-box",
                    padding:
                        props.kind === "switch"
                            ? 2
                            : visualStyle === "minimal"
                                ? 1
                                : visualStyle === "compact"
                                    ? 2
                                    : 4,
                    display: "grid",
                    gridTemplateRows: props.sublabel
                        ? "minmax(0,1fr) minmax(0,1fr)"
                        : "minmax(0,1fr)",
                    gap: 1,
                    textAlign:
                        props.kind === "element"
                            ? "center"
                            : "left",
                    pointerEvents: "none",
                    overflow: "hidden"
                }}
            >
                {/* Preview typography uses control geometry only. Long text
                    scrolls instead of shrinking to a different size. */}
                <LayoutPreviewMarqueeText
                    text={props.label}
                    color={
                        props.kind === "element"
                            ? MFX_COLORS.muted
                            : MFX_COLORS.cyan
                    }
                    fontSize={
                        props.kind === "switch"
                            ? LAYOUT_PREVIEW_SWITCH_LABEL_TEXT_SIZE
                            : LAYOUT_PREVIEW_LABEL_TEXT_SIZE
                    }
                    fontWeight={900}
                    align={props.kind === "element" ? "center" : "left"}
                />

                {props.sublabel && (
                    <LayoutPreviewMarqueeText
                        text={props.sublabel}
                        color={MFX_COLORS.text}
                        fontSize={LAYOUT_PREVIEW_VALUE_TEXT_SIZE}
                        fontWeight={900}
                        align={props.kind === "element" ? "center" : "left"}
                    />
                )}
            </div>            {!props.ghost && props.onBeginDrag && (
                <div
                    aria-label="Resize"
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        props.onBeginDrag?.(event, {
                            ...baseTarget,
                            mode: "resize"
                        });
                    }}
                    style={resizeHandleStyle}
                />
            )}
        </div>
    );
}

function ActionEditor(props: {
    title: string;
    action: ControllerSwitchAction;
    onType: (type: ActionKind) => void;
    onPresetIndex: (presetIndex: number) => void;
}) {
    const presetSlotNumber =
        props.action.type === "preset"
            ? props.action.presetIndex + 1
            : 1;
    const [presetSlotText, setPresetSlotText] = useState(
        () => String(presetSlotNumber)
    );

    useEffect(() => {
        setPresetSlotText(String(presetSlotNumber));
    }, [presetSlotNumber, props.action.type]);

    const updatePresetSlotText = (value: string) => {
        // Keep the text box independent while the user is editing so deleting
        // the current value does not immediately force it back to 1.
        setPresetSlotText(value);
        if (value.trim() === "") return;

        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) return;

        const normalizedSlot = Math.max(1, Math.round(numericValue));
        props.onPresetIndex(normalizedSlot - 1);
    };

    const finishPresetSlotEdit = () => {
        if (presetSlotText.trim() === "") {
            setPresetSlotText(String(presetSlotNumber));
            return;
        }

        const numericValue = Number(presetSlotText);
        if (!Number.isFinite(numericValue) || numericValue < 1) {
            setPresetSlotText(String(presetSlotNumber));
            return;
        }

        const normalizedSlot = Math.max(1, Math.round(numericValue));
        setPresetSlotText(String(normalizedSlot));
        props.onPresetIndex(normalizedSlot - 1);
    };

    return (
        <div style={actionBoxStyle}>
            <div style={actionTitleStyle}>{props.title}</div>
            <select
                value={actionKind(props.action)}
                onChange={(event) =>
                    props.onType(event.target.value as ActionKind)
                }
                style={inputStyle}
            >
                <option value="none">Unused</option>
                <option value="preset">Preset slot</option>
                <option value="bankUp">Bank Up</option>
                <option value="bankDown">Bank Down</option>
                <option value="chainBypass">Chain Bypass</option>
                <option value="snapshotMode">Snapshot Mode</option>
            </select>

            {props.action.type === "preset" && (
                <label style={{ ...fieldLabelStyle, marginTop: 8 }}>
                    Preset slot
                    <input
                        type="number"
                        min={1}
                        value={presetSlotText}
                        onChange={(event) =>
                            updatePresetSlotText(event.target.value)
                        }
                        onBlur={finishPresetSlotEdit}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                finishPresetSlotEdit();
                                event.currentTarget.blur();
                            }
                        }}
                        style={inputStyle}
                    />
                </label>
            )}
        </div>
    );
}

const screenStyle: React.CSSProperties = {
    height: "100%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: MFX_COLORS.background,
    color: MFX_COLORS.text
};

const headerStyle: React.CSSProperties = {
    flex: "0 0 auto",
    display: "flex",
    alignItems: "center",
    padding: "10px 14px",
    borderBottom: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panel
};

const titleStyle: React.CSSProperties = {
    color: MFX_COLORS.cyan,
    fontSize: "1rem",
    fontWeight: 950,
    letterSpacing: "0.08em"
};

const subtitleStyle: React.CSSProperties = {
    color: MFX_COLORS.muted,
    fontSize: "0.72rem",
    marginTop: 2
};

const counterStyle: React.CSSProperties = {
    marginLeft: "auto",
    border: `1px solid ${MFX_COLORS.border}`,
    borderRadius: 8,
    padding: "5px 9px",
    color: MFX_COLORS.cyan,
    fontWeight: 900,
    fontSize: "0.78rem"
};

const messageStyle: React.CSSProperties = {
    flex: "0 0 auto",
    padding: "6px 12px",
    textAlign: "center",
    background: MFX_COLORS.cyanSurface,
    color: MFX_COLORS.cyanText,
    borderBottom: `1px solid ${MFX_COLORS.cyan}`,
    fontSize: "0.76rem",
    fontWeight: 850
};

const bodyStyle: React.CSSProperties = {
    flex: "1 1 auto",
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "62% 38%",
    overflow: "hidden"
};

const switchListPanelStyle: React.CSSProperties = {
    minWidth: 0,
    overflow: "auto",
    padding: 12,
    borderRight: `1px solid ${MFX_COLORS.border}`
};

const editorPanelStyle: React.CSSProperties = {
    minWidth: 0,
    overflowY: "auto",
    padding: 12,
    background: MFX_COLORS.panelAlt
};

const sectionTopStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
    marginBottom: 10
};

const sectionTitleStyle: React.CSSProperties = {
    color: MFX_COLORS.cyan,
    fontSize: "0.82rem",
    fontWeight: 950,
    letterSpacing: "0.06em"
};

const helpStyle: React.CSSProperties = {
    color: MFX_COLORS.muted,
    fontSize: "0.7rem",
    lineHeight: 1.35
};

const switchListStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 8,
    padding: 10,
    border: `1px solid ${MFX_COLORS.border}`,
    borderRadius: 12,
    background: MFX_COLORS.panelAlt
};

const switchCellStyle: React.CSSProperties = {
    minHeight: 82,
    padding: 8,
    border: "1px solid",
    borderRadius: 10,
    background: MFX_COLORS.panel,
    color: MFX_COLORS.text,
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "center",
    textAlign: "left",
    cursor: "pointer"
};

const switchNumberStyle: React.CSSProperties = {
    color: MFX_COLORS.cyan,
    fontSize: "0.72rem",
    fontWeight: 950
};

const switchActionStyle: React.CSSProperties = {
    color: MFX_COLORS.text,
    marginTop: 5,
    fontSize: "0.82rem",
    fontWeight: 900,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
};

const switchGpioStyle: React.CSSProperties = {
    color: MFX_COLORS.muted,
    marginTop: 6,
    fontSize: "0.66rem"
};

const layoutSummaryStyle: React.CSSProperties = {
    marginTop: 10,
    padding: 8,
    borderRadius: 8,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panel,
    color: MFX_COLORS.muted,
    fontSize: "0.68rem",
    fontWeight: 850
};

const buttonRowStyle: React.CSSProperties = {
    display: "flex",
    gap: 8,
    marginTop: 10
};

const buttonStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 8,
    border: `1px solid ${MFX_COLORS.cyan}`,
    background: MFX_COLORS.cyanSurface,
    color: MFX_COLORS.cyanText,
    fontWeight: 900,
    cursor: "pointer"
};

const layoutButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    minWidth: 112,
    minHeight: 42,
    fontSize: "0.82rem",
    letterSpacing: "0.06em"
};

const dangerButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panel,
    color: MFX_COLORS.text
};

const fieldLabelStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    marginTop: 12,
    color: MFX_COLORS.muted,
    fontSize: "0.72rem",
    fontWeight: 850
};

const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "7px 8px",
    borderRadius: 7,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.background,
    color: MFX_COLORS.text
};

const noteStyle: React.CSSProperties = {
    marginTop: 6,
    padding: 7,
    borderRadius: 7,
    border: `1px solid ${MFX_COLORS.border}`,
    color: MFX_COLORS.muted,
    fontSize: "0.66rem",
    lineHeight: 1.35
};

const actionBoxStyle: React.CSSProperties = {
    marginTop: 12,
    padding: 9,
    borderRadius: 9,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panel
};

const actionTitleStyle: React.CSSProperties = {
    color: MFX_COLORS.cyan,
    fontSize: "0.68rem",
    fontWeight: 950,
    marginBottom: 6
};

const footerStyle: React.CSSProperties = {
    flex: "0 0 auto",
    display: "flex",
    gap: 8,
    alignItems: "center",
    padding: "8px 12px",
    borderTop: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panel
};

const footerHelpStyle: React.CSSProperties = {
    flex: "1 1 auto",
    minWidth: 0,
    color: MFX_COLORS.muted,
    fontSize: "0.68rem"
};

const secondaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.background,
    color: MFX_COLORS.text
};

const saveButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    minWidth: 100
};

const checkboxLabelStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 7,
    marginTop: 14,
    color: MFX_COLORS.text,
    fontSize: "0.72rem",
    fontWeight: 850
};

const layoutOverlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: `${MFX_HEADER_HEIGHT}px 0 0 0`,
    zIndex: 30000,
    padding: 12,
    boxSizing: "border-box",
    background: MFX_COLORS.background,
    color: MFX_COLORS.text
};

const layoutEditorShellStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    border: `1px solid ${MFX_COLORS.border}`,
    borderRadius: 12,
    overflow: "hidden",
    background: MFX_COLORS.panel
};

const layoutEditorToolbarStyle: React.CSSProperties = {
    flex: "0 0 auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 12px",
    borderBottom: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panel
};

const layoutModeGroupStyle: React.CSSProperties = {
    marginLeft: "auto",
    display: "flex",
    gap: 4,
    padding: 3,
    borderRadius: 9,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.background
};

const layoutModeStyle: React.CSSProperties = {
    ...secondaryButtonStyle,
    minWidth: 82,
    padding: "7px 10px",
    border: "none"
};

const layoutModeActiveStyle: React.CSSProperties = {
    ...layoutModeStyle,
    background: MFX_COLORS.cyanSurface,
    color: MFX_COLORS.cyanText
};

const layoutEditorBodyStyle: React.CSSProperties = {
    flex: "1 1 auto",
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "220px minmax(0, 1fr)"
};

const layoutInspectorStyle: React.CSSProperties = {
    minHeight: 0,
    overflowY: "auto",
    padding: 12,
    borderRight: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panelAlt
};

const selectedInfoStyle: React.CSSProperties = {
    marginTop: 7,
    color: MFX_COLORS.cyan,
    fontWeight: 900,
    fontSize: "0.82rem"
};

const rectInfoStyle: React.CSSProperties = {
    marginTop: 7,
    color: MFX_COLORS.muted,
    fontSize: "0.68rem",
    lineHeight: 1.45
};

const layoutPreviewPanelStyle: React.CSSProperties = {
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    padding: 10,
    background: MFX_COLORS.background
};

const layoutPreviewTitleStyle: React.CSSProperties = {
    flex: "0 0 auto",
    paddingBottom: 7,
    color: MFX_COLORS.muted,
    fontSize: "0.68rem",
    fontWeight: 800
};

const layoutCanvasStyle: React.CSSProperties = {
    position: "relative",
    flex: "1 1 auto",
    minHeight: 0,
    overflow: "hidden",
    border: `2px solid ${MFX_COLORS.border}`,
    borderRadius: 10,
    backgroundColor: MFX_COLORS.background,
    backgroundPosition: "0 0",
    touchAction: "none"
};

const layoutPreviewSwitchStyle: React.CSSProperties = {
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 4,
    padding: 8,
    border: `2px solid ${MFX_COLORS.border}`,
    borderRadius: 8,
    background: MFX_COLORS.panelAlt,
    color: MFX_COLORS.cyan,
    textAlign: "left",
    cursor: "pointer"
};

const layoutPreviewEmptyStyle: React.CSSProperties = {
    minWidth: 0,
    minHeight: 0,
    border: `1px dashed ${MFX_COLORS.border}`,
    borderRadius: 8,
    background: "transparent",
    color: MFX_COLORS.muted,
    fontSize: "0.65rem",
    fontWeight: 850,
    cursor: "pointer"
};

const resizeHandleStyle: React.CSSProperties = {
    position: "absolute",
    zIndex: 5,
    right: 1,
    bottom: 1,
    width: 28,
    height: 28,
    borderRight: `5px solid ${MFX_COLORS.cyan}`,
    borderBottom: `5px solid ${MFX_COLORS.cyan}`,
    boxSizing: "border-box",
    cursor: "nwse-resize",
    touchAction: "none",
    userSelect: "none",
    WebkitUserSelect: "none"
};
