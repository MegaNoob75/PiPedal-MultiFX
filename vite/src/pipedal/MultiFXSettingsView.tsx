import { useEffect } from "react";
import SettingsDialog from "./SettingsDialog";

interface MultiFXSettingsViewProps {
    onClose: () => void;
}

/**
 * MultiFX host for PiPedal's complete native Settings application.
 *
 * PiPedal's SettingsDialog already contains the audio, MIDI, routing,
 * networking, display, governor and system settings workflows. MultiFX keeps
 * that functionality intact and applies its own shell/theme around it.
 */
export default function MultiFXSettingsView({
    onClose
}: MultiFXSettingsViewProps) {
    useEffect(() => {
        document.body.classList.add("multifx-settings-route");

        return () => {
            document.body.classList.remove("multifx-settings-route");
        };
    }, []);

    return (
        <SettingsDialog
            open={true}
            onboarding={false}
            onClose={onClose}
        />
    );
}
