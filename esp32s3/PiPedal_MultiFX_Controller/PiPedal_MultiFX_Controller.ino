/*
 * PiPedal MultiFX Physical Controller
 * ESP32-S3 / Control Surface
 *
 * IMPORTANT DESIGN CHANGE
 * -----------------------
 * SW1..SW8 no longer send PiPedal preset Program Change commands.
 *
 * They now send neutral physical-switch identity messages:
 *
 *   SW1 -> CC40
 *   SW2 -> CC41
 *   SW3 -> CC42
 *   SW4 -> CC43
 *   SW5 -> CC44
 *   SW6 -> CC45
 *   SW7 -> CC46
 *   SW8 -> CC47
 *
 * MultiFX controller-config.json decides what each switch means.
 *
 * Encoder remains:
 *   CC30 = rotation
 *   CC31 = push
 *
 * Pots remain:
 *   CC10..CC13
 */

#include <Control_Surface.h>

USBMIDI_Interface midi;

// ------------------------------------------------------------
// Physical footswitches
//
// Current physical layout:
//
//   SW1  SW2  SW3  SW4
//   SW5  SW6  SW7  SW8
//
// Current pins:
//   SW1=6, SW2=7, SW3=15, SW4=16
//   SW5=1, SW6=2, SW7=4,  SW8=5
// ------------------------------------------------------------

CCButton sw1 {6,  {40, CHANNEL_1}};
CCButton sw2 {7,  {41, CHANNEL_1}};
CCButton sw3 {15, {42, CHANNEL_1}};
CCButton sw4 {16, {43, CHANNEL_1}};

CCButton sw5 {1,  {44, CHANNEL_1}};
CCButton sw6 {2,  {45, CHANNEL_1}};
CCButton sw7 {4,  {46, CHANNEL_1}};
CCButton sw8 {5,  {47, CHANNEL_1}};

// ------------------------------------------------------------
// Potentiometers
// ------------------------------------------------------------

CCPotentiometer pot1 {8,  {10, CHANNEL_1}};
CCPotentiometer pot2 {12, {11, CHANNEL_1}};
CCPotentiometer pot3 {13, {12, CHANNEL_1}};
CCPotentiometer pot4 {11, {13, CHANNEL_1}};

// ------------------------------------------------------------
// Encoder
//
// A = pin 18
// B = pin 17
//
// Existing absolute CC encoder behavior is preserved on CC30.
// ------------------------------------------------------------

CCAbsoluteEncoder encoder {
    {18, 17},
    {30, CHANNEL_1},
};

// Encoder push button: pin 21 -> CC31
CCButton encoderButton {21, {31, CHANNEL_1}};

// ------------------------------------------------------------
// Setup
// ------------------------------------------------------------

void setup() {
    analogReadResolution(10);

#if defined(ARDUINO_ARCH_ESP32)
    analogSetAttenuation(ADC_11db);
#endif

    Control_Surface.begin();
}

// ------------------------------------------------------------
// Main loop
// ------------------------------------------------------------

void loop() {
    Control_Surface.loop();
}