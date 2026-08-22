import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    applyMultiFXTheme,
    BUILT_IN_THEMES,
    deleteCustomMultiFXTheme,
    loadCustomMultiFXThemes,
    loadMultiFXTheme,
    MultiFXThemeDefinition,
    saveCustomMultiFXTheme,
    saveMultiFXTheme,
    validateMultiFXTheme,
    MFX_COLORS
} from "./MultiFXTheme";

type ThemeCategory =
    | "COLORFUL"
    | "DARK"
    | "LIGHT"
    | "AMP / VINTAGE"
    | "STUDIO / NEUTRAL"
    | "TERMINAL / HIGH CONTRAST";

const CATEGORY_ORDER: ThemeCategory[] = [
    "COLORFUL",
    "DARK",
    "LIGHT",
    "AMP / VINTAGE",
    "STUDIO / NEUTRAL",
    "TERMINAL / HIGH CONTRAST"
];

const AMP_VINTAGE_NAMES = new Set([
    "Boutique Blue",
    "British Stack",
    "Brownface",
    "Copper",
    "Goldtop",
    "Orange Crush",
    "Royal Gold",
    "Silverface",
    "Surf Green",
    "Tube Glow",
    "Vintage Cream"
]);

const STUDIO_NEUTRAL_NAMES = new Set([
    "Blue Steel",
    "Graphite",
    "Gunmetal",
    "Slate Purple",
    "Studio Dark",
    "Studio Warm"
]);

const TERMINAL_NAMES = new Set([
    "Blackout",
    "High Contrast",
    "Night Vision",
    "Terminal Amber",
    "Terminal Green"
]);

export default function MultiFXThemeManager() {
    const originalRef = useRef<MultiFXThemeDefinition>(loadMultiFXTheme());

    const [theme, setTheme] = useState<MultiFXThemeDefinition>(
        () => cloneTheme(originalRef.current)
    );

    const [message, setMessage] = useState("");

    const [customThemes, setCustomThemes] = useState<MultiFXThemeDefinition[]>(
        () => loadCustomMultiFXThemes()
    );

    const groupedBuiltIns = useMemo(() => {
        const groups = new Map<ThemeCategory, MultiFXThemeDefinition[]>();

        for (const category of CATEGORY_ORDER) {
            groups.set(category, []);
        }

        for (const preset of BUILT_IN_THEMES) {
            groups.get(getThemeCategory(preset))!.push(preset);
        }

        for (const themes of groups.values()) {
            themes.sort((a, b) =>
                a.name.localeCompare(b.name, undefined, {
                    sensitivity: "base"
                })
            );
        }

        return groups;
    }, []);

    const sortedCustomThemes = useMemo(
        () =>
            [...customThemes].sort((a, b) =>
                a.name.localeCompare(b.name, undefined, {
                    sensitivity: "base"
                })
            ),
        [customThemes]
    );

    useEffect(() => {
        applyMultiFXTheme(theme);
    }, [theme]);

    useEffect(() => {
        return () => {
            applyMultiFXTheme(originalRef.current);
        };
    }, []);

    useEffect(() => {
        if (!message) {
            return;
        }

        const timer = window.setTimeout(() => {
            setMessage("");
        }, 1800);

        return () => window.clearTimeout(timer);
    }, [message]);

    const updateColor = (
        key: keyof MultiFXThemeDefinition["colors"],
        value: string
    ) => {
        setTheme((current) => ({
            ...current,
            name: current.name.startsWith("Custom")
                ? current.name
                : `Custom - ${current.name}`,
            author: "User",
            colors: {
                ...current.colors,
                [key]: value
            }
        }));
    };

    const previewTheme = (preset: MultiFXThemeDefinition) => {
        setTheme(cloneTheme(preset));
        setMessage(`Previewing "${preset.name}".`);
    };

    const setThemeActive = () => {
        if (saveMultiFXTheme(theme)) {
            originalRef.current = cloneTheme(theme);
            setMessage(`"${theme.name}" is now the active theme.`);
        } else {
            setMessage("Theme is invalid and could not be set.");
        }
    };

    const saveCustom = () => {
        const customName = theme.name.trim();

        if (!customName) {
            setMessage("Enter a name before saving a custom theme.");
            return;
        }

        const customTheme: MultiFXThemeDefinition = {
            ...cloneTheme(theme),
            name: customName,
            author: "User",
            version: 1
        };

        const next = saveCustomMultiFXTheme(customTheme);
        setCustomThemes(next);
        setTheme(cloneTheme(customTheme));
        setMessage(`Saved custom theme "${customName}".`);
    };

    const deleteCustom = (name: string) => {
        const next = deleteCustomMultiFXTheme(name);
        setCustomThemes(next);
        setMessage(`Deleted custom theme "${name}".`);
    };

    const exportTheme = () => {
        const blob = new Blob(
            [JSON.stringify(theme, null, 2)],
            { type: "application/json" }
        );

        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${safeName(theme.name)}.multifx-theme.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        setMessage("Theme exported.");
    };

    const importTheme = async (file: File) => {
        try {
            const text = await file.text();
            const parsed = validateMultiFXTheme(JSON.parse(text));

            if (!parsed) {
                setMessage("That file is not a valid MultiFX theme.");
                return;
            }

            setTheme(cloneTheme(parsed));
            setMessage(
                `Imported "${parsed.name}". Use SAVE CUSTOM to keep it or SET THEME to make it active.`
            );
        } catch (error) {
            setMessage(`Could not import theme: ${String(error)}`);
        }
    };

    return (
        <div style={screenStyle}>
            <div style={headerStyle}>
                <div>
                    <div style={titleStyle}>THEME MANAGER</div>
                    <div style={subtitleStyle}>
                        Preview • set active • save custom • import/export
                    </div>
                </div>
            </div>

            {message && createPortal(
                <div
                    role="status"
                    aria-live="polite"
                    style={{
                        position: "fixed",
                        left: "50%",
                        top: "calc(8px * var(--mfx-ui-scale, 1))",
                        transform: "translateX(-50%)",
                        zIndex: 2147483647,
                        maxWidth: "min(72vw, 560px)",
                        padding:
                            "calc(8px * var(--mfx-ui-scale, 1)) calc(14px * var(--mfx-ui-scale, 1))",
                        borderRadius: 10,
                        border: `1px solid ${MFX_COLORS.cyan}`,
                        background: MFX_COLORS.panelAlt,
                        color: MFX_COLORS.cyanText,
                        fontWeight: 900,
                        textAlign: "center",
                        boxShadow: "0 8px 22px rgba(0,0,0,0.68)",
                        pointerEvents: "none"
                    }}
                >
                    {message}
                </div>,
                document.body
            )}

            <div
                style={{
                    flex: "1 1 auto",
                    minHeight: 0,
                    overflow: "hidden",
                    padding: "calc(12px * var(--mfx-ui-scale, 1))",
                    boxSizing: "border-box"
                }}
            >
                <div
                    style={{
                        height: "100%",
                        minHeight: 0,
                        display: "grid",
                        gridTemplateColumns: "29% minmax(0, 71%)",
                        gap: "calc(12px * var(--mfx-ui-scale, 1))",
                        overflow: "hidden"
                    }}
                >
                    <div
                        style={{
                            minWidth: 0,
                            minHeight: 0,
                            display: "flex",
                            flexDirection: "column",
                            overflow: "hidden",
                            borderRadius: 10,
                            border: `1px solid ${MFX_COLORS.border}`,
                            background: MFX_COLORS.panel
                        }}
                    >
                        <div
                            style={{
                                flex: "0 0 auto",
                                padding:
                                    "calc(9px * var(--mfx-ui-scale, 1))",
                                borderBottom:
                                    `1px solid ${MFX_COLORS.border}`,
                                background: MFX_COLORS.panelAlt
                            }}
                        >
                            <div
                                style={{
                                    ...sectionTitleStyle,
                                    marginBottom:
                                        "calc(7px * var(--mfx-ui-scale, 1))"
                                }}
                            >
                                THEMES
                            </div>

                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "1fr 1fr",
                                    gap:
                                        "calc(7px * var(--mfx-ui-scale, 1))"
                                }}
                            >
                                <label
                                    style={{
                                        ...buttonStyle,
                                        width: "100%",
                                        minWidth: 0,
                                        boxSizing: "border-box"
                                    }}
                                >
                                    IMPORT
                                    <input
                                        type="file"
                                        accept="application/json,.json"
                                        style={{ display: "none" }}
                                        onChange={(event) => {
                                            const file =
                                                event.target.files?.[0];

                                            if (file) {
                                                void importTheme(file);
                                            }

                                            event.currentTarget.value = "";
                                        }}
                                    />
                                </label>

                                <button
                                    type="button"
                                    onClick={exportTheme}
                                    style={{
                                        ...buttonStyle,
                                        width: "100%",
                                        minWidth: 0
                                    }}
                                >
                                    EXPORT
                                </button>
                            </div>
                        </div>

                        <div
                            style={{
                                flex: "1 1 auto",
                                minHeight: 0,
                                overflowY: "auto",
                                overflowX: "hidden",
                                overscrollBehavior: "contain",
                                touchAction: "pan-y",
                                padding:
                                    "calc(8px * var(--mfx-ui-scale, 1))"
                            }}
                        >
                            <div
                                style={{
                                    display: "grid",
                                    gap:
                                        "calc(7px * var(--mfx-ui-scale, 1))"
                                }}
                            >
                                {CATEGORY_ORDER.map((category) => {
                                    const presets =
                                        groupedBuiltIns.get(category) ?? [];

                                    if (presets.length === 0) {
                                        return null;
                                    }

                                    return (
                                        <React.Fragment key={category}>
                                            <ThemeCategoryHeader
                                                title={category}
                                                count={presets.length}
                                            />

                                            {presets.map((preset) => (
                                                <ThemePresetButton
                                                    key={preset.name}
                                                    preset={preset}
                                                    selected={
                                                        theme.name
                                                        === preset.name
                                                    }
                                                    onClick={() =>
                                                        previewTheme(preset)
                                                    }
                                                />
                                            ))}
                                        </React.Fragment>
                                    );
                                })}

                                {sortedCustomThemes.length > 0 && (
                                    <>
                                        <ThemeCategoryHeader
                                            title="MY THEMES"
                                            count={sortedCustomThemes.length}
                                        />

                                        {sortedCustomThemes.map((preset) => (
                                            <div
                                                key={`custom-${preset.name}`}
                                                style={{
                                                    display: "grid",
                                                    gridTemplateColumns:
                                                        "minmax(0, 1fr) auto",
                                                    gap:
                                                        "calc(5px * var(--mfx-ui-scale, 1))"
                                                }}
                                            >
                                                <ThemePresetButton
                                                    preset={preset}
                                                    selected={
                                                        theme.name
                                                        === preset.name
                                                    }
                                                    onClick={() => {
                                                        setTheme(
                                                            cloneTheme(preset)
                                                        );
                                                        setMessage(
                                                            `Previewing custom theme "${preset.name}".`
                                                        );
                                                    }}
                                                />

                                                <button
                                                    type="button"
                                                    title={`Delete ${preset.name}`}
                                                    aria-label={`Delete ${preset.name}`}
                                                    onClick={() =>
                                                        deleteCustom(
                                                            preset.name
                                                        )
                                                    }
                                                    style={{
                                                        width:
                                                            "calc(38px * var(--mfx-ui-scale, 1))",
                                                        minWidth:
                                                            "calc(38px * var(--mfx-ui-scale, 1))",
                                                        borderRadius: 8,
                                                        border:
                                                            `1px solid ${MFX_COLORS.danger}`,
                                                        background:
                                                            MFX_COLORS.background,
                                                        color:
                                                            MFX_COLORS.danger,
                                                        font: "inherit",
                                                        fontWeight: 900,
                                                        cursor: "pointer"
                                                    }}
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        ))}
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <div
                        style={{
                            minWidth: 0,
                            minHeight: 0,
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                            padding:
                                "calc(11px * var(--mfx-ui-scale, 1))",
                            boxSizing: "border-box",
                            borderRadius: 10,
                            border: `1px solid ${MFX_COLORS.border}`,
                            background: MFX_COLORS.panel
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "var(--mfx-gap, 8px)",
                                marginBottom:
                                    "calc(9px * var(--mfx-ui-scale, 1))"
                            }}
                        >
                            <div
                                style={{
                                    ...sectionTitleStyle,
                                    marginBottom: 0,
                                    flex: "1 1 auto",
                                    fontSize: "1.02rem"
                                }}
                            >
                                CUSTOMIZE
                            </div>

                            <button
                                type="button"
                                onClick={setThemeActive}
                                style={{
                                    ...primaryButtonStyle,
                                    minHeight:
                                        "calc(40px * var(--mfx-ui-scale, 1))",
                                    padding:
                                        "calc(6px * var(--mfx-ui-scale, 1)) calc(12px * var(--mfx-ui-scale, 1))"
                                }}
                            >
                                SET THEME
                            </button>

                            <button
                                type="button"
                                onClick={saveCustom}
                                style={{
                                    ...buttonStyle,
                                    minHeight:
                                        "calc(40px * var(--mfx-ui-scale, 1))",
                                    padding:
                                        "calc(6px * var(--mfx-ui-scale, 1)) calc(12px * var(--mfx-ui-scale, 1))",
                                    border:
                                        `1px solid ${MFX_COLORS.cyan}`,
                                    color:
                                        MFX_COLORS.cyanText,
                                    background:
                                        MFX_COLORS.cyanSurface
                                }}
                            >
                                SAVE CUSTOM
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    const original =
                                        cloneTheme(originalRef.current);

                                    setTheme(original);
                                    applyMultiFXTheme(original);
                                    setMessage("Reverted unsaved changes.");
                                }}
                                style={{
                                    ...buttonStyle,
                                    minHeight:
                                        "calc(40px * var(--mfx-ui-scale, 1))",
                                    padding:
                                        "calc(6px * var(--mfx-ui-scale, 1)) calc(12px * var(--mfx-ui-scale, 1))"
                                }}
                            >
                                REVERT
                            </button>
                        </div>

                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns:
                                    "calc(94px * var(--mfx-ui-scale, 1)) minmax(0, 1fr)",
                                gap: "var(--mfx-gap, 8px)",
                                alignItems: "center",
                                marginBottom:
                                    "calc(9px * var(--mfx-ui-scale, 1))"
                            }}
                        >
                            <label
                                style={{
                                    ...fieldLabelStyle,
                                    margin: 0,
                                    fontSize: "0.8rem"
                                }}
                            >
                                Theme name
                            </label>

                            <input
                                value={theme.name}
                                onChange={(event) =>
                                    setTheme((current) => ({
                                        ...current,
                                        name: event.target.value
                                    }))
                                }
                                style={{
                                    ...textInputStyle,
                                    height:
                                        "calc(40px * var(--mfx-ui-scale, 1))",
                                    fontSize: "0.9rem"
                                }}
                            />
                        </div>

                        <div
                            style={{
                                flex: "1 1 auto",
                                minHeight: 0,
                                display: "grid",
                                gridTemplateColumns:
                                    "repeat(3, minmax(0, 1fr))",
                                gridTemplateRows:
                                    "repeat(5, minmax(0, 1fr))",
                                gap:
                                    "calc(7px * var(--mfx-ui-scale, 1))"
                            }}
                        >
                            <ColorField
                                label="Background"
                                value={theme.colors.background}
                                onChange={(v) =>
                                    updateColor("background", v)
                                }
                            />
                            <ColorField
                                label="Panel"
                                value={theme.colors.panel}
                                onChange={(v) =>
                                    updateColor("panel", v)
                                }
                            />
                            <ColorField
                                label="Panel Alt"
                                value={theme.colors.panelAlt}
                                onChange={(v) =>
                                    updateColor("panelAlt", v)
                                }
                            />
                            <ColorField
                                label="Navigation"
                                value={theme.colors.navigation}
                                onChange={(v) =>
                                    updateColor("navigation", v)
                                }
                            />
                            <ColorField
                                label="Nav Text"
                                value={theme.colors.navigationText}
                                onChange={(v) =>
                                    updateColor("navigationText", v)
                                }
                            />
                            <ColorField
                                label="Nav Surface"
                                value={theme.colors.navigationSurface}
                                onChange={(v) =>
                                    updateColor("navigationSurface", v)
                                }
                            />
                            <ColorField
                                label="Selected"
                                value={theme.colors.selected}
                                onChange={(v) =>
                                    updateColor("selected", v)
                                }
                            />
                            <ColorField
                                label="Sel Surface"
                                value={theme.colors.selectedSurface}
                                onChange={(v) =>
                                    updateColor("selectedSurface", v)
                                }
                            />
                            <ColorField
                                label="Sel Text"
                                value={theme.colors.selectedText}
                                onChange={(v) =>
                                    updateColor("selectedText", v)
                                }
                            />
                            <ColorField
                                label="Text"
                                value={theme.colors.text}
                                onChange={(v) =>
                                    updateColor("text", v)
                                }
                            />
                            <ColorField
                                label="Muted"
                                value={theme.colors.muted}
                                onChange={(v) =>
                                    updateColor("muted", v)
                                }
                            />
                            <ColorField
                                label="Border"
                                value={theme.colors.border}
                                onChange={(v) =>
                                    updateColor("border", v)
                                }
                            />
                            <ColorField
                                label="Danger"
                                value={theme.colors.danger}
                                onChange={(v) =>
                                    updateColor("danger", v)
                                }
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ThemeCategoryHeader({
    title,
    count
}: {
    title: string;
    count: number;
}) {
    return (
        <div
            style={{
                marginTop:
                    "calc(8px * var(--mfx-ui-scale, 1))",
                padding:
                    "calc(7px * var(--mfx-ui-scale, 1)) calc(5px * var(--mfx-ui-scale, 1)) calc(3px * var(--mfx-ui-scale, 1))",
                borderBottom:
                    `1px solid ${MFX_COLORS.border}`,
                color: MFX_COLORS.purpleLight,
                fontWeight: 900,
                fontSize: "0.76rem",
                letterSpacing: "0.055em"
            }}
        >
            {title}
            <span
                style={{
                    marginLeft: 6,
                    color: MFX_COLORS.muted,
                    fontWeight: 700,
                    letterSpacing: 0
                }}
            >
                ({count})
            </span>
        </div>
    );
}

function ThemePresetButton({
    preset,
    selected,
    onClick
}: {
    preset: MultiFXThemeDefinition;
    selected: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                minHeight:
                    "calc(58px * var(--mfx-ui-scale, 1))",
                padding:
                    "calc(7px * var(--mfx-ui-scale, 1)) calc(10px * var(--mfx-ui-scale, 1))",
                borderRadius: 9,
                border:
                    selected
                        ? `2px solid ${MFX_COLORS.cyan}`
                        : `1px solid ${MFX_COLORS.border}`,
                background:
                    selected
                        ? MFX_COLORS.cyanSurface
                        : MFX_COLORS.background,
                color:
                    selected
                        ? MFX_COLORS.cyanText
                        : MFX_COLORS.text,
                textAlign: "left",
                font: "inherit",
                cursor: "pointer",
                minWidth: 0
            }}
        >
            <div
                style={{
                    fontWeight: 900,
                    fontSize: "0.88rem",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis"
                }}
            >
                {preset.name}
            </div>

            <ThemeSwatches theme={preset} />
        </button>
    );
}

function ThemeSwatches({
    theme
}: {
    theme: MultiFXThemeDefinition;
}) {
    const values = [
        theme.colors.background,
        theme.colors.panel,
        theme.colors.navigation,
        theme.colors.selected,
        theme.colors.text
    ];

    return (
        <div
            style={{
                display: "flex",
                gap: 4,
                marginTop: 7
            }}
        >
            {values.map((value, index) => (
                <span
                    key={`${value}-${index}`}
                    style={{
                        width: 25,
                        height: 10,
                        borderRadius: 3,
                        background: value,
                        border:
                            "1px solid rgba(255,255,255,0.18)"
                    }}
                />
            ))}
        </div>
    );
}

function ColorField({
    label,
    value,
    onChange
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label
            style={{
                display: "grid",
                gridTemplateColumns:
                    "calc(36px * var(--mfx-ui-scale, 1)) minmax(0, 1fr)",
                gap:
                    "calc(7px * var(--mfx-ui-scale, 1))",
                alignItems: "center",
                width: "100%",
                height: "100%",
                minHeight:
                    "calc(48px * var(--mfx-ui-scale, 1))",
                padding:
                    "calc(6px * var(--mfx-ui-scale, 1)) calc(8px * var(--mfx-ui-scale, 1))",
                boxSizing: "border-box",
                borderRadius: 8,
                border: `1px solid ${MFX_COLORS.border}`,
                background: MFX_COLORS.panel
            }}
        >
            <input
                type="color"
                value={value}
                onChange={(event) =>
                    onChange(event.target.value.toUpperCase())
                }
                style={{
                    width:
                        "calc(34px * var(--mfx-ui-scale, 1))",
                    height:
                        "calc(34px * var(--mfx-ui-scale, 1))",
                    padding: 0,
                    border: 0,
                    background: "transparent"
                }}
            />

            <span style={{ minWidth: 0 }}>
                <span
                    style={{
                        display: "block",
                        color: MFX_COLORS.text,
                        fontWeight: 800,
                        fontSize: "0.78rem",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis"
                    }}
                >
                    {label}
                </span>

                <span
                    style={{
                        display: "block",
                        color: MFX_COLORS.muted,
                        fontSize: "0.68rem",
                        whiteSpace: "nowrap"
                    }}
                >
                    {value}
                </span>
            </span>
        </label>
    );
}

function getThemeCategory(
    theme: MultiFXThemeDefinition
): ThemeCategory {
    if (AMP_VINTAGE_NAMES.has(theme.name)) {
        return "AMP / VINTAGE";
    }

    if (STUDIO_NEUTRAL_NAMES.has(theme.name)) {
        return "STUDIO / NEUTRAL";
    }

    if (TERMINAL_NAMES.has(theme.name)) {
        return "TERMINAL / HIGH CONTRAST";
    }

    const backgroundLuminance =
        relativeLuminance(theme.colors.background);

    if (backgroundLuminance >= 0.55) {
        return "LIGHT";
    }

    if (backgroundLuminance <= 0.10) {
        return "DARK";
    }

    return "COLORFUL";
}

function relativeLuminance(hex: string): number {
    const [r, g, b] = hexToRgb(hex);

    const linearize = (component: number) => {
        const value = component / 255;

        return value <= 0.04045
            ? value / 12.92
            : Math.pow((value + 0.055) / 1.055, 2.4);
    };

    return (
        0.2126 * linearize(r)
        + 0.7152 * linearize(g)
        + 0.0722 * linearize(b)
    );
}

function hexToRgb(hex: string): [number, number, number] {
    const value = hex.replace("#", "");

    return [
        Number.parseInt(value.slice(0, 2), 16),
        Number.parseInt(value.slice(2, 4), 16),
        Number.parseInt(value.slice(4, 6), 16)
    ];
}

function cloneTheme(
    theme: MultiFXThemeDefinition
): MultiFXThemeDefinition {
    return JSON.parse(
        JSON.stringify(theme)
    ) as MultiFXThemeDefinition;
}

function safeName(value: string): string {
    return (
        value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
        || "multifx-theme"
    );
}

const screenStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: MFX_COLORS.background,
    color: MFX_COLORS.text
};

const headerStyle: React.CSSProperties = {
    minHeight: "var(--mfx-header-height, 56px)",
    display: "flex",
    alignItems: "center",
    padding:
        "calc(6px * var(--mfx-ui-scale, 1)) calc(70px * var(--mfx-ui-scale, 1)) calc(6px * var(--mfx-ui-scale, 1)) calc(78px * var(--mfx-ui-scale, 1))",
    boxSizing: "border-box",
    borderBottom: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panel
};

const titleStyle: React.CSSProperties = {
    color: MFX_COLORS.purpleLight,
    fontWeight: 900,
    letterSpacing: "0.05em"
};

const subtitleStyle: React.CSSProperties = {
    marginTop: 2,
    color: MFX_COLORS.muted,
    fontSize: "0.72rem"
};

const sectionTitleStyle: React.CSSProperties = {
    color: MFX_COLORS.purpleLight,
    fontWeight: 900,
    marginBottom: 8
};

const fieldLabelStyle: React.CSSProperties = {
    display: "block",
    color: MFX_COLORS.muted,
    fontSize: "0.76rem",
    fontWeight: 800,
    marginBottom: 5
};

const textInputStyle: React.CSSProperties = {
    width: "100%",
    height: 42,
    padding: "0 10px",
    boxSizing: "border-box",
    borderRadius: 8,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.background,
    color: MFX_COLORS.text,
    font: "inherit"
};

const buttonStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    padding: "6px 12px",
    borderRadius: 8,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panelAlt,
    color: MFX_COLORS.text,
    font: "inherit",
    fontWeight: 850,
    cursor: "pointer"
};

const primaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    border: `2px solid ${MFX_COLORS.purple}`,
    background: MFX_COLORS.purpleSurface,
    color: MFX_COLORS.purpleLight
};
