/*
 * Portable physical-controller configuration.
 *
 * Logical switch actions live in ControllerConfig. This file describes the
 * electrical side of the controller: source addresses, expansion modules,
 * analog controls, encoders, and the current reference wiring template.
 * Keeping this model board-neutral prevents ESP32 pin names from leaking into
 * the rest of MultiFX.
 */

/** A physical input can be a direct board GPIO or a channel on a module. */
export type ControllerInputSource =
    | { type: "gpio"; pin: number }
    | { type: "module"; moduleId: string; channel: number };

/** Drivers currently implemented by the shared controller firmware. */
export type ControllerModuleDriver =
    | "hc4051"
    | "hc4067"
    | "mcp23017"
    | "ads1015"
    | "ads1115";

/** Wiring shared by the 8- and 16-channel analog multiplexer drivers. */
export interface ControllerMuxModuleConfig {
    id: string;
    label: string;
    driver: "hc4051" | "hc4067";
    signalPin: number;
    selectPins: number[];
    enablePin: number | null;
}

/** Wiring shared by the supported I2C GPIO-expander and ADC drivers. */
export interface ControllerI2cModuleConfig {
    id: string;
    label: string;
    driver: "mcp23017" | "ads1015" | "ads1115";
    sdaPin: number;
    sclPin: number;
    address: number;
}

export type ControllerModuleConfig =
    | ControllerMuxModuleConfig
    | ControllerI2cModuleConfig;

export type ControllerAnalogStyle = "pot" | "slider" | "expression";

/** One analog control is normalized to MIDI 0..127 after calibration/filtering. */
export interface ControllerAnalogControlConfig {
    id: string;
    label: string;
    style: ControllerAnalogStyle;
    input: ControllerInputSource | null;
    midiCc: number;
    calibrationMin: number;
    calibrationMax: number;
    inverted: boolean;
    filterShift: number;
    /** Minimum accumulated 7-bit MIDI steps before firmware reports movement. */
    midiHysteresis: number;
}

/** A quadrature encoder uses two digital inputs and an optional push input. */
export interface ControllerEncoderConfig {
    id: string;
    label: string;
    aInput: ControllerInputSource;
    bInput: ControllerInputSource;
    buttonInput: ControllerInputSource | null;
    turnCc: number;
    buttonCc: number;
    stepsPerDetent: number;
    reversed: boolean;
}

/** Physical portion of the current controller schema. */
export interface ControllerHardwareConfig {
    version: 1;
    boardProfile: "auto" | string;
    templateId: "esp32s3-reference" | "custom";
    modules: ControllerModuleConfig[];
    analogControls: ControllerAnalogControlConfig[];
    encoders: ControllerEncoderConfig[];
}

/** Metadata used by the Hardware UI and the bridge's protocol encoder. */
export interface ControllerModuleDriverInfo {
    id: ControllerModuleDriver;
    label: string;
    capability: "digital" | "analog" | "both";
    channels: number;
    description: string;
}

export const CONTROLLER_MODULE_DRIVERS:
    readonly ControllerModuleDriverInfo[] = [
        {
            id: "hc4051",
            label: "74HC4051 (8-channel mux)",
            capability: "both",
            channels: 8,
            description: "Adds eight switch or analog channels using one signal pin and three select pins."
        },
        {
            id: "hc4067",
            label: "CD74HC4067 (16-channel mux)",
            capability: "both",
            channels: 16,
            description: "Adds sixteen switch or analog channels using one signal pin and four select pins."
        },
        {
            id: "mcp23017",
            label: "MCP23017 (16 digital inputs)",
            capability: "digital",
            channels: 16,
            description: "Adds sixteen I2C switch/button inputs with internal pull-ups."
        },
        {
            id: "ads1015",
            label: "ADS1015 (4-channel ADC)",
            capability: "analog",
            channels: 4,
            description: "Adds four I2C analog inputs with 12-bit conversion."
        },
        {
            id: "ads1115",
            label: "ADS1115 (4-channel ADC)",
            capability: "analog",
            channels: 4,
            description: "Adds four I2C analog inputs with 16-bit conversion."
        }
    ];

export const MAX_CONTROLLER_MODULES = 4;
export const MAX_CONTROLLER_ANALOG_CONTROLS = 16;
export const MAX_CONTROLLER_ENCODERS = 4;
export const MAX_CONTROLLER_GPIO = 126;

/**
 * The existing pedal is the first factory template. It remains a template,
 * not an ESP32-wide restriction: users can replace every compatible source.
 */
export const defaultControllerHardwareConfig: ControllerHardwareConfig = {
    version: 1,
    boardProfile: "auto",
    templateId: "esp32s3-reference",
    modules: [],
    analogControls: [
        makeDefaultAnalog("pot1", "POT 1", 8, 10),
        makeDefaultAnalog("pot2", "POT 2", 12, 11),
        makeDefaultAnalog("pot3", "POT 3", 13, 12),
        makeDefaultAnalog("pot4", "POT 4", 11, 13)
    ],
    encoders: [{
        id: "encoder1",
        label: "MAIN ENCODER",
        aInput: { type: "gpio", pin: 18 },
        bInput: { type: "gpio", pin: 17 },
        buttonInput: { type: "gpio", pin: 21 },
        turnCc: 30,
        buttonCc: 31,
        stepsPerDetent: 4,
        reversed: false
    }]
};

/** Construct one consistently filtered/calibrated factory pot entry. */
function makeDefaultAnalog(
    id: string,
    label: string,
    pin: number,
    midiCc: number
): ControllerAnalogControlConfig {
    return {
        id,
        label,
        style: "pot",
        input: { type: "gpio", pin },
        midiCc,
        calibrationMin: 0,
        calibrationMax: 4095,
        inverted: false,
        filterShift: 4,
        midiHysteresis: 2
    };
}

/** Produce the stable identity used for duplicate detection and UI selection. */
export function controllerInputSourceId(
    source: ControllerInputSource | null
): string | null {
    if (source === null) return null;
    return source.type === "gpio"
        ? `gpio:${source.pin}`
        : `module:${source.moduleId}:${source.channel}`;
}

/** Return a concise label that remains useful while hardware is disconnected. */
export function controllerInputSourceLabel(
    source: ControllerInputSource | null,
    modules: readonly ControllerModuleConfig[] = []
): string {
    if (source === null) return "Not connected";
    if (source.type === "gpio") return `GPIO ${source.pin}`;
    const module = modules.find((item) => item.id === source.moduleId);
    return `${module?.label ?? source.moduleId} · CH ${source.channel}`;
}

/** Look up immutable driver information without duplicating switch statements. */
export function controllerModuleDriverInfo(
    driver: ControllerModuleDriver
): ControllerModuleDriverInfo {
    return CONTROLLER_MODULE_DRIVERS.find((item) => item.id === driver)!;
}

/** Create a valid editable module with conservative, clearly visible defaults. */
export function createControllerModule(
    driver: ControllerModuleDriver,
    sequence: number
): ControllerModuleConfig {
    const id = `module${sequence}`;
    const info = controllerModuleDriverInfo(driver);
    if (driver === "hc4051" || driver === "hc4067") {
        return {
            id,
            label: info.label.split(" (")[0],
            driver,
            signalPin: 10,
            selectPins: driver === "hc4051"
                ? [39, 40, 41]
                : [39, 40, 41, 42],
            enablePin: null
        };
    }
    return {
        id,
        label: info.label.split(" (")[0],
        driver,
        sdaPin: 9,
        sclPin: 10,
        address: driver === "mcp23017" ? 0x20 : 0x48
    };
}

/** Return whether a module channel can serve the requested electrical role. */
export function moduleSupportsCapability(
    module: ControllerModuleConfig,
    capability: "digital" | "analog"
): boolean {
    const kind = controllerModuleDriverInfo(module.driver).capability;
    return kind === "both" || kind === capability;
}

/** Narrow the module union for callers that render or validate wiring fields. */
export function isControllerMuxModule(
    module: ControllerModuleConfig
): module is ControllerMuxModuleConfig {
    return module.driver === "hc4051" || module.driver === "hc4067";
}

/** Return the legal zero-based channel count for a configured module. */
export function controllerModuleChannelCount(
    module: ControllerModuleConfig
): number {
    return controllerModuleDriverInfo(module.driver).channels;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
    value: Record<string, unknown>,
    keys: readonly string[]
): boolean {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length
        && actual.every((key, index) => key === expected[index]);
}

function integerIn(value: unknown, minimum: number, maximum: number): boolean {
    return typeof value === "number"
        && Number.isInteger(value)
        && value >= minimum
        && value <= maximum;
}

/** Validate the shape of a direct or module-backed input reference. */
export function isControllerInputSource(
    value: unknown
): value is ControllerInputSource {
    if (!isRecord(value)) return false;
    if (value.type === "gpio") {
        return integerIn(value.pin, 0, MAX_CONTROLLER_GPIO)
            && Object.keys(value).every((key) => key === "type" || key === "pin");
    }
    return value.type === "module"
        && typeof value.moduleId === "string"
        && Boolean(value.moduleId.trim())
        && integerIn(value.channel, 0, 126)
        && Object.keys(value).every((key) =>
            key === "type" || key === "moduleId" || key === "channel"
        );
}

/**
 * Validate physical configuration before it reaches the bridge or firmware.
 * Board-specific reservations are deliberately not checked here: only the
 * connected firmware is authoritative for those rules.
 */
export function validateControllerHardwareConfig(
    value: unknown,
    switchInputs: readonly (ControllerInputSource | null)[] = []
): string | undefined {
    if (!isRecord(value)
        || !hasExactKeys(value, [
            "version", "boardProfile", "templateId", "modules",
            "analogControls", "encoders"
        ])
        || value.version !== 1) {
        return "Unsupported controller hardware configuration.";
    }
    if (typeof value.boardProfile !== "string" || !value.boardProfile.trim()) {
        return "Select a controller board profile.";
    }
    if (value.templateId !== "esp32s3-reference" && value.templateId !== "custom") {
        return "Invalid controller hardware template.";
    }
    if (!Array.isArray(value.modules) || value.modules.length > MAX_CONTROLLER_MODULES) {
        return `A controller can use at most ${MAX_CONTROLLER_MODULES} expansion modules.`;
    }
    if (!Array.isArray(value.analogControls)
        || value.analogControls.length > MAX_CONTROLLER_ANALOG_CONTROLS) {
        return `A controller can use at most ${MAX_CONTROLLER_ANALOG_CONTROLS} analog controls.`;
    }
    if (!Array.isArray(value.encoders)
        || value.encoders.length > MAX_CONTROLLER_ENCODERS) {
        return `A controller can use at most ${MAX_CONTROLLER_ENCODERS} encoders.`;
    }

    const modules = new Map<string, ControllerModuleConfig>();
    const moduleLabels = new Set<string>();
    const exclusivePins = new Map<number, string>();
    let i2cPins: { sda: number; scl: number } | null = null;

    /** Claim a pin that cannot safely be shared with another controller role. */
    const claimPin = (pin: unknown, owner: string): string | undefined => {
        if (!integerIn(pin, 0, MAX_CONTROLLER_GPIO)) {
            return `${owner} has an invalid GPIO number.`;
        }
        const numericPin = pin as number;
        const previous = exclusivePins.get(numericPin);
        if (previous) return `GPIO ${numericPin} is used by both ${previous} and ${owner}.`;
        exclusivePins.set(numericPin, owner);
        return undefined;
    };

    for (const rawModule of value.modules) {
        if (!isRecord(rawModule)
            || typeof rawModule.id !== "string"
            || !/^[A-Za-z][A-Za-z0-9_-]{0,23}$/.test(rawModule.id)
            || modules.has(rawModule.id)) {
            return "Module IDs must be unique and use letters, numbers, dashes, or underscores.";
        }
        if (typeof rawModule.label !== "string" || !rawModule.label.trim()
            || moduleLabels.has(rawModule.label.trim().toLowerCase())) {
            return "Module names must be non-empty and unique.";
        }
        if (!CONTROLLER_MODULE_DRIVERS.some((item) => item.id === rawModule.driver)) {
            return `Module ${rawModule.label} uses an unsupported driver.`;
        }

        const moduleKeys = rawModule.driver === "hc4051"
            || rawModule.driver === "hc4067"
            ? ["id", "label", "driver", "signalPin", "selectPins", "enablePin"]
            : ["id", "label", "driver", "sdaPin", "sclPin", "address"];
        if (!hasExactKeys(rawModule, moduleKeys)) {
            return `Module ${rawModule.label} has an invalid configuration shape.`;
        }

        const module = rawModule as unknown as ControllerModuleConfig;
        modules.set(module.id, module);
        moduleLabels.add(module.label.trim().toLowerCase());

        if (isControllerMuxModule(module)) {
            const selectCount = module.driver === "hc4051" ? 3 : 4;
            if (!Array.isArray(module.selectPins)
                || module.selectPins.length !== selectCount) {
                return `${module.label} requires ${selectCount} select pins.`;
            }
            let error = claimPin(module.signalPin, `${module.label} signal`);
            if (error) return error;
            for (let index = 0; index < module.selectPins.length; ++index) {
                error = claimPin(module.selectPins[index], `${module.label} S${index}`);
                if (error) return error;
            }
            if (module.enablePin !== null) {
                error = claimPin(module.enablePin, `${module.label} enable`);
                if (error) return error;
            }
        } else {
            if (!integerIn(module.sdaPin, 0, MAX_CONTROLLER_GPIO)
                || !integerIn(module.sclPin, 0, MAX_CONTROLLER_GPIO)
                || module.sdaPin === module.sclPin) {
                return `${module.label} has invalid I2C pins.`;
            }
            if (i2cPins === null) {
                i2cPins = { sda: module.sdaPin, scl: module.sclPin };
                const sdaError = claimPin(module.sdaPin, "I2C SDA");
                if (sdaError) return sdaError;
                const sclError = claimPin(module.sclPin, "I2C SCL");
                if (sclError) return sclError;
            } else if (i2cPins.sda !== module.sdaPin || i2cPins.scl !== module.sclPin) {
                return "All I2C modules must use the same SDA and SCL pins.";
            }
            const minimumAddress = module.driver === "mcp23017" ? 0x20 : 0x48;
            const maximumAddress = module.driver === "mcp23017" ? 0x27 : 0x4b;
            if (!integerIn(module.address, minimumAddress, maximumAddress)) {
                return `${module.label} has an invalid I2C address.`;
            }
            const duplicateAddress = [...modules.values()].some((item) =>
                item.id !== module.id
                && !isControllerMuxModule(item)
                && item.address === module.address
            );
            if (duplicateAddress) return `I2C address 0x${module.address.toString(16)} is used twice.`;
        }
    }

    /** Validate a source and optionally claim direct GPIO ownership. */
    const validateSource = (
        source: unknown,
        capability: "digital" | "analog",
        owner: string,
        optional = false
    ): string | undefined => {
        if (source === null && optional) return undefined;
        if (!isControllerInputSource(source)) return `${owner} has an invalid input source.`;
        if (source.type === "gpio") return claimPin(source.pin, owner);
        const module = modules.get(source.moduleId);
        if (!module) return `${owner} references missing module ${source.moduleId}.`;
        if (source.channel >= controllerModuleChannelCount(module)) {
            return `${owner} uses a channel outside ${module.label}.`;
        }
        if (!moduleSupportsCapability(module, capability)) {
            return `${module.label} cannot provide an ${capability} input for ${owner}.`;
        }
        return undefined;
    };

    const sourceOwners = new Map<string, string>();
    /** Prevent two controls from consuming the same module channel. */
    const claimSource = (
        source: ControllerInputSource | null,
        owner: string
    ): string | undefined => {
        const key = controllerInputSourceId(source);
        if (key === null || source?.type === "gpio") return undefined;
        const previous = sourceOwners.get(key);
        if (previous) return `${owner} and ${previous} use the same module channel.`;
        sourceOwners.set(key, owner);
        return undefined;
    };

    for (let index = 0; index < switchInputs.length; ++index) {
        const source = switchInputs[index];
        if (source === null) continue;
        const owner = `SW${index + 1}`;
        const error = validateSource(source, "digital", owner) ?? claimSource(source, owner);
        if (error) return error;
    }

    const controlIds = new Set<string>();
    const midiCcs = new Map<number, string>();
    for (const rawControl of value.analogControls) {
        if (!isRecord(rawControl)
            || !hasExactKeys(rawControl, [
                "id", "label", "style", "input", "midiCc",
                "calibrationMin", "calibrationMax", "inverted",
                "filterShift", "midiHysteresis"
            ])
            || typeof rawControl.id !== "string"
            || !rawControl.id.trim()
            || controlIds.has(rawControl.id)) return "Analog control IDs must be non-empty and unique.";
        if (typeof rawControl.label !== "string" || !rawControl.label.trim()) {
            return "Analog control names must be non-empty.";
        }
        if (rawControl.style !== "pot"
            && rawControl.style !== "slider"
            && rawControl.style !== "expression") return `${rawControl.label} has an invalid style.`;
        if (!integerIn(rawControl.midiCc, 0, 119)) return `${rawControl.label} has an invalid MIDI CC.`;
        if (!integerIn(rawControl.calibrationMin, 0, 4094)
            || !integerIn(rawControl.calibrationMax, 1, 4095)
            || (rawControl.calibrationMin as number) >= (rawControl.calibrationMax as number)) {
            return `${rawControl.label} has an invalid calibration range.`;
        }
        if (typeof rawControl.inverted !== "boolean"
            || !integerIn(rawControl.filterShift, 0, 7)
            || !integerIn(rawControl.midiHysteresis, 1, 4)) {
            return `${rawControl.label} has invalid filtering or response settings.`;
        }
        controlIds.add(rawControl.id);
        const owner = rawControl.label as string;
        const source = rawControl.input as ControllerInputSource | null;
        if (source !== null) {
            const error = validateSource(source, "analog", owner) ?? claimSource(source, owner);
            if (error) return error;
        }
        const cc = rawControl.midiCc as number;
        const previousCc = midiCcs.get(cc);
        if (previousCc) return `MIDI CC ${cc} is used by both ${previousCc} and ${owner}.`;
        midiCcs.set(cc, owner);
    }

    for (const rawEncoder of value.encoders) {
        if (!isRecord(rawEncoder)
            || !hasExactKeys(rawEncoder, [
                "id", "label", "aInput", "bInput", "buttonInput",
                "turnCc", "buttonCc", "stepsPerDetent", "reversed"
            ])
            || typeof rawEncoder.id !== "string"
            || !rawEncoder.id.trim()
            || controlIds.has(rawEncoder.id)) return "Encoder IDs must be non-empty and unique.";
        if (typeof rawEncoder.label !== "string" || !rawEncoder.label.trim()) {
            return "Encoder names must be non-empty.";
        }
        if (!integerIn(rawEncoder.turnCc, 0, 119)
            || !integerIn(rawEncoder.buttonCc, 0, 119)
            || !integerIn(rawEncoder.stepsPerDetent, 1, 4)
            || typeof rawEncoder.reversed !== "boolean") return `${rawEncoder.label} has invalid MIDI settings.`;
        controlIds.add(rawEncoder.id);
        const encoder = rawEncoder as unknown as ControllerEncoderConfig;
        for (const [part, source, optional] of [
            ["A", encoder.aInput, false],
            ["B", encoder.bInput, false],
            ["button", encoder.buttonInput, true]
        ] as const) {
            const owner = `${encoder.label} ${part}`;
            const error = validateSource(source, "digital", owner, optional)
                ?? claimSource(source, owner);
            if (error) return error;
        }
        for (const [cc, owner] of [
            [encoder.turnCc, `${encoder.label} turn`],
            [encoder.buttonCc, `${encoder.label} button`]
        ] as const) {
            const previousCc = midiCcs.get(cc);
            if (previousCc) return `MIDI CC ${cc} is used by both ${previousCc} and ${owner}.`;
            midiCcs.set(cc, owner);
        }
    }

    return undefined;
}
