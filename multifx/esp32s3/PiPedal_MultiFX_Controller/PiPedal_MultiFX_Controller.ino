/*
 * PiPedal MultiFX portable physical controller
 *
 * This sketch is the USB-MIDI/protocol shell. Board capability, common module
 * drivers, scanning, filtering, Learn, and last-known-good storage live in the
 * adjacent documented ControllerHardware files so future board builds share
 * one implementation instead of copying a complete sketch.
 *
 * Protocol compatibility:
 *   v1  direct-GPIO logical switch map (retained for older bridges)
 *   v2  capability discovery and transient digital/analog Learn
 *   v3  board/driver catalog and atomic portable hardware configuration
 *   v4  configurable response threshold for each analog control
 */

#include <Control_Surface.h>

#include "BoardProfile.h"
#include "ControllerHardware.h"
#include "ControllerProtocol.h"

USBMIDI_Interface midi;
mfx::ControllerHardware controller;

namespace {

constexpr uint8_t SYSEX_PREFIX[] = {0x7D, 0x4D, 0x46, 0x58};
constexpr size_t SOURCE_DESCRIPTOR_SIZE = 7;
constexpr uint8_t DRIVER_MASK = 0x1F; // All five initial runtime drivers.

/** Send one controller event on MIDI channel 1. */
void sendControlChange(uint8_t cc, uint8_t value) {
    midi.sendControlChange({cc, Channel_1}, value);
}

/** Write the shared seven-byte source descriptor into an outgoing message. */
void writeDescriptor(uint8_t *destination, const mfx::SourceDescriptor &descriptor) {
    destination[0] = descriptor.source.type;
    destination[1] = descriptor.source.instance;
    destination[2] = descriptor.source.channel;
    destination[3] = descriptor.capabilities;
    destination[4] = descriptor.state;
    destination[5] = descriptor.usage;
    destination[6] = descriptor.usageIndex;
}

/** Build a descriptor even for disabled/error Learn results. */
mfx::SourceDescriptor describeOrEmpty(const mfx::SourceAddress &source) {
    mfx::SourceDescriptor descriptor;
    if (!source.enabled() || !controller.describeSource(source, descriptor)) {
        descriptor = mfx::SourceDescriptor{};
        descriptor.source = {mfx::SOURCE_GPIO, 0, 0};
    }
    return descriptor;
}

/** Return a correlated v2 Learn status without persisting the learned source. */
void sendLearnResult(
    uint8_t token,
    uint8_t status,
    const mfx::SourceAddress &source,
    const mfx::SourceAddress &secondarySource
) {
    constexpr size_t MESSAGE_SIZE = 1 + 4 + 1 + 1 + 1 + 1
        + 2 * SOURCE_DESCRIPTOR_SIZE + 1;
    uint8_t message[MESSAGE_SIZE] = {};
    size_t offset = 0;
    message[offset++] = 0xF0;
    for (uint8_t byte : SYSEX_PREFIX) message[offset++] = byte;
    message[offset++] = mfx::PROTOCOL_V2;
    message[offset++] = mfx::CMD_LEARN_RESULT;
    message[offset++] = token;
    message[offset++] = status;
    const mfx::SourceDescriptor descriptor = describeOrEmpty(source);
    writeDescriptor(&message[offset], descriptor);
    offset += SOURCE_DESCRIPTOR_SIZE;
    const mfx::SourceDescriptor secondaryDescriptor = describeOrEmpty(secondarySource);
    writeDescriptor(&message[offset], secondaryDescriptor);
    offset += SOURCE_DESCRIPTOR_SIZE;
    message[offset++] = 0xF7;
    midi.sendSysEx(message);
}

/**
 * Send the compatible v2 direct-pin report. Version 3 follows with richer,
 * chunked data, but keeping this response lets older bridges continue to work.
 */
void sendV2Capabilities() {
    constexpr size_t NAME_LENGTH = sizeof(mfx::BOARD_NAME) - 1;
    constexpr size_t MESSAGE_SIZE = 1 + 4 + 1 + 1 + 1 + NAME_LENGTH + 1
        + mfx::BOARD_PIN_COUNT * SOURCE_DESCRIPTOR_SIZE + 1;
    uint8_t message[MESSAGE_SIZE] = {};
    size_t offset = 0;
    message[offset++] = 0xF0;
    for (uint8_t byte : SYSEX_PREFIX) message[offset++] = byte;
    message[offset++] = mfx::PROTOCOL_V2;
    message[offset++] = mfx::CMD_CAPABILITY_REPORT;
    message[offset++] = NAME_LENGTH;
    for (size_t index = 0; index < NAME_LENGTH; ++index) {
        message[offset++] = static_cast<uint8_t>(mfx::BOARD_NAME[index]);
    }
    message[offset++] = static_cast<uint8_t>(mfx::BOARD_PIN_COUNT);
    for (const auto &pin : mfx::BOARD_PINS) {
        mfx::SourceDescriptor descriptor;
        controller.describeSource({mfx::SOURCE_GPIO, 0, pin.pin}, descriptor);
        writeDescriptor(&message[offset], descriptor);
        offset += SOURCE_DESCRIPTOR_SIZE;
    }
    message[offset++] = 0xF7;
    midi.sendSysEx(message);
}

/** Send one short hardware-profile chunk, avoiding SysEx buffer limits. */
void sendHardwareProfileInput(const mfx::SourceDescriptor &descriptor) {
    constexpr size_t MESSAGE_SIZE = 1 + 4 + 1 + 1
        + SOURCE_DESCRIPTOR_SIZE + 1 + 1;
    uint8_t message[MESSAGE_SIZE] = {};
    size_t offset = 0;
    message[offset++] = 0xF0;
    for (uint8_t byte : SYSEX_PREFIX) message[offset++] = byte;
    message[offset++] = mfx::PROTOCOL_V4;
    message[offset++] = mfx::CMD_PROFILE_INPUT;
    writeDescriptor(&message[offset], descriptor);
    offset += SOURCE_DESCRIPTOR_SIZE;
    message[offset++] = descriptor.reason;
    message[offset++] = 0xF7;
    midi.sendSysEx(message);
}

/**
 * Report board identity, compiled driver catalog, direct pins, and every
 * channel supplied by the currently configured expansion modules.
 */
void sendHardwareProfile() {
    constexpr size_t NAME_LENGTH = sizeof(mfx::BOARD_NAME) - 1;
    constexpr size_t BEGIN_SIZE = 1 + 4 + 1 + 1 + 1 + NAME_LENGTH + 4 + 1;
    uint8_t beginMessage[BEGIN_SIZE] = {};
    size_t offset = 0;
    beginMessage[offset++] = 0xF0;
    for (uint8_t byte : SYSEX_PREFIX) beginMessage[offset++] = byte;
    beginMessage[offset++] = mfx::PROTOCOL_V4;
    beginMessage[offset++] = mfx::CMD_PROFILE_REPORT;
    beginMessage[offset++] = NAME_LENGTH;
    for (size_t index = 0; index < NAME_LENGTH; ++index) {
        beginMessage[offset++] = static_cast<uint8_t>(mfx::BOARD_NAME[index]);
    }
    beginMessage[offset++] = mfx::MAX_MODULES;
    beginMessage[offset++] = mfx::MAX_ANALOG_CONTROLS;
    beginMessage[offset++] = mfx::MAX_ENCODERS;
    beginMessage[offset++] = DRIVER_MASK;
    beginMessage[offset++] = 0xF7;
    midi.sendSysEx(beginMessage);

    for (const auto &pin : mfx::BOARD_PINS) {
        mfx::SourceDescriptor descriptor;
        if (controller.describeSource({mfx::SOURCE_GPIO, 0, pin.pin}, descriptor)) {
            sendHardwareProfileInput(descriptor);
        }
    }

    const mfx::ControllerConfig &config = controller.config();
    for (uint8_t moduleIndex = 0; moduleIndex < config.moduleCount; ++moduleIndex) {
        const uint8_t driver = config.modules[moduleIndex].driver;
        const uint8_t sourceType = driver == mfx::DRIVER_HC4051
                || driver == mfx::DRIVER_HC4067
            ? mfx::SOURCE_MUX
            : driver == mfx::DRIVER_MCP23017
                ? mfx::SOURCE_GPIO_EXPANDER
                : mfx::SOURCE_EXTERNAL_ADC;
        const uint8_t channelCount = driver == mfx::DRIVER_HC4051
            ? 8
            : driver == mfx::DRIVER_HC4067 || driver == mfx::DRIVER_MCP23017
                ? 16
                : 4;
        for (uint8_t channel = 0; channel < channelCount; ++channel) {
            mfx::SourceDescriptor descriptor;
            if (controller.describeSource(
                {sourceType, static_cast<uint8_t>(moduleIndex + 1), channel}, descriptor
            )) sendHardwareProfileInput(descriptor);
        }
    }

    uint8_t endMessage[] = {
        0xF0, 0x7D, 0x4D, 0x46, 0x58,
        mfx::PROTOCOL_V4, mfx::CMD_PROFILE_END, 0xF7,
    };
    midi.sendSysEx(endMessage);
}

/** Send the firmware's atomic transaction result and optional detail byte. */
void sendConfigResult(uint8_t token, uint8_t status, uint8_t detail) {
    uint8_t message[] = {
        0xF0, 0x7D, 0x4D, 0x46, 0x58,
        mfx::PROTOCOL_V4, mfx::CMD_CONFIG_RESULT,
        token, status, detail, 0xF7,
    };
    midi.sendSysEx(message);
}

/** Remove optional F0/F7 delimiters and verify the private manufacturer tag. */
bool unwrapMessage(
    SysExMessage sysex,
    const uint8_t *&data,
    uint16_t &start,
    uint16_t &end
) {
    data = sysex.data;
    start = 0;
    end = sysex.length;
    if (end > 0 && data[0] == 0xF0) start = 1;
    if (end > start && data[end - 1] == 0xF7) --end;
    if (end - start < 6) return false;
    for (uint8_t index = 0; index < 4; ++index) {
        if (data[start + index] != SYSEX_PREFIX[index]) return false;
    }
    return true;
}

/** Decode TYPE/INSTANCE/CHANNEL from a v3 record at the supplied offset. */
mfx::SourceAddress readSource(const uint8_t *data, uint16_t offset) {
    return {data[offset], data[offset + 1], data[offset + 2]};
}

/** Decode a MIDI-safe two-byte 14-bit integer. */
uint16_t read14(const uint8_t *data, uint16_t offset) {
    return static_cast<uint16_t>(data[offset])
        | (static_cast<uint16_t>(data[offset + 1]) << 7);
}

/** Parse and atomically apply the retained version-1 direct switch map. */
bool handleV1(const uint8_t *data, uint16_t start, uint16_t end) {
    if (data[start + 4] != 1 || end - start < 6) return false;
    const uint8_t count = data[start + 5];
    if (count > mfx::MAX_SWITCHES || end - start != 6 + count * 2) return false;
    uint8_t pins[mfx::MAX_SWITCHES];
    for (auto &pin : pins) pin = mfx::DISABLED_VALUE;
    for (uint8_t pair = 0; pair < count; ++pair) {
        const uint16_t offset = start + 6 + pair * 2;
        const uint8_t logicalSwitch = data[offset];
        if (logicalSwitch < 1 || logicalSwitch > mfx::MAX_SWITCHES) return false;
        pins[logicalSwitch - 1] = data[offset + 1];
    }
    const bool applied = controller.applyLegacySwitchPins(pins);
    if (applied) {
        sendV2Capabilities();
        sendHardwareProfile();
    }
    return applied;
}

/** Parse version-2 capability/Learn commands. */
bool handleV2(const uint8_t *data, uint16_t start, uint16_t end) {
    if (data[start + 4] != mfx::PROTOCOL_V2) return false;
    const uint8_t command = data[start + 5];
    if (command == mfx::CMD_CAPABILITY_REQUEST && end - start == 6) {
        sendV2Capabilities();
        return true;
    }
    if (command == mfx::CMD_LEARN_START && end - start == 9) {
        controller.startLearn(data[start + 6], data[start + 7], data[start + 8]);
        return true;
    }
    if (command == mfx::CMD_LEARN_CANCEL && end - start == 7) {
        controller.cancelLearn(data[start + 6]);
        return true;
    }
    return false;
}

/** Parse one record of the current portable hardware protocol. */
bool handleHardwareProtocol(const uint8_t *data, uint16_t start, uint16_t end) {
    if (data[start + 4] != mfx::PROTOCOL_V4) return false;
    const uint8_t command = data[start + 5];
    if (command == mfx::CMD_PROFILE_REQUEST && end - start == 6) {
        sendHardwareProfile();
        return true;
    }
    if (command == mfx::CMD_CONFIG_BEGIN && end - start == 11) {
        const bool accepted = controller.beginTransaction(
            data[start + 6], data[start + 7], data[start + 8],
            data[start + 9], data[start + 10]
        );
        if (!accepted) sendConfigResult(data[start + 6], mfx::CONFIG_INCOMPLETE, 0);
        return true;
    }
    if (command == mfx::CMD_CONFIG_MODULE && end - start == 16) {
        mfx::ModuleConfig module;
        module.driver = data[start + 8];
        module.address = data[start + 9];
        for (uint8_t index = 0; index < 6; ++index) module.pins[index] = data[start + 10 + index];
        controller.setTransactionModule(data[start + 6], data[start + 7], module);
        return true;
    }
    if (command == mfx::CMD_CONFIG_SWITCH && end - start == 12) {
        mfx::SwitchConfig item;
        item.source = readSource(data, start + 8);
        item.flags = data[start + 11];
        controller.setTransactionSwitch(data[start + 6], data[start + 7], item);
        return true;
    }
    if (command == mfx::CMD_CONFIG_ANALOG && end - start == 19) {
        mfx::AnalogConfig item;
        item.source = readSource(data, start + 8);
        item.midiCc = data[start + 11];
        item.filterShift = data[start + 12];
        item.calibrationMin = read14(data, start + 13);
        item.calibrationMax = read14(data, start + 15);
        item.flags = data[start + 17];
        item.midiHysteresis = data[start + 18];
        controller.setTransactionAnalog(data[start + 6], data[start + 7], item);
        return true;
    }
    if (command == mfx::CMD_CONFIG_ENCODER && end - start == 21) {
        mfx::EncoderConfig item;
        item.a = readSource(data, start + 8);
        item.b = readSource(data, start + 11);
        item.button = readSource(data, start + 14);
        item.turnCc = data[start + 17];
        item.buttonCc = data[start + 18];
        item.stepsPerDetent = data[start + 19];
        item.flags = data[start + 20];
        controller.setTransactionEncoder(data[start + 6], data[start + 7], item);
        return true;
    }
    if (command == mfx::CMD_CONFIG_COMMIT && end - start == 7) {
        const uint8_t token = data[start + 6];
        uint8_t detail = 0;
        const uint8_t result = controller.commitTransaction(token, detail);
        sendConfigResult(token, result, detail);
        if (result == mfx::CONFIG_APPLIED) {
            sendV2Capabilities();
            sendHardwareProfile();
        }
        return true;
    }
    return false;
}

/** Control Surface callback routes only the private MultiFX SysEx messages. */
struct MultiFXMidiCallbacks : MIDI_Callbacks {
    void onSysExMessage(MIDI_Interface &, SysExMessage sysex) override {
        const uint8_t *data = nullptr;
        uint16_t start = 0;
        uint16_t end = 0;
        if (!unwrapMessage(sysex, data, start, end)) return;
        if (handleV1(data, start, end)) return;
        if (handleV2(data, start, end)) return;
        handleHardwareProtocol(data, start, end);
    }
} midiCallbacks;

} // namespace

void setup() {
    Control_Surface.begin();
    midi.setCallbacks(midiCallbacks);
    controller.begin(sendControlChange, sendLearnResult);
}

void loop() {
    Control_Surface.loop();
    controller.update();
}
