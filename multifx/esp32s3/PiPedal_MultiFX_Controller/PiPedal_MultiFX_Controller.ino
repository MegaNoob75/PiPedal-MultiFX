/*
 * PiPedal MultiFX Physical Controller
 * ESP32-S3 / Control Surface 2.1.2
 *
 * Footswitch-first controller protocol.
 *
 * IMPORTANT
 * ---------
 * The ESP32 does NOT know about presets, banks, snapshots or PiPedal actions.
 * It only reports logical physical switch identity:
 *
 *   SW1  -> CC40
 *   SW2  -> CC41
 *   ...
 *   SW12 -> CC51
 *
 * 127 = pressed
 *   0 = released
 *
 * GPIO wiring is configurable at runtime over USB MIDI SysEx and is stored
 * persistently using ESP32 Preferences. The user therefore does not need to
 * edit or recompile this sketch when a footswitch is moved to another
 * supported GPIO.
 *
 * Private GPIO-map SysEx payload:
 *   F0 7D 4D 46 58 01 COUNT [SW PIN]... F7
 *
 * PIN 127 means "disabled".
 *
 * Existing pots and encoder are retained unchanged for compatibility. Their
 * GPIOs are reserved and cannot simultaneously be used as footswitch pins.
 */

#include <Control_Surface.h>
#include <Preferences.h>

USBMIDI_Interface midi;
Preferences preferences;

// ------------------------------------------------------------
// Current non-footswitch hardware retained for compatibility.
// ------------------------------------------------------------

CCPotentiometer pot1 {8,  {10, CHANNEL_1}};
CCPotentiometer pot2 {12, {11, CHANNEL_1}};
CCPotentiometer pot3 {13, {12, CHANNEL_1}};
CCPotentiometer pot4 {11, {13, CHANNEL_1}};

CCAbsoluteEncoder encoder {
    {18, 17},
    {30, CHANNEL_1},
};

CCButton encoderButton {21, {31, CHANNEL_1}};

// ------------------------------------------------------------
// Footswitch protocol.
// ------------------------------------------------------------

static constexpr uint8_t MAX_FOOTSWITCHES = 12;
static constexpr uint8_t FIRST_SWITCH_CC = 40;
static constexpr uint8_t DISABLED_PIN = 127;
static constexpr uint32_t DEBOUNCE_MS = 25;

static constexpr uint8_t DEFAULT_PINS[MAX_FOOTSWITCHES] = {
    6, 7, 15, 16,
    1, 2, 4, 5,
    DISABLED_PIN, DISABLED_PIN, DISABLED_PIN, DISABLED_PIN
};

// Conservative GPIO set matching ControllerConfig.ts.
// GPIOs used by current pots/encoder, USB, possible flash/PSRAM and strapping
// pins are intentionally excluded.
static constexpr uint8_t ALLOWED_FOOTSWITCH_PINS[] = {
    1, 2, 3, 4, 5, 6, 7, 9, 10, 14, 15, 16,
    39, 40, 41, 42, 47
};

struct FootswitchState {
    uint8_t pin = DISABLED_PIN;
    bool rawPressed = false;
    bool stablePressed = false;
    uint32_t rawChangedAt = 0;
};

FootswitchState footswitches[MAX_FOOTSWITCHES];

// ------------------------------------------------------------
// Helpers.
// ------------------------------------------------------------

bool isAllowedFootswitchPin(uint8_t pin) {
    if (pin == DISABLED_PIN) {
        return true;
    }

    for (uint8_t allowed : ALLOWED_FOOTSWITCH_PINS) {
        if (allowed == pin) {
            return true;
        }
    }
    return false;
}

bool pinUsedByAnotherSwitch(uint8_t pin, uint8_t exceptIndex) {
    if (pin == DISABLED_PIN) {
        return false;
    }

    for (uint8_t i = 0; i < MAX_FOOTSWITCHES; ++i) {
        if (i != exceptIndex && footswitches[i].pin == pin) {
            return true;
        }
    }
    return false;
}

void configureSwitchPin(uint8_t index, uint8_t pin) {
    if (index >= MAX_FOOTSWITCHES) {
        return;
    }

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

        if (!isAllowedFootswitchPin(pin)) {
            pin = DEFAULT_PINS[i];
        }

        // Avoid duplicate saved pins after a malformed/old configuration.
        bool duplicate = false;
        for (uint8_t previous = 0; previous < i; ++previous) {
            if (
                pin != DISABLED_PIN
                && footswitches[previous].pin == pin
            ) {
                duplicate = true;
                break;
            }
        }

        if (duplicate) {
            pin = DISABLED_PIN;
        }

        configureSwitchPin(i, pin);
    }

    preferences.end();
}

void sendSwitchState(uint8_t index, bool pressed) {
    if (index >= MAX_FOOTSWITCHES) {
        return;
    }

    midi.sendControlChange(
        {static_cast<uint8_t>(FIRST_SWITCH_CC + index), CHANNEL_1},
        pressed ? 127 : 0
    );
}

void updateFootswitches() {
    const uint32_t now = millis();

    for (uint8_t i = 0; i < MAX_FOOTSWITCHES; ++i) {
        FootswitchState &state = footswitches[i];

        if (state.pin == DISABLED_PIN) {
            continue;
        }

        const bool pressed = digitalRead(state.pin) == LOW;

        if (pressed != state.rawPressed) {
            state.rawPressed = pressed;
            state.rawChangedAt = now;
        }

        if (
            state.rawPressed != state.stablePressed
            && static_cast<uint32_t>(now - state.rawChangedAt) >= DEBOUNCE_MS
        ) {
            state.stablePressed = state.rawPressed;
            sendSwitchState(i, state.stablePressed);
        }
    }
}

// ------------------------------------------------------------
// Private SysEx GPIO configuration.
// ------------------------------------------------------------

bool applyPinMapSysEx(SysExMessage sysex) {
    const uint8_t *data = sysex.data;
    const uint16_t length = sysex.length;

    // Depending on backend/version, SysExMessage may include F0/F7 in data.
    uint16_t start = 0;
    uint16_t end = length;

    if (length >= 1 && data[0] == 0xF0) {
        start = 1;
    }
    if (end > start && data[end - 1] == 0xF7) {
        --end;
    }

    if (end - start < 6) {
        return false;
    }

    if (
        data[start + 0] != 0x7D
        || data[start + 1] != 0x4D
        || data[start + 2] != 0x46
        || data[start + 3] != 0x58
        || data[start + 4] != 0x01
    ) {
        return false;
    }

    const uint8_t pairCount = data[start + 5];
    if (pairCount > MAX_FOOTSWITCHES) {
        return false;
    }

    if ((end - start) != static_cast<uint16_t>(6 + pairCount * 2)) {
        return false;
    }

    uint8_t proposed[MAX_FOOTSWITCHES];
    for (uint8_t i = 0; i < MAX_FOOTSWITCHES; ++i) {
        proposed[i] = DISABLED_PIN;
    }

    for (uint8_t pair = 0; pair < pairCount; ++pair) {
        const uint16_t offset = start + 6 + pair * 2;
        const uint8_t logicalSwitch = data[offset];
        const uint8_t pin = data[offset + 1];

        if (
            logicalSwitch < 1
            || logicalSwitch > MAX_FOOTSWITCHES
            || !isAllowedFootswitchPin(pin)
        ) {
            return false;
        }

        proposed[logicalSwitch - 1] = pin;
    }

    // Reject duplicate enabled GPIOs.
    for (uint8_t i = 0; i < MAX_FOOTSWITCHES; ++i) {
        if (proposed[i] == DISABLED_PIN) {
            continue;
        }

        for (uint8_t j = i + 1; j < MAX_FOOTSWITCHES; ++j) {
            if (proposed[i] == proposed[j]) {
                return false;
            }
        }
    }

    for (uint8_t i = 0; i < MAX_FOOTSWITCHES; ++i) {
        configureSwitchPin(i, proposed[i]);
    }

    savePinMap();
    return true;
}

struct MultiFXMidiCallbacks : MIDI_Callbacks {
    void onSysExMessage(
        MIDI_Interface &,
        SysExMessage sysex
    ) override {
        applyPinMapSysEx(sysex);
    }
} midiCallbacks;

// ------------------------------------------------------------
// Arduino lifecycle.
// ------------------------------------------------------------

void setup() {
    analogReadResolution(10);

#if defined(ARDUINO_ARCH_ESP32)
    analogSetAttenuation(ADC_11db);
#endif

    // Load GPIO map before MIDI begins so physical inputs are ready immediately.
    loadPinMap();

    Control_Surface.begin();

    // Control Surface 2.1.2 supports incoming SysEx callbacks on USB MIDI.
    midi.setCallbacks(midiCallbacks);
}

void loop() {
    // Keep all existing Control Surface controls running, and service incoming
    // USB MIDI (including our GPIO-map SysEx).
    Control_Surface.loop();

    // Footswitches are manual so their GPIO pins can change at runtime.
    updateFootswitches();
}
