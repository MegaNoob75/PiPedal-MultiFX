/*
 * PiPedal MultiFX Physical Controller
 * ESP32-S3 / Control Surface 2.1.2
 *
 * The firmware reports physical identity only. PiPedal-MultiFX decides what
 * each logical switch does. GPIO assignments arrive at runtime over USB MIDI
 * SysEx and are persisted in ESP32 Preferences.
 *
 * Footswitches:
 *   SW1..SW12 -> CC40..CC51, 127 pressed / 0 released
 * Encoder:
 *   A=GPIO18, B=GPIO17 -> CC30 relative two's-complement
 *   push=GPIO21         -> CC31
 * Pots:
 *   GPIO8/12/13/11 -> CC10..CC13
 *
 * Private GPIO map SysEx (F0/F7 supplied by MIDI transport):
 *   7D 4D 46 58 01 COUNT [SW PIN]...
 * PIN 127 means disabled.
 *
 * Capability/Learn protocol v2:
 *   7D 4D 46 58 02 02                         capability request
 *   7D 4D 46 58 02 03 ...                     capability report
 *   7D 4D 46 58 02 04 TOKEN FLAGS TARGET_SW   begin Learn
 *   7D 4D 46 58 02 05 TOKEN                   cancel Learn
 *   7D 4D 46 58 02 06 TOKEN STATUS ...        Learn result
 */

#include <Control_Surface.h>
#include <Preferences.h>

USBMIDI_Interface midi;
Preferences preferences;

// The ESP32-S3 ADC can jitter enough to make an untouched pot cross MIDI
// value boundaries. Use a stronger low-pass filter than CCPotentiometer's
// default while retaining its 7-bit hysteresis.
static constexpr uint8_t POT_FILTER_SHIFT = 4;
static constexpr uint32_t POT_SAMPLE_INTERVAL_US = 1000;
static constexpr uint8_t POT_CCS[] = {10, 11, 12, 13};
using StablePotInput = AH::FilteredAnalog<7, POT_FILTER_SHIFT, uint32_t>;
StablePotInput potInputs[] = {8, 12, 13, 11};
uint32_t lastPotSampleAt = 0;

static_assert(sizeof(potInputs) / sizeof(potInputs[0]) ==
                  sizeof(POT_CCS) / sizeof(POT_CCS[0]),
              "Each pot input must have a MIDI CC number.");

void beginPots() {
    for (auto &pot : potInputs) {
        pot.resetToCurrentValue();
    }
    lastPotSampleAt = micros();
}

void updatePots() {
    const uint32_t now = micros();
    if (now - lastPotSampleAt < POT_SAMPLE_INTERVAL_US) {
        return;
    }
    lastPotSampleAt = now;

    for (size_t i = 0; i < sizeof(potInputs) / sizeof(potInputs[0]); ++i) {
        if (potInputs[i].update()) {
            midi.sendControlChange(
                {POT_CCS[i], CHANNEL_1},
                static_cast<uint8_t>(potInputs[i].getValue()));
        }
    }
}

// Endless relative encoder. Unlike CCAbsoluteEncoder, this never reaches a
// 0/127 endpoint. Control Surface sends two's-complement relative CC values:
// +1 is 1 and -1 is 127 by default.
CCRotaryEncoder encoder {{18, 17}, {30, CHANNEL_1}};
CCButton encoderButton {21, {31, CHANNEL_1}};

static constexpr uint8_t MAX_FOOTSWITCHES = 12;
static constexpr uint8_t FIRST_SWITCH_CC = 40;
static constexpr uint8_t DISABLED_PIN = 127;
static constexpr uint32_t DEBOUNCE_MS = 25;
static constexpr uint32_t LEARN_TIMEOUT_MS = 30000;

static constexpr uint8_t PROTOCOL_VERSION = 2;
static constexpr uint8_t CMD_CAPABILITY_REQUEST = 0x02;
static constexpr uint8_t CMD_CAPABILITY_REPORT = 0x03;
static constexpr uint8_t CMD_LEARN_START = 0x04;
static constexpr uint8_t CMD_LEARN_CANCEL = 0x05;
static constexpr uint8_t CMD_LEARN_RESULT = 0x06;

static constexpr uint8_t CAPABILITY_DIGITAL = 0x01;
static constexpr uint8_t CAPABILITY_ANALOG = 0x02;
static constexpr uint8_t SOURCE_GPIO = 0x00;
static constexpr uint8_t INPUT_AVAILABLE = 0x01;
static constexpr uint8_t INPUT_RESERVED = 0x02;
static constexpr uint8_t INPUT_ASSIGNED = 0x04;
static constexpr uint8_t USAGE_NONE = 0x00;
static constexpr uint8_t USAGE_SWITCH = 0x01;
static constexpr uint8_t LEARN_STATUS_LEARNED = 0x00;
static constexpr uint8_t LEARN_STATUS_TIMEOUT = 0x01;
static constexpr uint8_t LEARN_STATUS_CANCELLED = 0x02;
static constexpr uint8_t LEARN_STATUS_ERROR = 0x03;
static constexpr uint8_t LEARN_STATUS_CONFLICT = 0x04;
static constexpr uint8_t SOURCE_DESCRIPTOR_SIZE = 7;

static constexpr char BOARD_NAME[] = "ESP32-S3 DevKitC-1";

static constexpr uint8_t DEFAULT_PINS[MAX_FOOTSWITCHES] = {
    6, 7, 15, 16, 1, 2, 4, 5,
    DISABLED_PIN, DISABLED_PIN, DISABLED_PIN, DISABLED_PIN
};

// ESP32-S3 DevKitC-1 board profile. The browser no longer duplicates this
// list: the firmware reports these safe switch candidates at runtime. Pins
// claimed by pots, encoder, USB and unsafe board functions are excluded.
static constexpr uint8_t SWITCH_INPUT_PINS[] = {
    1, 2, 3, 4, 5, 6, 7, 9, 10, 14, 15, 16,
    39, 40, 41, 42, 47
};

// These safe switch candidates are also ADC-capable on ESP32-S3. Phase 1
// only learns switches, but reporting the analog flag keeps the source model
// ready for later pot/multiplexer/external-ADC work.
static constexpr uint8_t ANALOG_CAPABLE_INPUT_PINS[] = {
    1, 2, 3, 4, 5, 6, 7, 9, 10, 14, 15, 16
};

static constexpr size_t SWITCH_INPUT_COUNT =
    sizeof(SWITCH_INPUT_PINS) / sizeof(SWITCH_INPUT_PINS[0]);

struct FootswitchState {
    uint8_t pin = DISABLED_PIN;
    bool rawPressed = false;
    bool stablePressed = false;
    uint32_t rawChangedAt = 0;
};

FootswitchState footswitches[MAX_FOOTSWITCHES];

struct LearnPinState {
    bool rawPressed = false;
    bool stablePressed = false;
    bool armed = false;
    uint32_t rawChangedAt = 0;
};

struct DigitalLearnState {
    bool active = false;
    uint8_t token = 0;
    uint8_t targetHardwareSwitch = 0;
    uint32_t startedAt = 0;
    LearnPinState pins[SWITCH_INPUT_COUNT];
};

DigitalLearnState digitalLearn;

bool isAllowedFootswitchPin(uint8_t pin) {
    if (pin == DISABLED_PIN) return true;
    for (uint8_t allowed : SWITCH_INPUT_PINS) {
        if (allowed == pin) return true;
    }
    return false;
}

bool isAnalogCapableInputPin(uint8_t pin) {
    for (uint8_t analogPin : ANALOG_CAPABLE_INPUT_PINS) {
        if (analogPin == pin) return true;
    }
    return false;
}

int8_t assignedSwitchForPin(uint8_t pin) {
    for (uint8_t i = 0; i < MAX_FOOTSWITCHES; ++i) {
        if (footswitches[i].pin == pin) return static_cast<int8_t>(i);
    }
    return -1;
}

void configureSwitchPin(uint8_t index, uint8_t pin) {
    if (index >= MAX_FOOTSWITCHES) return;
    FootswitchState &state = footswitches[index];

    if (state.pin != DISABLED_PIN && state.pin != pin) {
        pinMode(state.pin, INPUT);
    }

    state.pin = pin;
    if (pin == DISABLED_PIN) {
        state.rawPressed = false;
        state.stablePressed = false;
        state.rawChangedAt = millis();
        return;
    }

    pinMode(pin, INPUT_PULLUP);
    const bool pressed = digitalRead(pin) == LOW;
    state.rawPressed = pressed;
    state.stablePressed = pressed;
    state.rawChangedAt = millis();
}

void savePinMap() {
    preferences.begin("mfxpins", false);
    for (uint8_t i = 0; i < MAX_FOOTSWITCHES; ++i) {
        char key[5];
        snprintf(key, sizeof(key), "p%u", i + 1);
        preferences.putUChar(key, footswitches[i].pin);
    }
    preferences.end();
}

void loadPinMap() {
    preferences.begin("mfxpins", true);
    for (uint8_t i = 0; i < MAX_FOOTSWITCHES; ++i) {
        char key[5];
        snprintf(key, sizeof(key), "p%u", i + 1);
        uint8_t pin = preferences.getUChar(key, DEFAULT_PINS[i]);
        if (!isAllowedFootswitchPin(pin)) pin = DEFAULT_PINS[i];

        for (uint8_t previous = 0; previous < i; ++previous) {
            if (pin != DISABLED_PIN && footswitches[previous].pin == pin) {
                pin = DISABLED_PIN;
                break;
            }
        }
        configureSwitchPin(i, pin);
    }
    preferences.end();
}

void sendSwitchState(uint8_t index, bool pressed) {
    midi.sendControlChange(
        {static_cast<uint8_t>(FIRST_SWITCH_CC + index), CHANNEL_1},
        pressed ? 127 : 0
    );
}

void updateFootswitches() {
    if (digitalLearn.active) return;
    const uint32_t now = millis();
    for (uint8_t i = 0; i < MAX_FOOTSWITCHES; ++i) {
        FootswitchState &state = footswitches[i];
        if (state.pin == DISABLED_PIN) continue;

        const bool pressed = digitalRead(state.pin) == LOW;
        if (pressed != state.rawPressed) {
            state.rawPressed = pressed;
            state.rawChangedAt = now;
        }
        if (state.rawPressed != state.stablePressed
            && static_cast<uint32_t>(now - state.rawChangedAt) >= DEBOUNCE_MS) {
            state.stablePressed = state.rawPressed;
            sendSwitchState(i, state.stablePressed);
        }
    }
}

void writeSourceDescriptor(
    uint8_t *destination,
    uint8_t pin,
    uint8_t capabilityFlags,
    uint8_t stateFlags,
    uint8_t usage,
    uint8_t usageIndex
) {
    destination[0] = SOURCE_GPIO;
    destination[1] = 0; // Direct GPIO source instance.
    destination[2] = pin;
    destination[3] = capabilityFlags;
    destination[4] = stateFlags;
    destination[5] = usage;
    destination[6] = usageIndex;
}

void sendCapabilities() {
    static constexpr size_t BOARD_NAME_LENGTH = sizeof(BOARD_NAME) - 1;
    static constexpr size_t MESSAGE_SIZE =
        1 + 4 + 1 + 1 + 1 + BOARD_NAME_LENGTH + 1
        + SWITCH_INPUT_COUNT * SOURCE_DESCRIPTOR_SIZE + 1;
    uint8_t message[MESSAGE_SIZE] = {};
    size_t offset = 0;
    message[offset++] = 0xF0;
    message[offset++] = 0x7D;
    message[offset++] = 0x4D;
    message[offset++] = 0x46;
    message[offset++] = 0x58;
    message[offset++] = PROTOCOL_VERSION;
    message[offset++] = CMD_CAPABILITY_REPORT;
    message[offset++] = static_cast<uint8_t>(BOARD_NAME_LENGTH);
    for (size_t i = 0; i < BOARD_NAME_LENGTH; ++i) {
        message[offset++] = static_cast<uint8_t>(BOARD_NAME[i]);
    }
    message[offset++] = static_cast<uint8_t>(SWITCH_INPUT_COUNT);

    for (uint8_t pin : SWITCH_INPUT_PINS) {
        const int8_t assignedSwitch = assignedSwitchForPin(pin);
        const uint8_t capabilityFlags = CAPABILITY_DIGITAL
            | (isAnalogCapableInputPin(pin) ? CAPABILITY_ANALOG : 0);
        const uint8_t stateFlags = assignedSwitch >= 0
            ? INPUT_ASSIGNED
            : INPUT_AVAILABLE;
        writeSourceDescriptor(
            &message[offset],
            pin,
            capabilityFlags,
            stateFlags,
            assignedSwitch >= 0 ? USAGE_SWITCH : USAGE_NONE,
            assignedSwitch >= 0
                ? static_cast<uint8_t>(assignedSwitch + 1)
                : 0
        );
        offset += SOURCE_DESCRIPTOR_SIZE;
    }
    message[offset++] = 0xF7;
    midi.sendSysEx(message);
}

void sendLearnResult(uint8_t token, uint8_t status, uint8_t pin) {
    static constexpr size_t MESSAGE_SIZE =
        1 + 4 + 1 + 1 + 1 + 1 + SOURCE_DESCRIPTOR_SIZE + 1;
    uint8_t message[MESSAGE_SIZE] = {};
    size_t offset = 0;
    message[offset++] = 0xF0;
    message[offset++] = 0x7D;
    message[offset++] = 0x4D;
    message[offset++] = 0x46;
    message[offset++] = 0x58;
    message[offset++] = PROTOCOL_VERSION;
    message[offset++] = CMD_LEARN_RESULT;
    message[offset++] = token;
    message[offset++] = status;

    if (pin == DISABLED_PIN) {
        writeSourceDescriptor(&message[offset], 0, 0, 0, USAGE_NONE, 0);
    } else {
        const int8_t assignedSwitch = assignedSwitchForPin(pin);
        const uint8_t capabilityFlags = CAPABILITY_DIGITAL
            | (isAnalogCapableInputPin(pin) ? CAPABILITY_ANALOG : 0);
        writeSourceDescriptor(
            &message[offset],
            pin,
            capabilityFlags,
            assignedSwitch >= 0 ? INPUT_ASSIGNED : INPUT_AVAILABLE,
            assignedSwitch >= 0 ? USAGE_SWITCH : USAGE_NONE,
            assignedSwitch >= 0
                ? static_cast<uint8_t>(assignedSwitch + 1)
                : 0
        );
    }
    offset += SOURCE_DESCRIPTOR_SIZE;
    message[offset++] = 0xF7;
    midi.sendSysEx(message);
}

void restoreSwitchPinsAfterLearn() {
    for (uint8_t i = 0; i < MAX_FOOTSWITCHES; ++i) {
        configureSwitchPin(i, footswitches[i].pin);
    }
    for (uint8_t pin : SWITCH_INPUT_PINS) {
        if (assignedSwitchForPin(pin) < 0) pinMode(pin, INPUT);
    }
}

void finishDigitalLearn(uint8_t status, uint8_t pin) {
    if (!digitalLearn.active) return;
    const uint8_t token = digitalLearn.token;
    digitalLearn.active = false;
    restoreSwitchPinsAfterLearn();
    sendLearnResult(token, status, pin);
}

void startDigitalLearn(
    uint8_t token,
    uint8_t requestedCapabilities,
    uint8_t targetHardwareSwitch
) {
    if (digitalLearn.active) {
        finishDigitalLearn(LEARN_STATUS_CANCELLED, DISABLED_PIN);
    }
    if (token == 0
        || (requestedCapabilities & CAPABILITY_DIGITAL) == 0
        || targetHardwareSwitch < 1
        || targetHardwareSwitch > MAX_FOOTSWITCHES) {
        sendLearnResult(token, LEARN_STATUS_ERROR, DISABLED_PIN);
        return;
    }

    digitalLearn.active = true;
    digitalLearn.token = token;
    digitalLearn.targetHardwareSwitch = targetHardwareSwitch;
    digitalLearn.startedAt = millis();
    for (size_t i = 0; i < SWITCH_INPUT_COUNT; ++i) {
        const uint8_t pin = SWITCH_INPUT_PINS[i];
        pinMode(pin, INPUT_PULLUP);
        const bool pressed = digitalRead(pin) == LOW;
        digitalLearn.pins[i].rawPressed = pressed;
        digitalLearn.pins[i].stablePressed = pressed;
        // A switch held before Learn must be released and pressed again.
        digitalLearn.pins[i].armed = !pressed;
        digitalLearn.pins[i].rawChangedAt = digitalLearn.startedAt;
    }
}

void cancelDigitalLearn(uint8_t token) {
    if (digitalLearn.active && digitalLearn.token == token) {
        finishDigitalLearn(LEARN_STATUS_CANCELLED, DISABLED_PIN);
    }
}

void updateDigitalLearn() {
    if (!digitalLearn.active) return;
    const uint32_t now = millis();
    if (static_cast<uint32_t>(now - digitalLearn.startedAt)
        >= LEARN_TIMEOUT_MS) {
        finishDigitalLearn(LEARN_STATUS_TIMEOUT, DISABLED_PIN);
        return;
    }

    for (size_t i = 0; i < SWITCH_INPUT_COUNT; ++i) {
        LearnPinState &state = digitalLearn.pins[i];
        const uint8_t pin = SWITCH_INPUT_PINS[i];
        const bool pressed = digitalRead(pin) == LOW;
        if (pressed != state.rawPressed) {
            state.rawPressed = pressed;
            state.rawChangedAt = now;
        }
        if (state.rawPressed == state.stablePressed
            || static_cast<uint32_t>(now - state.rawChangedAt) < DEBOUNCE_MS) {
            continue;
        }

        state.stablePressed = state.rawPressed;
        if (!state.stablePressed) {
            state.armed = true;
            continue;
        }
        if (!state.armed) continue;

        const int8_t assignedSwitch = assignedSwitchForPin(pin);
        const bool conflicts = assignedSwitch >= 0
            && assignedSwitch + 1 != digitalLearn.targetHardwareSwitch;
        finishDigitalLearn(
            conflicts ? LEARN_STATUS_CONFLICT : LEARN_STATUS_LEARNED,
            pin
        );
        return;
    }
}

bool applyPinMapSysEx(SysExMessage sysex) {
    const uint8_t *data = sysex.data;
    uint16_t start = 0;
    uint16_t end = sysex.length;
    if (end > 0 && data[0] == 0xF0) start = 1;
    if (end > start && data[end - 1] == 0xF7) --end;

    if (end - start < 6
        || data[start] != 0x7D
        || data[start + 1] != 0x4D
        || data[start + 2] != 0x46
        || data[start + 3] != 0x58
        || data[start + 4] != 0x01) {
        return false;
    }

    const uint8_t count = data[start + 5];
    if (count > MAX_FOOTSWITCHES
        || end - start != static_cast<uint16_t>(6 + count * 2)) {
        return false;
    }

    uint8_t proposed[MAX_FOOTSWITCHES];
    for (uint8_t i = 0; i < MAX_FOOTSWITCHES; ++i) proposed[i] = DISABLED_PIN;

    for (uint8_t pair = 0; pair < count; ++pair) {
        const uint16_t offset = start + 6 + pair * 2;
        const uint8_t logicalSwitch = data[offset];
        const uint8_t pin = data[offset + 1];
        if (logicalSwitch < 1 || logicalSwitch > MAX_FOOTSWITCHES
            || !isAllowedFootswitchPin(pin)) return false;
        proposed[logicalSwitch - 1] = pin;
    }

    for (uint8_t i = 0; i < MAX_FOOTSWITCHES; ++i) {
        if (proposed[i] == DISABLED_PIN) continue;
        for (uint8_t j = i + 1; j < MAX_FOOTSWITCHES; ++j) {
            if (proposed[i] == proposed[j]) return false;
        }
    }

    if (digitalLearn.active) {
        finishDigitalLearn(LEARN_STATUS_CANCELLED, DISABLED_PIN);
    }
    for (uint8_t i = 0; i < MAX_FOOTSWITCHES; ++i) {
        configureSwitchPin(i, proposed[i]);
    }
    savePinMap();
    sendCapabilities();
    return true;
}

bool applyControllerCommandSysEx(SysExMessage sysex) {
    const uint8_t *data = sysex.data;
    uint16_t start = 0;
    uint16_t end = sysex.length;
    if (end > 0 && data[0] == 0xF0) start = 1;
    if (end > start && data[end - 1] == 0xF7) --end;

    if (end - start < 6
        || data[start] != 0x7D
        || data[start + 1] != 0x4D
        || data[start + 2] != 0x46
        || data[start + 3] != 0x58
        || data[start + 4] != PROTOCOL_VERSION) {
        return false;
    }

    const uint8_t command = data[start + 5];
    if (command == CMD_CAPABILITY_REQUEST) {
        if (end - start != 6) return false;
        sendCapabilities();
        return true;
    }
    if (command == CMD_LEARN_START) {
        if (end - start != 9) return false;
        startDigitalLearn(
            data[start + 6],
            data[start + 7],
            data[start + 8]
        );
        return true;
    }
    if (command == CMD_LEARN_CANCEL) {
        if (end - start != 7) return false;
        cancelDigitalLearn(data[start + 6]);
        return true;
    }
    return false;
}

struct MultiFXMidiCallbacks : MIDI_Callbacks {
    void onSysExMessage(MIDI_Interface &, SysExMessage sysex) override {
        if (!applyPinMapSysEx(sysex)) {
            applyControllerCommandSysEx(sysex);
        }
    }
} midiCallbacks;

void setup() {
    analogReadResolution(10);
#if defined(ARDUINO_ARCH_ESP32)
    analogSetAttenuation(ADC_11db);
#endif
    beginPots();
    loadPinMap();

    // Make the encoder protocol explicit so firmware and bridge cannot drift.
    RelativeCCSender::setMode(relativeCCmode::TWOS_COMPLEMENT);

    Control_Surface.begin();
    midi.setCallbacks(midiCallbacks);
}

void loop() {
    Control_Surface.loop();
    updatePots();
    if (digitalLearn.active) {
        updateDigitalLearn();
    } else {
        updateFootswitches();
    }
}
