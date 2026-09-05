export const MULTIFX_UPDATE_STATUS_EVENT = "pipedal-multifx-update-status";

export type MultiFXUpdateJobState = "idle" | "installing" | "complete" | "failed";

export interface MultiFXUpdateStatus {
    installedVersion: string;
    latestVersion: string;
    latestName: string;
    releaseUrl: string;
    updateAvailable: boolean;
    jobState: MultiFXUpdateJobState;
    targetVersion: string;
    startedAt: number;
    completedAt: number;
    unitState: string;
    progressMessages: string[];
    message: string;
    error: string;
}

function multiFXUpdateUrl(refresh = false): string {
    const hostname = window.location.hostname.includes(":")
        ? `[${window.location.hostname}]`
        : window.location.hostname;
    return `http://${hostname}:8877/multifx-update${refresh ? "?refresh=1" : ""}`;
}

function normalizeMultiFXUpdateStatus(value: unknown): MultiFXUpdateStatus {
    const source = value && typeof value === "object"
        ? value as Record<string, unknown>
        : {};
    const rawJobState = source.jobState;
    const jobState: MultiFXUpdateJobState = rawJobState === "installing"
        || rawJobState === "complete"
        || rawJobState === "failed"
        ? rawJobState
        : "idle";
    const text = (key: string) => typeof source[key] === "string"
        ? source[key] as string
        : "";
    const progressMessages = Array.isArray(source.progressMessages)
        ? source.progressMessages.filter(
            (item): item is string => typeof item === "string"
        ).slice(-8)
        : [];
    return {
        installedVersion: text("installedVersion"),
        latestVersion: text("latestVersion"),
        latestName: text("latestName"),
        releaseUrl: text("releaseUrl"),
        updateAvailable: source.updateAvailable === true,
        jobState,
        targetVersion: text("targetVersion"),
        startedAt: typeof source.startedAt === "number" ? source.startedAt : 0,
        completedAt: typeof source.completedAt === "number" ? source.completedAt : 0,
        unitState: text("unitState"),
        progressMessages,
        message: text("message"),
        error: text("error")
    };
}

export function publishMultiFXUpdateStatus(status: MultiFXUpdateStatus): void {
    window.dispatchEvent(new CustomEvent(MULTIFX_UPDATE_STATUS_EVENT, {
        detail: status
    }));
}

export async function requestMultiFXUpdate(
    method: "GET" | "POST",
    refresh = false
): Promise<MultiFXUpdateStatus> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetch(multiFXUpdateUrl(refresh), {
            method,
            cache: "no-store",
            headers: method === "POST"
                ? { "Content-Type": "application/json" }
                : undefined,
            body: method === "POST"
                ? JSON.stringify({ action: "installLatest" })
                : undefined,
            signal: controller.signal
        });
        const payload = await response.json() as unknown;
        if (!response.ok) {
            const detail = payload && typeof payload === "object"
                && typeof (payload as Record<string, unknown>).error === "string"
                ? (payload as Record<string, string>).error
                : `HTTP ${response.status}`;
            throw new Error(detail);
        }
        const status = normalizeMultiFXUpdateStatus(payload);
        publishMultiFXUpdateStatus(status);
        return status;
    } finally {
        window.clearTimeout(timer);
    }
}
