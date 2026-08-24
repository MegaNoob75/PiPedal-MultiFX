#pragma once

/*
 * Shared, MIDI-safe protocol and configuration types for the MultiFX physical
 * controller. These structures intentionally contain fixed-size byte fields:
 * they are small enough for microcontrollers, deterministic in Preferences /
 * EEPROM, and straightforward to validate before use.
 */

#include <Arduino.h>

namespace mfx {

constexpr uint8_t MAX_SWITCHES = 12;
constexpr uint8_t MAX_MODULES = 4;
constexpr uint8_t MAX_ANALOG_CONTROLS = 16;
constexpr uint8_t MAX_ENCODERS = 4;
constexpr uint8_t MAX_MODULE_CHANNELS = 16;
constexpr uint8_t DISABLED_VALUE = 127;
constexpr uint8_t FIRST_SWITCH_CC = 40;

constexpr uint8_t PROTOCOL_V2 = 2;
constexpr uint8_t CMD_CAPABILITY_REQUEST = 0x02;
constexpr uint8_t CMD_CAPABILITY_REPORT = 0x03;
constexpr uint8_t CMD_LEARN_START = 0x04;
constexpr uint8_t CMD_LEARN_CANCEL = 0x05;
constexpr uint8_t CMD_LEARN_RESULT = 0x06;

constexpr uint8_t PROTOCOL_V3 = 3;
constexpr uint8_t PROTOCOL_V4 = 4;
constexpr uint8_t CMD_PROFILE_REQUEST = 0x10;
constexpr uint8_t CMD_PROFILE_REPORT = 0x11;
constexpr uint8_t CMD_PROFILE_INPUT = 0x12;
constexpr uint8_t CMD_PROFILE_END = 0x13;
constexpr uint8_t CMD_CONFIG_BEGIN = 0x20;
constexpr uint8_t CMD_CONFIG_MODULE = 0x21;
constexpr uint8_t CMD_CONFIG_SWITCH = 0x22;
constexpr uint8_t CMD_CONFIG_ANALOG = 0x23;
constexpr uint8_t CMD_CONFIG_ENCODER = 0x24;
constexpr uint8_t CMD_CONFIG_COMMIT = 0x25;
constexpr uint8_t CMD_CONFIG_RESULT = 0x26;
constexpr uint8_t CMD_MODULE_SCAN = 0x30;
constexpr uint8_t CMD_MODULE_SCAN_RESULT = 0x31;

enum ModuleScanFamily : uint8_t {
    MODULE_SCAN_MCP23017 = 1,
    // ADS1015 and ADS1115 share addresses and their basic register protocol,
    // so discovery deliberately reports the family and lets the user confirm
    // the exact converter model before saving.
    MODULE_SCAN_ADS1X15 = 2,
};

enum SourceType : uint8_t {
    SOURCE_GPIO = 0,
    SOURCE_MUX = 1,
    SOURCE_EXTERNAL_ADC = 2,
    SOURCE_GPIO_EXPANDER = 3,
    SOURCE_DISABLED = DISABLED_VALUE,
};

enum CapabilityFlag : uint8_t {
    CAP_DIGITAL = 0x01,
    CAP_ANALOG = 0x02,
    CAP_OUTPUT = 0x04,
    // Learn-only mode: identify the two digital phases of one encoder.
    CAP_ENCODER = 0x08,
    // Learn-only mode: identify an encoder's optional push input.
    CAP_ENCODER_PUSH = 0x10,
};

enum InputStateFlag : uint8_t {
    INPUT_AVAILABLE = 0x01,
    INPUT_RESERVED = 0x02,
    INPUT_ASSIGNED = 0x04,
    INPUT_CAUTION = 0x08,
    INPUT_RECOMMENDED = 0x10,
};

enum InputUsage : uint8_t {
    USAGE_NONE = 0,
    USAGE_SWITCH = 1,
    USAGE_ENCODER = 2,
    USAGE_ENCODER_PUSH = 3,
    USAGE_POT = 4,
    USAGE_USB = 5,
    USAGE_SYSTEM = 6,
};

enum DriverId : uint8_t {
    DRIVER_NONE = 0,
    DRIVER_HC4051 = 1,
    DRIVER_HC4067 = 2,
    DRIVER_MCP23017 = 3,
    DRIVER_ADS1015 = 4,
    DRIVER_ADS1115 = 5,
};

enum LearnStatus : uint8_t {
    LEARNED = 0,
    LEARN_TIMEOUT = 1,
    LEARN_CANCELLED = 2,
    LEARN_ERROR = 3,
    LEARN_CONFLICT = 4,
};

enum ConfigStatus : uint8_t {
    CONFIG_APPLIED = 0,
    CONFIG_INCOMPLETE = 1,
    CONFIG_INCOMPATIBLE_SOURCE = 2,
    CONFIG_RESOURCE_CONFLICT = 3,
    CONFIG_INVALID_MODULE = 4,
    CONFIG_STORAGE_ERROR = 5,
};

/** Compact physical source address used inside firmware and on hardware protocols. */
struct SourceAddress {
    uint8_t type = SOURCE_DISABLED;
    uint8_t instance = 0;
    uint8_t channel = 0;

    bool enabled() const { return type != SOURCE_DISABLED; }
};

/** One runtime-selected expansion driver and all of its wiring parameters. */
struct ModuleConfig {
    uint8_t driver = DRIVER_NONE;
    uint8_t address = 0;
    uint8_t pins[6] = {
        DISABLED_VALUE, DISABLED_VALUE, DISABLED_VALUE,
        DISABLED_VALUE, DISABLED_VALUE, DISABLED_VALUE,
    };
};

/** Physical source for one fixed logical MIDI switch number. */
struct SwitchConfig {
    SourceAddress source;
    uint8_t flags = 0x03; // active-low + pull-up
};

/** Calibration/filter/MIDI behavior for one pot, slider, or expression input. */
struct AnalogConfig {
    SourceAddress source;
    uint8_t midiCc = 0;
    uint8_t filterShift = 4;
    uint16_t calibrationMin = 0;
    uint16_t calibrationMax = 4095;
    uint8_t flags = 0;
    // 1 is finest response; larger values trade resolution for noise immunity.
    uint8_t midiHysteresis = 2;
};

/** Source and MIDI behavior for one quadrature encoder and optional button. */
struct EncoderConfig {
    SourceAddress a;
    SourceAddress b;
    SourceAddress button;
    uint8_t turnCc = 30;
    uint8_t buttonCc = 31;
    uint8_t stepsPerDetent = 4;
    uint8_t flags = 0;
};

/** Complete last-known-good controller configuration stored by the firmware. */
struct ControllerConfig {
    uint32_t magic = 0;
    uint8_t version = 0;
    uint8_t moduleCount = 0;
    uint8_t switchCount = MAX_SWITCHES;
    uint8_t analogCount = 0;
    uint8_t encoderCount = 0;
    ModuleConfig modules[MAX_MODULES];
    SwitchConfig switches[MAX_SWITCHES];
    AnalogConfig analogs[MAX_ANALOG_CONTROLS];
    EncoderConfig encoders[MAX_ENCODERS];
    uint32_t checksum = 0;
};

constexpr uint32_t CONFIG_MAGIC = 0x4D465833UL; // ASCII-ish "MFX3"
constexpr uint8_t STORED_CONFIG_VERSION = 2;

/** One descriptor returned by v2 Learn and the chunked hardware profile. */
struct SourceDescriptor {
    SourceAddress source;
    uint8_t capabilities = 0;
    uint8_t state = 0;
    uint8_t usage = USAGE_NONE;
    uint8_t usageIndex = 0;
    uint8_t reason = 0;
};

} // namespace mfx
