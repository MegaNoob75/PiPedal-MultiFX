/*
 * MultiFX-only backup file contract.
 *
 * Keeping validation separate from the Settings component makes restore
 * checks reusable and testable. The format is deliberately exact: unknown
 * keys, partial current records and unreleased older schemas are rejected
 * before browser or bridge state is changed.
 */

import {
    CUSTOM_THEMES_STORAGE_KEY,
    THEME_STORAGE_KEY,
    validateMultiFXTheme
} from "./MultiFXTheme";
import { validateMultiFXPresetAssignments } from "./MultiFXPresetAssignments";
import { validateControllerLayoutConfig } from "./ControllerConfig";
import { validateMultiFXUIBehaviorSettings } from "./MultiFXUIBehavior";
import { MULTIFX_KEYBOARD_SETTINGS_STORAGE_KEY } from "./keyboard/MultiFXKeyboardMode";
import {
    CUSTOM_KEYBOARD_THEMES_STORAGE_KEY,
    validateMultiFXKeyboardTheme
} from "./keyboard/MultiFXKeyboardTheme";

export const MULTIFX_BACKUP_FORMAT = "pipedal-multifx-ui-backup";
export const MULTIFX_BACKUP_VERSION = 9;

export const MULTIFX_BACKUP_LOCAL_STORAGE_KEYS = [
    THEME_STORAGE_KEY,
    CUSTOM_THEMES_STORAGE_KEY,
    CUSTOM_KEYBOARD_THEMES_STORAGE_KEY,
    MULTIFX_KEYBOARD_SETTINGS_STORAGE_KEY
] as const;

export type MultiFXBackupSettings = Record<string, string | null>;

export interface MultiFXSharedBackupState {
    controllerConfig?: unknown | null;
    presetAssignments?: unknown;
    uiSettings?: unknown | null;
}

export interface MultiFXBackupFile {
    format: typeof MULTIFX_BACKUP_FORMAT;
    version: number;
    createdAt: string;
    settings: MultiFXBackupSettings;
    sharedState: MultiFXSharedBackupState;
}

function isRecord(
    value: unknown
): value is Record<string, unknown> {
    return (
        typeof value === "object"
        && value !== null
        && !Array.isArray(value)
    );
}

function exactKeys(
    record: Record<string, unknown>,
    expected: readonly string[]
): boolean {
    const actual = Object.keys(record).sort();
    const wanted = [...expected].sort();
    return actual.length === wanted.length
        && actual.every((key, index) => key === wanted[index]);
}

/** Strictly validate a complete settings backup before restoring any state. */
export function validateMultiFXBackup(
    value: unknown
): value is MultiFXBackupFile {
    if (!isRecord(value)) return false;

    if (!exactKeys(value, [
        "format", "version", "createdAt", "settings", "sharedState"
    ])
        || value.format !== MULTIFX_BACKUP_FORMAT
        || value.version !== MULTIFX_BACKUP_VERSION
        || typeof value.createdAt !== "string"
        || !Number.isFinite(Date.parse(value.createdAt))
        || !isRecord(value.settings)) {
        return false;
    }

    if (!exactKeys(
        value.settings,
        MULTIFX_BACKUP_LOCAL_STORAGE_KEYS
    )) return false;
    for (const key of MULTIFX_BACKUP_LOCAL_STORAGE_KEYS) {
        const storedValue = value.settings[key];
        if (storedValue !== null && typeof storedValue !== "string") {
            return false;
        }
    }

    try {
        const activeTheme = value.settings[THEME_STORAGE_KEY];
        if (typeof activeTheme === "string"
            && !validateMultiFXTheme(JSON.parse(activeTheme))) {
            return false;
        }
        const customThemes = value.settings[CUSTOM_THEMES_STORAGE_KEY];
        if (typeof customThemes === "string") {
            const parsed = JSON.parse(customThemes) as unknown;
            if (!Array.isArray(parsed)
                || parsed.some((theme) => !validateMultiFXTheme(theme))) {
                return false;
            }
            const names = parsed.map((theme) =>
                (theme as { name: string }).name.trim().toLocaleLowerCase()
            );
            if (new Set(names).size !== names.length) return false;
        }
        const keyboardThemes = value.settings[CUSTOM_KEYBOARD_THEMES_STORAGE_KEY];
        if (typeof keyboardThemes === "string") {
            const parsed = JSON.parse(keyboardThemes) as unknown;
            if (!Array.isArray(parsed)
                || parsed.some((theme) => !validateMultiFXKeyboardTheme(theme))) {
                return false;
            }
        }
    } catch {
        return false;
    }

    if (!isRecord(value.sharedState)
        || !exactKeys(value.sharedState, [
            "controllerConfig", "presetAssignments", "uiSettings"
        ])) {
        return false;
    }

    if (value.sharedState.controllerConfig !== null
        && validateControllerLayoutConfig(
            value.sharedState.controllerConfig
        ) !== undefined) {
        return false;
    }

    if (Object.prototype.hasOwnProperty.call(
        value.sharedState,
        "presetAssignments"
    ) && !validateMultiFXPresetAssignments(
        value.sharedState.presetAssignments
    )) {
        return false;
    }

    if (value.sharedState.uiSettings !== null
        && !validateMultiFXUIBehaviorSettings(
            value.sharedState.uiSettings
        )) {
        return false;
    }

    return true;
}
