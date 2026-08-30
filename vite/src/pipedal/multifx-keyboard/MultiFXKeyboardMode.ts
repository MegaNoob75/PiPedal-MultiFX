export type MultiFXKeyboardMode = "auto" | "multifx" | "system" | "off";
export type MultiFXKeyboardKeyShape = "rounded" | "square";
export type MultiFXKeyboardTextSize = "normal" | "large" | "extra-large";
export type MultiFXKeyboardSize = "full" | "large" | "compact";
export type MultiFXKeyboardPlacement = "top" | "center" | "bottom";

export const MULTIFX_KEYBOARD_MODE_STORAGE_KEY =
    "pipedal-multifx-keyboard-mode";
export const MULTIFX_KEYBOARD_SETTINGS_STORAGE_KEY =
    "pipedal-multifx-keyboard-settings";
export const MULTIFX_KEYBOARD_SETTINGS_CHANGED_EVENT =
    "pipedal-multifx-keyboard-settings-changed";

export interface MultiFXKeyboardSettings {
    version: 4;
    mode: MultiFXKeyboardMode;
    transparentBackground: boolean;
    themeId: string;
    keyShape: MultiFXKeyboardKeyShape;
    textSize: MultiFXKeyboardTextSize;
    hapticFeedback: boolean;
    size: MultiFXKeyboardSize;
    placement: MultiFXKeyboardPlacement;
}

export const DEFAULT_MULTIFX_KEYBOARD_SETTINGS: MultiFXKeyboardSettings = {
    version: 4,
    mode: "auto",
    transparentBackground: false,
    themeId: "current",
    keyShape: "rounded",
    textSize: "large",
    hapticFeedback: true,
    size: "full",
    placement: "center"
};

function isMode(value: unknown): value is MultiFXKeyboardMode {
    return value === "auto" || value === "multifx"
        || value === "system" || value === "off";
}

function isKeyShape(value: unknown): value is MultiFXKeyboardKeyShape {
    return value === "rounded" || value === "square";
}

function isTextSize(value: unknown): value is MultiFXKeyboardTextSize {
    return value === "normal" || value === "large" || value === "extra-large";
}

function isSize(value: unknown): value is MultiFXKeyboardSize {
    return value === "full" || value === "large" || value === "compact";
}

function isPlacement(value: unknown): value is MultiFXKeyboardPlacement {
    return value === "top" || value === "center" || value === "bottom";
}

export function loadMultiFXKeyboardSettings(): MultiFXKeyboardSettings {
    try {
        const raw = window.localStorage.getItem(
            MULTIFX_KEYBOARD_SETTINGS_STORAGE_KEY
        );
        if (raw) {
            const value = JSON.parse(raw) as Record<string, unknown>;
            if ([1, 2, 3, 4].includes(value.version as number)
                && isMode(value.mode)) {
                const migrated = {
                    ...DEFAULT_MULTIFX_KEYBOARD_SETTINGS,
                    mode: value.mode,
                    transparentBackground: typeof value.transparentBackground === "boolean"
                        ? value.transparentBackground : false,
                    themeId: typeof value.themeId === "string"
                        ? value.themeId : "current",
                    keyShape: isKeyShape(value.keyShape) ? value.keyShape : "rounded",
                    textSize: isTextSize(value.textSize) ? value.textSize : "large",
                    hapticFeedback: typeof value.hapticFeedback === "boolean"
                        ? value.hapticFeedback : true,
                    size: isSize(value.size) ? value.size : "full",
                    placement: isPlacement(value.placement) ? value.placement : "center"
                };
                return migrated;
            }
        }
    } catch {
        // Invalid local data falls back to the safe automatic behavior.
    }
    const legacyMode = window.localStorage.getItem(
        MULTIFX_KEYBOARD_MODE_STORAGE_KEY
    );
    return {
        ...DEFAULT_MULTIFX_KEYBOARD_SETTINGS,
        mode: isMode(legacyMode) ? legacyMode : "auto"
    };
}

export function validateMultiFXKeyboardSettings(
    value: unknown
): MultiFXKeyboardSettings | undefined {
    if (!value || typeof value !== "object") return undefined;
    const source = value as Record<string, unknown>;
    if (source.version !== 4 || !isMode(source.mode)
        || typeof source.transparentBackground !== "boolean"
        || typeof source.themeId !== "string"
        || !isKeyShape(source.keyShape) || !isTextSize(source.textSize)
        || typeof source.hapticFeedback !== "boolean"
        || !isSize(source.size) || !isPlacement(source.placement)) {
        return undefined;
    }
    return structuredClone(source as unknown as MultiFXKeyboardSettings);
}

export function saveMultiFXKeyboardSettings(
    settings: MultiFXKeyboardSettings
): void {
    window.localStorage.setItem(
        MULTIFX_KEYBOARD_SETTINGS_STORAGE_KEY,
        JSON.stringify(settings)
    );
    window.dispatchEvent(new Event(
        MULTIFX_KEYBOARD_SETTINGS_CHANGED_EVENT
    ));
}

export function loadMultiFXKeyboardMode(): MultiFXKeyboardMode {
    return loadMultiFXKeyboardSettings().mode;
}

export function saveMultiFXKeyboardMode(mode: MultiFXKeyboardMode): void {
    saveMultiFXKeyboardSettings({
        ...loadMultiFXKeyboardSettings(),
        mode
    });
}

function isMobileBrowser(): boolean {
    const nav = navigator as Navigator & {
        userAgentData?: { mobile?: boolean };
    };
    return nav.userAgentData?.mobile === true
        || /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);
}

function isDedicatedPiTouchscreen(): boolean {
    const localHost = window.location.hostname === "localhost"
        || window.location.hostname === "127.0.0.1"
        || window.location.hostname === "::1";
    const touchCapable = navigator.maxTouchPoints > 0
        || window.matchMedia?.("(pointer: coarse)").matches === true;
    return localHost && touchCapable && !isMobileBrowser();
}

export function shouldUseMultiFXKeyboard(
    mode: MultiFXKeyboardMode = loadMultiFXKeyboardMode()
): boolean {
    if (mode === "multifx") return true;
    if (mode !== "auto") return false;
    if (isMobileBrowser()) return false;
    return isDedicatedPiTouchscreen();
}
