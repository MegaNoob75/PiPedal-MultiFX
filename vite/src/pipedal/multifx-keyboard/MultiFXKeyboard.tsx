import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
    LETTER_ROWS,
    MultiFXKeyboardLayer,
    MultiFXKeyboardLayout,
    NUMERIC_ROWS,
    SYMBOL_ROWS
} from "./MultiFXKeyboardLayouts";
import {
    eraseSelection,
    MultiFXEditableElement,
    replaceSelection
} from "./MultiFXKeyboardUtils";
import { themePaintToCss } from "../MultiFXTheme";
import "./MultiFXKeyboard.css";
import { MultiFXKeyboardSettings } from "./MultiFXKeyboardMode";
import { MultiFXKeyboardThemeDefinition } from "./MultiFXKeyboardTheme";

export interface MultiFXKeyboardSession {
    id: number;
    target: MultiFXEditableElement;
    label: string;
    unit: string;
    layout: MultiFXKeyboardLayout;
    value: string;
    selectionStart: number;
    selectionEnd: number;
    password: boolean;
    settings: MultiFXKeyboardSettings;
    theme: MultiFXKeyboardThemeDefinition;
}

interface MultiFXKeyboardProps {
    session: MultiFXKeyboardSession;
    onCancel: () => void;
    onDone: (value: string, selectionStart: number, selectionEnd: number) => void;
}

export default function MultiFXKeyboard({
    session,
    onCancel,
    onDone
}: MultiFXKeyboardProps) {
    const [value, setValue] = useState(session.value);
    const [selection, setSelection] = useState({
        start: session.selectionStart,
        end: session.selectionEnd
    });
    const [layer, setLayer] = useState<MultiFXKeyboardLayer>("letters");
    const [shift, setShift] = useState(false);
    const [caps, setCaps] = useState(false);
    const theme = session.theme;

    const insert = (text: string) => {
        const maximum = session.target.maxLength;
        const selectedLength = selection.end - selection.start;
        const available = maximum >= 0
            ? Math.max(0, maximum - (value.length - selectedLength))
            : text.length;
        const accepted = text.slice(0, available);
        if (!accepted) return;
        const result = replaceSelection(
            value,
            selection.start,
            selection.end,
            accepted
        );
        setValue(result.value);
        setSelection({ start: result.start, end: result.end });
        if (shift && !caps) setShift(false);
    };

    const erase = () => {
        const result = eraseSelection(
            value,
            selection.start,
            selection.end
        );
        setValue(result.value);
        setSelection({ start: result.start, end: result.end });
    };

    const moveCursor = (amount: number, extend: boolean) => {
        const anchor = extend ? selection.start : selection.end;
        const cursor = Math.max(0, Math.min(value.length, selection.end + amount));
        setSelection(extend
            ? { start: Math.min(anchor, cursor), end: Math.max(anchor, cursor) }
            : { start: cursor, end: cursor });
    };

    useEffect(() => {
        const keyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key === "Enter") {
                event.preventDefault();
                onDone(value, selection.start, selection.end);
            } else if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
            } else if (event.key === "Backspace") {
                event.preventDefault();
                erase();
            } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                moveCursor(-1, event.shiftKey);
            } else if (event.key === "ArrowRight") {
                event.preventDefault();
                moveCursor(1, event.shiftKey);
            } else if (event.key.length === 1) {
                if (session.layout === "numeric"
                    && !/^[0-9.-]$/.test(event.key)) {
                    return;
                }
                event.preventDefault();
                insert(event.key);
            }
        };
        window.addEventListener("keydown", keyDown, true);
        return () => window.removeEventListener("keydown", keyDown, true);
    });

    const keyboardStyle = useMemo(() => ({
        "--mfx-keyboard-backdrop": themePaintToCss(theme.backdrop),
        "--mfx-keyboard-background": themePaintToCss(theme.panel),
        "--mfx-keyboard-value-background": themePaintToCss(theme.valueBox),
        "--mfx-keyboard-key-background": themePaintToCss(theme.key),
        "--mfx-keyboard-active": themePaintToCss(theme.pressedKey),
        "--mfx-keyboard-border": theme.border,
        "--mfx-keyboard-text": theme.text,
        "--mfx-keyboard-muted": theme.secondaryText,
        "--mfx-keyboard-accent": theme.accent,
        "--mfx-keyboard-active-text": theme.pressedText,
        "--mfx-keyboard-danger": theme.cancel
    }) as React.CSSProperties, [theme]);

    const letterRows = LETTER_ROWS.map((row) => row.map((letter) =>
        shift !== caps ? letter.toUpperCase() : letter
    ));
    const rows = session.layout === "numeric"
        ? NUMERIC_ROWS
        : layer === "symbols" ? SYMBOL_ROWS : letterRows;

    const visibleValue = session.password ? "•".repeat(value.length) : value;
    const before = visibleValue.slice(0, selection.start);
    const selected = visibleValue.slice(selection.start, selection.end);
    const after = visibleValue.slice(selection.end);

    const key = (label: string, action: () => void, className = "") => (
        <button type="button" className={`multifx-keyboard-key ${className}`}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
                if (session.settings.hapticFeedback) navigator.vibrate?.(8);
                action();
            }} aria-label={label}>
            {label}
        </button>
    );

    return createPortal(
        <div className={`multifx-keyboard-backdrop${session.settings.transparentBackground
            ? " is-transparent" : ""} text-${session.settings.textSize} size-${session.settings.size} placement-${session.settings.placement}`} style={keyboardStyle}
            role="dialog" aria-modal="true" aria-label={`Keyboard for ${session.label}`}>
            <div className={`multifx-keyboard-panel${session.settings.transparentBackground
                ? " is-transparent" : ""} keys-${session.settings.keyShape}`}>
                <div className="multifx-keyboard-value" aria-live="polite">
                    <div className="multifx-keyboard-value-heading">
                        <span className="multifx-keyboard-label">{session.label}</span>
                        {session.unit && <span className="multifx-keyboard-unit">{session.unit}</span>}
                    </div>
                    <div className="multifx-keyboard-value-text">
                        {before}
                        {selected
                            ? <span className="multifx-keyboard-selection">{selected}</span>
                            : <span className="multifx-keyboard-caret" />}
                        {after || "\u00a0"}
                    </div>
                </div>
                <div className="multifx-keyboard-rows">
                    {rows.map((row, rowIndex) => (
                        <div className="multifx-keyboard-row" key={rowIndex}>
                            {row.map((character) => key(character, () => insert(character)))}
                        </div>
                    ))}
                    {session.layout === "text" && layer === "letters" && (
                        <div className="multifx-keyboard-row">
                            {key("⇧", () => {
                                if (shift) {
                                    setCaps(true);
                                    setShift(false);
                                } else if (caps) {
                                    setCaps(false);
                                } else {
                                    setShift(true);
                                }
                            }, shift || caps ? "is-active is-wide" : "is-wide")}
                            {key("⌫", erase, "is-wide")}
                        </div>
                    )}
                </div>
                <div className="multifx-keyboard-row">
                    {session.layout === "text" && key(
                        layer === "letters" ? "123" : "ABC",
                        () => setLayer(layer === "letters" ? "symbols" : "letters"),
                        "is-wide"
                    )}
                    {session.layout === "text" && key("SPACE", () => insert(" "), "is-space")}
                    {session.layout === "numeric" && key("⌫", erase, "is-wide")}
                    {key("CANCEL", onCancel, "is-wide is-cancel")}
                    {key("DONE", () => onDone(value, selection.start, selection.end), "is-wide is-done")}
                </div>
            </div>
        </div>,
        document.body
    );
}
