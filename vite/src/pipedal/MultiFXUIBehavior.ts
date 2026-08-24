/*
 * Small, MultiFX-specific interaction preferences.
 *
 * These values control transient interface behavior rather than PiPedal audio
 * or controller assignments. They are stored locally for fast startup and
 * mirrored through the MultiFX runtime bridge so the PC and pedal display use
 * the same timing and pop-out behavior.
 */

export const MULTIFX_UI_BEHAVIOR_STORAGE_KEY =
    "pipedal-multifx-ui-behavior-v1";
export const MULTIFX_UI_BEHAVIOR_CHANGED_EVENT =
    "multifx-ui-behavior-changed";

export interface MultiFXUIBehaviorSettings {
    version: 1;
    physicalControlPopout: boolean;
    touchControlPopout: boolean;
    controlPopoutDurationMs: number;
    controlPopoutScale: number;
    parameterFeedbackEnabled: boolean;
    statusToastDurationMs: number;
}

export const DEFAULT_MULTIFX_UI_BEHAVIOR: MultiFXUIBehaviorSettings = {
    version: 1,
    physicalControlPopout: true,
    touchControlPopout: true,
    controlPopoutDurationMs: 2200,
    controlPopoutScale: 1.65,
    parameterFeedbackEnabled: true,
    statusToastDurationMs: 1800
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object"
        && value !== null
        && !Array.isArray(value);
}

function numberIn(value: unknown, minimum: number, maximum: number): boolean {
    return typeof value === "number"
        && Number.isFinite(value)
        && value >= minimum
        && value <= maximum;
}

/** Return a detached, validated settings record or undefined for bad data. */
export function validateMultiFXUIBehaviorSettings(
    value: unknown
): MultiFXUIBehaviorSettings | undefined {
    if (!isRecord(value)) return undefined;
    const expected = [
        "version",
        "physicalControlPopout",
        "touchControlPopout",
        "controlPopoutDurationMs",
        "controlPopoutScale",
        "parameterFeedbackEnabled",
        "statusToastDurationMs"
    ].sort();
    const actual = Object.keys(value).sort();
    if (actual.length !== expected.length
        || !actual.every((key, index) => key === expected[index])
        || value.version !== 1
        || typeof value.physicalControlPopout !== "boolean"
        || typeof value.touchControlPopout !== "boolean"
        || !numberIn(value.controlPopoutDurationMs, 500, 10000)
        || !numberIn(value.controlPopoutScale, 1.2, 2.5)
        || typeof value.parameterFeedbackEnabled !== "boolean"
        || !numberIn(value.statusToastDurationMs, 500, 10000)) {
        return undefined;
    }

    return JSON.parse(JSON.stringify(value)) as MultiFXUIBehaviorSettings;
}

/** Read interaction preferences without allowing malformed storage to leak in. */
export function loadMultiFXUIBehaviorSettings(): MultiFXUIBehaviorSettings {
    try {
        const stored = window.localStorage.getItem(
            MULTIFX_UI_BEHAVIOR_STORAGE_KEY
        );
        if (stored) {
            const valid = validateMultiFXUIBehaviorSettings(
                JSON.parse(stored) as unknown
            );
            if (valid) return valid;
        }
    } catch {
        // Browser storage is optional; defaults remain fully usable.
    }
    return { ...DEFAULT_MULTIFX_UI_BEHAVIOR };
}

/** Persist settings and notify live views such as Performance and Settings. */
export function saveMultiFXUIBehaviorSettings(
    value: MultiFXUIBehaviorSettings
): boolean {
    const valid = validateMultiFXUIBehaviorSettings(value);
    if (!valid) return false;

    window.localStorage.setItem(
        MULTIFX_UI_BEHAVIOR_STORAGE_KEY,
        JSON.stringify(valid, null, 2)
    );
    window.dispatchEvent(new Event(MULTIFX_UI_BEHAVIOR_CHANGED_EVENT));
    return true;
}
