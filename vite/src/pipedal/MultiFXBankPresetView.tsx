/*
 * PiPedal-MultiFX — Bank / Preset View Wrapper
 *
 * BankPresetManager owns everyday MultiFX organization. This wrapper adds the
 * few native PiPedal bank-file operations that were still missing from the MFX
 * workflow: clone, download and upload.
 *
 * PiPedal remains authoritative for bank contents and file formats. MultiFX
 * only supplies appliance-style buttons and name validation around the native
 * saveBankAs(), download() and uploadBank() calls.
 */

import { useEffect, useRef, useState } from "react";
import BankPresetManager from "./BankPresetManager";
import { BankIndex } from "./Banks";
import { PiPedalModelFactory } from "./PiPedalModel";
import { MFX_COLORS } from "./MultiFXTheme";

type MultiFXBankPresetViewProps = {
    onClose: () => void;
};

export default function MultiFXBankPresetView({
    onClose
}: MultiFXBankPresetViewProps) {
    const model = PiPedalModelFactory.getInstance();
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const [banks, setBanks] = useState<BankIndex>(
        () => model.banks.get().clone()
    );
    const [busy, setBusy] = useState(false);
    const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
    const [cloneName, setCloneName] = useState("");

    useEffect(() => {
        const handleBanksChanged = () => {
            setBanks(model.banks.get().clone());
        };

        model.banks.addOnChangedHandler(handleBanksChanged);
        handleBanksChanged();

        return () => {
            model.banks.removeOnChangedHandler(handleBanksChanged);
        };
    }, [model]);

    const selectedBankId = banks.selectedBank;
    const selectedBank = banks.getEntry(selectedBankId);

    const showError = (error: unknown) => {
        model.showAlert(
            error instanceof Error ? error.message : String(error)
        );
    };

    const bankNameExists = (name: string) =>
        banks.entries.some(
            (bank) => bank.name.localeCompare(name, undefined, {
                sensitivity: "accent"
            }) === 0
        );

    const makeCloneName = () => {
        const baseName = selectedBank?.name?.trim() || "Bank";
        const firstChoice = `${baseName} Copy`;

        if (!bankNameExists(firstChoice)) {
            return firstChoice;
        }

        let suffix = 2;
        while (bankNameExists(`${baseName} Copy ${suffix}`)) {
            suffix += 1;
        }

        return `${baseName} Copy ${suffix}`;
    };

    const beginClone = () => {
        if (!selectedBank || busy) {
            return;
        }

        setCloneName(makeCloneName());
        setCloneDialogOpen(true);
    };

    const cloneBank = async () => {
        if (!selectedBank || busy) {
            return;
        }

        const name = cloneName.trim();
        if (!name) {
            model.showAlert("Enter a name for the cloned bank.");
            return;
        }

        if (bankNameExists(name)) {
            model.showAlert("A bank with that name already exists.");
            return;
        }

        setBusy(true);

        try {
            // saveBankAs is PiPedal's native whole-bank copy operation. Unlike
            // MultiFX NEW BANK, we intentionally keep every copied preset.
            const newBankId = await model.saveBankAs(
                selectedBank.instanceId,
                name
            );

            await model.openBank(newBankId);
            setCloneDialogOpen(false);
        } catch (error) {
            showError(error);
        } finally {
            setBusy(false);
        }
    };

    const downloadBank = () => {
        if (!selectedBank || busy) {
            return;
        }

        // PiPedal owns the .piBank serialization and browser download.
        model.download("downloadBank", selectedBank.instanceId);
    };

    const uploadBanks = async (fileList: FileList) => {
        if (busy || fileList.length === 0) {
            return;
        }

        setBusy(true);

        try {
            // Match PiPedal's native BankDialog behavior: importing several
            // files inserts each subsequent bank after the previous import.
            let uploadAfter = selectedBankId;

            for (let index = 0; index < fileList.length; index++) {
                uploadAfter = await model.uploadBank(
                    fileList[index],
                    uploadAfter
                );
            }

            // Bring the newly imported bank into the MultiFX manager so the
            // result is immediately visible instead of merely existing in the
            // background bank list.
            if (uploadAfter >= 0) {
                await model.openBank(uploadAfter);
            }
        } catch (error) {
            showError(error);
        } finally {
            setBusy(false);
        }
    };

    const toolbarButtonStyle: React.CSSProperties = {
        minHeight: "var(--mfx-touch-height, 40px)",
        padding: "0 12px",
        borderRadius: 9,
        border: `1px solid ${MFX_COLORS.border}`,
        background: MFX_COLORS.panelAlt,
        color: MFX_COLORS.text,
        font: "inherit",
        fontSize: "0.75rem",
        fontWeight: 900,
        letterSpacing: "0.035em",
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.55 : 1
    };

    return (
        <div
            style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                overflow: "hidden",
                background: MFX_COLORS.background,
                color: MFX_COLORS.text
            }}
        >
            <style>
                {`
                    /* File/clone tools belong to the Bank pane. The native
                       MultiFX bank toolbar stays immediately below them while
                       the Preset pane keeps its normal full-height layout. */
                    .mfx-bank-manager-host > div > div:nth-child(2) > section:first-child > div:first-child {
                        padding-top: calc(58px * var(--mfx-ui-scale, 1)) !important;
                    }
                `}
            </style>

            <div
                className="mfx-bank-file-tools"
                style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    zIndex: 1005,
                    width: "34%",
                    minHeight: "calc(50px * var(--mfx-ui-scale, 1))",
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 6,
                    padding: "4px 8px",
                    boxSizing: "border-box",
                    borderRight: `1px solid ${MFX_COLORS.border}`,
                    borderBottom: `1px solid ${MFX_COLORS.border}`,
                    background: MFX_COLORS.panel
                }}
            >
                <button
                    type="button"
                    disabled={!selectedBank || busy}
                    onClick={beginClone}
                    style={toolbarButtonStyle}
                >
                    CLONE
                </button>

                <button
                    type="button"
                    disabled={!selectedBank || busy}
                    onClick={downloadBank}
                    style={toolbarButtonStyle}
                >
                    DOWNLOAD
                </button>

                <button
                    type="button"
                    disabled={busy}
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                        ...toolbarButtonStyle,
                        border: `1px solid ${MFX_COLORS.cyan}`,
                        background: MFX_COLORS.cyanSurface,
                        color: MFX_COLORS.cyanText
                    }}
                >
                    UPLOAD
                </button>

                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".piBank"
                    style={{ display: "none" }}
                    onChange={(event) => {
                        const files = event.target.files;
                        if (files && files.length > 0) {
                            void uploadBanks(files);
                        }

                        // Reset the input so selecting the same file again still
                        // produces a change event, matching PiPedal BankDialog.
                        event.target.value = "";
                    }}
                />
            </div>

            <div
                className="mfx-bank-manager-host"
                style={{
                    position: "absolute",
                    inset: 0,
                    minHeight: 0,
                    overflow: "hidden"
                }}
            >
                <BankPresetManager onClose={onClose} />
            </div>

            {cloneDialogOpen && selectedBank && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        zIndex: 1300,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 24,
                        boxSizing: "border-box",
                        background: "rgba(0,0,0,0.72)"
                    }}
                    onClick={() => {
                        if (!busy) {
                            setCloneDialogOpen(false);
                        }
                    }}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="Clone bank"
                        onClick={(event) => event.stopPropagation()}
                        style={{
                            width: "min(520px, 88vw)",
                            padding: 18,
                            borderRadius: 12,
                            border: `2px solid ${MFX_COLORS.purple}`,
                            background: MFX_COLORS.panel,
                            boxShadow: "0 18px 50px rgba(0,0,0,0.8)"
                        }}
                    >
                        <div
                            style={{
                                marginBottom: 7,
                                color: MFX_COLORS.purpleLight,
                                fontWeight: 900,
                                fontSize: "1.25rem"
                            }}
                        >
                            Clone Bank
                        </div>

                        <div
                            style={{
                                marginBottom: 13,
                                color: MFX_COLORS.muted,
                                fontSize: "0.86rem"
                            }}
                        >
                            Copy “{selectedBank.name}” with all of its presets.
                            The clone must have a unique name.
                        </div>

                        <input
                            autoFocus
                            value={cloneName}
                            onChange={(event) => setCloneName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    void cloneBank();
                                } else if (event.key === "Escape" && !busy) {
                                    setCloneDialogOpen(false);
                                }
                            }}
                            style={{
                                width: "100%",
                                minHeight: 48,
                                boxSizing: "border-box",
                                padding: "8px 12px",
                                borderRadius: 8,
                                border: `2px solid ${MFX_COLORS.purple}`,
                                outline: "none",
                                background: MFX_COLORS.background,
                                color: MFX_COLORS.text,
                                font: "inherit",
                                fontSize: "1.05rem",
                                fontWeight: 800
                            }}
                        />

                        <div
                            style={{
                                display: "flex",
                                justifyContent: "flex-end",
                                gap: 8,
                                marginTop: 16
                            }}
                        >
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => setCloneDialogOpen(false)}
                                style={toolbarButtonStyle}
                            >
                                CANCEL
                            </button>

                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => void cloneBank()}
                                style={{
                                    ...toolbarButtonStyle,
                                    border: `1px solid ${MFX_COLORS.purple}`,
                                    background: MFX_COLORS.purpleSurface,
                                    color: MFX_COLORS.purpleLight
                                }}
                            >
                                {busy ? "CLONING..." : "CLONE"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
