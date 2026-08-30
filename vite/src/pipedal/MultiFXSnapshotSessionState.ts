/*
 * Pure state rules for PI-MULTIFX snapshot sessions.
 *
 * The bridge owns the transient, cross-display map. This module deliberately
 * contains no browser or PiPedal dependencies so the interaction rules can be
 * tested without a running controller.
 */

export type PresetSnapshotSessionState = {
    snapshotIndex: number;
    enabled: boolean;
};

export type PresetSnapshotSessionMap = Record<
    string,
    PresetSnapshotSessionState
>;

export function presetSnapshotSessionKey(
    bankId: number,
    presetId: number
): string {
    return `${bankId}:${presetId}`;
}

/**
 * A Snapshot View press recalls a different/off snapshot. Pressing the same
 * active snapshot again forgets it completely, so a later preset press is a
 * no-op until another snapshot is chosen.
 */
export function snapshotViewPress(
    current: PresetSnapshotSessionState | null,
    snapshotIndex: number
): PresetSnapshotSessionState | null {
    if (
        current?.snapshotIndex === snapshotIndex
        && current.enabled
    ) {
        return null;
    }

    return { snapshotIndex, enabled: true };
}

/**
 * A repeated Performance preset press toggles its remembered snapshot. With
 * no remembered snapshot, it intentionally does nothing.
 */
export function performancePresetPress(
    current: PresetSnapshotSessionState | null
): PresetSnapshotSessionState | null {
    if (!current) return null;
    return {
        snapshotIndex: current.snapshotIndex,
        enabled: !current.enabled
    };
}

export function isSnapshotSessionConfirmed(
    current: PresetSnapshotSessionState | null,
    nativeSelectedSnapshot: number
): boolean {
    return Boolean(
        current?.enabled
        && current.snapshotIndex === nativeSelectedSnapshot
    );
}

export type PerformancePresetLightState =
    | "inactive"
    | "active"
    | "modified"
    | "snapshot"
    | "bypass";

export function performancePresetLightState(options: {
    presetIsActive: boolean;
    chainBypassed: boolean;
    snapshotConfirmed: boolean;
    presetModified: boolean;
}): PerformancePresetLightState {
    if (!options.presetIsActive) return "inactive";
    if (options.chainBypassed) return "bypass";
    if (options.snapshotConfirmed) return "snapshot";
    if (options.presetModified) return "modified";
    return "active";
}
