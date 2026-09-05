import type { MultiFXKeyboardLayout } from "./MultiFXKeyboardLayouts";

export type MultiFXEditableElement = HTMLInputElement | HTMLTextAreaElement;

const SUPPORTED_INPUT_TYPES = new Set([
    "", "text", "search", "email", "url", "tel", "password", "number"
]);

export function editableElementFromTarget(
    target: EventTarget | null
): MultiFXEditableElement | null {
    const element = target instanceof Element
        ? target.closest("input, textarea")
        : null;
    if (element instanceof HTMLTextAreaElement) {
        return element.disabled || element.readOnly ? null : element;
    }
    if (!(element instanceof HTMLInputElement)
        || element.disabled
        || element.readOnly
        || !SUPPORTED_INPUT_TYPES.has(element.type.toLowerCase())) {
        return null;
    }
    return element;
}

function textFromLabelledBy(element: HTMLElement): string {
    const ids = element.getAttribute("aria-labelledby")?.trim().split(/\s+/)
        ?? [];
    return ids.map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
}

export function inferKeyboardLabel(element: MultiFXEditableElement): string {
    const explicit = element.dataset.multifxKeyboardLabel?.trim();
    if (explicit) return explicit;
    const labels = element instanceof HTMLInputElement
        ? element.labels
        : element.labels;
    const associated = labels?.[0]?.textContent?.trim();
    if (associated) return associated;
    const ariaLabelledBy = textFromLabelledBy(element);
    if (ariaLabelledBy) return ariaLabelledBy;
    // PiPedal's FullScreenIME renders the real parameter caption as a nearby
    // Typography sibling while its temporary input only says "symbol value".
    let context: HTMLElement | null = element.parentElement;
    for (let depth = 0; context && depth < 4; depth += 1) {
        const contextualCaption = Array.from(context.children)
            .find((child) => child.classList.contains("MuiTypography-root"))
            ?.textContent?.trim();
        if (contextualCaption) return contextualCaption;
        context = context.parentElement;
    }
    const ariaLabel = element.getAttribute("aria-label")?.trim();
    if (ariaLabel) {
        const symbolValue = /^([a-z0-9_-]+) value$/i.exec(ariaLabel);
        if (symbolValue) {
            return symbolValue[1]
                .replace(/[_-]+/g, " ")
                .replace(/\b\w/g, (letter) => letter.toUpperCase());
        }
        return ariaLabel;
    }
    const muiLabel = element.closest(".MuiFormControl-root")
        ?.querySelector(".MuiInputLabel-root")?.textContent?.trim();
    if (muiLabel) return muiLabel;
    const pluginControlFrame = element.closest('[class*="controlFrame"]');
    const pluginControlLabel = pluginControlFrame
        ?.querySelector('[class*="titleSection"] .MuiTypography-root')
        ?.textContent?.trim();
    if (pluginControlLabel) return pluginControlLabel;
    if (element.placeholder.trim()) return element.placeholder.trim();
    if (element.name.trim()) return element.name.trim();
    if (element.id.trim()) return element.id.trim();
    return "Edit Value";
}

export function inferKeyboardUnit(element: MultiFXEditableElement): string {
    const explicit = element.dataset.multifxKeyboardUnit?.trim();
    if (explicit) return explicit;
    if (element instanceof HTMLInputElement && element.type === "number") {
        const parts: string[] = [];
        if (element.min) parts.push(`min ${element.min}`);
        if (element.max) parts.push(`max ${element.max}`);
        if (element.step && element.step !== "any") parts.push(`step ${element.step}`);
        return parts.join(" · ");
    }
    return "";
}

export function inferKeyboardLayout(
    element: MultiFXEditableElement
): MultiFXKeyboardLayout {
    const explicit = element.dataset.multifxKeyboardLayout;
    if (explicit === "numeric" || explicit === "decimal") return "numeric";
    if (explicit === "text") return "text";
    const inputMode = element.inputMode.toLowerCase();
    if (element instanceof HTMLInputElement && element.type === "number") {
        return "numeric";
    }
    return inputMode === "numeric" || inputMode === "decimal"
        ? "numeric"
        : "text";
}

export function replaceSelection(
    value: string,
    start: number,
    end: number,
    insertion: string
): { value: string; start: number; end: number } {
    const next = value.slice(0, start) + insertion + value.slice(end);
    const cursor = start + insertion.length;
    return { value: next, start: cursor, end: cursor };
}

export function eraseSelection(
    value: string,
    start: number,
    end: number
): { value: string; start: number; end: number } {
    if (start !== end) return replaceSelection(value, start, end, "");
    if (start <= 0) return { value, start: 0, end: 0 };
    return replaceSelection(value, start - 1, start, "");
}

export function commitEditableValue(
    element: MultiFXEditableElement,
    value: string,
    selectionStart: number,
    selectionEnd: number
): void {
    const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertReplacementText",
        data: value
    }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    try {
        element.setSelectionRange(selectionStart, selectionEnd);
    } catch {
        // Number inputs do not expose a text selection API.
    }
}
