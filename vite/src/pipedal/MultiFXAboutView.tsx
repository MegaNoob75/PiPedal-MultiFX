/*
 * PiPedal-MultiFX — About / Legal
 *
 * This is a completely local MultiFX view.
 *
 * IMPORTANT:
 * - It does not mount PiPedal's AboutDialog.
 * - It does not use DialogEx or PiPedal's dialog stack.
 * - It does not make a network request when the legal view is opened.
 *
 * The static legal/attribution content below mirrors the substantive legal
 * information currently presented by PiPedal's native About dialog. Keeping
 * this page local lets MultiFX present those notices without disturbing the
 * PiPedal websocket/application lifecycle.
 *
 * PiPedal's generated open-source notices are intentionally NOT fetched here.
 * The installed PiPedal file remains the authoritative generated notice source:
 *     /etc/pipedal/react/var/notices.txt
 *
 * We are temporarily avoiding the runtime fetch specifically to prove whether
 * that first legal-page request is what causes PiPedal to enter Reconnecting.
 */

import { useState } from "react";
import { PiPedalModelFactory } from "./PiPedalModel";
import { MFX_COLORS, MFX_HEADER_HEIGHT } from "./MultiFXTheme";

export default function MultiFXAboutView() {
    const model = PiPedalModelFactory.getInstance();
    const [legalOpen, setLegalOpen] = useState(false);

    const serverInfo = model.serverVersion;
    const serverVersion = serverInfo?.serverVersion ?? "Unknown";

    const supportPiPedal = () => {
        if (model.isAndroidHosted()) {
            model.showAndroidDonationActivity();
            return;
        }

        window.open(
            "https://github.com/sponsors/rerdavies",
            "_blank",
            "noopener,noreferrer"
        );
    };

    const actionButtonStyle: React.CSSProperties = {
        minHeight: "var(--mfx-touch-height, 42px)",
        padding: "8px 14px",
        borderRadius: 10,
        border: `2px solid ${MFX_COLORS.purple}`,
        background: MFX_COLORS.purpleSurface,
        color: MFX_COLORS.purpleLight,
        font: "inherit",
        fontWeight: 900,
        letterSpacing: "0.035em",
        cursor: "pointer"
    };

    if (legalOpen) {
        return (
            <div style={pageStyle}>
                <div style={legalHeaderStyle}>
                    <button
                        type="button"
                        onClick={() => setLegalOpen(false)}
                        style={{
                            ...actionButtonStyle,
                            minWidth: 76,
                            padding: "4px 10px"
                        }}
                    >
                        ← BACK
                    </button>

                    <div
                        style={{
                            flex: "1 1 auto",
                            textAlign: "center",
                            color: MFX_COLORS.purpleLight,
                            fontWeight: 900,
                            letterSpacing: "0.06em"
                        }}
                    >
                        PIPEDAL ABOUT / LEGAL
                    </div>

                    <div style={{ width: 76 }} />
                </div>

                <div style={scrollStyle}>
                    <div style={contentStyle}>
                        <Section title="PiPedal">
                            <InfoRow label="Version" value={serverVersion} />
                            <InfoRow
                                label="Build"
                                value={serverInfo?.debug ? "Debug" : "Release"}
                            />
                            <InfoRow
                                label="Server OS"
                                value={serverInfo?.osVersion ?? "Unknown"}
                            />

                            {serverInfo?.webAddresses?.length ? (
                                <div style={{ marginTop: 14 }}>
                                    <div style={captionStyle}>ADDRESSES</div>
                                    {serverInfo.webAddresses.map((address, index) => (
                                        <div
                                            key={`${address}-${index}`}
                                            style={noticeLineStyle}
                                        >
                                            {address}
                                        </div>
                                    ))}
                                </div>
                            ) : null}

                            <p style={paragraphStyle}>
                                PiPedal was created by Robin E. R. Davies.
                                PiPedal MultiFX is an unofficial alternative
                                interface built on PiPedal and does not replace
                                PiPedal's upstream licensing or attribution.
                            </p>
                        </Section>

                        <Section title="TONE3000 bundled content">
                            <p style={paragraphStyle}>
                                The following files are provided under a T3K
                                license. Under an arrangement with Tone3000.com,
                                permission has been granted to Robin Davies to
                                distribute these files for use only with PiPedal.
                            </p>

                            <LegalPath path="/etc/pipedal/config/default_presets/presets/Factory Presets.piBank" />
                            <LegalPath path="/var/pipedal/audio_uploads/NeuralAmpModels/Factory Models/" />
                            <LegalPath path="/var/pipedal/audio_uploads/IRs/Factory IRs/" />

                            <p style={paragraphStyle}>
                                Contact the original authors for permission before
                                distributing those data files for other purposes
                                or as part of a forked PiPedal distribution.
                                Detailed attribution is installed with the files:
                            </p>

                            <LegalPath path="/var/pipedal/audio_uploads/NeuralAmpModels/Factory Models/README.md" />
                            <LegalPath path="/var/pipedal/audio_uploads/IRs/Factory IRs/README.md" />

                            <div style={attributionBoxStyle}>
                                <Attribution name="2dor" url="https://tone3000.com/t2dor" />
                                <Attribution name="amalgamaudio" url="https://tone3000.com/amalgamaudio" />
                                <Attribution name="kenazmusic" url="https://tone3000.com/kenazmusic" />
                                <Attribution name="outmodedelectronics" url="https://tone3000.com/outmodedelectronics" />
                                <Attribution name="scottcorgan" url="https://tone3000.com/scottcorgan" />
                                <Attribution name="tone3000" url="https://tone3000.com/tone3000" />
                            </div>

                            <Subheading>T3K License</Subheading>
                            <p style={paragraphStyle}>
                                Users may download and use the data file in
                                software and publish the resulting outputs
                                without royalties or restrictions. However, they
                                may not upload, republish, or distribute the data
                                file without the author's permission.
                            </p>
                        </Section>

                        <Section title="PiPedal factory presets">
                            <p style={paragraphStyle}>
                                PiPedal factory presets are licensed under a
                                CC-BY-4.0 license.
                            </p>

                            <div style={attributionBoxStyle}>
                                <div>© Robin E. R. Davies</div>
                                <div>© Andrew Curtis</div>
                            </div>

                            <ExternalLink href="https://creativecommons.org/licenses/by/4.0/">
                                Creative Commons Attribution 4.0
                            </ExternalLink>
                        </Section>

                        <Section title="CabIR content">
                            <p style={paragraphStyle}>
                                Installed files in
                                <b> /var/pipedal/audio_uploads/CabIR </b>
                                are provided under a CC-BY-4.0 license. Refer to
                                the installed license file for detailed
                                attribution.
                            </p>

                            <LegalPath path="/var/pipedal/audio_uploads/CabIR/LICENSE.md" />

                            <div style={attributionBoxStyle}>
                                © Kristoffer Ekstrand, Adventure Kid Research & Technology
                            </div>
                        </Section>

                        <Section title="Convolution Reverb content">
                            <p style={paragraphStyle}>
                                Installed files in
                                <b> /var/pipedal/audio_uploads/ConvolutionReverb </b>
                                are provided under a CC-BY-4.0 license. Refer to
                                the installed license file for detailed
                                attribution.
                            </p>

                            <LegalPath path="/var/pipedal/audio_uploads/ConvolutionReverb/LICENSE.md" />

                            <div style={attributionBoxStyle}>
                                <Attribution
                                    name="Greg Hopkins"
                                    url="https://hopkinsmedia.services/ir"
                                />
                                <Attribution
                                    name="Open AIR Library — University of York"
                                    url="https://www.openairlib.net/"
                                />
                                <div>
                                    © AudioLab University of York, Alex Duffell,
                                    Aishwarya Sridhar, Zhong Li
                                </div>
                                <div>
                                    © Audio Lab University of York, Andrew Chadwick,
                                    Simon Shelley
                                </div>
                                <div>
                                    © AudioLab University of York, www.ncem.co.uk
                                </div>
                            </div>
                        </Section>

                        <Section title="Open-source notices">
                            <p style={paragraphStyle}>
                                PiPedal's generated third-party/open-source
                                notices remain authoritative in the installed
                                PiPedal web package. This test version deliberately
                                does not fetch that file when this page opens,
                                because we are isolating the first-open reconnect.
                            </p>

                            <LegalPath path="/etc/pipedal/react/var/notices.txt" />

                            <div style={noticeBoxStyle}>
                                No PiPedal model operation, websocket command,
                                dialog-stack operation, or HTTP fetch is performed
                                by opening or closing this legal page.
                            </div>
                        </Section>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={pageStyle}>
            <div
                style={{
                    flex: `0 0 ${MFX_HEADER_HEIGHT}px`,
                    height: MFX_HEADER_HEIGHT,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 12px 6px 78px",
                    boxSizing: "border-box",
                    borderBottom: `1px solid ${MFX_COLORS.border}`,
                    background: MFX_COLORS.panel
                }}
            >
                <div
                    style={{
                        flex: "1 1 auto",
                        textAlign: "right",
                        color: MFX_COLORS.purpleLight,
                        fontWeight: 900,
                        letterSpacing: "0.05em"
                    }}
                >
                    ABOUT
                </div>
            </div>

            <div style={scrollStyle}>
                <div style={contentStyle}>
                    <div
                        style={{
                            padding: 22,
                            borderRadius: 14,
                            border: `2px solid ${MFX_COLORS.purple}`,
                            background: MFX_COLORS.panel,
                            boxShadow: "0 10px 28px rgba(0,0,0,0.42)"
                        }}
                    >
                        <div
                            style={{
                                color: MFX_COLORS.purpleLight,
                                fontSize: "1.7rem",
                                fontWeight: 900,
                                letterSpacing: "0.04em"
                            }}
                        >
                            PiPedal MultiFX
                        </div>

                        <div
                            style={{
                                marginTop: 6,
                                color: MFX_COLORS.cyan,
                                fontWeight: 800
                            }}
                        >
                            Alternative performance interface for PiPedal
                        </div>

                        <p style={paragraphStyle}>
                            PiPedal MultiFX provides a touchscreen- and
                            foot-controller-focused interface while continuing
                            to use PiPedal for pedalboards, plugins, banks,
                            presets, audio processing and system management.
                        </p>

                        <InfoRow label="PiPedal server" value={serverVersion} />
                        <InfoRow label="Interface" value="PiPedal MultiFX" />

                        <div
                            style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 10,
                                marginTop: 18
                            }}
                        >
                            <button
                                type="button"
                                onClick={() => setLegalOpen(true)}
                                style={actionButtonStyle}
                            >
                                PIPEDAL ABOUT / LEGAL
                            </button>

                            <button
                                type="button"
                                onClick={supportPiPedal}
                                style={{
                                    ...actionButtonStyle,
                                    borderColor: MFX_COLORS.cyan,
                                    background: MFX_COLORS.cyanSurface,
                                    color: MFX_COLORS.cyanText
                                }}
                            >
                                SUPPORT PIPEDAL
                            </button>
                        </div>

                        <div
                            style={{
                                marginTop: 18,
                                padding: "12px 14px",
                                borderRadius: 9,
                                border: `1px solid ${MFX_COLORS.border}`,
                                background: MFX_COLORS.panelAlt,
                                color: MFX_COLORS.muted,
                                fontSize: "0.86rem",
                                lineHeight: 1.45
                            }}
                        >
                            PiPedal legal details are displayed entirely inside
                            MultiFX. The legal-page button performs only a local
                            React state change.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Section({
    title,
    children
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section
            style={{
                marginBottom: 18,
                padding: 18,
                borderRadius: 12,
                border: `1px solid ${MFX_COLORS.border}`,
                background: MFX_COLORS.panel
            }}
        >
            <div
                style={{
                    marginBottom: 12,
                    color: MFX_COLORS.purpleLight,
                    fontWeight: 900,
                    fontSize: "1.08rem",
                    letterSpacing: "0.04em"
                }}
            >
                {title}
            </div>
            {children}
        </section>
    );
}

function Subheading({ children }: { children: React.ReactNode }) {
    return (
        <div
            style={{
                marginTop: 16,
                marginBottom: 6,
                color: MFX_COLORS.cyan,
                fontWeight: 900
            }}
        >
            {children}
        </div>
    );
}

function InfoRow({
    label,
    value
}: {
    label: string;
    value: string;
}) {
    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "160px 1fr",
                gap: 12,
                padding: "9px 0",
                borderBottom: `1px solid ${MFX_COLORS.border}`
            }}
        >
            <div style={{ color: MFX_COLORS.muted, fontWeight: 700 }}>
                {label}
            </div>
            <div style={{ color: MFX_COLORS.text, fontWeight: 800 }}>
                {value}
            </div>
        </div>
    );
}

function LegalPath({ path }: { path: string }) {
    return <div style={noticeLineStyle}>{path}</div>;
}

function Attribution({
    name,
    url
}: {
    name: string;
    url: string;
}) {
    return (
        <div>
            © {name} —{" "}
            <a
                href={url}
                target="_blank"
                rel="noreferrer"
                style={linkStyle}
            >
                {url}
            </a>
        </div>
    );
}

function ExternalLink({
    href,
    children
}: {
    href: string;
    children: React.ReactNode;
}) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noreferrer"
            style={{
                ...linkStyle,
                display: "inline-block",
                marginTop: 8
            }}
        >
            {children}
        </a>
    );
}

const pageStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: MFX_COLORS.background,
    color: MFX_COLORS.text
};

const legalHeaderStyle: React.CSSProperties = {
    flex: `0 0 ${MFX_HEADER_HEIGHT}px`,
    minHeight: MFX_HEADER_HEIGHT,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 12px",
    boxSizing: "border-box",
    borderBottom: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panel
};

const scrollStyle: React.CSSProperties = {
    flex: "1 1 auto",
    minHeight: 0,
    overflowY: "auto",
    padding: 24,
    boxSizing: "border-box",
    touchAction: "pan-y"
};

const contentStyle: React.CSSProperties = {
    maxWidth: 820,
    margin: "0 auto"
};

const paragraphStyle: React.CSSProperties = {
    color: MFX_COLORS.text,
    lineHeight: 1.55,
    marginTop: 12,
    marginBottom: 12
};

const captionStyle: React.CSSProperties = {
    color: MFX_COLORS.muted,
    fontSize: "0.72rem",
    fontWeight: 900,
    letterSpacing: "0.05em"
};

const noticeLineStyle: React.CSSProperties = {
    marginTop: 6,
    padding: "7px 9px",
    borderRadius: 7,
    background: MFX_COLORS.panelAlt,
    color: MFX_COLORS.text,
    fontSize: "0.78rem",
    lineHeight: 1.35,
    userSelect: "text",
    wordBreak: "break-word"
};

const noticeBoxStyle: React.CSSProperties = {
    marginTop: 10,
    padding: 14,
    borderRadius: 9,
    border: `1px solid ${MFX_COLORS.border}`,
    background: MFX_COLORS.panelAlt,
    color: MFX_COLORS.text
};

const attributionBoxStyle: React.CSSProperties = {
    marginTop: 12,
    padding: 12,
    borderRadius: 9,
    background: MFX_COLORS.panelAlt,
    color: MFX_COLORS.text,
    fontSize: "0.82rem",
    lineHeight: 1.6
};

const linkStyle: React.CSSProperties = {
    color: MFX_COLORS.cyan,
    textDecoration: "underline"
};
