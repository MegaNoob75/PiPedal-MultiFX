import React, { useEffect, useMemo, useState } from "react";
import { PiPedalModelFactory } from "./PiPedalModel";
import { UiPlugin } from "./Lv2Plugin";
import { MFX_COLORS, MFX_SURFACES } from "./MultiFXTheme";

interface MultiFXPluginBrowserProps {
    open: boolean;
    title: string;
    actionLabel: string;
    onCancel: () => void;
    onChoose: (pluginUri: string) => void;
}

export default function MultiFXPluginBrowser({
    open,
    title,
    actionLabel,
    onCancel,
    onChoose
}: MultiFXPluginBrowserProps) {
    const model = PiPedalModelFactory.getInstance();

    const [plugins, setPlugins] = useState<UiPlugin[]>(model.ui_plugins.get());
    const [search, setSearch] = useState("");
    const [category, setCategory] = useState("All");
    const [selectedUri, setSelectedUri] = useState<string>("");

    useEffect(() => {
        const changed = (value: UiPlugin[]) => setPlugins(value);
        model.ui_plugins.addOnChangedHandler(changed);
        return () => model.ui_plugins.removeOnChangedHandler(changed);
    }, [model]);

    useEffect(() => {
        if (open) {
            setSearch("");
            setCategory("All");
            setSelectedUri("");
        }
    }, [open]);

    const categories = useMemo(() => {
        const values = new Set<string>();
        for (const plugin of plugins) {
            const label = (plugin.plugin_display_type || "Other").trim();
            if (label) values.add(label);
        }
        return ["All", ...Array.from(values).sort((a, b) => a.localeCompare(b))];
    }, [plugins]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();

        return plugins
            .filter((plugin) => {
                if (category !== "All") {
                    const displayType = (plugin.plugin_display_type || "Other").trim();
                    if (displayType !== category) return false;
                }

                if (!q) return true;

                return [
                    plugin.name,
                    plugin.plugin_display_type,
                    plugin.author_name,
                    plugin.uri
                ].some((value) =>
                    (value || "").toLowerCase().includes(q)
                );
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [plugins, search, category]);

    if (!open) return null;

    const selected = plugins.find((p) => p.uri === selectedUri);

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 25000,
                background: MFX_SURFACES.page.background,
                color: MFX_SURFACES.page.text,
                display: "flex",
                flexDirection: "column"
            }}
        >
            {/* Covers the shell's normal Back arrow while leaving MFX visible. */}
            <button
                type="button"
                aria-label="Back"
                title="Back"
                onClick={onCancel}
                style={{
                    position: "fixed",
                    right: 8,
                    top: 8,
                    zIndex: 30010,
                    width: 48,
                    minWidth: 48,
                    height: 40,
                    padding: 0,
                    borderRadius: 10,
                    border: `2px solid ${MFX_COLORS.purple}`,
                    background: MFX_COLORS.purpleSurface,
                    color: MFX_COLORS.purpleLight,
                    font: "inherit",
                    fontWeight: 900,
                    fontSize: "1.55rem",
                    lineHeight: 1,
                    cursor: "pointer"
                }}
            >
                ←
            </button>

            <div
                style={{
                    minHeight: 56,
                    display: "flex",
                    alignItems: "center",
                    padding: "6px 70px 6px 78px",
                    borderBottom: `1px solid ${MFX_COLORS.border}`,
                    background: MFX_SURFACES.header.background,
                    color: MFX_SURFACES.header.text,
                    boxShadow: MFX_SURFACES.header.shadow,
                    boxSizing: "border-box"
                }}
            >
                <div>
                    <div
                        style={{
                            color: MFX_SURFACES.header.accent,
                            fontWeight: 900,
                            letterSpacing: "0.05em"
                        }}
                    >
                        {title}
                    </div>
                    <div style={{ color: MFX_SURFACES.header.label, fontSize: "0.72rem" }}>
                        Choose the plugin yourself. Nothing is added until you press {actionLabel}.
                    </div>
                </div>
            </div>

            <div
                style={{
                    display: "flex",
                    gap: 8,
                    padding: "10px 12px",
                    borderBottom: `1px solid ${MFX_COLORS.border}`,
                    background: MFX_SURFACES.menu.background,
                    color: MFX_SURFACES.menu.text
                }}
            >
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search plugins..."
                    autoComplete="off"
                    style={{
                        flex: "1 1 auto",
                        minWidth: 120,
                        height: 42,
                        padding: "0 12px",
                        borderRadius: 9,
                        border: `1px solid ${MFX_COLORS.border}`,
                        background: MFX_COLORS.background,
                        color: MFX_COLORS.text,
                        font: "inherit",
                        boxSizing: "border-box"
                    }}
                />

                <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    style={{
                        flex: "0 1 260px",
                        minWidth: 150,
                        height: 42,
                        padding: "0 10px",
                        borderRadius: 9,
                        border: `1px solid ${MFX_COLORS.purple}`,
                        background: MFX_COLORS.panel,
                        color: MFX_COLORS.text,
                        font: "inherit"
                    }}
                >
                    {categories.map((value) => (
                        <option key={value} value={value}>
                            {value}
                        </option>
                    ))}
                </select>
            </div>

            <div
                style={{
                    flex: "1 1 auto",
                    minHeight: 0,
                    overflowY: "auto",
                    padding: 10,
                    touchAction: "pan-y"
                }}
            >
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                        gap: 8
                    }}
                >
                    {filtered.map((plugin) => {
                        const active = selectedUri === plugin.uri;

                        return (
                            <button
                                key={plugin.uri}
                                type="button"
                                onClick={() => setSelectedUri(plugin.uri)}
                                onDoubleClick={() => {
                                    setSelectedUri(plugin.uri);
                                }}
                                style={{
                                    minHeight: 64,
                                    padding: "8px 12px",
                                    borderRadius: 10,
                                    border: active
                                        ? `2px solid ${MFX_COLORS.cyan}`
                                        : `1px solid ${MFX_COLORS.border}`,
                                    background: active
                                        ? MFX_COLORS.cyanSurface
                                        : MFX_COLORS.panel,
                                    color: MFX_COLORS.text,
                                    textAlign: "left",
                                    font: "inherit",
                                    cursor: "pointer"
                                }}
                            >
                                <div
                                    style={{
                                        color: active
                                            ? MFX_COLORS.cyanText
                                            : MFX_COLORS.text,
                                        fontWeight: 900,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis"
                                    }}
                                >
                                    {plugin.name}
                                </div>

                                <div
                                    style={{
                                        marginTop: 3,
                                        color: MFX_COLORS.muted,
                                        fontSize: "0.75rem",
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis"
                                    }}
                                >
                                    {plugin.plugin_display_type || "Plugin"}
                                    {plugin.author_name ? ` • ${plugin.author_name}` : ""}
                                </div>
                            </button>
                        );
                    })}
                </div>

                {filtered.length === 0 && (
                    <div
                        style={{
                            padding: 30,
                            color: MFX_COLORS.muted,
                            textAlign: "center"
                        }}
                    >
                        No plugins match this search.
                    </div>
                )}
            </div>

            <div
                style={{
                    minHeight: 62,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    borderTop: `1px solid ${MFX_COLORS.border}`,
                    background: MFX_SURFACES.header.background,
                    color: MFX_SURFACES.header.text,
                    boxSizing: "border-box"
                }}
            >
                <div
                    style={{
                        flex: "1 1 auto",
                        minWidth: 0
                    }}
                >
                    <div
                        style={{
                            color: selected
                                ? MFX_COLORS.cyan
                                : MFX_COLORS.muted,
                            fontWeight: 850,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                        }}
                    >
                        {selected ? selected.name : "Select a plugin"}
                    </div>
                </div>

                <button
                    type="button"
                    onClick={onCancel}
                    style={footerButton(false)}
                >
                    CANCEL
                </button>

                <button
                    type="button"
                    disabled={!selectedUri}
                    onClick={() => {
                        if (selectedUri) onChoose(selectedUri);
                    }}
                    style={{
                        ...footerButton(true),
                        opacity: selectedUri ? 1 : 0.42
                    }}
                >
                    {actionLabel}
                </button>
            </div>
        </div>
    );
}

function footerButton(primary: boolean): React.CSSProperties {
    return {
        minHeight: 44,
        padding: "7px 16px",
        borderRadius: 9,
        border: primary
            ? `2px solid ${MFX_COLORS.purple}`
            : `1px solid ${MFX_COLORS.border}`,
        background: primary
            ? MFX_COLORS.purpleSurface
            : MFX_COLORS.panelAlt,
        color: primary
            ? MFX_COLORS.purpleLight
            : MFX_COLORS.text,
        font: "inherit",
        fontWeight: 900,
        cursor: "pointer",
        whiteSpace: "nowrap"
    };
}
