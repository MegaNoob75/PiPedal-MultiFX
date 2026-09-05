import { useEffect, useMemo, useState } from "react";
import SettingsDialog from "../pipedal/SettingsDialog";
import MultiFXUpdatesView from "./MultiFXUpdatesView";
import { PiPedalModelFactory } from "../pipedal/PiPedalModel";

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
    const model = useMemo(() => PiPedalModelFactory.getInstance(), []);
    const [updatesOpen, setUpdatesOpen] = useState(false);

    useEffect(() => {
        document.body.classList.add("multifx-settings-route");

        // PiPedal's SettingsDialog calls this public model action. Redirect it
        // only while hosted by MultiFX so its existing Check for updates row
        // opens our owned update view above the nested settings dialog.
        const originalShowUpdateDialog = model.showUpdateDialog;
        model.showUpdateDialog = (show: boolean = true) => {
            setUpdatesOpen(show);
        };

        return () => {
            model.showUpdateDialog = originalShowUpdateDialog;
            document.body.classList.remove("multifx-settings-route");
        };
    }, [model]);

    return (
        <>
            <SettingsDialog
                open={true}
                onboarding={false}
                onClose={onClose}
            />
            {updatesOpen && (
                <div style={updatesOverlayStyle}>
                    <MultiFXUpdatesView onClose={() => setUpdatesOpen(false)} />
                </div>
            )}
        </>
    );
}

const updatesOverlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 1600
};
