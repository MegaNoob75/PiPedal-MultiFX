#pragma once

/*
 * Runtime-configurable physical controller engine.
 *
 * The engine owns source validation, common expansion-module drivers,
 * debouncing, encoder decoding, analog filtering, transient Learn, and
 * last-known-good storage. MIDI framing remains in the small .ino file.
 */

#include <Arduino.h>
#include <Wire.h>

#include "BoardProfile.h"
#include "ControllerProtocol.h"

namespace mfx {

using SendControlChange = void (*)(uint8_t cc, uint8_t value);
using SendLearnResult = void (*)(
    uint8_t token,
    uint8_t status,
    const SourceAddress &source,
    const SourceAddress &secondarySource
);

class ControllerHardware {
public:
    /** Load last-known-good configuration (or factory template) and start I/O. */
    void begin(SendControlChange sendCc, SendLearnResult sendLearn);

    /** Scan switches, encoders, analog controls, and an active Learn session. */
    void update();

    /** Start a transaction whose records cannot affect live I/O until commit. */
    bool beginTransaction(
        uint8_t token,
        uint8_t modules,
        uint8_t switches,
        uint8_t analogs,
        uint8_t encoders
    );

    /** Store one numbered module record in the temporary transaction. */
    bool setTransactionModule(uint8_t token, uint8_t index, const ModuleConfig &module);

    /** Store one logical switch source in the temporary transaction. */
    bool setTransactionSwitch(uint8_t token, uint8_t index, const SwitchConfig &item);

    /** Store one analog control in the temporary transaction. */
    bool setTransactionAnalog(uint8_t token, uint8_t index, const AnalogConfig &item);

    /** Store one encoder in the temporary transaction. */
    bool setTransactionEncoder(uint8_t token, uint8_t index, const EncoderConfig &item);

    /** Validate/apply/store a complete transaction and return ConfigStatus. */
    uint8_t commitTransaction(uint8_t token, uint8_t &detail);

    /** Keep legacy v1 bridge compatibility by replacing direct switch sources. */
    bool applyLegacySwitchPins(const uint8_t pins[MAX_SWITCHES]);

    /** Enter transient digital/analog Learn without modifying persistent configuration. */
    void startLearn(uint8_t token, uint8_t requestedCapabilities, uint8_t targetIndex);

    /** Cancel the matching Learn session, leaving live configuration untouched. */
    void cancelLearn(uint8_t token);

    /** True while normal logical switch MIDI is deliberately suppressed. */
    bool learnActive() const { return learn_.active; }

    /** Return the current validated configuration for profile reporting. */
    const ControllerConfig &config() const { return active_; }

    /** Describe capabilities, assignment, caution, and usage for one source. */
    bool describeSource(const SourceAddress &source, SourceDescriptor &descriptor) const;

private:
    struct SwitchRuntime {
        bool rawPressed = false;
        bool stablePressed = false;
        uint32_t rawChangedAt = 0;
    };

    struct AnalogRuntime {
        bool initialized = false;
        int32_t filtered = 0;
        uint16_t lastSentRaw = 0;
        uint8_t lastMidi = 0;
    };

    struct EncoderRuntime {
        uint8_t previousAb = 0;
        int8_t transitionAccumulator = 0;
        bool buttonRaw = false;
        bool buttonStable = false;
        uint32_t buttonChangedAt = 0;
    };

    struct LearnCandidate {
        SourceAddress source;
        uint16_t analogBaseline = 0;
        uint16_t analogLast = 0;
        uint16_t analogTravel = 0;
        int8_t analogDirection = 0;
        uint8_t analogConfirmations = 0;
        uint8_t encoderTransitions = 0;
        bool encoderLevel = true;
        bool rawPressed = false;
        bool stablePressed = false;
        bool armed = false;
        uint32_t rawChangedAt = 0;
    };

    struct LearnRuntime {
        bool active = false;
        uint8_t token = 0;
        uint8_t capability = 0;
        uint8_t targetIndex = 0;
        uint8_t candidateCount = 0;
        uint32_t startedAt = 0;
        LearnCandidate candidates[64];
    };

    struct Transaction {
        bool active = false;
        uint8_t token = 0;
        uint8_t expectedModules = 0;
        uint8_t expectedSwitches = 0;
        uint8_t expectedAnalogs = 0;
        uint8_t expectedEncoders = 0;
        bool moduleReceived[MAX_MODULES] = {};
        bool switchReceived[MAX_SWITCHES] = {};
        bool analogReceived[MAX_ANALOG_CONTROLS] = {};
        bool encoderReceived[MAX_ENCODERS] = {};
        ControllerConfig draft;
    };

    ControllerConfig active_;
    Transaction transaction_;
    SwitchRuntime switchRuntime_[MAX_SWITCHES];
    AnalogRuntime analogRuntime_[MAX_ANALOG_CONTROLS];
    EncoderRuntime encoderRuntime_[MAX_ENCODERS];
    LearnRuntime learn_;
    uint16_t moduleDigitalCache_[MAX_MODULES] = {};
    bool moduleDigitalCacheValid_[MAX_MODULES] = {};
    SendControlChange sendCc_ = nullptr;
    SendLearnResult sendLearn_ = nullptr;
    uint32_t lastModuleRefreshAt_ = 0;
    uint32_t lastAnalogSampleAt_ = 0;
    uint8_t nextAnalogIndex_ = 0;

    /** Fill the built-in template matching the original ESP32-S3 controller. */
    void makeFactoryConfig(ControllerConfig &config) const;

    /** Load and checksum-check stored bytes; returns false for missing/corrupt data. */
    bool loadStoredConfig(ControllerConfig &config);

    /** Store a checksum-protected configuration after successful validation. */
    bool saveStoredConfig(const ControllerConfig &config);

    /** Calculate the checksum over every stored byte except the checksum field. */
    uint32_t calculateChecksum(const ControllerConfig &config) const;

    /** Validate all driver, source, board-capability, and ownership constraints. */
    uint8_t validateConfig(const ControllerConfig &config, uint8_t &detail) const;

    /** Release old modes, initialize modules/sources, and reset runtime filters. */
    void activateConfig(const ControllerConfig &config);

    /** Initialize module buses and chips selected by the current config. */
    void beginModules();

    /** Configure a source for its digital role when direct GPIO/mux permits it. */
    void beginDigitalSource(const SourceAddress &source, bool pullup);

    /** Refresh cached digital expanders once per scan interval. */
    void refreshDigitalModules();

    /** Read one digital source; true is electrical HIGH, false is LOW. */
    bool readDigitalSource(const SourceAddress &source);

    /** Read one analog source normalized to the common firmware range 0..4095. */
    uint16_t readAnalogSource(const SourceAddress &source);

    /** Select one channel on a 4051/4067 before reading its shared signal pin. */
    void selectMuxChannel(const ModuleConfig &module, uint8_t channel);

    /** Read both GPIO banks from an MCP23017 into the scan cache. */
    bool readMcp23017(const ModuleConfig &module, uint16_t &value);

    /** Perform one high-rate single-ended ADS1015/ADS1115 conversion. */
    uint16_t readAds1x15(const ModuleConfig &module, uint8_t channel);

    /** Write an 8-bit register pair to an MCP23017. */
    bool writeMcpRegister(const ModuleConfig &module, uint8_t reg, uint16_t value);

    /** Translate electrical level and switch flags into a logical pressed state. */
    bool switchPressed(const SwitchConfig &item);

    /** Debounce configured switches and send CC40..CC51 edge events. */
    void updateSwitches();

    /** Decode quadrature movement and debounce optional encoder buttons. */
    void updateEncoders();

    /** Sample/filter one analog control per interval to keep the main loop responsive. */
    void updateAnalogControls();

    /** Build capability-compatible Learn candidates from the live topology. */
    void prepareLearnCandidates();

    /** Detect a button press or sustained analog movement and finish Learn. */
    void updateLearn();

    /** Leave Learn, restore source modes, and emit its correlated result. */
    void finishLearn(
        uint8_t status,
        const SourceAddress &source,
        const SourceAddress &secondarySource = SourceAddress{}
    );

    /** Return one-based logical switch using a source, or zero when unassigned. */
    uint8_t assignedSwitch(const SourceAddress &source) const;

    /** Return true when two compact source addresses identify the same input. */
    static bool sameSource(const SourceAddress &left, const SourceAddress &right);
};

} // namespace mfx

