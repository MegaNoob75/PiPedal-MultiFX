/*
 * PiPedal-MultiFX controller configuration.
 *
 * This file intentionally supports ONE schema only. During development it is
 * safer to reject an incompatible config than to silently migrate old fields
 * into a different meaning. If validation fails, MultiFX uses the factory
 * configuration from this file/controller-config.json.
 */

export type ControllerSwitchAction =
    | { type: "preset"; presetIndex: number }
    | { type: "bankUp" }
    | { type: "bankDown" }
    | { type: "chainBypass" }
    | { type: "snapshotMode" }
    | { type: "none"; text: string };

export interface ControllerSwitchConfig {
    id: string;
    label: string;
    hardwareSwitch: number;
    gpioPin: number | null;
    action: ControllerSwitchAction;
    longPressAction: ControllerSwitchAction;
    row: number;
    column: number;
}

export type ControllerPerformanceLayoutMode = "grid" | "freeform";

export interface ControllerLayoutRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export type ControllerLayoutElementId =
    | "currentBank"
    | "activePreset"
    | "cpuUsage"
    | "xruns"
    | "lastXrun"
    | "temperature"
    | "cpuFrequency"
    | "cpuGovernor"
    | "audioStatus"
    | "systemStatus"
    | "chainBypassStatus"
    | "snapshotModeStatus";

export type ControllerLayoutElementStyle = "panel" | "compact" | "minimal";
export type ControllerLayoutElementShape =
    | "rectangle"
    | "rounded"
    | "circle"
    | "hexagon"
    | "triangle";

export interface ControllerLayoutElement {
    id: ControllerLayoutElementId;
    visible: boolean;
    rect: ControllerLayoutRect;
    style: ControllerLayoutElementStyle;
    shape: ControllerLayoutElementShape;
    showLabel: boolean;
}

export const CONTROLLER_LAYOUT_ELEMENT_IDS:
    readonly ControllerLayoutElementId[] = [
        "currentBank",
        "activePreset",
        "cpuUsage",
        "xruns",
        "lastXrun",
        "temperature",
        "cpuFrequency",
        "cpuGovernor",
        "audioStatus",
        "systemStatus",
        "chainBypassStatus",
        "snapshotModeStatus"
    ];

export const CONTROLLER_LAYOUT_ELEMENT_LABELS:
    Record<ControllerLayoutElementId, string> = {
        currentBank: "Current Bank",
        activePreset: "Active Preset",
        cpuUsage: "CPU Usage",
        xruns: "XRuns",
        lastXrun: "Last XRun",
        temperature: "Temperature",
        cpuFrequency: "CPU Frequency",
        cpuGovernor: "CPU Governor",
        audioStatus: "Audio Status",
        systemStatus: "System Status",
        chainBypassStatus: "Chain Bypass",
        snapshotModeStatus: "Snapshot Mode"
    };

export interface ControllerPerformanceLayout {
    mode: ControllerPerformanceLayoutMode;
    switches: Record<string, ControllerLayoutRect>;
    unplacedSwitchIds: string[];
    elements: Record<ControllerLayoutElementId, ControllerLayoutElement>;
}

export interface ControllerGridLayoutDefault {
    columns: number;
    rows: number;
    positions: Record<string, { row: number; column: number }>;
}

export interface ControllerFreeformLayoutDefault {
    switches: Record<string, ControllerLayoutRect>;
    unplacedSwitchIds: string[];
    elements: Record<ControllerLayoutElementId, ControllerLayoutElement>;
}

export interface ControllerLayoutDefaults {
    grid: ControllerGridLayoutDefault | null;
    freeform: ControllerFreeformLayoutDefault | null;
}

/*
 * Visual values are still part of the current schema because Performance View
 * consumes them directly. They are not migration aliases. A later UI-only
 * refactor can move them into the theme without changing musical/controller
 * state semantics.
 */
export interface ControllerColors {
    pageBackground: string;
    pageText: string;
    headerBackground: string;
    headerBorder: string;
    headerShadow: string;
    bankTitleText: string;
    bankNameText: string;
    activePresetLabelText: string;
    activePresetNameText: string;
    headerDivider: string;
    switchBackground: string;
    switchBorder: string;
    switchLabelText: string;
    switchValueText: string;
    bankSwitchBackground: string;
    bankSwitchBorder: string;
    bankSwitchLabelText: string;
    bankSwitchValueText: string;
    activeSwitchBackground: string;
    activeSwitchBorder: string;
    activeSwitchLabelText: string;
    activeSwitchValueText: string;
    activeSwitchShadow: string;
    disabledSwitchOpacity: number;
    configErrorBackground: string;
    configErrorBorder: string;
    configErrorText: string;
}

export interface ControllerSizing {
    gridTopMargin: number;
    switchPadding: string;
    switchBorderRadius: number;
    switchLabelFontSize: string;
    switchValueFontSize: string;
    switchValueMarginTop: number;
    bankTitleFontSize: string;
    bankNameFontSize: string;
    activePresetLabelFontSize: string;
    activePresetNameFontSize: string;
    marqueeDelaySeconds: number;
    marqueePixelsPerSecond: number;
    marqueeEndPauseSeconds: number;
}

export interface ControllerLayoutConfig {
    schemaVersion: 1;
    columns: number;
    rows: number;
    gap: number;
    outerPadding: number;
    headerPadding: string;
    longPressMs: number;
    sizing: ControllerSizing;
    colors: ControllerColors;
    switches: ControllerSwitchConfig[];
    performanceLayout: ControllerPerformanceLayout;
    layoutDefaults: ControllerLayoutDefaults;
}

export interface LoadedControllerConfig {
    config: ControllerLayoutConfig;
    error?: string;
}

export const MAX_FOOTSWITCHES = 12;
export const MAX_CONTROLLER_COLUMNS = 6;
export const MAX_CONTROLLER_ROWS = 3;
export const DEFAULT_LONG_PRESS_MS = 700;
export const MIN_LONG_PRESS_MS = 300;
export const MAX_LONG_PRESS_MS = 3000;
export const MIN_FREEFORM_SWITCH_WIDTH = 0.06;
export const MIN_FREEFORM_SWITCH_HEIGHT = 0.06;
export const MIN_FREEFORM_HEADER_WIDTH = 0.18;
export const MIN_FREEFORM_HEADER_HEIGHT = 0.09;

export const CONTROLLER_CONFIG_CHANGED_EVENT =
    "multifx-controller-config-changed";

const CONTROLLER_STORAGE_KEY = "pipedal-multifx-controller-config-v2";

// Used only when no capability-aware controller is connected. Connected
// controllers report their own usable inputs through the runtime bridge.
export const FALLBACK_FOOTSWITCH_GPIO_PINS: readonly number[] = [
    1, 2, 3, 4, 5, 6, 7, 9, 10, 14, 15, 16, 39, 40, 41, 42, 47
];

const BANK_RECT: ControllerLayoutRect = {
    x: 0,
    y: 0,
    width: 0.48,
    height: 0.18
};

const ACTIVE_PRESET_RECT: ControllerLayoutRect = {
    x: 0.52,
    y: 0,
    width: 0.48,
    height: 0.18
};

const DEFAULT_ELEMENT_RECT: ControllerLayoutRect = {
    x: 0.35,
    y: 0.35,
    width: 0.22,
    height: 0.14
};

function makeDefaultElements(): Record<
    ControllerLayoutElementId,
    ControllerLayoutElement
> {
    const result = {} as Record<
        ControllerLayoutElementId,
        ControllerLayoutElement
    >;

    for (const id of CONTROLLER_LAYOUT_ELEMENT_IDS) {
        let rect = { ...DEFAULT_ELEMENT_RECT };
        let visible = false;
        let style: ControllerLayoutElementStyle = "compact";
        let shape: ControllerLayoutElementShape = "rounded";

        if (id === "currentBank") {
            rect = { ...BANK_RECT };
            visible = true;
            style = "panel";
        } else if (id === "activePreset") {
            rect = { ...ACTIVE_PRESET_RECT };
            visible = true;
            style = "panel";
        } else if (id === "cpuUsage" || id === "temperature") {
            shape = "circle";
        } else if (id === "xruns") {
            shape = "hexagon";
        } else if (id === "audioStatus") {
            style = "minimal";
        } else if (id === "systemStatus") {
            rect = { x: 0.25, y: 0.25, width: 0.50, height: 0.24 };
            style = "panel";
        }

        result[id] = {
            id,
            visible,
            rect,
            style,
            shape,
            showLabel: true
        };
    }

    return result;
}

export const defaultControllerConfig: ControllerLayoutConfig = {
    schemaVersion: 1,
    columns: 4,
    rows: 2,
    gap: 10,
    outerPadding: 12,
    headerPadding: "clamp(8px, 1.5vh, 16px) clamp(12px, 2.4vw, 24px)",
    longPressMs: DEFAULT_LONG_PRESS_MS,
    sizing: {
        gridTopMargin: 10,
        switchPadding: "clamp(6px, 1.35vw, 14px)",
        switchBorderRadius: 12,
        switchLabelFontSize: "clamp(0.62rem, 1.35vw, 0.90rem)",
        switchValueFontSize: "clamp(0.78rem, 1.95vw, 1.25rem)",
        switchValueMarginTop: 4,
        bankTitleFontSize: "clamp(0.76rem, 1.6vw, 1.05rem)",
        bankNameFontSize: "clamp(1.35rem, 4.2vw, 2.8rem)",
        activePresetLabelFontSize: "clamp(0.72rem, 1.5vw, 0.95rem)",
        activePresetNameFontSize: "clamp(0.95rem, 2.5vw, 1.55rem)",
        marqueeDelaySeconds: 2.5,
        marqueePixelsPerSecond: 45,
        marqueeEndPauseSeconds: 1.0
    },
    colors: {
        pageBackground: "#121212",
        pageText: "#ffffff",
        headerBackground: "#1e1e1e",
        headerBorder: "#333333",
        headerShadow: "0 4px 20px rgba(0,0,0,0.5)",
        bankTitleText: "#A770E4",
        bankNameText: "#ffffff",
        activePresetLabelText: "#aaaaaa",
        activePresetNameText: "#22c55e",
        headerDivider: "#333333",
        switchBackground: "#1e1e1e",
        switchBorder: "#333333",
        switchLabelText: "#888888",
        switchValueText: "#ffffff",
        bankSwitchBackground: "#2a1b40",
        bankSwitchBorder: "#A770E4",
        bankSwitchLabelText: "#b99adf",
        bankSwitchValueText: "#ffffff",
        activeSwitchBackground: "#22c55e",
        activeSwitchBorder: "#4ade80",
        activeSwitchLabelText: "#d9ffe5",
        activeSwitchValueText: "#071a0c",
        activeSwitchShadow: "0 0 20px rgba(34,197,94,0.45)",
        disabledSwitchOpacity: 0.48,
        configErrorBackground: "#3b1111",
        configErrorBorder: "#ef4444",
        configErrorText: "#fecaca"
    },
    switches: [
        { id: "sw1", label: "SW 1", hardwareSwitch: 1, gpioPin: 6,  action: { type: "preset", presetIndex: 0 }, longPressAction: { type: "none", text: "Unused" }, row: 1, column: 1 },
        { id: "sw2", label: "SW 2", hardwareSwitch: 2, gpioPin: 7,  action: { type: "preset", presetIndex: 1 }, longPressAction: { type: "none", text: "Unused" }, row: 1, column: 2 },
        { id: "sw3", label: "SW 3", hardwareSwitch: 3, gpioPin: 15, action: { type: "preset", presetIndex: 2 }, longPressAction: { type: "none", text: "Unused" }, row: 1, column: 3 },
        { id: "sw4", label: "SW 4", hardwareSwitch: 4, gpioPin: 16, action: { type: "preset", presetIndex: 3 }, longPressAction: { type: "none", text: "Unused" }, row: 1, column: 4 },
        { id: "sw5", label: "SW 5", hardwareSwitch: 5, gpioPin: 1,  action: { type: "chainBypass" }, longPressAction: { type: "none", text: "Unused" }, row: 2, column: 1 },
        { id: "sw6", label: "SW 6", hardwareSwitch: 6, gpioPin: 2,  action: { type: "snapshotMode" }, longPressAction: { type: "none", text: "Unused" }, row: 2, column: 2 },
        { id: "sw7", label: "SW 7", hardwareSwitch: 7, gpioPin: 4,  action: { type: "bankUp" }, longPressAction: { type: "none", text: "Unused" }, row: 2, column: 3 },
        { id: "sw8", label: "SW 8", hardwareSwitch: 8, gpioPin: 5,  action: { type: "bankDown" }, longPressAction: { type: "none", text: "Unused" }, row: 2, column: 4 }
    ],
    performanceLayout: {
        mode: "grid",
        switches: {},
        unplacedSwitchIds: [],
        elements: makeDefaultElements()
    },
    layoutDefaults: {
        grid: null,
        freeform: null
    }
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneConfig(config: ControllerLayoutConfig): ControllerLayoutConfig {
    return structuredClone(config);
}

function validRect(value: unknown): value is ControllerLayoutRect {
    if (!isRecord(value)) return false;
    const x = value.x;
    const y = value.y;
    const width = value.width;
    const height = value.height;
    if (
        typeof x !== "number" || !Number.isFinite(x)
        || typeof y !== "number" || !Number.isFinite(y)
        || typeof width !== "number" || !Number.isFinite(width)
        || typeof height !== "number" || !Number.isFinite(height)
    ) return false;
    return width > 0
        && height > 0
        && x >= 0
        && y >= 0
        && x + width <= 1.000001
        && y + height <= 1.000001;
}

function validAction(value: unknown): value is ControllerSwitchAction {
    if (!isRecord(value) || typeof value.type !== "string") return false;
    switch (value.type) {
        case "preset":
            return typeof value.presetIndex === "number"
                && Number.isInteger(value.presetIndex)
                && value.presetIndex >= 0;
        case "bankUp":
        case "bankDown":
        case "chainBypass":
        case "snapshotMode":
            return true;
        case "none":
            return typeof value.text === "string";
        default:
            return false;
    }
}

function validElement(value: unknown, id: ControllerLayoutElementId): value is ControllerLayoutElement {
    if (!isRecord(value)) return false;
    return value.id === id
        && typeof value.visible === "boolean"
        && validRect(value.rect)
        && (value.style === "panel" || value.style === "compact" || value.style === "minimal")
        && (value.shape === "rectangle" || value.shape === "rounded" || value.shape === "circle" || value.shape === "hexagon" || value.shape === "triangle")
        && typeof value.showLabel === "boolean";
}

function validateConfig(value: unknown): string | undefined {
    if (!isRecord(value)) return "Controller config must be an object.";
    if (value.schemaVersion !== 1) return "Unsupported controller config schema. Reset to the current factory configuration.";

    const integerIn = (input: unknown, min: number, max: number) =>
        typeof input === "number" && Number.isInteger(input) && input >= min && input <= max;

    if (!integerIn(value.columns, 1, MAX_CONTROLLER_COLUMNS)) return "Invalid controller column count.";
    if (!integerIn(value.rows, 1, MAX_CONTROLLER_ROWS)) return "Invalid controller row count.";
    if (typeof value.gap !== "number" || !Number.isFinite(value.gap) || value.gap < 0) return "Invalid controller gap.";
    if (typeof value.outerPadding !== "number" || !Number.isFinite(value.outerPadding) || value.outerPadding < 0) return "Invalid outer padding.";
    if (typeof value.headerPadding !== "string") return "Invalid header padding.";
    if (typeof value.longPressMs !== "number" || value.longPressMs < MIN_LONG_PRESS_MS || value.longPressMs > MAX_LONG_PRESS_MS) return "Invalid long-press threshold.";

    if (!isRecord(value.sizing)) return "Missing controller sizing.";
    const numericSizing = [
        "gridTopMargin", "switchBorderRadius", "switchValueMarginTop",
        "marqueeDelaySeconds", "marqueePixelsPerSecond", "marqueeEndPauseSeconds"
    ];
    const stringSizing = [
        "switchPadding", "switchLabelFontSize", "switchValueFontSize",
        "bankTitleFontSize", "bankNameFontSize",
        "activePresetLabelFontSize", "activePresetNameFontSize"
    ];
    for (const key of numericSizing) {
        const input = value.sizing[key];
        if (typeof input !== "number" || !Number.isFinite(input) || input < 0) return `Invalid sizing field: ${key}.`;
    }
    for (const key of stringSizing) {
        if (typeof value.sizing[key] !== "string") return `Invalid sizing field: ${key}.`;
    }

    if (!isRecord(value.colors)) return "Missing controller colors.";
    const colorStringKeys = Object.keys(defaultControllerConfig.colors)
        .filter((key) => key !== "disabledSwitchOpacity");
    for (const key of colorStringKeys) {
        if (typeof value.colors[key] !== "string") return `Invalid color field: ${key}.`;
    }
    if (typeof value.colors.disabledSwitchOpacity !== "number"
        || !Number.isFinite(value.colors.disabledSwitchOpacity)
        || value.colors.disabledSwitchOpacity < 0
        || value.colors.disabledSwitchOpacity > 1) {
        return "Invalid disabled-switch opacity.";
    }

    if (!Array.isArray(value.switches) || value.switches.length > MAX_FOOTSWITCHES) return "Invalid switch list.";

    const ids = new Set<string>();
    const hardware = new Set<number>();
    const pins = new Set<number>();
    const gridCells = new Set<string>();
    const presetIndexes = new Set<number>();

    for (const raw of value.switches) {
        if (!isRecord(raw)) return "Invalid switch entry.";
        if (typeof raw.id !== "string" || !raw.id.trim() || ids.has(raw.id)) return "Switch IDs must be non-empty and unique.";
        if (typeof raw.label !== "string" || !raw.label.trim()) return "Switch labels must be non-empty.";
        ids.add(raw.id);
        if (!integerIn(raw.hardwareSwitch, 1, MAX_FOOTSWITCHES) || hardware.has(raw.hardwareSwitch as number)) return "Physical switch numbers must be unique.";
        hardware.add(raw.hardwareSwitch as number);
        if (raw.gpioPin !== null) {
            // Pin safety belongs to the connected controller firmware. Keeping
            // the persisted schema board-neutral allows a configuration from a
            // different supported controller to load before that hardware is
            // connected.
            if (!integerIn(raw.gpioPin, 0, 126)) return "Invalid footswitch GPIO.";
            if (pins.has(raw.gpioPin as number)) return "GPIO pins must be unique.";
            pins.add(raw.gpioPin as number);
        }
        if (!validAction(raw.action) || !validAction(raw.longPressAction)) return "Invalid switch action.";
        if (isRecord(raw.action) && raw.action.type === "preset") {
            const presetIndex = raw.action.presetIndex as number;
            if (presetIndexes.has(presetIndex)) return "Preset switch indexes must be unique.";
            presetIndexes.add(presetIndex);
        }
        if (!integerIn(raw.row, 1, MAX_CONTROLLER_ROWS) || !integerIn(raw.column, 1, MAX_CONTROLLER_COLUMNS)) return "Invalid switch grid position.";
        const cell = `${raw.row}:${raw.column}`;
        if (gridCells.has(cell)) return "Grid switch positions must be unique.";
        gridCells.add(cell);
    }

    const sortedPresetIndexes = [...presetIndexes].sort((a, b) => a - b);
    if (sortedPresetIndexes.some((value, index) => value !== index)) {
        return "Preset switch indexes must be contiguous starting at zero.";
    }

    const layout = value.performanceLayout;
    if (!isRecord(layout)) return "Missing Performance layout.";
    if (layout.mode !== "grid" && layout.mode !== "freeform") return "Invalid Performance layout mode.";
    if (!isRecord(layout.switches) || !Array.isArray(layout.unplacedSwitchIds) || !isRecord(layout.elements)) return "Invalid Performance layout data.";
    const validSwitchIds = new Set(ids);
    for (const rawId of layout.unplacedSwitchIds) {
        if (typeof rawId !== "string" || !validSwitchIds.has(rawId)) return "Invalid unplaced switch ID.";
    }
    for (const [switchId, rect] of Object.entries(layout.switches)) {
        if (!validSwitchIds.has(switchId) || !validRect(rect)) return `Invalid Performance switch rectangle: ${switchId}.`;
    }
    for (const id of CONTROLLER_LAYOUT_ELEMENT_IDS) {
        if (!validElement((layout.elements as Record<string, unknown>)[id], id)) return `Invalid dashboard element: ${id}.`;
    }

    if (!isRecord(value.layoutDefaults)) return "Missing layout defaults.";
    const gridDefault = value.layoutDefaults.grid;
    if (gridDefault !== null) {
        if (!isRecord(gridDefault)
            || !integerIn(gridDefault.columns, 1, MAX_CONTROLLER_COLUMNS)
            || !integerIn(gridDefault.rows, 1, MAX_CONTROLLER_ROWS)
            || !isRecord(gridDefault.positions)) return "Invalid Grid default.";
        for (const [switchId, position] of Object.entries(gridDefault.positions)) {
            if (!validSwitchIds.has(switchId) || !isRecord(position)
                || !integerIn(position.row, 1, MAX_CONTROLLER_ROWS)
                || !integerIn(position.column, 1, MAX_CONTROLLER_COLUMNS)) return "Invalid Grid-default switch position.";
        }
    }
    const freeformDefault = value.layoutDefaults.freeform;
    if (freeformDefault !== null) {
        if (!isRecord(freeformDefault) || !isRecord(freeformDefault.switches)
            || !Array.isArray(freeformDefault.unplacedSwitchIds)
            || !isRecord(freeformDefault.elements)) return "Invalid Freeform default.";
        for (const [switchId, rect] of Object.entries(freeformDefault.switches)) {
            if (!validSwitchIds.has(switchId) || !validRect(rect)) return "Invalid Freeform-default switch rectangle.";
        }
        for (const rawId of freeformDefault.unplacedSwitchIds) {
            if (typeof rawId !== "string" || !validSwitchIds.has(rawId)) return "Invalid Freeform-default unplaced switch ID.";
        }
        for (const id of CONTROLLER_LAYOUT_ELEMENT_IDS) {
            if (!validElement((freeformDefault.elements as Record<string, unknown>)[id], id)) return `Invalid Freeform-default element: ${id}.`;
        }
    }

    return undefined;
}

function defaultRectForSwitch(
    item: ControllerSwitchConfig,
    columns: number,
    rows: number
): ControllerLayoutRect {
    const top = 0.20;
    const availableHeight = 0.80;
    const gap = 0.012;
    const width = 1 / columns;
    const height = availableHeight / rows;
    return {
        x: (item.column - 1) * width + gap / 2,
        y: top + (item.row - 1) * height + gap / 2,
        width: Math.max(MIN_FREEFORM_SWITCH_WIDTH, width - gap),
        height: Math.max(MIN_FREEFORM_SWITCH_HEIGHT, height - gap)
    };
}

export function ensureControllerPerformanceLayout(
    config: ControllerLayoutConfig
): ControllerLayoutConfig {
    const next = cloneConfig(config);
    const validIds = new Set(next.switches.map((item) => item.id));

    next.performanceLayout.unplacedSwitchIds =
        next.performanceLayout.unplacedSwitchIds.filter((id) => validIds.has(id));

    const rects: Record<string, ControllerLayoutRect> = {};
    for (const item of next.switches) {
        const existing = next.performanceLayout.switches[item.id];
        rects[item.id] = validRect(existing)
            ? { ...existing }
            : defaultRectForSwitch(item, next.columns, next.rows);
    }
    next.performanceLayout.switches = rects;

    return next;
}

function parseControllerConfig(value: unknown): LoadedControllerConfig {
    const error = validateConfig(value);
    if (error) {
        return {
            config: cloneConfig(defaultControllerConfig),
            error
        };
    }

    return {
        config: ensureControllerPerformanceLayout(
            cloneConfig(value as unknown as ControllerLayoutConfig)
        )
    };
}

export async function loadControllerConfig(): Promise<LoadedControllerConfig> {
    const saved = window.localStorage.getItem(CONTROLLER_STORAGE_KEY);
    if (saved) {
        try {
            const parsed = parseControllerConfig(JSON.parse(saved) as unknown);
            if (!parsed.error) return parsed;
            window.localStorage.removeItem(CONTROLLER_STORAGE_KEY);
        } catch {
            window.localStorage.removeItem(CONTROLLER_STORAGE_KEY);
        }
    }

    try {
        const response = await fetch("/controller-config.json", { cache: "no-store" });
        if (response.ok) {
            const parsed = parseControllerConfig(await response.json());
            if (!parsed.error) return parsed;
        }
    } catch {
        // Factory config below remains available offline.
    }

    return { config: cloneConfig(defaultControllerConfig) };
}

export function saveControllerConfig(
    config: ControllerLayoutConfig
): LoadedControllerConfig {
    const parsed = parseControllerConfig(config);
    if (parsed.error) return parsed;

    window.localStorage.setItem(
        CONTROLLER_STORAGE_KEY,
        JSON.stringify(parsed.config, null, 2)
    );
    window.dispatchEvent(new Event(CONTROLLER_CONFIG_CHANGED_EVENT));
    return parsed;
}

export function clearSavedControllerConfig(): void {
    window.localStorage.removeItem(CONTROLLER_STORAGE_KEY);
    window.dispatchEvent(new Event(CONTROLLER_CONFIG_CHANGED_EVENT));
}

export function getSavedControllerConfigJson(): string | null {
    return window.localStorage.getItem(CONTROLLER_STORAGE_KEY);
}
