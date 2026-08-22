export type ControllerSwitchAction =
    | { type: "preset"; presetIndex: number; }
    | { type: "bankUp"; }
    | { type: "bankDown"; }
    | { type: "chainBypass"; }
    | { type: "snapshotMode"; }
    | { type: "none"; text?: string; };

export interface ControllerSwitchConfig {
    id: string;
    label: string;

    // Logical physical switch identity reported by the bridge (SW1..SW12).
    // This is deliberately independent of both GPIO wiring and musical action.
    hardwareSwitch?: number;

    // ESP32-S3 GPIO used by this logical switch. Undefined means disabled in
    // runtime state. Saved configs serialize that state as null so an explicit
    // "Not connected" remains distinct from legacy configs with no gpioPin field.
    gpioPin?: number;

    action: ControllerSwitchAction;
    longPressAction?: ControllerSwitchAction;

    // Grid coordinates are used only when the Performance layout is in Grid
    // mode. Freeform placement is stored separately in performanceLayout.
    row?: number;
    column?: number;
}

export type ControllerPerformanceLayoutMode = "grid" | "freeform";

export interface ControllerLayoutRect {
    // All values are normalized to the Performance View work area (0..1).
    // This keeps a custom enclosure layout proportional on different screens.
    x: number;
    y: number;
    width: number;
    height: number;
}

export type ControllerLayoutElementId =
    | "currentBank"
    | "presetPage"
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

export type ControllerLayoutElementStyle =
    | "panel"
    | "compact"
    | "minimal";

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
        "presetPage",
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
        presetPage: "Preset Page",
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
    snapToGrid: boolean;
    snapStep: number;

    // Freeform status widgets. Each logical status group moves/resizes
    // independently while keeping its related controls together.
    bankHeader: ControllerLayoutRect;
    presetPageHeader: ControllerLayoutRect;
    activePresetHeader: ControllerLayoutRect;

    // Legacy V1 field. Kept optional so an older controller-config.json can
    // be migrated without breaking. New saves use the three fields above.
    header?: ControllerLayoutRect;

    switches: Record<string, ControllerLayoutRect>;

    // Freeform-only placement state. A switch listed here remains part of the
    // controller configuration/hardware mapping, but is intentionally not
    // rendered in Performance View until it is placed in the Layout editor.
    // Grid mode ignores this list.
    unplacedSwitchIds: string[];

    // Dashboard/status elements are independent from footswitches. The three
    // original header rectangles above are retained as migration aliases, while
    // new layouts use this collection as the authoritative Freeform element set.
    elements: Record<ControllerLayoutElementId, ControllerLayoutElement>;
}


export interface ControllerGridLayoutDefault {
    columns: number;
    rows: number;
    positions: Record<string, {
        row: number;
        column: number;
    }>;
}

export interface ControllerFreeformLayoutDefault {
    bankHeader: ControllerLayoutRect;
    presetPageHeader: ControllerLayoutRect;
    activePresetHeader: ControllerLayoutRect;
    switches: Record<string, ControllerLayoutRect>;
    unplacedSwitchIds: string[];
    elements: Record<ControllerLayoutElementId, ControllerLayoutElement>;
}

export interface ControllerLayoutDefaults {
    grid?: ControllerGridLayoutDefault;
    freeform?: ControllerFreeformLayoutDefault;
}

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
    columns: number;
    rows: number;
    gap: number;
    outerPadding: number;
    headerPadding: string;
    longPressMs: number;
    sizing: ControllerSizing;
    colors: ControllerColors;
    switches: ControllerSwitchConfig[];

    // Performance placement is part of the shared controller configuration.
    // MultiFXRuntimeSync already distributes this object between browsers, so
    // editing the physical layout on a desktop also updates the Pi kiosk.
    performanceLayout: ControllerPerformanceLayout;

    // User-defined reset targets for each layout mode. These travel with the
    // controller configuration so different physical enclosures can define
    // their own defaults instead of relying on one hard-coded arrangement.
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

const DEFAULT_FREEFORM_HEADER: ControllerLayoutRect = {
    x: 0,
    y: 0,
    width: 1,
    height: 0.18
};

const DEFAULT_FREEFORM_BANK_HEADER: ControllerLayoutRect = {
    x: 0,
    y: 0,
    width: 0.32,
    height: 0.18
};

const DEFAULT_FREEFORM_PRESET_PAGE_HEADER: ControllerLayoutRect = {
    x: 0.34,
    y: 0,
    width: 0.32,
    height: 0.18
};

const DEFAULT_FREEFORM_ACTIVE_PRESET_HEADER: ControllerLayoutRect = {
    x: 0.68,
    y: 0,
    width: 0.32,
    height: 0.18
};

// Conservative GPIO list for the current ESP32-S3 DevKitC-1 controller.
// Pins currently occupied by pots/encoder are intentionally omitted.
// GPIO19/20 are USB D-/D+ and are never offered.
// GPIO35/36/37 are omitted because some WROOM variants use them internally.
// GPIO0/45/46 are omitted to avoid strapping-pin surprises.
export const FOOTSWITCH_GPIO_PINS: readonly number[] = [
    1, 2, 3, 4, 5, 6, 7, 9, 10, 14, 15, 16,
    39, 40, 41, 42, 47
];

const DEFAULT_GPIO_BY_SWITCH: Record<number, number | undefined> = {
    1: 6,
    2: 7,
    3: 15,
    4: 16,
    5: 1,
    6: 2,
    7: 4,
    8: 5
};

export function defaultGpioForHardwareSwitch(
    hardwareSwitch: number
): number | undefined {
    return DEFAULT_GPIO_BY_SWITCH[hardwareSwitch];
}


const DEFAULT_DASHBOARD_ELEMENT_RECT: ControllerLayoutRect = {
    x: 0.35,
    y: 0.35,
    width: 0.22,
    height: 0.14
};

function makeDefaultLayoutElements(): Record<
    ControllerLayoutElementId,
    ControllerLayoutElement
> {
    const result = {} as Record<
        ControllerLayoutElementId,
        ControllerLayoutElement
    >;

    for (const id of CONTROLLER_LAYOUT_ELEMENT_IDS) {
        let rect = DEFAULT_DASHBOARD_ELEMENT_RECT;
        let visible = false;
        let style: ControllerLayoutElementStyle = "compact";
        let shape: ControllerLayoutElementShape = "rounded";

        if (id === "currentBank") {
            rect = DEFAULT_FREEFORM_BANK_HEADER;
            visible = true;
            style = "panel";
        } else if (id === "presetPage") {
            rect = DEFAULT_FREEFORM_PRESET_PAGE_HEADER;
            visible = true;
            style = "panel";
        } else if (id === "activePreset") {
            rect = DEFAULT_FREEFORM_ACTIVE_PRESET_HEADER;
            visible = true;
            style = "panel";
        } else if (id === "cpuUsage") {
            shape = "circle";
        } else if (id === "xruns") {
            shape = "hexagon";
        } else if (id === "temperature") {
            shape = "circle";
        } else if (id === "audioStatus") {
            style = "minimal";
        } else if (id === "systemStatus") {
            rect = {
                x: 0.25,
                y: 0.25,
                width: 0.50,
                height: 0.24
            };
            style = "panel";
        }

        result[id] = {
            id,
            visible,
            rect: { ...rect },
            style,
            shape,
            showLabel: true
        };
    }

    return result;
}

export const defaultControllerConfig: ControllerLayoutConfig = {
    columns: 4,
    rows: 2,
    gap: 10,
    outerPadding: 12,
    headerPadding: "clamp(8px, 1.5vh, 16px) clamp(12px, 2.4vw, 24px)",
    longPressMs: DEFAULT_LONG_PRESS_MS,

    sizing: {
        gridTopMargin: 10,
        // Keep the same visual hierarchy while fitting 2-row and 3-row layouts.
        // These values intentionally scale with the 1024x600 appliance viewport
        // instead of assuming every controller is the original 4x2 layout.
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
        headerShadow: "0 4px 20px rgba(0, 0, 0, 0.5)",
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
        activeSwitchValueText: "#ffffff",
        activeSwitchShadow: "0 0 20px rgba(34, 197, 94, 0.4)",
        disabledSwitchOpacity: 0.45,
        configErrorBackground: "#3b1d1d",
        configErrorBorder: "#ef4444",
        configErrorText: "#fecaca"
    },

    switches: [
        { id: "sw1", label: "SW 1", hardwareSwitch: 1, gpioPin: 6,  action: { type: "preset", presetIndex: 0 }, longPressAction: { type: "none", text: "Unused" }, row: 1, column: 1 },
        { id: "sw2", label: "SW 2", hardwareSwitch: 2, gpioPin: 7,  action: { type: "preset", presetIndex: 1 }, longPressAction: { type: "none", text: "Unused" }, row: 1, column: 2 },
        { id: "sw3", label: "SW 3", hardwareSwitch: 3, gpioPin: 15, action: { type: "preset", presetIndex: 2 }, longPressAction: { type: "none", text: "Unused" }, row: 1, column: 3 },
        { id: "sw4", label: "SW 4", hardwareSwitch: 4, gpioPin: 16, action: { type: "bankUp" }, longPressAction: { type: "none", text: "Unused" }, row: 1, column: 4 },
        { id: "sw5", label: "SW 5", hardwareSwitch: 5, gpioPin: 1,  action: { type: "preset", presetIndex: 3 }, longPressAction: { type: "none", text: "Unused" }, row: 2, column: 1 },
        { id: "sw6", label: "SW 6", hardwareSwitch: 6, gpioPin: 2,  action: { type: "preset", presetIndex: 4 }, longPressAction: { type: "none", text: "Unused" }, row: 2, column: 2 },
        { id: "sw7", label: "SW 7", hardwareSwitch: 7, gpioPin: 4,  action: { type: "preset", presetIndex: 5 }, longPressAction: { type: "none", text: "Unused" }, row: 2, column: 3 },
        { id: "sw8", label: "SW 8", hardwareSwitch: 8, gpioPin: 5,  action: { type: "bankDown" }, longPressAction: { type: "none", text: "Unused" }, row: 2, column: 4 }
    ],

    performanceLayout: {
        mode: "grid",
        snapToGrid: true,
        snapStep: 0.025,
        bankHeader: DEFAULT_FREEFORM_BANK_HEADER,
        presetPageHeader: DEFAULT_FREEFORM_PRESET_PAGE_HEADER,
        activePresetHeader: DEFAULT_FREEFORM_ACTIVE_PRESET_HEADER,
        switches: {},
        unplacedSwitchIds: [],
        elements: makeDefaultLayoutElements()
    },

    layoutDefaults: {}
};

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown, fallback: string): string =>
    typeof value === "string" && value.trim().length > 0 ? value : fallback;

const nonNegativeNumber = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : fallback;

const opacityValue = (value: unknown, fallback: number): number =>
    typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= 1
        ? value
        : fallback;

const boundedInteger = (
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number
): number =>
    typeof value === "number" && Number.isFinite(value)
        ? Math.min(maximum, Math.max(minimum, Math.round(value)))
        : fallback;

const clamp = (value: number, minimum: number, maximum: number): number =>
    Math.min(maximum, Math.max(minimum, value));

const boundedNumber = (
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number
): number =>
    typeof value === "number" && Number.isFinite(value)
        ? clamp(value, minimum, maximum)
        : fallback;

function parseAction(value: unknown): ControllerSwitchAction | undefined {
    if (!isObject(value) || typeof value.type !== "string") {
        return undefined;
    }

    switch (value.type) {
        case "preset":
            if (
                typeof value.presetIndex === "number"
                && Number.isInteger(value.presetIndex)
                && value.presetIndex >= 0
            ) {
                return { type: "preset", presetIndex: value.presetIndex };
            }
            return undefined;
        case "bankUp":
            return { type: "bankUp" };
        case "bankDown":
            return { type: "bankDown" };
        case "chainBypass":
            return { type: "chainBypass" };
        case "snapshotMode":
            return { type: "snapshotMode" };
        case "none":
            return {
                type: "none",
                text: typeof value.text === "string" ? value.text : undefined
            };
        default:
            return undefined;
    }
}

function mergeColors(value: unknown): ControllerColors {
    const d = defaultControllerConfig.colors;
    const s = isObject(value) ? value : {};
    return {
        pageBackground: stringValue(s.pageBackground, d.pageBackground),
        pageText: stringValue(s.pageText, d.pageText),
        headerBackground: stringValue(s.headerBackground, d.headerBackground),
        headerBorder: stringValue(s.headerBorder, d.headerBorder),
        headerShadow: stringValue(s.headerShadow, d.headerShadow),
        bankTitleText: stringValue(s.bankTitleText, d.bankTitleText),
        bankNameText: stringValue(s.bankNameText, d.bankNameText),
        activePresetLabelText: stringValue(s.activePresetLabelText, d.activePresetLabelText),
        activePresetNameText: stringValue(s.activePresetNameText, d.activePresetNameText),
        headerDivider: stringValue(s.headerDivider, d.headerDivider),
        switchBackground: stringValue(s.switchBackground, d.switchBackground),
        switchBorder: stringValue(s.switchBorder, d.switchBorder),
        switchLabelText: stringValue(s.switchLabelText, d.switchLabelText),
        switchValueText: stringValue(s.switchValueText, d.switchValueText),
        bankSwitchBackground: stringValue(s.bankSwitchBackground, d.bankSwitchBackground),
        bankSwitchBorder: stringValue(s.bankSwitchBorder, d.bankSwitchBorder),
        bankSwitchLabelText: stringValue(s.bankSwitchLabelText, d.bankSwitchLabelText),
        bankSwitchValueText: stringValue(s.bankSwitchValueText, d.bankSwitchValueText),
        activeSwitchBackground: stringValue(s.activeSwitchBackground, d.activeSwitchBackground),
        activeSwitchBorder: stringValue(s.activeSwitchBorder, d.activeSwitchBorder),
        activeSwitchLabelText: stringValue(s.activeSwitchLabelText, d.activeSwitchLabelText),
        activeSwitchValueText: stringValue(s.activeSwitchValueText, d.activeSwitchValueText),
        activeSwitchShadow: stringValue(s.activeSwitchShadow, d.activeSwitchShadow),
        disabledSwitchOpacity: opacityValue(s.disabledSwitchOpacity, d.disabledSwitchOpacity),
        configErrorBackground: stringValue(s.configErrorBackground, d.configErrorBackground),
        configErrorBorder: stringValue(s.configErrorBorder, d.configErrorBorder),
        configErrorText: stringValue(s.configErrorText, d.configErrorText)
    };
}

function mergeSizing(value: unknown): ControllerSizing {
    const d = defaultControllerConfig.sizing;
    const s = isObject(value) ? value : {};
    return {
        gridTopMargin: nonNegativeNumber(s.gridTopMargin, d.gridTopMargin),
        switchPadding: stringValue(s.switchPadding, d.switchPadding),
        switchBorderRadius: nonNegativeNumber(s.switchBorderRadius, d.switchBorderRadius),
        switchLabelFontSize: stringValue(s.switchLabelFontSize, d.switchLabelFontSize),
        switchValueFontSize: stringValue(s.switchValueFontSize, d.switchValueFontSize),
        switchValueMarginTop: nonNegativeNumber(s.switchValueMarginTop, d.switchValueMarginTop),
        bankTitleFontSize: stringValue(s.bankTitleFontSize, d.bankTitleFontSize),
        bankNameFontSize: stringValue(s.bankNameFontSize, d.bankNameFontSize),
        activePresetLabelFontSize: stringValue(s.activePresetLabelFontSize, d.activePresetLabelFontSize),
        activePresetNameFontSize: stringValue(s.activePresetNameFontSize, d.activePresetNameFontSize),
        marqueeDelaySeconds: nonNegativeNumber(s.marqueeDelaySeconds, d.marqueeDelaySeconds),
        marqueePixelsPerSecond: nonNegativeNumber(s.marqueePixelsPerSecond, d.marqueePixelsPerSecond),
        marqueeEndPauseSeconds: nonNegativeNumber(s.marqueeEndPauseSeconds, d.marqueeEndPauseSeconds)
    };
}

function parseSwitches(value: unknown): ControllerSwitchConfig[] | undefined {
    if (!Array.isArray(value) || value.length > MAX_FOOTSWITCHES) {
        return undefined;
    }

    const result: ControllerSwitchConfig[] = [];
    const usedIds = new Set<string>();
    const usedHardware = new Set<number>();
    const usedPins = new Set<number>();

    for (let index = 0; index < value.length; ++index) {
        const item = value[index];
        if (!isObject(item)) return undefined;

        const action = parseAction(item.action);
        if (!action) return undefined;

        const longPressAction = item.longPressAction === undefined
            ? { type: "none", text: "Unused" } as ControllerSwitchAction
            : parseAction(item.longPressAction);
        if (!longPressAction) return undefined;

        const id = typeof item.id === "string" && item.id.trim()
            ? item.id.trim()
            : `sw${index + 1}`;
        if (usedIds.has(id)) return undefined;
        usedIds.add(id);

        const hardwareSwitch =
            typeof item.hardwareSwitch === "number"
            && Number.isInteger(item.hardwareSwitch)
            && item.hardwareSwitch >= 1
            && item.hardwareSwitch <= MAX_FOOTSWITCHES
                ? item.hardwareSwitch
                : index + 1;

        if (usedHardware.has(hardwareSwitch)) return undefined;
        usedHardware.add(hardwareSwitch);

        const hasGpioPin = Object.prototype.hasOwnProperty.call(
            item,
            "gpioPin"
        );

        let gpioPin: number | undefined;
        if (
            typeof item.gpioPin === "number"
            && Number.isInteger(item.gpioPin)
            && FOOTSWITCH_GPIO_PINS.includes(item.gpioPin)
        ) {
            gpioPin = item.gpioPin;
        } else if (
            hasGpioPin
            && (item.gpioPin === null || item.gpioPin === undefined)
        ) {
            // Explicitly disconnected switch. Keep the logical/UI switch while
            // disabling only its physical GPIO mapping.
            gpioPin = undefined;
        } else {
            // Automatic migration of old configs that pre-date GPIO mapping.
            // Only a genuinely missing gpioPin field reaches this path for the
            // normal legacy case, so old controller wiring remains intact.
            gpioPin = defaultGpioForHardwareSwitch(hardwareSwitch);
        }

        if (gpioPin !== undefined) {
            if (usedPins.has(gpioPin)) return undefined;
            usedPins.add(gpioPin);
        }

        const row =
            typeof item.row === "number"
            && Number.isInteger(item.row)
            && item.row >= 1
            && item.row <= MAX_CONTROLLER_ROWS
                ? item.row
                : Math.floor(index / 4) + 1;

        const column =
            typeof item.column === "number"
            && Number.isInteger(item.column)
            && item.column >= 1
            && item.column <= MAX_CONTROLLER_COLUMNS
                ? item.column
                : (index % 4) + 1;

        result.push({
            id,
            label:
                typeof item.label === "string" && item.label.trim()
                    ? item.label
                    : `SW ${hardwareSwitch}`,
            hardwareSwitch,
            gpioPin,
            action,
            longPressAction,
            row,
            column
        });
    }

    return result;
}

function ensureGridCapacity(
    columnsValue: number,
    rowsValue: number,
    switchCount: number
): { columns: number; rows: number } {
    let columns = clamp(
        Math.round(columnsValue),
        1,
        MAX_CONTROLLER_COLUMNS
    );
    let rows = clamp(
        Math.round(rowsValue),
        1,
        MAX_CONTROLLER_ROWS
    );

    while (
        columns * rows < switchCount
        && rows < MAX_CONTROLLER_ROWS
    ) {
        rows += 1;
    }

    while (
        columns * rows < switchCount
        && columns < MAX_CONTROLLER_COLUMNS
    ) {
        columns += 1;
    }

    return { columns, rows };
}

function normalizeLayoutRect(
    value: unknown,
    fallback: ControllerLayoutRect,
    minimumWidth: number,
    minimumHeight: number
): ControllerLayoutRect {
    const source = isObject(value) ? value : {};

    const width = boundedNumber(
        source.width,
        fallback.width,
        minimumWidth,
        1
    );
    const height = boundedNumber(
        source.height,
        fallback.height,
        minimumHeight,
        1
    );
    const x = boundedNumber(source.x, fallback.x, 0, 1 - width);
    const y = boundedNumber(source.y, fallback.y, 0, 1 - height);

    return {
        x: clamp(x, 0, 1 - width),
        y: clamp(y, 0, 1 - height),
        width,
        height
    };
}

function defaultRectForSwitch(
    switchConfig: ControllerSwitchConfig,
    index: number,
    columns: number,
    rows: number
): ControllerLayoutRect {
    const safeColumns = Math.max(1, columns);
    const safeRows = Math.max(1, rows);
    const gap = 0.012;
    const top = 0.20;
    const availableHeight = 0.80;

    const column = clamp(
        (switchConfig.column ?? (index % safeColumns) + 1) - 1,
        0,
        safeColumns - 1
    );
    const row = clamp(
        (switchConfig.row ?? Math.floor(index / safeColumns) + 1) - 1,
        0,
        safeRows - 1
    );

    const cellWidth = 1 / safeColumns;
    const cellHeight = availableHeight / safeRows;

    return {
        x: column * cellWidth + gap / 2,
        y: top + row * cellHeight + gap / 2,
        width: Math.max(MIN_FREEFORM_SWITCH_WIDTH, cellWidth - gap),
        height: Math.max(MIN_FREEFORM_SWITCH_HEIGHT, cellHeight - gap)
    };
}

function normalizeElementStyle(
    value: unknown,
    fallback: ControllerLayoutElementStyle
): ControllerLayoutElementStyle {
    return value === "panel"
        || value === "compact"
        || value === "minimal"
            ? value
            : fallback;
}

function normalizeElementShape(
    value: unknown,
    fallback: ControllerLayoutElementShape
): ControllerLayoutElementShape {
    return value === "rectangle"
        || value === "rounded"
        || value === "circle"
        || value === "hexagon"
        || value === "triangle"
            ? value
            : fallback;
}

function normalizeLayoutElements(
    value: unknown,
    legacyBankHeader: ControllerLayoutRect,
    legacyPresetPageHeader: ControllerLayoutRect,
    legacyActivePresetHeader: ControllerLayoutRect
): Record<ControllerLayoutElementId, ControllerLayoutElement> {
    const defaults = makeDefaultLayoutElements();
    const source = isObject(value) ? value : {};
    const result = {} as Record<
        ControllerLayoutElementId,
        ControllerLayoutElement
    >;

    for (const id of CONTROLLER_LAYOUT_ELEMENT_IDS) {
        const fallback = defaults[id];
        const raw = isObject(source[id]) ? source[id] : {};

        let legacyRect: ControllerLayoutRect | undefined;
        if (id === "currentBank") legacyRect = legacyBankHeader;
        if (id === "presetPage") legacyRect = legacyPresetPageHeader;
        if (id === "activePreset") legacyRect = legacyActivePresetHeader;

        result[id] = {
            id,
            visible:
                typeof raw.visible === "boolean"
                    ? raw.visible
                    : fallback.visible,
            rect: normalizeLayoutRect(
                raw.rect,
                legacyRect ?? fallback.rect,
                MIN_FREEFORM_HEADER_WIDTH,
                MIN_FREEFORM_HEADER_HEIGHT
            ),
            style: normalizeElementStyle(
                raw.style,
                fallback.style
            ),
            shape: normalizeElementShape(
                raw.shape,
                fallback.shape
            ),
            showLabel:
                typeof raw.showLabel === "boolean"
                    ? raw.showLabel
                    : fallback.showLabel
        };
    }

    return result;
}

function normalizePerformanceLayout(
    value: unknown,
    switches: ControllerSwitchConfig[],
    columns: number,
    rows: number
): ControllerPerformanceLayout {
    const source = isObject(value) ? value : {};
    const sourceSwitches = isObject(source.switches)
        ? source.switches
        : {};

    const normalizedSwitches: Record<string, ControllerLayoutRect> = {};
    switches.forEach((switchConfig, index) => {
        const fallback = defaultRectForSwitch(
            switchConfig,
            index,
            columns,
            rows
        );
        normalizedSwitches[switchConfig.id] = normalizeLayoutRect(
            sourceSwitches[switchConfig.id],
            fallback,
            MIN_FREEFORM_SWITCH_WIDTH,
            MIN_FREEFORM_SWITCH_HEIGHT
        );
    });

    const legacyHeader = normalizeLayoutRect(
        source.header,
        DEFAULT_FREEFORM_HEADER,
        MIN_FREEFORM_HEADER_WIDTH,
        MIN_FREEFORM_HEADER_HEIGHT
    );

    // If this is an older V1 config with one combined header, split its
    // existing rectangle into three horizontal groups. Once saved, the new
    // independent rectangles are persisted directly.
    const legacyGap = Math.min(0.02, legacyHeader.width * 0.02);
    const legacyThirdWidth = Math.max(
        MIN_FREEFORM_HEADER_WIDTH,
        (legacyHeader.width - legacyGap * 2) / 3
    );
    const legacyBankFallback: ControllerLayoutRect = {
        x: legacyHeader.x,
        y: legacyHeader.y,
        width: Math.min(legacyHeader.width, legacyThirdWidth),
        height: legacyHeader.height
    };
    const legacyPageFallback: ControllerLayoutRect = {
        x: Math.min(
            1 - legacyThirdWidth,
            legacyHeader.x + legacyThirdWidth + legacyGap
        ),
        y: legacyHeader.y,
        width: Math.min(legacyHeader.width, legacyThirdWidth),
        height: legacyHeader.height
    };
    const legacyActiveFallback: ControllerLayoutRect = {
        x: Math.min(
            1 - legacyThirdWidth,
            legacyHeader.x + (legacyThirdWidth + legacyGap) * 2
        ),
        y: legacyHeader.y,
        width: Math.min(legacyHeader.width, legacyThirdWidth),
        height: legacyHeader.height
    };

    const validSwitchIds = new Set(
        switches.map((switchConfig) => switchConfig.id)
    );
    const unplacedSwitchIds = Array.isArray(source.unplacedSwitchIds)
        ? source.unplacedSwitchIds.filter(
            (value): value is string =>
                typeof value === "string"
                && validSwitchIds.has(value)
        )
        : [];

    const bankHeader = normalizeLayoutRect(
        source.bankHeader,
        isObject(source.header)
            ? legacyBankFallback
            : DEFAULT_FREEFORM_BANK_HEADER,
        MIN_FREEFORM_HEADER_WIDTH,
        MIN_FREEFORM_HEADER_HEIGHT
    );
    const presetPageHeader = normalizeLayoutRect(
        source.presetPageHeader,
        isObject(source.header)
            ? legacyPageFallback
            : DEFAULT_FREEFORM_PRESET_PAGE_HEADER,
        MIN_FREEFORM_HEADER_WIDTH,
        MIN_FREEFORM_HEADER_HEIGHT
    );
    const activePresetHeader = normalizeLayoutRect(
        source.activePresetHeader,
        isObject(source.header)
            ? legacyActiveFallback
            : DEFAULT_FREEFORM_ACTIVE_PRESET_HEADER,
        MIN_FREEFORM_HEADER_WIDTH,
        MIN_FREEFORM_HEADER_HEIGHT
    );

    const elements = normalizeLayoutElements(
        source.elements,
        bankHeader,
        presetPageHeader,
        activePresetHeader
    );

    return {
        mode: source.mode === "freeform" ? "freeform" : "grid",
        snapToGrid:
            typeof source.snapToGrid === "boolean"
                ? source.snapToGrid
                : true,
        snapStep: boundedNumber(source.snapStep, 0.025, 0.01, 0.10),

        // Keep aliases synchronized for old code/config compatibility.
        bankHeader: elements.currentBank.rect,
        presetPageHeader: elements.presetPage.rect,
        activePresetHeader: elements.activePreset.rect,

        switches: normalizedSwitches,
        unplacedSwitchIds,
        elements
    };
}

function normalizeLayoutDefaults(
    value: unknown,
    switches: ControllerSwitchConfig[],
    fallbackColumns: number,
    fallbackRows: number
): ControllerLayoutDefaults {
    const source = isObject(value) ? value : {};
    const validIds = new Set(switches.map((item) => item.id));
    const result: ControllerLayoutDefaults = {};

    if (isObject(source.grid)) {
        const columns = boundedInteger(
            source.grid.columns,
            fallbackColumns,
            1,
            MAX_CONTROLLER_COLUMNS
        );
        const rows = boundedInteger(
            source.grid.rows,
            fallbackRows,
            1,
            MAX_CONTROLLER_ROWS
        );
        const sourcePositions = isObject(source.grid.positions)
            ? source.grid.positions
            : {};
        const positions: ControllerGridLayoutDefault["positions"] = {};

        for (const item of switches) {
            const raw = sourcePositions[item.id];
            if (!isObject(raw)) continue;
            positions[item.id] = {
                row: boundedInteger(raw.row, item.row ?? 1, 1, rows),
                column: boundedInteger(
                    raw.column,
                    item.column ?? 1,
                    1,
                    columns
                )
            };
        }

        result.grid = {
            columns,
            rows,
            positions
        };
    }

    if (isObject(source.freeform)) {
        const sourceSwitches = isObject(source.freeform.switches)
            ? source.freeform.switches
            : {};
        const defaultSwitches: Record<string, ControllerLayoutRect> = {};

        switches.forEach((item, index) => {
            defaultSwitches[item.id] = normalizeLayoutRect(
                sourceSwitches[item.id],
                defaultRectForSwitch(
                    item,
                    index,
                    fallbackColumns,
                    fallbackRows
                ),
                MIN_FREEFORM_SWITCH_WIDTH,
                MIN_FREEFORM_SWITCH_HEIGHT
            );
        });

        const unplacedSwitchIds = Array.isArray(
            source.freeform.unplacedSwitchIds
        )
            ? source.freeform.unplacedSwitchIds.filter(
                (value): value is string =>
                    typeof value === "string"
                    && validIds.has(value)
            )
            : [];

        const bankHeader = normalizeLayoutRect(
            source.freeform.bankHeader,
            DEFAULT_FREEFORM_BANK_HEADER,
            MIN_FREEFORM_HEADER_WIDTH,
            MIN_FREEFORM_HEADER_HEIGHT
        );
        const presetPageHeader = normalizeLayoutRect(
            source.freeform.presetPageHeader,
            DEFAULT_FREEFORM_PRESET_PAGE_HEADER,
            MIN_FREEFORM_HEADER_WIDTH,
            MIN_FREEFORM_HEADER_HEIGHT
        );
        const activePresetHeader = normalizeLayoutRect(
            source.freeform.activePresetHeader,
            DEFAULT_FREEFORM_ACTIVE_PRESET_HEADER,
            MIN_FREEFORM_HEADER_WIDTH,
            MIN_FREEFORM_HEADER_HEIGHT
        );

        result.freeform = {
            bankHeader,
            presetPageHeader,
            activePresetHeader,
            switches: defaultSwitches,
            unplacedSwitchIds,
            elements: normalizeLayoutElements(
                source.freeform.elements,
                bankHeader,
                presetPageHeader,
                activePresetHeader
            )
        };
    }

    return result;
}

export function ensureControllerPerformanceLayout(
    config: ControllerLayoutConfig
): ControllerLayoutConfig {
    return {
        ...config,
        performanceLayout: normalizePerformanceLayout(
            config.performanceLayout,
            config.switches,
            config.columns,
            config.rows
        ),
        layoutDefaults: normalizeLayoutDefaults(
            config.layoutDefaults,
            config.switches,
            config.columns,
            config.rows
        )
    };
}

export function snapControllerLayoutValue(
    value: number,
    step: number,
    enabled: boolean
): number {
    if (!enabled || step <= 0) return value;
    return Math.round(value / step) * step;
}

function parseControllerConfig(value: unknown): LoadedControllerConfig {
    if (!isObject(value)) {
        return {
            config: structuredClone(defaultControllerConfig),
            error: "Controller configuration is not a JSON object."
        };
    }

    const switches = parseSwitches(value.switches);
    if (!switches) {
        return {
            config: structuredClone(defaultControllerConfig),
            error:
                `Invalid controller switches. Up to ${MAX_FOOTSWITCHES} unique footswitches and GPIO pins are supported.`
        };
    }

    const requestedColumns = boundedInteger(
        value.columns,
        defaultControllerConfig.columns,
        1,
        MAX_CONTROLLER_COLUMNS
    );
    const requestedRows = boundedInteger(
        value.rows,
        defaultControllerConfig.rows,
        1,
        MAX_CONTROLLER_ROWS
    );
    const dimensions = ensureGridCapacity(
        requestedColumns,
        requestedRows,
        switches.length
    );
    const columns = dimensions.columns;
    const rows = dimensions.rows;

    const occupied = new Set<string>();
    for (const sw of switches) {
        let row = Math.min(rows, Math.max(1, sw.row ?? 1));
        let column = Math.min(columns, Math.max(1, sw.column ?? 1));
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

        sw.row = row;
        sw.column = column;
        occupied.add(key);
    }

    return {
        config: {
            columns,
            rows,
            gap: nonNegativeNumber(value.gap, defaultControllerConfig.gap),
            outerPadding: nonNegativeNumber(
                value.outerPadding,
                defaultControllerConfig.outerPadding
            ),
            headerPadding: stringValue(
                value.headerPadding,
                defaultControllerConfig.headerPadding
            ),
            longPressMs: boundedInteger(
                value.longPressMs,
                DEFAULT_LONG_PRESS_MS,
                MIN_LONG_PRESS_MS,
                MAX_LONG_PRESS_MS
            ),
            sizing: mergeSizing(value.sizing),
            colors: mergeColors(value.colors),
            switches,
            performanceLayout: normalizePerformanceLayout(
                value.performanceLayout,
                switches,
                columns,
                rows
            ),
            layoutDefaults: normalizeLayoutDefaults(
                value.layoutDefaults,
                switches,
                columns,
                rows
            )
        }
    };
}

const CONTROLLER_STORAGE_KEY = "pipedal-multifx-controller-config-v1";
export const CONTROLLER_CONFIG_CHANGED_EVENT =
    "multifx-controller-config-changed";

function stringifyControllerConfig(
    config: ControllerLayoutConfig
): string {
    return JSON.stringify(
        config,
        (key, value) =>
            key === "gpioPin" && value === undefined
                ? null
                : value,
        2
    );
}

export function validateControllerConfig(
    value: unknown
): LoadedControllerConfig {
    return parseControllerConfig(value);
}

function applyCurrentResponsiveSizing(
    config: ControllerLayoutConfig
): ControllerLayoutConfig {
    // Layout density changed when MultiFX gained 9-12 switch controllers.
    // Preserve wiring/actions/colors/positions, but use one responsive visual
    // scale for every layout so adding a switch cannot hide action/preset text.
    return {
        ...config,
        gap: Math.min(config.gap, defaultControllerConfig.gap),
        outerPadding: Math.min(
            config.outerPadding,
            defaultControllerConfig.outerPadding
        ),
        headerPadding: defaultControllerConfig.headerPadding,
        sizing: {
            ...config.sizing,
            gridTopMargin: defaultControllerConfig.sizing.gridTopMargin,
            switchPadding: defaultControllerConfig.sizing.switchPadding,
            switchLabelFontSize:
                defaultControllerConfig.sizing.switchLabelFontSize,
            switchValueFontSize:
                defaultControllerConfig.sizing.switchValueFontSize,
            switchValueMarginTop:
                defaultControllerConfig.sizing.switchValueMarginTop,
            bankTitleFontSize:
                defaultControllerConfig.sizing.bankTitleFontSize,
            bankNameFontSize:
                defaultControllerConfig.sizing.bankNameFontSize,
            activePresetLabelFontSize:
                defaultControllerConfig.sizing.activePresetLabelFontSize,
            activePresetNameFontSize:
                defaultControllerConfig.sizing.activePresetNameFontSize
        }
    };
}

export async function loadControllerConfig(): Promise<LoadedControllerConfig> {
    const saved = window.localStorage.getItem(CONTROLLER_STORAGE_KEY);
    if (saved) {
        try {
            const parsed = parseControllerConfig(JSON.parse(saved) as unknown);
            if (!parsed.error) {
                const normalized = applyCurrentResponsiveSizing(parsed.config);
                // Persist the normalized sizing while keeping the same storage
                // key so existing backups and runtime synchronization continue
                // to work without a format break. Explicitly disconnected GPIO
                // entries are serialized as null instead of being dropped.
                window.localStorage.setItem(
                    CONTROLLER_STORAGE_KEY,
                    stringifyControllerConfig(normalized)
                );
                return { config: normalized };
            }
            return parsed;
        } catch {
            window.localStorage.removeItem(CONTROLLER_STORAGE_KEY);
        }
    }

    try {
        const response = await fetch("/controller-config.json", {
            cache: "no-store"
        });
        if (response.ok) {
            return parseControllerConfig(await response.json());
        }
    } catch {
        // Shipped config is optional. Built-in defaults remain usable.
    }

    return {
        config: ensureControllerPerformanceLayout(
            structuredClone(defaultControllerConfig)
        )
    };
}

export function saveControllerConfig(
    config: ControllerLayoutConfig
): LoadedControllerConfig {
    const parsed = parseControllerConfig(config);
    if (parsed.error) return parsed;

    window.localStorage.setItem(
        CONTROLLER_STORAGE_KEY,
        stringifyControllerConfig(parsed.config)
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
