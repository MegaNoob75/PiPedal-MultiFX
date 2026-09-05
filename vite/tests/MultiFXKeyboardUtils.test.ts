import assert from "node:assert/strict";
import test from "node:test";
import {
    eraseSelection,
    replaceSelection
} from "../src/multifx/keyboard/MultiFXKeyboardUtils.ts";

test("inserts at the current cursor instead of appending", () => {
    assert.deepEqual(
        replaceSelection("Oxford Clean", 6, 6, " Studio"),
        { value: "Oxford Studio Clean", start: 13, end: 13 }
    );
});

test("replaces selected text and places the cursor after it", () => {
    assert.deepEqual(
        replaceSelection("Oxford Clean", 0, 6, "London"),
        { value: "London Clean", start: 6, end: 6 }
    );
});

test("backspace deletes a selection or the character before the cursor", () => {
    assert.deepEqual(
        eraseSelection("Preset 19", 7, 9),
        { value: "Preset ", start: 7, end: 7 }
    );
    assert.deepEqual(
        eraseSelection("Preset", 3, 3),
        { value: "Prset", start: 2, end: 2 }
    );
});
