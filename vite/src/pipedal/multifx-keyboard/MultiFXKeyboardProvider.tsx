import { useCallback, useEffect, useRef, useState } from "react";
import MultiFXKeyboard, { MultiFXKeyboardSession } from "./MultiFXKeyboard";
import {
    loadMultiFXKeyboardSettings,
    shouldUseMultiFXKeyboard
} from "./MultiFXKeyboardMode";
import {
    commitEditableValue,
    editableElementFromTarget,
    inferKeyboardLabel,
    inferKeyboardLayout,
    inferKeyboardUnit,
    MultiFXEditableElement
} from "./MultiFXKeyboardUtils";
import {
    resolveMultiFXKeyboardTheme
} from "./MultiFXKeyboardTheme";

type InputModeState = { hadAttribute: boolean; value: string | null };

export default function MultiFXKeyboardProvider() {
    const [session, setSession] = useState<MultiFXKeyboardSession | null>(null);
    const nextSessionId = useRef(0);
    const inputModeState = useRef(new WeakMap<MultiFXEditableElement, InputModeState>());

    const suppressSystemKeyboard = useCallback((element: MultiFXEditableElement) => {
        if (inputModeState.current.has(element)) return;
        inputModeState.current.set(element, {
            hadAttribute: element.hasAttribute("inputmode"),
            value: element.getAttribute("inputmode")
        });
        element.setAttribute("inputmode", "none");
    }, []);

    const restoreInputMode = useCallback((element: MultiFXEditableElement) => {
        const saved = inputModeState.current.get(element);
        if (!saved) return;
        if (saved.hadAttribute && saved.value !== null) {
            element.setAttribute("inputmode", saved.value);
        } else {
            element.removeAttribute("inputmode");
        }
        inputModeState.current.delete(element);
    }, []);

    const open = useCallback((element: MultiFXEditableElement) => {
        const keyboardSettings = loadMultiFXKeyboardSettings();
        if (!shouldUseMultiFXKeyboard(keyboardSettings.mode)) return;
        suppressSystemKeyboard(element);
        let start = element.value.length;
        let end = start;
        try {
            start = element.selectionStart ?? start;
            end = element.selectionEnd ?? start;
        } catch {
            // Number inputs do not expose selectionStart/selectionEnd.
        }
        setSession({
            id: ++nextSessionId.current,
            target: element,
            label: inferKeyboardLabel(element),
            unit: inferKeyboardUnit(element),
            layout: inferKeyboardLayout(element),
            value: element.value,
            selectionStart: start,
            selectionEnd: end,
            password: element instanceof HTMLInputElement && element.type === "password",
            settings: keyboardSettings,
            theme: resolveMultiFXKeyboardTheme(keyboardSettings.themeId)
        });
    }, [suppressSystemKeyboard]);

    const close = useCallback((current: MultiFXKeyboardSession) => {
        current.target.blur();
        restoreInputMode(current.target);
        setSession(null);
    }, [restoreInputMode]);

    useEffect(() => {
        const pointerDown = (event: PointerEvent) => {
            if (!shouldUseMultiFXKeyboard()) return;
            const element = editableElementFromTarget(event.target);
            if (element) suppressSystemKeyboard(element);
        };
        const focusIn = (event: FocusEvent) => {
            const element = editableElementFromTarget(event.target);
            if (element) open(element);
        };
        document.addEventListener("pointerdown", pointerDown, true);
        document.addEventListener("focusin", focusIn, true);

        const active = editableElementFromTarget(document.activeElement);
        if (active) open(active);

        return () => {
            document.removeEventListener("pointerdown", pointerDown, true);
            document.removeEventListener("focusin", focusIn, true);
        };
    }, [open, suppressSystemKeyboard]);

    if (!session) return null;

    return (
        <MultiFXKeyboard
            key={session.id}
            session={session}
            onCancel={() => close(session)}
            onDone={(value, start, end) => {
                commitEditableValue(session.target, value, start, end);
                close(session);
            }}
        />
    );
}
