import assert from "node:assert/strict";
import test from "node:test";

import {
    isSnapshotSessionConfirmed,
    performancePresetLightState,
    performancePresetPress,
    presetSnapshotSessionKey,
    snapshotViewPress
} from "../src/pipedal/MultiFXSnapshotSessionState.ts";

test("a preset with no selected snapshot does not toggle", () => {
    assert.equal(performancePresetPress(null), null);
});

test("Snapshot View selects, then forgets, the same active snapshot", () => {
    const selected = snapshotViewPress(null, 1);
    assert.deepEqual(selected, { snapshotIndex: 1, enabled: true });
    assert.equal(snapshotViewPress(selected, 1), null);
    assert.equal(performancePresetPress(null), null);
});

test("Snapshot View re-enables a remembered snapshot that was off", () => {
    assert.deepEqual(
        snapshotViewPress({ snapshotIndex: 3, enabled: false }, 3),
        { snapshotIndex: 3, enabled: true }
    );
});

test("Performance presses toggle a remembered snapshot without forgetting it", () => {
    const active = { snapshotIndex: 2, enabled: true };
    const off = performancePresetPress(active);
    assert.deepEqual(off, { snapshotIndex: 2, enabled: false });
    assert.deepEqual(
        performancePresetPress(off),
        { snapshotIndex: 2, enabled: true }
    );
});

test("bank and preset together form the session identity", () => {
    assert.notEqual(
        presetSnapshotSessionKey(10, 1),
        presetSnapshotSessionKey(11, 1)
    );
});

test("snapshot confirmation requires both remembered intent and native state", () => {
    assert.equal(
        isSnapshotSessionConfirmed({ snapshotIndex: 4, enabled: true }, 4),
        true
    );
    assert.equal(
        isSnapshotSessionConfirmed({ snapshotIndex: 4, enabled: false }, 4),
        false
    );
    assert.equal(
        isSnapshotSessionConfirmed({ snapshotIndex: 4, enabled: true }, -1),
        false
    );
});

test("preset indicator priority is bypass, snapshot, modified, active", () => {
    assert.equal(performancePresetLightState({
        presetIsActive: true,
        chainBypassed: true,
        snapshotConfirmed: true,
        presetModified: true
    }), "bypass");
    assert.equal(performancePresetLightState({
        presetIsActive: true,
        chainBypassed: false,
        snapshotConfirmed: true,
        presetModified: true
    }), "snapshot");
    assert.equal(performancePresetLightState({
        presetIsActive: true,
        chainBypassed: false,
        snapshotConfirmed: false,
        presetModified: true
    }), "modified");
    assert.equal(performancePresetLightState({
        presetIsActive: true,
        chainBypassed: false,
        snapshotConfirmed: false,
        presetModified: false
    }), "active");
});
