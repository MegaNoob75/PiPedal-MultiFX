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
 */

#include <Control_Surface.h>
#include <Preferences.h>

USBMIDI_Interface midi;
Preferences preferences;

CCPotentiometer pot1 {8,  {10, CHANNEL_1}};
CCPotentiometer pot2 {12, {11, CHANNEL_1}};
CCPotentiometer pot3 {13, {12, CHANNEL_1}};
CCPotentiometer pot4 {11, {13, CHANNEL_1}};

// Endless relative encoder. Unlike CCAbsoluteEncoder, this never reaches a
// 0/127 endpoint. Control Surface sends two's-complement relative CC values:
// +1 is 1 and -1 is 127 by default.
CCRotaryEncoder encoder {{18, 17}, {30, CHANNEL_1}};
CCButton encoderButton {21, {31, CHANNEL_1}};

static constexpr uint8_t MAX_FOOTSWITCHES = 12;
static constexpr uint8_t FIRST_SWITCH_CC = 40;
static constexpr uint8_t DISABLED_PIN = 127;
static constexpr uint32_t DEBOUNCE_MS = 25;

static constexpr uint8_t DEFAULT_PINS[MAX_FOOTSWITCHES] = {
    6, 7, 15, 16, 1, 2, 4, 5,
    DISABLED_PIN, DISABLED_PIN, DISABLED_PIN, DISABLED_PIN
};

// Must match ControllerConfig.ts. Pins used by pots, encoder, USB and unsafe
// ESP32-S3 flash/PSRAM/strapping functions are intentionally unavailable.
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

bool isAllowedFootswitchPin(uint8_t pin) {
    if (pin == DISABLED_PIN) return true;
    for (uint8_t allowed : ALLOWED_FOOTSWITCH_PINS) {
        if (allowed == pin) return true;
    }
    return false;
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

    for (uint8_t i = 0; i < MAX_FOOTSWITCHES; ++i) {
        configureSwitchPin(i, proposed[i]);
    }
    savePinMap();
    return true;
}

struct MultiFXMidiCallbacks : MIDI_Callbacks {
    void onSysExMessage(MIDI_Interface &, SysExMessage sysex) override {
        applyPinMapSysEx(sysex);
    }
} midiCallbacks;

void setup() {
    analogReadResolution(10);
#if defined(ARDUINO_ARCH_ESP32)
    analogSetAttenuation(ADC_11db);
#endif
    loadPinMap();

    // Make the encoder protocol explicit so firmware and bridge cannot drift.
    RelativeCCSender::setMode(relativeCCmode::TWOS_COMPLEMENT);

    Control_Surface.begin();
    midi.setCallbacks(midiCallbacks);
}

void loop() {
    Control_Surface.loop();
    updateFootswitches();
}
