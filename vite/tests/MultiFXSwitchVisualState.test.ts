import assert from "node:assert/strict";
import test from "node:test";
import { performanceSwitchVisualActive } from "../src/multifx/MultiFXSwitchVisualState.ts";

function trace(presetAction: boolean, states: Array<[boolean, boolean]>) {
    return states.map(([active, pressed]) => performanceSwitchVisualActive({
        presetAction, active, pressed
    }));
}

test("preset presses with confirmation after release move down once and stay down", () => {
    // Idle, press, release/loading, confirmed, still selected.
    assert.deepEqual(trace(true, [
        [false, false], [false, true], [false, false], [true, false], [true, false]
    ]), [false, false, false, true, true]);
});

test("preset confirmation while held stays down when the physical switch releases", () => {
    assert.deepEqual(trace(true, [
        [false, false], [false, true], [true, true], [true, false]
    ]), [false, false, true, true]);
});

test("pressing the selected preset for snapshots does not release its latched position", () => {
    assert.deepEqual(trace(true, [
        [true, false], [true, true], [true, false], [true, false]
    ]), [true, true, true, true]);
});

test("switching away releases the previous preset even if its input remains held", () => {
    assert.deepEqual(trace(true, [
        [true, false], [true, true], [false, true], [false, false]
    ]), [true, true, false, false]);
});

test("cancelled or failed preset selection cannot leave a false active appearance", () => {
    assert.deepEqual(trace(true, [
        [false, false], [false, true], [false, false], [false, false]
    ]), [false, false, false, false]);
});

test("navigation and momentary utility switches retain press and release movement", () => {
    assert.deepEqual(trace(false, [
        [false, false], [false, true], [false, false]
    ]), [false, true, false]);
});

test("latched utility switches retain their active state after input release", () => {
    assert.deepEqual(trace(false, [
        [false, false], [false, true], [true, true], [true, false], [false, false]
    ]), [false, true, true, true, false]);
});
