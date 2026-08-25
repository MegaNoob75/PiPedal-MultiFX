/* Bank/preset manager wrapper for native PiPedal bank-file operations. */
import React, { useEffect, useRef, useState } from "react";
import BankPresetManager from "./BankPresetManager";
import { BankIndex } from "./Banks";
import { PiPedalModelFactory } from "./PiPedalModel";
import {
    getBankPresetAssignments,
    setPresetAssignment
} from "./MultiFXPresetAssignments";
import {
    MFX_COLORS,
    MFX_SURFACES,
    multiFXSurfaceBackground
} from "./MultiFXTheme";

export default function MultiFXBankPresetView() {
    const model = PiPedalModelFactory.getInstance();
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [banks, setBanks] = useState<BankIndex>(() => model.banks.get().clone());
    const [busy, setBusy] = useState(false);
    const [cloneOpen, setCloneOpen] = useState(false);
    const [cloneName, setCloneName] = useState("");

    useEffect(() => {
        const changed = () => setBanks(model.banks.get().clone());
        model.banks.addOnChangedHandler(changed);
        changed();
        return () => model.banks.removeOnChangedHandler(changed);
    }, [model]);

    const selectedBank = banks.getEntry(banks.selectedBank);
    const nameExists = (name: string) => banks.entries.some((bank) =>
        bank.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0
    );

    const defaultCloneName = () => {
        const base = selectedBank?.name?.trim() || "Bank";
        let candidate = `${base} Copy`;
        let number = 2;
        while (nameExists(candidate)) candidate = `${base} Copy ${number++}`;
        return candidate;
    };

    const cloneBank = async () => {
        if (!selectedBank || busy) return;
        const name = cloneName.trim();
        if (!name || nameExists(name)) {
            model.showAlert(!name ? "Enter a bank name." : "A bank with that name already exists.");
            return;
        }

        setBusy(true);
        try {
            const sourceBankId = selectedBank.instanceId;
            const sourcePresetIds = model.presets.get().presets.map((preset) => preset.instanceId);
            const sourceAssignments = getBankPresetAssignments(sourceBankId);

            const newBankId = await model.saveBankAs(sourceBankId, name);
            await model.openBank(newBankId);
            const clonedPresetIds = model.presets.get().presets.map((preset) => preset.instanceId);

            // PiPedal clones presets in bank order. Translate assignment IDs by
            // that order so the cloned bank has the same footswitch pattern.
            for (const [switchId, sourcePresetId] of Object.entries(sourceAssignments)) {
                if (sourcePresetId === null) {
                    await setPresetAssignment(newBankId, switchId, null);
                    continue;
                }
                const sourceIndex = sourcePresetIds.indexOf(sourcePresetId);
                const clonedPresetId = sourceIndex >= 0 ? clonedPresetIds[sourceIndex] ?? null : null;
                await setPresetAssignment(newBankId, switchId, clonedPresetId);
            }
            setCloneOpen(false);
        } catch (error) {
            model.showAlert(String(error));
        } finally {
            setBusy(false);
        }
    };

    const downloadBank = () => {
        if (selectedBank && !busy) model.download("downloadBank", selectedBank.instanceId);
    };

    const uploadBanks = async (files: FileList) => {
        if (busy || files.length === 0) return;
        setBusy(true);
        try {
            let after = banks.selectedBank;
            for (let index = 0; index < files.length; ++index) {
                after = await model.uploadBank(files[index], after);
            }
            if (after >= 0) await model.openBank(after);
        } catch (error) {
            model.showAlert(String(error));
        } finally {
            setBusy(false);
        }
    };

    const tools = (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" disabled={!selectedBank || busy} style={buttonStyle}
                onClick={() => { setCloneName(defaultCloneName()); setCloneOpen(true); }}>CLONE</button>
            <button type="button" disabled={!selectedBank || busy} style={buttonStyle} onClick={downloadBank}>DOWNLOAD</button>
            <button type="button" disabled={busy} style={accentButtonStyle} onClick={() => fileInputRef.current?.click()}>UPLOAD</button>
            <input ref={fileInputRef} type="file" multiple accept=".piBank" style={{ display: "none" }}
                onChange={(event) => {
                    if (event.target.files) void uploadBanks(event.target.files);
                    event.target.value = "";
                }} />
        </div>
    );

    return <>
        <BankPresetManager bankTools={tools} />
        {cloneOpen && selectedBank && (
            <div style={overlayStyle} onClick={() => !busy && setCloneOpen(false)}>
                <div style={dialogStyle} onClick={(event) => event.stopPropagation()}>
                    <strong>Clone Bank</strong>
                    <div style={{ color: MFX_COLORS.muted }}>Copy “{selectedBank.name}” with its presets and Performance switch assignments.</div>
                    <input autoFocus value={cloneName} onChange={(event) => setCloneName(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") void cloneBank();
                            if (event.key === "Escape" && !busy) setCloneOpen(false);
                        }} style={inputStyle} />
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                        <button style={buttonStyle} disabled={busy} onClick={() => setCloneOpen(false)}>CANCEL</button>
                        <button style={accentButtonStyle} disabled={busy} onClick={() => void cloneBank()}>{busy ? "CLONING..." : "CLONE"}</button>
                    </div>
                </div>
            </div>
        )}
    </>;
}

const buttonStyle: React.CSSProperties = { minHeight: 38, padding: "0 10px", borderRadius: 8, border: `1px solid ${MFX_COLORS.border}`, background: MFX_COLORS.panelAlt, color: MFX_COLORS.text, font: "inherit", fontWeight: 900, cursor: "pointer" };
const accentButtonStyle: React.CSSProperties = { ...buttonStyle, border: `1px solid ${MFX_COLORS.cyan}`, background: MFX_COLORS.cyanSurface, color: MFX_COLORS.cyanText };
const overlayStyle: React.CSSProperties = { position: "absolute", inset: 0, zIndex: 1600, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.72)" };
const dialogStyle: React.CSSProperties = { width: "min(520px, 88vw)", padding: 18, borderRadius: 12, border: "2px solid transparent", background: multiFXSurfaceBackground("popup"), color: MFX_SURFACES.popup.text, boxShadow: MFX_SURFACES.popup.shadow, display: "flex", flexDirection: "column", gap: 12 };
const inputStyle: React.CSSProperties = { minHeight: 46, padding: "0 10px", borderRadius: 8, border: `1px solid ${MFX_COLORS.border}`, background: MFX_COLORS.background, color: MFX_COLORS.text, font: "inherit" };
