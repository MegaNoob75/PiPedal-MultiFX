#include "ControllerHardware.h"

#include <stddef.h>
#include <string.h>

#if defined(ARDUINO_ARCH_ESP32)
#include <Preferences.h>
#else
#include <EEPROM.h>
#endif

namespace mfx {

namespace {

constexpr uint32_t DEBOUNCE_MS = 25;
constexpr uint32_t LEARN_TIMEOUT_MS = 30000;
constexpr uint32_t MODULE_REFRESH_US = 1000;
constexpr uint32_t ANALOG_SAMPLE_US = 1000;
constexpr uint16_t ANALOG_SEND_DEADBAND = 8;
constexpr uint8_t SWITCH_ACTIVE_LOW = 0x01;
constexpr uint8_t SWITCH_PULLUP = 0x02;
constexpr uint8_t ANALOG_INVERTED = 0x01;
constexpr uint8_t ENCODER_REVERSED = 0x01;

/** Return the channel count implemented by a module driver. */
uint8_t moduleChannelCount(uint8_t driver) {
    switch (driver) {
        case DRIVER_HC4051: return 8;
        case DRIVER_HC4067:
        case DRIVER_MCP23017: return 16;
        case DRIVER_ADS1015:
        case DRIVER_ADS1115: return 4;
        default: return 0;
    }
}

/** Return the descriptor source type associated with one module driver. */
uint8_t sourceTypeForDriver(uint8_t driver) {
    if (driver == DRIVER_HC4051 || driver == DRIVER_HC4067) return SOURCE_MUX;
    if (driver == DRIVER_MCP23017) return SOURCE_GPIO_EXPANDER;
    if (driver == DRIVER_ADS1015 || driver == DRIVER_ADS1115) return SOURCE_EXTERNAL_ADC;
    return SOURCE_DISABLED;
}

/** Test whether the driver can produce a requested input capability. */
bool driverSupports(uint8_t driver, uint8_t capability) {
    if (driver == DRIVER_HC4051 || driver == DRIVER_HC4067) {
        return capability == CAP_DIGITAL || capability == CAP_ANALOG;
    }
    if (driver == DRIVER_MCP23017) return capability == CAP_DIGITAL;
    return (driver == DRIVER_ADS1015 || driver == DRIVER_ADS1115)
        && capability == CAP_ANALOG;
}

/** Read a big-endian 16-bit value from an I2C register. */
bool readI2cWord(uint8_t address, uint8_t reg, uint16_t &value) {
    Wire.beginTransmission(address);
    Wire.write(reg);
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(address, static_cast<uint8_t>(2)) != 2) return false;
    value = static_cast<uint16_t>(Wire.read()) << 8;
    value |= static_cast<uint16_t>(Wire.read());
    return true;
}

/** Write a big-endian 16-bit value to an I2C register. */
bool writeI2cWord(uint8_t address, uint8_t reg, uint16_t value) {
    Wire.beginTransmission(address);
    Wire.write(reg);
    Wire.write(static_cast<uint8_t>(value >> 8));
    Wire.write(static_cast<uint8_t>(value & 0xFF));
    return Wire.endTransmission() == 0;
}

} // namespace

void ControllerHardware::begin(
    SendControlChange sendCc,
    SendLearnResult sendLearn
) {
    sendCc_ = sendCc;
    sendLearn_ = sendLearn;
    analogReadResolution(12);
#if defined(ARDUINO_ARCH_ESP32)
    analogSetAttenuation(ADC_11db);
#elif defined(ARDUINO_ARCH_RP2040)
    EEPROM.begin(sizeof(ControllerConfig));
#endif

    ControllerConfig loaded;
    uint8_t detail = 0;
    if (!loadStoredConfig(loaded)
        || validateConfig(loaded, detail) != CONFIG_APPLIED) {
        makeFactoryConfig(loaded);

#if defined(ARDUINO_ARCH_ESP32)
        // Import only the old v0.2 direct switch map when no v3 configuration
        // exists. This preserves a user's custom footswitch pins after flash.
        Preferences legacy;
        if (legacy.begin("mfxpins", true)) {
            bool claimed[127] = {};
            for (uint8_t index = 0; index < MAX_SWITCHES; ++index) {
                char key[5];
                snprintf(key, sizeof(key), "p%u", index + 1);
                const uint8_t fallback = loaded.switches[index].source.enabled()
                    ? loaded.switches[index].source.channel
                    : DISABLED_VALUE;
                const uint8_t pin = legacy.getUChar(key, fallback);
                if (pin == DISABLED_VALUE) {
                    loaded.switches[index].source = SourceAddress{};
                } else if (pin < 127 && !claimed[pin]
                    && boardPinSupports(pin, CAP_DIGITAL)) {
                    loaded.switches[index].source = {SOURCE_GPIO, 0, pin};
                    claimed[pin] = true;
                }
            }
            legacy.end();
        }
#endif
        saveStoredConfig(loaded);
    }
    activateConfig(loaded);
}

void ControllerHardware::update() {
    refreshDigitalModules();
    updateEncoders();
    updateAnalogControls();
    if (learn_.active) updateLearn();
    else updateSwitches();
}

void ControllerHardware::makeFactoryConfig(ControllerConfig &config) const {
    memset(&config, 0, sizeof(config));
    config.magic = CONFIG_MAGIC;
    config.version = STORED_CONFIG_VERSION;
    config.switchCount = MAX_SWITCHES;

#if defined(ARDUINO_ARCH_ESP32)
    const uint8_t switchPins[] = {6, 7, 15, 16, 1, 2, 4, 5};
    const uint8_t analogPins[] = {8, 12, 13, 11};
    const uint8_t encoderPins[] = {18, 17, 21};
#elif defined(ARDUINO_ARCH_RP2040)
    const uint8_t switchPins[] = {2, 3, 4, 5, 6, 7, 8, 9};
    const uint8_t analogPins[] = {26, 27, 28};
    const uint8_t encoderPins[] = {10, 11, 12};
#else
    const uint8_t switchPins[] = {2, 3, 4, 5, 6, 7, 8, 9};
    const uint8_t analogPins[] = {14, 15, 16, 17};
    const uint8_t encoderPins[] = {10, 11, 12};
#endif

    for (uint8_t index = 0; index < MAX_SWITCHES; ++index) {
        config.switches[index].source = SourceAddress{};
        config.switches[index].flags = SWITCH_ACTIVE_LOW | SWITCH_PULLUP;
    }
    for (uint8_t index = 0; index < sizeof(switchPins); ++index) {
        config.switches[index].source = {SOURCE_GPIO, 0, switchPins[index]};
    }

    config.analogCount = sizeof(analogPins);
    for (uint8_t index = 0; index < config.analogCount; ++index) {
        AnalogConfig &analog = config.analogs[index];
        analog.source = {SOURCE_GPIO, 0, analogPins[index]};
        analog.midiCc = 10 + index;
        analog.filterShift = 4;
        analog.calibrationMin = 0;
        analog.calibrationMax = 4095;
    }

    config.encoderCount = 1;
    config.encoders[0].a = {SOURCE_GPIO, 0, encoderPins[0]};
    config.encoders[0].b = {SOURCE_GPIO, 0, encoderPins[1]};
    config.encoders[0].button = {SOURCE_GPIO, 0, encoderPins[2]};
    config.encoders[0].turnCc = 30;
    config.encoders[0].buttonCc = 31;
    config.encoders[0].stepsPerDetent = 4;
}

uint32_t ControllerHardware::calculateChecksum(const ControllerConfig &config) const {
    const uint8_t *bytes = reinterpret_cast<const uint8_t *>(&config);
    const size_t length = offsetof(ControllerConfig, checksum);
    uint32_t crc = 0xFFFFFFFFUL;
    for (size_t index = 0; index < length; ++index) {
        crc ^= bytes[index];
        for (uint8_t bit = 0; bit < 8; ++bit) {
            crc = (crc >> 1) ^ (0xEDB88320UL & (0UL - (crc & 1UL)));
        }
    }
    return ~crc;
}

bool ControllerHardware::loadStoredConfig(ControllerConfig &config) {
#if defined(ARDUINO_ARCH_ESP32)
    Preferences preferences;
    if (!preferences.begin("mfxhw", true)) return false;
    const bool sizeMatches = preferences.getBytesLength("config") == sizeof(config);
    const size_t read = sizeMatches
        ? preferences.getBytes("config", &config, sizeof(config))
        : 0;
    preferences.end();
    if (read != sizeof(config)) return false;
#else
    EEPROM.get(0, config);
#endif
    return config.magic == CONFIG_MAGIC
        && config.version == STORED_CONFIG_VERSION
        && config.checksum == calculateChecksum(config);
}

bool ControllerHardware::saveStoredConfig(const ControllerConfig &config) {
    ControllerConfig stored = config;
    stored.magic = CONFIG_MAGIC;
    stored.version = STORED_CONFIG_VERSION;
    stored.checksum = calculateChecksum(stored);
#if defined(ARDUINO_ARCH_ESP32)
    Preferences preferences;
    if (!preferences.begin("mfxhw", false)) return false;
    const size_t written = preferences.putBytes("config", &stored, sizeof(stored));
    preferences.end();
    return written == sizeof(stored);
#else
    EEPROM.put(0, stored);
#if defined(ARDUINO_ARCH_RP2040)
    return EEPROM.commit();
#else
    return true;
#endif
#endif
}

uint8_t ControllerHardware::validateConfig(
    const ControllerConfig &config,
    uint8_t &detail
) const {
    detail = 0;
    if (config.moduleCount > MAX_MODULES
        || config.switchCount != MAX_SWITCHES
        || config.analogCount > MAX_ANALOG_CONTROLS
        || config.encoderCount > MAX_ENCODERS) {
        return CONFIG_INCOMPLETE;
    }

    bool pinClaimed[127] = {};
    bool moduleChannelClaimed[MAX_MODULES][MAX_MODULE_CHANNELS] = {};
    bool i2cConfigured = false;
    uint8_t i2cSda = DISABLED_VALUE;
    uint8_t i2cScl = DISABLED_VALUE;
    bool i2cAddresses[128] = {};

    auto claimPin = [&](uint8_t pin, uint8_t capability) -> uint8_t {
        if (pin >= 127 || !boardPinSupports(pin, capability)) {
            detail = pin;
            return CONFIG_INCOMPATIBLE_SOURCE;
        }
        if (pinClaimed[pin]) {
            detail = pin;
            return CONFIG_RESOURCE_CONFLICT;
        }
        pinClaimed[pin] = true;
        return CONFIG_APPLIED;
    };

    for (uint8_t index = 0; index < config.moduleCount; ++index) {
        const ModuleConfig &module = config.modules[index];
        if (moduleChannelCount(module.driver) == 0) {
            detail = index + 1;
            return CONFIG_INVALID_MODULE;
        }
        if (module.driver == DRIVER_HC4051 || module.driver == DRIVER_HC4067) {
            uint8_t result = claimPin(module.pins[0], CAP_DIGITAL);
            if (result != CONFIG_APPLIED) return result;
            const uint8_t selectCount = module.driver == DRIVER_HC4051 ? 3 : 4;
            for (uint8_t pinIndex = 0; pinIndex < selectCount; ++pinIndex) {
                result = claimPin(module.pins[1 + pinIndex], CAP_OUTPUT);
                if (result != CONFIG_APPLIED) return result;
            }
            if (module.pins[5] != DISABLED_VALUE) {
                result = claimPin(module.pins[5], CAP_OUTPUT);
                if (result != CONFIG_APPLIED) return result;
            }
        } else {
            const bool validAddress = module.driver == DRIVER_MCP23017
                ? module.address >= 0x20 && module.address <= 0x27
                : module.address >= 0x48 && module.address <= 0x4B;
            if (!validAddress || i2cAddresses[module.address]) {
                detail = index + 1;
                return CONFIG_INVALID_MODULE;
            }
            i2cAddresses[module.address] = true;
            if (!i2cConfigured) {
                uint8_t result = claimPin(module.pins[0], CAP_OUTPUT);
                if (result != CONFIG_APPLIED) return result;
                result = claimPin(module.pins[1], CAP_OUTPUT);
                if (result != CONFIG_APPLIED) return result;
                i2cSda = module.pins[0];
                i2cScl = module.pins[1];
                i2cConfigured = true;
            } else if (module.pins[0] != i2cSda || module.pins[1] != i2cScl) {
                detail = index + 1;
                return CONFIG_INVALID_MODULE;
            }
        }
    }

    auto claimSource = [&](const SourceAddress &source, uint8_t capability) -> uint8_t {
        if (!source.enabled()) return CONFIG_APPLIED;
        if (source.type == SOURCE_GPIO) return claimPin(source.channel, capability);
        if (source.instance < 1 || source.instance > config.moduleCount) {
            detail = source.instance;
            return CONFIG_INCOMPATIBLE_SOURCE;
        }
        const uint8_t moduleIndex = source.instance - 1;
        const ModuleConfig &module = config.modules[moduleIndex];
        if (source.type != sourceTypeForDriver(module.driver)
            || source.channel >= moduleChannelCount(module.driver)
            || !driverSupports(module.driver, capability)) {
            detail = source.instance;
            return CONFIG_INCOMPATIBLE_SOURCE;
        }
        if (moduleChannelClaimed[moduleIndex][source.channel]) {
            detail = source.channel;
            return CONFIG_RESOURCE_CONFLICT;
        }
        moduleChannelClaimed[moduleIndex][source.channel] = true;
        return CONFIG_APPLIED;
    };

    for (uint8_t index = 0; index < MAX_SWITCHES; ++index) {
        const uint8_t result = claimSource(config.switches[index].source, CAP_DIGITAL);
        if (result != CONFIG_APPLIED) return result;
    }
    bool midiCcClaimed[120] = {};
    for (uint8_t index = 0; index < config.analogCount; ++index) {
        const AnalogConfig &analog = config.analogs[index];
        uint8_t result = claimSource(analog.source, CAP_ANALOG);
        if (result != CONFIG_APPLIED) return result;
        if (!analog.source.enabled() || analog.midiCc >= 120
            || midiCcClaimed[analog.midiCc]
            || analog.filterShift > 7
            || analog.calibrationMin >= analog.calibrationMax
            || analog.calibrationMax > 4095) {
            detail = index + 1;
            return CONFIG_INCOMPATIBLE_SOURCE;
        }
        midiCcClaimed[analog.midiCc] = true;
    }
    for (uint8_t index = 0; index < config.encoderCount; ++index) {
        const EncoderConfig &encoder = config.encoders[index];
        uint8_t result = claimSource(encoder.a, CAP_DIGITAL);
        if (result != CONFIG_APPLIED) return result;
        result = claimSource(encoder.b, CAP_DIGITAL);
        if (result != CONFIG_APPLIED) return result;
        result = claimSource(encoder.button, CAP_DIGITAL);
        if (result != CONFIG_APPLIED) return result;
        if (encoder.turnCc >= 120 || encoder.buttonCc >= 120
            || midiCcClaimed[encoder.turnCc] || midiCcClaimed[encoder.buttonCc]
            || encoder.turnCc == encoder.buttonCc
            || encoder.stepsPerDetent < 1 || encoder.stepsPerDetent > 4) {
            detail = index + 1;
            return CONFIG_INCOMPATIBLE_SOURCE;
        }
        midiCcClaimed[encoder.turnCc] = true;
        midiCcClaimed[encoder.buttonCc] = true;
    }
    return CONFIG_APPLIED;
}

void ControllerHardware::activateConfig(const ControllerConfig &config) {
    if (learn_.active) learn_.active = false;
    active_ = config;
    active_.magic = CONFIG_MAGIC;
    active_.version = STORED_CONFIG_VERSION;
    memset(switchRuntime_, 0, sizeof(switchRuntime_));
    memset(analogRuntime_, 0, sizeof(analogRuntime_));
    memset(encoderRuntime_, 0, sizeof(encoderRuntime_));
    memset(moduleDigitalCacheValid_, 0, sizeof(moduleDigitalCacheValid_));
    beginModules();

    for (uint8_t index = 0; index < MAX_SWITCHES; ++index) {
        const SwitchConfig &item = active_.switches[index];
        beginDigitalSource(item.source, (item.flags & SWITCH_PULLUP) != 0);
        if (item.source.enabled()) {
            const bool pressed = switchPressed(item);
            switchRuntime_[index].rawPressed = pressed;
            switchRuntime_[index].stablePressed = pressed;
            switchRuntime_[index].rawChangedAt = millis();
        }
    }
    for (uint8_t index = 0; index < active_.encoderCount; ++index) {
        const EncoderConfig &encoder = active_.encoders[index];
        beginDigitalSource(encoder.a, true);
        beginDigitalSource(encoder.b, true);
        beginDigitalSource(encoder.button, true);
        encoderRuntime_[index].previousAb =
            (readDigitalSource(encoder.a) ? 2 : 0)
            | (readDigitalSource(encoder.b) ? 1 : 0);
        if (encoder.button.enabled()) {
            const bool pressed = !readDigitalSource(encoder.button);
            encoderRuntime_[index].buttonRaw = pressed;
            encoderRuntime_[index].buttonStable = pressed;
            encoderRuntime_[index].buttonChangedAt = millis();
        }
    }
    lastModuleRefreshAt_ = micros();
    lastAnalogSampleAt_ = micros();
    nextAnalogIndex_ = 0;
}

void ControllerHardware::beginModules() {
    bool wireStarted = false;
    for (uint8_t index = 0; index < active_.moduleCount; ++index) {
        const ModuleConfig &module = active_.modules[index];
        if (module.driver == DRIVER_HC4051 || module.driver == DRIVER_HC4067) {
            const uint8_t selectCount = module.driver == DRIVER_HC4051 ? 3 : 4;
            for (uint8_t pinIndex = 0; pinIndex < selectCount; ++pinIndex) {
                pinMode(module.pins[1 + pinIndex], OUTPUT);
                digitalWrite(module.pins[1 + pinIndex], LOW);
            }
            if (module.pins[5] != DISABLED_VALUE) {
                pinMode(module.pins[5], OUTPUT);
                digitalWrite(module.pins[5], LOW);
            }
        } else {
            if (!wireStarted) {
#if defined(ARDUINO_ARCH_ESP32)
                Wire.begin(module.pins[0], module.pins[1]);
#else
                Wire.begin();
#endif
                wireStarted = true;
            }
            if (module.driver == DRIVER_MCP23017) {
                writeMcpRegister(module, 0x00, 0xFFFF); // IODIRA/B: inputs
                writeMcpRegister(module, 0x0C, 0xFFFF); // GPPUA/B: pull-ups
            }
        }
    }
}

void ControllerHardware::beginDigitalSource(
    const SourceAddress &source,
    bool pullup
) {
    if (!source.enabled()) return;
    if (source.type == SOURCE_GPIO) {
        pinMode(source.channel, pullup ? INPUT_PULLUP : INPUT);
    }
}

void ControllerHardware::refreshDigitalModules() {
    const uint32_t now = micros();
    if (static_cast<uint32_t>(now - lastModuleRefreshAt_) < MODULE_REFRESH_US) return;
    lastModuleRefreshAt_ = now;
    for (uint8_t index = 0; index < active_.moduleCount; ++index) {
        if (active_.modules[index].driver == DRIVER_MCP23017) {
            moduleDigitalCacheValid_[index] = readMcp23017(
                active_.modules[index], moduleDigitalCache_[index]
            );
        }
    }
}

void ControllerHardware::selectMuxChannel(
    const ModuleConfig &module,
    uint8_t channel
) {
    const uint8_t selectCount = module.driver == DRIVER_HC4051 ? 3 : 4;
    for (uint8_t index = 0; index < selectCount; ++index) {
        digitalWrite(module.pins[1 + index], (channel & (1U << index)) ? HIGH : LOW);
    }
    delayMicroseconds(4);
}

bool ControllerHardware::readDigitalSource(const SourceAddress &source) {
    if (!source.enabled()) return true;
    if (source.type == SOURCE_GPIO) return digitalRead(source.channel) == HIGH;
    if (source.instance < 1 || source.instance > active_.moduleCount) return true;
    const uint8_t moduleIndex = source.instance - 1;
    const ModuleConfig &module = active_.modules[moduleIndex];
    if (source.type == SOURCE_MUX) {
        selectMuxChannel(module, source.channel);
        pinMode(module.pins[0], INPUT_PULLUP);
        return digitalRead(module.pins[0]) == HIGH;
    }
    if (source.type == SOURCE_GPIO_EXPANDER
        && moduleDigitalCacheValid_[moduleIndex]) {
        return (moduleDigitalCache_[moduleIndex] & (1U << source.channel)) != 0;
    }
    return true;
}

uint16_t ControllerHardware::readAnalogSource(const SourceAddress &source) {
    if (!source.enabled()) return 0;
    if (source.type == SOURCE_GPIO) return analogRead(source.channel);
    if (source.instance < 1 || source.instance > active_.moduleCount) return 0;
    const ModuleConfig &module = active_.modules[source.instance - 1];
    if (source.type == SOURCE_MUX) {
        selectMuxChannel(module, source.channel);
        pinMode(module.pins[0], INPUT);
        return analogRead(module.pins[0]);
    }
    if (source.type == SOURCE_EXTERNAL_ADC) {
        return readAds1x15(module, source.channel);
    }
    return 0;
}

bool ControllerHardware::writeMcpRegister(
    const ModuleConfig &module,
    uint8_t reg,
    uint16_t value
) {
    // MCP23017 sequential register pairs are little-endian (A then B).
    Wire.beginTransmission(module.address);
    Wire.write(reg);
    Wire.write(static_cast<uint8_t>(value & 0xFF));
    Wire.write(static_cast<uint8_t>(value >> 8));
    return Wire.endTransmission() == 0;
}

bool ControllerHardware::readMcp23017(
    const ModuleConfig &module,
    uint16_t &value
) {
    Wire.beginTransmission(module.address);
    Wire.write(static_cast<uint8_t>(0x12)); // GPIOA, then GPIOB
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(module.address, static_cast<uint8_t>(2)) != 2) return false;
    value = static_cast<uint16_t>(Wire.read());
    value |= static_cast<uint16_t>(Wire.read()) << 8;
    return true;
}

uint16_t ControllerHardware::readAds1x15(
    const ModuleConfig &module,
    uint8_t channel
) {
    if (channel >= 4) return 0;
    // Single-shot, single-ended, +/-4.096 V, fastest supported data rate,
    // comparator disabled. Controller inputs must still remain within 3.3 V.
    const uint16_t config = static_cast<uint16_t>(
        0x8000U | ((4U + channel) << 12) | 0x0200U | 0x0100U | 0x00E0U | 0x0003U
    );
    if (!writeI2cWord(module.address, 0x01, config)) return 0;
    delayMicroseconds(module.driver == DRIVER_ADS1015 ? 400 : 1300);
    uint16_t rawWord = 0;
    if (!readI2cWord(module.address, 0x00, rawWord)) return 0;
    int32_t raw = static_cast<int16_t>(rawWord);
    if (module.driver == DRIVER_ADS1015) {
        raw >>= 4;
        // At the selected +/-4.096 V gain, 3.3 V is about code 1650. Normalize
        // the controller's safe 0..3.3 V electrical range to the same 0..4095
        // calibration range used by direct board ADCs.
        raw = constrain(raw, 0, 1650);
        return static_cast<uint16_t>((raw * 4095L) / 1650L);
    }
    raw = constrain(raw, 0, 26400);
    return static_cast<uint16_t>((raw * 4095L) / 26400L);
}

bool ControllerHardware::switchPressed(const SwitchConfig &item) {
    const bool high = readDigitalSource(item.source);
    return (item.flags & SWITCH_ACTIVE_LOW) ? !high : high;
}

void ControllerHardware::updateSwitches() {
    const uint32_t now = millis();
    for (uint8_t index = 0; index < MAX_SWITCHES; ++index) {
        const SwitchConfig &item = active_.switches[index];
        if (!item.source.enabled()) continue;
        SwitchRuntime &runtime = switchRuntime_[index];
        const bool pressed = switchPressed(item);
        if (pressed != runtime.rawPressed) {
            runtime.rawPressed = pressed;
            runtime.rawChangedAt = now;
        }
        if (runtime.rawPressed != runtime.stablePressed
            && static_cast<uint32_t>(now - runtime.rawChangedAt) >= DEBOUNCE_MS) {
            runtime.stablePressed = runtime.rawPressed;
            if (sendCc_) sendCc_(FIRST_SWITCH_CC + index, runtime.stablePressed ? 127 : 0);
        }
    }
}

void ControllerHardware::updateEncoders() {
    static constexpr int8_t QUADRATURE[16] = {
         0, -1,  1,  0,
         1,  0,  0, -1,
        -1,  0,  0,  1,
         0,  1, -1,  0,
    };
    const uint32_t now = millis();
    for (uint8_t index = 0; index < active_.encoderCount; ++index) {
        const EncoderConfig &encoder = active_.encoders[index];
        EncoderRuntime &runtime = encoderRuntime_[index];
        const uint8_t current = (readDigitalSource(encoder.a) ? 2 : 0)
            | (readDigitalSource(encoder.b) ? 1 : 0);
        int8_t delta = QUADRATURE[(runtime.previousAb << 2) | current];
        runtime.previousAb = current;
        if (encoder.flags & ENCODER_REVERSED) delta = -delta;
        runtime.transitionAccumulator += delta;
        const int8_t threshold = encoder.stepsPerDetent;
        while (runtime.transitionAccumulator >= threshold) {
            runtime.transitionAccumulator -= threshold;
            if (sendCc_) sendCc_(encoder.turnCc, 1);
        }
        while (runtime.transitionAccumulator <= -threshold) {
            runtime.transitionAccumulator += threshold;
            if (sendCc_) sendCc_(encoder.turnCc, 127);
        }

        if (!encoder.button.enabled()) continue;
        const bool pressed = !readDigitalSource(encoder.button);
        if (pressed != runtime.buttonRaw) {
            runtime.buttonRaw = pressed;
            runtime.buttonChangedAt = now;
        }
        if (runtime.buttonRaw != runtime.buttonStable
            && static_cast<uint32_t>(now - runtime.buttonChangedAt) >= DEBOUNCE_MS) {
            runtime.buttonStable = runtime.buttonRaw;
            if (sendCc_) sendCc_(encoder.buttonCc, pressed ? 127 : 0);
        }
    }
}

void ControllerHardware::updateAnalogControls() {
    if (active_.analogCount == 0) return;
    const uint32_t now = micros();
    if (static_cast<uint32_t>(now - lastAnalogSampleAt_) < ANALOG_SAMPLE_US) return;
    lastAnalogSampleAt_ = now;
    if (nextAnalogIndex_ >= active_.analogCount) nextAnalogIndex_ = 0;
    const uint8_t index = nextAnalogIndex_++;
    const AnalogConfig &analog = active_.analogs[index];
    AnalogRuntime &runtime = analogRuntime_[index];
    const uint16_t raw = readAnalogSource(analog.source);
    if (!runtime.initialized) {
        runtime.initialized = true;
        runtime.filtered = raw;
        runtime.lastSentRaw = raw;
    } else if (analog.filterShift == 0) {
        runtime.filtered = raw;
    } else {
        runtime.filtered += (static_cast<int32_t>(raw) - runtime.filtered)
            >> analog.filterShift;
    }

    const uint16_t filtered = constrain(runtime.filtered, 0, 4095);
    const uint16_t clamped = constrain(
        filtered, analog.calibrationMin, analog.calibrationMax
    );
    uint8_t midiValue = static_cast<uint8_t>(
        (static_cast<uint32_t>(clamped - analog.calibrationMin) * 127U)
        / (analog.calibrationMax - analog.calibrationMin)
    );
    if (analog.flags & ANALOG_INVERTED) midiValue = 127 - midiValue;
    if (!runtime.initialized) return;
    if (midiValue == runtime.lastMidi) return;
    const uint16_t movement = filtered > runtime.lastSentRaw
        ? filtered - runtime.lastSentRaw
        : runtime.lastSentRaw - filtered;
    if (movement < ANALOG_SEND_DEADBAND) return;
    runtime.lastMidi = midiValue;
    runtime.lastSentRaw = filtered;
    if (sendCc_) sendCc_(analog.midiCc, midiValue);
}

bool ControllerHardware::beginTransaction(
    uint8_t token,
    uint8_t modules,
    uint8_t switches,
    uint8_t analogs,
    uint8_t encoders
) {
    if (token == 0 || token >= 127 || modules > MAX_MODULES
        || switches != MAX_SWITCHES || analogs > MAX_ANALOG_CONTROLS
        || encoders > MAX_ENCODERS) return false;
    memset(&transaction_, 0, sizeof(transaction_));
    transaction_.active = true;
    transaction_.token = token;
    transaction_.expectedModules = modules;
    transaction_.expectedSwitches = switches;
    transaction_.expectedAnalogs = analogs;
    transaction_.expectedEncoders = encoders;
    transaction_.draft.magic = CONFIG_MAGIC;
    transaction_.draft.version = STORED_CONFIG_VERSION;
    transaction_.draft.moduleCount = modules;
    transaction_.draft.switchCount = switches;
    transaction_.draft.analogCount = analogs;
    transaction_.draft.encoderCount = encoders;
    for (auto &item : transaction_.draft.switches) item.source = SourceAddress{};
    return true;
}

bool ControllerHardware::setTransactionModule(
    uint8_t token,
    uint8_t index,
    const ModuleConfig &module
) {
    if (!transaction_.active || token != transaction_.token
        || index < 1 || index > transaction_.expectedModules) return false;
    transaction_.draft.modules[index - 1] = module;
    transaction_.moduleReceived[index - 1] = true;
    return true;
}

bool ControllerHardware::setTransactionSwitch(
    uint8_t token,
    uint8_t index,
    const SwitchConfig &item
) {
    if (!transaction_.active || token != transaction_.token
        || index < 1 || index > transaction_.expectedSwitches) return false;
    transaction_.draft.switches[index - 1] = item;
    transaction_.switchReceived[index - 1] = true;
    return true;
}

bool ControllerHardware::setTransactionAnalog(
    uint8_t token,
    uint8_t index,
    const AnalogConfig &item
) {
    if (!transaction_.active || token != transaction_.token
        || index < 1 || index > transaction_.expectedAnalogs) return false;
    transaction_.draft.analogs[index - 1] = item;
    transaction_.analogReceived[index - 1] = true;
    return true;
}

bool ControllerHardware::setTransactionEncoder(
    uint8_t token,
    uint8_t index,
    const EncoderConfig &item
) {
    if (!transaction_.active || token != transaction_.token
        || index < 1 || index > transaction_.expectedEncoders) return false;
    transaction_.draft.encoders[index - 1] = item;
    transaction_.encoderReceived[index - 1] = true;
    return true;
}

uint8_t ControllerHardware::commitTransaction(uint8_t token, uint8_t &detail) {
    detail = 0;
    if (!transaction_.active || token != transaction_.token) return CONFIG_INCOMPLETE;
    for (uint8_t index = 0; index < transaction_.expectedModules; ++index) {
        if (!transaction_.moduleReceived[index]) { detail = index + 1; return CONFIG_INCOMPLETE; }
    }
    for (uint8_t index = 0; index < transaction_.expectedSwitches; ++index) {
        if (!transaction_.switchReceived[index]) { detail = index + 1; return CONFIG_INCOMPLETE; }
    }
    for (uint8_t index = 0; index < transaction_.expectedAnalogs; ++index) {
        if (!transaction_.analogReceived[index]) { detail = index + 1; return CONFIG_INCOMPLETE; }
    }
    for (uint8_t index = 0; index < transaction_.expectedEncoders; ++index) {
        if (!transaction_.encoderReceived[index]) { detail = index + 1; return CONFIG_INCOMPLETE; }
    }
    const uint8_t validation = validateConfig(transaction_.draft, detail);
    if (validation != CONFIG_APPLIED) {
        transaction_.active = false;
        return validation;
    }
    const ControllerConfig accepted = transaction_.draft;
    transaction_.active = false;
    if (!saveStoredConfig(accepted)) return CONFIG_STORAGE_ERROR;
    activateConfig(accepted);
    return CONFIG_APPLIED;
}

bool ControllerHardware::applyLegacySwitchPins(const uint8_t pins[MAX_SWITCHES]) {
    ControllerConfig proposed = active_;
    for (uint8_t index = 0; index < MAX_SWITCHES; ++index) {
        proposed.switches[index].source = pins[index] == DISABLED_VALUE
            ? SourceAddress{}
            : SourceAddress{SOURCE_GPIO, 0, pins[index]};
        proposed.switches[index].flags = SWITCH_ACTIVE_LOW | SWITCH_PULLUP;
    }
    uint8_t detail = 0;
    if (validateConfig(proposed, detail) != CONFIG_APPLIED) return false;
    if (!saveStoredConfig(proposed)) return false;
    activateConfig(proposed);
    return true;
}

bool ControllerHardware::sameSource(
    const SourceAddress &left,
    const SourceAddress &right
) {
    return left.enabled() && right.enabled()
        && left.type == right.type
        && left.instance == right.instance
        && left.channel == right.channel;
}

uint8_t ControllerHardware::assignedSwitch(const SourceAddress &source) const {
    for (uint8_t index = 0; index < MAX_SWITCHES; ++index) {
        if (sameSource(active_.switches[index].source, source)) return index + 1;
    }
    return 0;
}

bool ControllerHardware::describeSource(
    const SourceAddress &source,
    SourceDescriptor &descriptor
) const {
    descriptor = SourceDescriptor{};
    descriptor.source = source;
    if (source.type == SOURCE_GPIO) {
        const PinProfile *profile = findBoardPin(source.channel);
        if (!profile) return false;
        descriptor.capabilities = profile->capabilities;
        descriptor.state = profile->state;
        descriptor.reason = profile->reason;
        if (profile->state & INPUT_RESERVED) {
            descriptor.usage = profile->reason == 4 ? USAGE_USB : USAGE_SYSTEM;
        }
        for (uint8_t moduleIndex = 0; moduleIndex < active_.moduleCount; ++moduleIndex) {
            const ModuleConfig &module = active_.modules[moduleIndex];
            for (uint8_t pinIndex = 0; pinIndex < 6; ++pinIndex) {
                if (module.pins[pinIndex] == source.channel) {
                    descriptor.state |= INPUT_ASSIGNED;
                    descriptor.usage = USAGE_SYSTEM;
                    descriptor.usageIndex = moduleIndex + 1;
                }
            }
        }
    } else {
        if (source.instance < 1 || source.instance > active_.moduleCount) return false;
        const ModuleConfig &module = active_.modules[source.instance - 1];
        if (source.type != sourceTypeForDriver(module.driver)
            || source.channel >= moduleChannelCount(module.driver)) return false;
        descriptor.capabilities = driverSupports(module.driver, CAP_DIGITAL) ? CAP_DIGITAL : 0;
        if (driverSupports(module.driver, CAP_ANALOG)) descriptor.capabilities |= CAP_ANALOG;
    }

    const uint8_t switchNumber = assignedSwitch(source);
    if (switchNumber) {
        descriptor.state |= INPUT_ASSIGNED;
        descriptor.usage = USAGE_SWITCH;
        descriptor.usageIndex = switchNumber;
    }
    for (uint8_t index = 0; index < active_.analogCount; ++index) {
        if (sameSource(active_.analogs[index].source, source)) {
            descriptor.state |= INPUT_ASSIGNED;
            descriptor.usage = USAGE_POT;
            descriptor.usageIndex = index + 1;
        }
    }
    for (uint8_t index = 0; index < active_.encoderCount; ++index) {
        if (sameSource(active_.encoders[index].a, source)
            || sameSource(active_.encoders[index].b, source)) {
            descriptor.state |= INPUT_ASSIGNED;
            descriptor.usage = USAGE_ENCODER;
            descriptor.usageIndex = sameSource(active_.encoders[index].a, source) ? 1 : 2;
        } else if (sameSource(active_.encoders[index].button, source)) {
            descriptor.state |= INPUT_ASSIGNED;
            descriptor.usage = USAGE_ENCODER_PUSH;
            descriptor.usageIndex = index + 1;
        }
    }
    if ((descriptor.state & (INPUT_RESERVED | INPUT_ASSIGNED)) == 0) {
        descriptor.state |= INPUT_AVAILABLE;
    }
    return descriptor.capabilities != 0;
}

void ControllerHardware::startLearn(
    uint8_t token,
    uint8_t requestedCapabilities,
    uint8_t targetSwitch
) {
    if (learn_.active) finishLearn(LEARN_CANCELLED, SourceAddress{});
    if (token == 0 || token >= 127 || !(requestedCapabilities & CAP_DIGITAL)
        || targetSwitch < 1 || targetSwitch > MAX_SWITCHES) {
        if (sendLearn_) sendLearn_(token, LEARN_ERROR, SourceAddress{});
        return;
    }
    memset(&learn_, 0, sizeof(learn_));
    learn_.active = true;
    learn_.token = token;
    learn_.targetSwitch = targetSwitch;
    learn_.startedAt = millis();
    prepareLearnCandidates();
    if (learn_.candidateCount == 0) finishLearn(LEARN_ERROR, SourceAddress{});
}

void ControllerHardware::cancelLearn(uint8_t token) {
    if (learn_.active && learn_.token == token) {
        finishLearn(LEARN_CANCELLED, SourceAddress{});
    }
}

void ControllerHardware::prepareLearnCandidates() {
    auto addCandidate = [&](const SourceAddress &source) {
        if (learn_.candidateCount >= 64) return;
        SourceDescriptor descriptor;
        if (!describeSource(source, descriptor)
            || !(descriptor.capabilities & CAP_DIGITAL)
            || (descriptor.state & INPUT_RESERVED)
            || descriptor.usage == USAGE_POT
            || descriptor.usage == USAGE_ENCODER
            || descriptor.usage == USAGE_ENCODER_PUSH
            || descriptor.usage == USAGE_SYSTEM) return;
        beginDigitalSource(source, true);
        LearnCandidate &candidate = learn_.candidates[learn_.candidateCount++];
        candidate.source = source;
        candidate.rawPressed = !readDigitalSource(source);
        candidate.stablePressed = candidate.rawPressed;
        candidate.armed = !candidate.rawPressed;
        candidate.rawChangedAt = learn_.startedAt;
    };

    for (const auto &pin : BOARD_PINS) {
        addCandidate({SOURCE_GPIO, 0, pin.pin});
    }
    for (uint8_t moduleIndex = 0; moduleIndex < active_.moduleCount; ++moduleIndex) {
        const ModuleConfig &module = active_.modules[moduleIndex];
        if (!driverSupports(module.driver, CAP_DIGITAL)) continue;
        const uint8_t sourceType = sourceTypeForDriver(module.driver);
        for (uint8_t channel = 0; channel < moduleChannelCount(module.driver); ++channel) {
            addCandidate({sourceType, static_cast<uint8_t>(moduleIndex + 1), channel});
        }
    }
}

void ControllerHardware::updateLearn() {
    const uint32_t now = millis();
    if (static_cast<uint32_t>(now - learn_.startedAt) >= LEARN_TIMEOUT_MS) {
        finishLearn(LEARN_TIMEOUT, SourceAddress{});
        return;
    }
    for (uint8_t index = 0; index < learn_.candidateCount; ++index) {
        LearnCandidate &candidate = learn_.candidates[index];
        const bool pressed = !readDigitalSource(candidate.source);
        if (pressed != candidate.rawPressed) {
            candidate.rawPressed = pressed;
            candidate.rawChangedAt = now;
        }
        if (candidate.rawPressed == candidate.stablePressed
            || static_cast<uint32_t>(now - candidate.rawChangedAt) < DEBOUNCE_MS) continue;
        candidate.stablePressed = candidate.rawPressed;
        if (!candidate.stablePressed) {
            candidate.armed = true;
            continue;
        }
        if (!candidate.armed) continue;
        const uint8_t switchNumber = assignedSwitch(candidate.source);
        const bool conflict = switchNumber != 0 && switchNumber != learn_.targetSwitch;
        finishLearn(conflict ? LEARN_CONFLICT : LEARNED, candidate.source);
        return;
    }
}

void ControllerHardware::finishLearn(
    uint8_t status,
    const SourceAddress &source
) {
    if (!learn_.active) return;
    const uint8_t token = learn_.token;
    learn_.active = false;
    // Reinitialize live sources so mux signal modes and switch debounce state
    // cannot inherit a transient Learn sample.
    activateConfig(active_);
    if (sendLearn_) sendLearn_(token, status, source);
}

} // namespace mfx
