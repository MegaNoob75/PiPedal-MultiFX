export type PerformanceLayoutMode = "controller" | "custom";

export interface MultiFXDevicePreferences {
    performanceLayoutMode: PerformanceLayoutMode;
    customPresetSlots: number;
    customColumns: number;
    showActionTiles: boolean;
}

export const MULTIFX_DEVICE_PREFERENCES_STORAGE_KEY =
    "pipedal-multifx-device-preferences-v1";

export const MULTIFX_DEVICE_PREFERENCES_CHANGED_EVENT =
    "multifx-device-preferences-changed";

// Performance View now follows the same physical-controller limits as the
// configurable ESP32: at most twelve footswitch-sized tiles and six columns.
// This prevents layouts that technically fit in CSS but are unreadable on the
// 1024x600 pedal touchscreen.
export const MAX_PERFORMANCE_TILES = 12;
export const MAX_PERFORMANCE_COLUMNS = 6;

export const DEFAULT_MULTIFX_DEVICE_PREFERENCES: MultiFXDevicePreferences = {
    performanceLayoutMode: "controller",
    customPresetSlots: 12,
    customColumns: 4,
    showActionTiles: true
};

const boundedInteger = (
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number
): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(
        maximum,
        Math.max(minimum, Math.round(value))
    );
};

export function normalizeMultiFXDevicePreferences(
    value: unknown
): MultiFXDevicePreferences {
    const source =
        value && typeof value === "object" && !Array.isArray(value)
            ? value as Record<string, unknown>
            : {};

    const performanceLayoutMode =
        source.performanceLayoutMode === "custom"
            ? "custom"
            : "controller";

    return {
        performanceLayoutMode,
        customPresetSlots: boundedInteger(
            source.customPresetSlots,
            DEFAULT_MULTIFX_DEVICE_PREFERENCES.customPresetSlots,
            1,
            MAX_PERFORMANCE_TILES
        ),
        customColumns: boundedInteger(
            source.customColumns,
            DEFAULT_MULTIFX_DEVICE_PREFERENCES.customColumns,
            1,
            MAX_PERFORMANCE_COLUMNS
        ),
        showActionTiles:
            typeof source.showActionTiles === "boolean"
                ? source.showActionTiles
                : DEFAULT_MULTIFX_DEVICE_PREFERENCES.showActionTiles
    };
}

export function loadMultiFXDevicePreferences(): MultiFXDevicePreferences {
    try {
        const stored = window.localStorage.getItem(
            MULTIFX_DEVICE_PREFERENCES_STORAGE_KEY
        );

        if (!stored) {
            return { ...DEFAULT_MULTIFX_DEVICE_PREFERENCES };
        }

        const normalized = normalizeMultiFXDevicePreferences(
            JSON.parse(stored) as unknown
        );

        // Write the clamped value back once so an old 32-slot / 8-column
        // preference cannot reappear on the next load.
        window.localStorage.setItem(
            MULTIFX_DEVICE_PREFERENCES_STORAGE_KEY,
            JSON.stringify(normalized)
        );

        return normalized;
    } catch {
        return { ...DEFAULT_MULTIFX_DEVICE_PREFERENCES };
    }
}

export function saveMultiFXDevicePreferences(
    preferences: MultiFXDevicePreferences
): MultiFXDevicePreferences {
    const normalized = normalizeMultiFXDevicePreferences(preferences);

    window.localStorage.setItem(
        MULTIFX_DEVICE_PREFERENCES_STORAGE_KEY,
        JSON.stringify(normalized)
    );

    window.dispatchEvent(
        new Event(MULTIFX_DEVICE_PREFERENCES_CHANGED_EVENT)
    );

    return normalized;
}

export function clearMultiFXDevicePreferences(): void {
    window.localStorage.removeItem(
        MULTIFX_DEVICE_PREFERENCES_STORAGE_KEY
    );

    window.dispatchEvent(
        new Event(MULTIFX_DEVICE_PREFERENCES_CHANGED_EVENT)
    );
}
