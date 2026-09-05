/*
 * PiPedal MultiFX viewport sizing.
 *
 * Design baseline: 1024 x 600.
 * The layout does NOT rearrange at different resolutions. Instead common
 * spacing, text and touch controls scale from the 1024x600 baseline.
 *
 * 7" / 1024x600 is the recommended minimum.
 */
export const MULTIFX_BASE_WIDTH = 1024;
export const MULTIFX_BASE_HEIGHT = 600;
export const MULTIFX_MIN_SCALE = 0.78;
export const MULTIFX_MAX_SCALE = 1.65;

function calculateScale(): number {
    const widthScale = window.innerWidth / MULTIFX_BASE_WIDTH;
    const heightScale = window.innerHeight / MULTIFX_BASE_HEIGHT;

    return Math.max(
        MULTIFX_MIN_SCALE,
        Math.min(MULTIFX_MAX_SCALE, widthScale, heightScale)
    );
}

function applyScale(): void {
    const scale = calculateScale();
    const root = document.documentElement;

    root.style.setProperty("--mfx-ui-scale", scale.toFixed(4));
    root.style.setProperty(
        "--mfx-font-size",
        `calc(16px * ${scale.toFixed(4)})`
    );
    root.style.setProperty(
        "--mfx-header-height",
        `calc(56px * ${scale.toFixed(4)})`
    );
    root.style.setProperty(
        "--mfx-touch-height",
        `calc(40px * ${scale.toFixed(4)})`
    );
    root.style.setProperty(
        "--mfx-gap",
        `calc(8px * ${scale.toFixed(4)})`
    );
    root.style.setProperty(
        "--mfx-pad",
        `calc(12px * ${scale.toFixed(4)})`
    );
}

export function installMultiFXResponsiveSizing(): () => void {
    applyScale();

    const handleResize = () => applyScale();
    window.addEventListener("resize", handleResize);

    return () => {
        window.removeEventListener("resize", handleResize);

        const root = document.documentElement;
        root.style.removeProperty("--mfx-ui-scale");
        root.style.removeProperty("--mfx-font-size");
        root.style.removeProperty("--mfx-header-height");
        root.style.removeProperty("--mfx-touch-height");
        root.style.removeProperty("--mfx-gap");
        root.style.removeProperty("--mfx-pad");
    };
}
