#pragma once

/*
 * Board capability profiles.
 *
 * Profiles describe what pins CAN do. They do not freeze a single hardware
 * layout. A hard reservation is rejected; a caution is reported to the UI but
 * remains selectable so users can make informed choices for their own board.
 */

#include "ControllerProtocol.h"

namespace mfx {

struct PinProfile {
    uint8_t pin;
    uint8_t capabilities;
    uint8_t state;
    uint8_t reason;
};

#if defined(ARDUINO_ARCH_ESP32)

constexpr char BOARD_NAME[] = "ESP32-S3 DevKitC-1";
constexpr char BOARD_ID[] = "esp32-s3-devkitc-1";

// Reason codes: 1 boot strap, 2 onboard device, 3 serial, 4 native USB.
constexpr PinProfile BOARD_PINS[] = {
    {0,  CAP_DIGITAL | CAP_OUTPUT, INPUT_CAUTION, 1},
    {1,  CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, INPUT_RECOMMENDED, 0},
    {2,  CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, INPUT_RECOMMENDED, 0},
    {3,  CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, INPUT_CAUTION, 1},
    {4,  CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, INPUT_RECOMMENDED, 0},
    {5,  CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, INPUT_RECOMMENDED, 0},
    {6,  CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, INPUT_RECOMMENDED, 0},
    {7,  CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, INPUT_RECOMMENDED, 0},
    {8,  CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, INPUT_RECOMMENDED, 0},
    {9,  CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, 0, 0},
    {10, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, 0, 0},
    {11, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, INPUT_RECOMMENDED, 0},
    {12, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, INPUT_RECOMMENDED, 0},
    {13, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, INPUT_RECOMMENDED, 0},
    {14, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, 0, 0},
    {15, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, INPUT_RECOMMENDED, 0},
    {16, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, INPUT_RECOMMENDED, 0},
    {17, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, INPUT_RECOMMENDED, 0},
    {18, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, INPUT_RECOMMENDED, 0},
    {19, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, INPUT_RESERVED, 4},
    {20, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, INPUT_RESERVED, 4},
    {21, CAP_DIGITAL | CAP_OUTPUT, INPUT_RECOMMENDED, 0},
    {38, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {39, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {40, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {41, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {42, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {43, CAP_DIGITAL | CAP_OUTPUT, INPUT_CAUTION, 3},
    {44, CAP_DIGITAL | CAP_OUTPUT, INPUT_CAUTION, 3},
    {45, CAP_DIGITAL | CAP_OUTPUT, INPUT_CAUTION, 1},
    {46, CAP_DIGITAL, INPUT_CAUTION, 1},
    {47, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {48, CAP_DIGITAL | CAP_OUTPUT, INPUT_CAUTION, 2},
};

#elif defined(ARDUINO_ARCH_RP2040)

constexpr char BOARD_NAME[] = "Raspberry Pi RP2040/RP2350";
constexpr char BOARD_ID[] = "raspberry-pi-rp2";
constexpr PinProfile BOARD_PINS[] = {
    {0, CAP_DIGITAL | CAP_OUTPUT, 0, 0}, {1, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {2, CAP_DIGITAL | CAP_OUTPUT, 0, 0}, {3, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {4, CAP_DIGITAL | CAP_OUTPUT, 0, 0}, {5, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {6, CAP_DIGITAL | CAP_OUTPUT, 0, 0}, {7, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {8, CAP_DIGITAL | CAP_OUTPUT, 0, 0}, {9, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {10, CAP_DIGITAL | CAP_OUTPUT, 0, 0}, {11, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {12, CAP_DIGITAL | CAP_OUTPUT, 0, 0}, {13, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {14, CAP_DIGITAL | CAP_OUTPUT, 0, 0}, {15, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {16, CAP_DIGITAL | CAP_OUTPUT, 0, 0}, {17, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {18, CAP_DIGITAL | CAP_OUTPUT, 0, 0}, {19, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {20, CAP_DIGITAL | CAP_OUTPUT, 0, 0}, {21, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {22, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {26, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, 0, 0},
    {27, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, 0, 0},
    {28, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, 0, 0},
};

#elif defined(CORE_TEENSY)

constexpr char BOARD_NAME[] = "Teensy 4.x";
constexpr char BOARD_ID[] = "teensy-4x";
constexpr PinProfile BOARD_PINS[] = {
    {0, CAP_DIGITAL | CAP_OUTPUT, 0, 0}, {1, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {2, CAP_DIGITAL | CAP_OUTPUT, 0, 0}, {3, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {4, CAP_DIGITAL | CAP_OUTPUT, 0, 0}, {5, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {6, CAP_DIGITAL | CAP_OUTPUT, 0, 0}, {7, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {8, CAP_DIGITAL | CAP_OUTPUT, 0, 0}, {9, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {10, CAP_DIGITAL | CAP_OUTPUT, 0, 0}, {11, CAP_DIGITAL | CAP_OUTPUT, 0, 0},
    {12, CAP_DIGITAL | CAP_OUTPUT, 0, 0}, {13, CAP_DIGITAL | CAP_OUTPUT, INPUT_CAUTION, 2},
    {14, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, 0, 0},
    {15, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, 0, 0},
    {16, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, 0, 0},
    {17, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, 0, 0},
    {18, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, 0, 0},
    {19, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, 0, 0},
    {20, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, 0, 0},
    {21, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, 0, 0},
    {22, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, 0, 0},
    {23, CAP_DIGITAL | CAP_ANALOG | CAP_OUTPUT, 0, 0},
};

#else
#error "Add a BoardProfile for this Arduino target before compiling MultiFX."
#endif

constexpr size_t BOARD_PIN_COUNT = sizeof(BOARD_PINS) / sizeof(BOARD_PINS[0]);

/** Find the immutable capability record for a board pin, or null if absent. */
inline const PinProfile *findBoardPin(uint8_t pin) {
    for (const auto &candidate : BOARD_PINS) {
        if (candidate.pin == pin) return &candidate;
    }
    return nullptr;
}

/** Test capability and hard-reservation rules without applying a pin mode. */
inline bool boardPinSupports(uint8_t pin, uint8_t capability) {
    const PinProfile *profile = findBoardPin(pin);
    return profile != nullptr
        && (profile->capabilities & capability) != 0
        && (profile->state & INPUT_RESERVED) == 0;
}

} // namespace mfx

