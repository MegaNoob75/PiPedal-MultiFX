/** Preset switches latch to selection; other switches also show momentary presses. */
export function performanceSwitchVisualActive({
    presetAction,
    active,
    pressed
}: {
    presetAction: boolean;
    active: boolean;
    pressed: boolean;
}): boolean {
    // An optimistic press followed by release and delayed preset confirmation
    // produces down/up/down. Preset movement follows confirmation only, then
    // remains down until selection changes. This never changes action dispatch.
    return active || (!presetAction && pressed);
}
