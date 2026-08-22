// MultiFX Performance View shared bank state.
//
// The Pi runtime-state service is authoritative. Each bank owns one shared
// record containing tile assignments, current page and selected slot. Browser
// localStorage is only a cache/fallback; it is never an independent layout.

import {
    readMultiFXRuntimeState,
    updateMultiFXRuntimeState
} from "./MultiFXRuntimeSync";

const STORAGE_KEY = "pipedal-multifx-preset-tiles-v1";
const SYNC_POLL_MS = 250;

export const MULTIFX_PRESET_TILE_STORE_CHANGED_EVENT =
    "multifx-preset-tile-store-changed";

type BankTileRecord = {
    slots: Array<number | null>;
    knownPresetIds: number[];

    // Number of logical preset switches used when `slots` was shaped into
    // pages. Keeping this lets a controller-layout change preserve every old
    // page while inserting genuinely EMPTY positions for newly-added switches.
    slotCount: number;

    currentPage: number;
    selectedSlot: number;
};

export type MultiFXPresetTileStore = {
    version: 1;
    banks: Record<string, BankTileRecord>;
};

export type MultiFXPresetBankViewState = {
    slots: Array<number | null>;
    currentPage: number;
    selectedSlot: number;
};

let runtimeSyncStarted = false;
let pendingPublishCount = 0;
let publishPromise: Promise<void> = Promise.resolve();

function emptyStore(): MultiFXPresetTileStore {
    return { version: 1, banks: {} };
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
    return typeof value === "number"
        && Number.isFinite(value)
        && value >= 0
        ? Math.floor(value)
        : fallback;
}

function normalizePresetIds(presetIds: number[]): number[] {
    const result: number[] = [];
    const seen = new Set<number>();
    for (const value of presetIds) {
        if (Number.isFinite(value) && !seen.has(value)) {
            seen.add(value);
            result.push(value);
        }
    }
    return result;
}

function normalizeSlots(value: unknown): Array<number | null> {
    if (!Array.isArray(value)) return [];
    return value.map((entry) =>
        typeof entry === "number" && Number.isFinite(entry)
            ? entry
            : null
    );
}

function normalizeBankRecord(value: unknown): BankTileRecord | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }

    const source = value as Record<string, unknown>;
    return {
        slots: normalizeSlots(source.slots),
        knownPresetIds: Array.isArray(source.knownPresetIds)
            ? normalizePresetIds(
                source.knownPresetIds.filter(
                    (entry): entry is number =>
                        typeof entry === "number" && Number.isFinite(entry)
                )
            )
            : [],
        slotCount: Math.max(
            0,
            nonNegativeInteger(source.slotCount, 0)
        ),
        // Older shared records did not contain navigation state. They migrate
        // safely to page zero / slot zero.
        currentPage: nonNegativeInteger(source.currentPage, 0),
        selectedSlot: nonNegativeInteger(source.selectedSlot, 0)
    };
}

export function normalizePresetTileStore(
    value: unknown
): MultiFXPresetTileStore {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return emptyStore();
    }

    const source = value as Record<string, unknown>;
    if (
        source.version !== 1
        || !source.banks
        || typeof source.banks !== "object"
        || Array.isArray(source.banks)
    ) {
        return emptyStore();
    }

    const banks: Record<string, BankTileRecord> = {};
    for (const [bankId, value] of Object.entries(
        source.banks as Record<string, unknown>
    )) {
        const record = normalizeBankRecord(value);
        if (record) banks[bankId] = record;
    }

    return { version: 1, banks };
}

function readLocalStore(): MultiFXPresetTileStore {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        return raw
            ? normalizePresetTileStore(JSON.parse(raw) as unknown)
            : emptyStore();
    } catch {
        return emptyStore();
    }
}

function writeLocalStore(
    store: MultiFXPresetTileStore,
    dispatch = true
): boolean {
    const normalized = normalizePresetTileStore(store);
    const serialized = JSON.stringify(normalized);

    if (window.localStorage.getItem(STORAGE_KEY) === serialized) {
        return false;
    }

    window.localStorage.setItem(STORAGE_KEY, serialized);

    if (dispatch) {
        window.dispatchEvent(
            new Event(MULTIFX_PRESET_TILE_STORE_CHANGED_EVENT)
        );
    }
    return true;
}

export function applyPresetTileStoreFromRuntime(value: unknown): boolean {
    if (value === undefined) return false;
    return writeLocalStore(normalizePresetTileStore(value), true);
}

function publishBank(
    bankId: number,
    record: BankTileRecord
): Promise<void> {
    const key = String(bankId);
    const snapshot = normalizeBankRecord(record);
    if (!snapshot) return Promise.resolve();

    // Count immediately so the background poll cannot apply an older runtime
    // snapshot while this local edit is waiting in the serialized queue.
    pendingPublishCount += 1;

    publishPromise = publishPromise
        .catch(() => undefined)
        .then(async () => {
            try {
                // Merge only the bank that changed into the latest runtime
                // store. Publishing a browser's whole cached store could
                // otherwise overwrite a newer edit made on another screen.
                const runtime = await readMultiFXRuntimeState();
                const merged = normalizePresetTileStore(
                    runtime.presetTileStore
                );

                merged.banks[key] = snapshot;

                const state = await updateMultiFXRuntimeState({
                    presetTileStore: merged
                });

                if (state.presetTileStore !== undefined) {
                    applyPresetTileStoreFromRuntime(
                        state.presetTileStore
                    );
                }
            } finally {
                pendingPublishCount = Math.max(
                    0,
                    pendingPublishCount - 1
                );
            }
        })
        .catch(() => {
            // Offline cache remains usable; polling reconnects automatically.
        });

    return publishPromise;
}

function padSlots(
    slots: Array<number | null>,
    slotCount: number
): Array<number | null> {
    const width = Math.max(1, slotCount);
    const next = [...slots];

    while (next.length < width) next.push(null);
    while (next.length % width !== 0) next.push(null);

    return next;
}

function reshapeSlotsForSlotCount(
    slots: Array<number | null>,
    oldSlotCount: number,
    newSlotCount: number
): Array<number | null> {
    const oldWidth = Math.max(1, oldSlotCount);
    const newWidth = Math.max(1, newSlotCount);

    if (oldWidth === newWidth) {
        return padSlots(slots, newWidth);
    }

    const pageCount = Math.max(
        1,
        Math.ceil(slots.length / oldWidth)
    );
    const reshaped: Array<number | null> = [];

    for (let page = 0; page < pageCount; ++page) {
        const oldPage = slots.slice(
            page * oldWidth,
            page * oldWidth + oldWidth
        );

        // Existing positions keep their assignment. New positions are explicit
        // empty tiles; shrinking removes only positions that no longer exist.
        for (let slot = 0; slot < newWidth; ++slot) {
            reshaped.push(
                slot < oldWidth
                    ? oldPage[slot] ?? null
                    : null
            );
        }
    }

    return padSlots(reshaped, newWidth);
}

function recordsEqual(
    left: BankTileRecord | undefined,
    right: BankTileRecord
): boolean {
    return Boolean(left) && JSON.stringify(left) === JSON.stringify(right);
}

function reconcileBankRecord(
    existing: BankTileRecord | undefined,
    currentPresetIds: number[],
    slotCount: number
): BankTileRecord {
    const presetIds = normalizePresetIds(currentPresetIds);

    if (!existing) {
        return {
            slots: padSlots([...presetIds], slotCount),
            knownPresetIds: [...presetIds],
            slotCount: Math.max(1, slotCount),
            currentPage: 0,
            selectedSlot: 0
        };
    }

    const currentSet = new Set(presetIds);

    let slots = existing.slots.map((value) =>
        typeof value === "number" && currentSet.has(value)
            ? value
            : null
    );

    const previousSlotCount =
        existing.slotCount > 0
            ? existing.slotCount
            : Math.max(1, slotCount);

    if (previousSlotCount !== Math.max(1, slotCount)) {
        slots = reshapeSlotsForSlotCount(
            slots,
            previousSlotCount,
            Math.max(1, slotCount)
        );
    }

    // Existing shared Performance layouts are explicit assignments. Discovering
    // a new PiPedal preset must NOT silently consume an empty controller tile.
    // This is especially important when a new logical preset switch has just
    // been added: its new slot must stay empty until the user assigns a preset.
    //
    // New presets created through MultiFX's explicit "new preset in this tile"
    // workflow are assigned by that workflow via savePresetTileIds().
    const normalizedSlots = padSlots(slots, slotCount);
    const pageCount = Math.max(
        1,
        Math.ceil(normalizedSlots.length / Math.max(1, slotCount))
    );

    return {
        slots: normalizedSlots,
        knownPresetIds: [...presetIds],
        slotCount: Math.max(1, slotCount),
        currentPage: Math.min(existing.currentPage, pageCount - 1),
        selectedSlot: Math.min(
            existing.selectedSlot,
            Math.max(0, slotCount - 1)
        )
    };
}

function startRuntimeSync() {
    if (runtimeSyncStarted || typeof window === "undefined") return;
    runtimeSyncStarted = true;

    const poll = async () => {
        try {
            if (pendingPublishCount === 0) {
                const state = await readMultiFXRuntimeState();
                if (state.presetTileStore !== undefined) {
                    applyPresetTileStoreFromRuntime(
                        state.presetTileStore
                    );
                }
            }
        } catch {
            // Runtime service can be unavailable briefly during boot/restart.
        } finally {
            window.setTimeout(poll, SYNC_POLL_MS);
        }
    };

    void poll();
}

export async function migratePresetSlotCountForBank(
    bankId: number,
    currentPresetIds: number[],
    oldSlotCount: number,
    newSlotCount: number
): Promise<void> {
    const oldWidth = Math.max(1, Math.floor(oldSlotCount));
    const newWidth = Math.max(1, Math.floor(newSlotCount));

    if (oldWidth === newWidth) return;

    const store = readLocalStore();
    const key = String(bankId);
    const presetIds = normalizePresetIds(currentPresetIds);

    // Untouched/default banks deliberately may not have a persisted record.
    // Build their current default layout using the OLD controller width first,
    // then reshape it. This is the key detail that leaves every newly-added
    // preset-switch position empty instead of letting PiPedal's preset order
    // immediately populate it.
    const existing = store.banks[key];
    const sourceRecord: BankTileRecord = existing ?? {
        slots: padSlots([...presetIds], oldWidth),
        knownPresetIds: [...presetIds],
        slotCount: oldWidth,
        currentPage: 0,
        selectedSlot: 0
    };

    const sourceWidth =
        sourceRecord.slotCount > 0
            ? sourceRecord.slotCount
            : oldWidth;

    const currentSet = new Set(presetIds);
    const cleanedSlots = sourceRecord.slots.map((value) =>
        typeof value === "number" && currentSet.has(value)
            ? value
            : null
    );

    const reshapedSlots = reshapeSlotsForSlotCount(
        cleanedSlots,
        sourceWidth,
        newWidth
    );

    const pageCount = Math.max(
        1,
        Math.ceil(reshapedSlots.length / newWidth)
    );

    const nextRecord: BankTileRecord = {
        slots: reshapedSlots,
        knownPresetIds: normalizePresetIds([
            ...sourceRecord.knownPresetIds,
            ...presetIds
        ]),
        slotCount: newWidth,
        currentPage: Math.min(
            sourceRecord.currentPage,
            pageCount - 1
        ),
        selectedSlot: Math.min(
            sourceRecord.selectedSlot,
            newWidth - 1
        )
    };

    store.banks[key] = nextRecord;
    writeLocalStore(store, true);

    // Finish publishing the explicit empty-slot layout before the controller
    // config with its new preset-slot count is allowed to propagate.
    await publishBank(bankId, nextRecord);
}

export function loadPresetBankViewState(
    bankId: number,
    currentPresetIds: number[],
    slotCount: number
): MultiFXPresetBankViewState {
    const store = readLocalStore();
    const key = String(bankId);
    const existing = store.banks[key];
    const nextRecord = reconcileBankRecord(
        existing,
        currentPresetIds,
        slotCount
    );

    if (!recordsEqual(existing, nextRecord)) {
        store.banks[key] = nextRecord;
        writeLocalStore(store, false);

        // Only publish reconciliation when a shared bank record already exists.
        // A brand-new browser cache must not seed/overwrite authority merely by
        // opening a bank. A real user edit will publish it immediately.
        if (existing) publishBank(bankId, nextRecord);
    }

    return {
        slots: [...nextRecord.slots],
        currentPage: nextRecord.currentPage,
        selectedSlot: nextRecord.selectedSlot
    };
}

export function loadPresetTileIds(
    bankId: number,
    currentPresetIds: number[],
    slotCount: number
): Array<number | null> {
    return loadPresetBankViewState(
        bankId,
        currentPresetIds,
        slotCount
    ).slots;
}

export function savePresetTileIds(
    bankId: number,
    slots: Array<number | null>,
    currentPresetIds: number[],
    slotCount?: number
) {
    const store = readLocalStore();
    const key = String(bankId);
    const existing = store.banks[key];
    const presetIds = normalizePresetIds(currentPresetIds);

    const nextRecord: BankTileRecord = {
        slots: [...slots],
        knownPresetIds: normalizePresetIds([
            ...presetIds,
            ...slots.filter(
                (value): value is number =>
                    typeof value === "number" && Number.isFinite(value)
            )
        ]),
        slotCount: Math.max(
            1,
            slotCount
                ?? (
                    existing?.slotCount
                    && existing.slotCount > 0
                        ? existing.slotCount
                        : slots.length
                )
        ),
        currentPage: existing?.currentPage ?? 0,
        selectedSlot: existing?.selectedSlot ?? 0
    };

    if (recordsEqual(existing, nextRecord)) return;

    store.banks[key] = nextRecord;
    writeLocalStore(store, true);
    publishBank(bankId, nextRecord);
}

export function savePresetBankNavigation(
    bankId: number,
    currentPresetIds: number[],
    slotCount: number,
    currentPage: number,
    selectedSlot: number
) {
    const store = readLocalStore();
    const key = String(bankId);
    const existing = reconcileBankRecord(
        store.banks[key],
        currentPresetIds,
        slotCount
    );

    const pageCount = Math.max(
        1,
        Math.ceil(existing.slots.length / Math.max(1, slotCount))
    );

    const nextRecord: BankTileRecord = {
        ...existing,
        currentPage: Math.min(
            Math.max(0, Math.floor(currentPage)),
            pageCount - 1
        ),
        selectedSlot: Math.min(
            Math.max(0, Math.floor(selectedSlot)),
            Math.max(0, slotCount - 1)
        )
    };

    if (recordsEqual(store.banks[key], nextRecord)) return;

    store.banks[key] = nextRecord;
    writeLocalStore(store, true);
    publishBank(bankId, nextRecord);
}

startRuntimeSync();
