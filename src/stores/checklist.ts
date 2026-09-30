"use client";

import { create } from "zustand";
import { ulid } from "@/lib/utils/id";
import { enqueue } from "@/lib/sync/outbox";
import { getDb, type ProgressRecord } from "@/lib/idb/db";
import { useSessionStore } from "./session";

export interface ProgressView {
  itemId: string;
  checked: boolean;
  updatedAt: number;
  updatedBy: string;
  rev: number;
}

interface ChecklistState {
  progress: Record<string, ProgressView>;
  loaded: boolean;

  hydrate: () => Promise<void>;
  setItem: (itemId: string, checked: boolean) => Promise<void>;
  applyUpdate: (update: {
    itemId: string;
    checked: boolean;
    updatedAt: number;
    updatedBy: string;
    rev: number;
  }) => Promise<void>;
  reset: () => void;
}

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

export const useChecklistStore = create<ChecklistState>((set, get) => ({
  progress: {},
  loaded: false,

  hydrate: () =>
    serialized(async () => {
      if (get().loaded) return;
      const { roomId } = useSessionStore.getState();
      if (!roomId) return;
      const db = await getDb();
      const rows = await db.getAllFromIndex("progress", "by-room", roomId);
      const progress: Record<string, ProgressView> = {};
      for (const row of rows) {
        if (row.roomId !== roomId) continue;
        progress[row.itemId] = {
          itemId: row.itemId,
          checked: row.checked,
          updatedAt: row.updatedAt,
          updatedBy: row.updatedBy,
          rev: row.rev,
        };
      }
      set({ progress, loaded: true });
    }),

  setItem: (itemId, checked) =>
    serialized(async () => {
      const { roomId, deviceId } = useSessionStore.getState();
      if (!roomId || !deviceId) throw new Error("no session");
      const updatedAt = Date.now();
      const existing = get().progress[itemId];
      const record: ProgressRecord = {
        key: `${roomId}:${itemId}`,
        roomId,
        itemId,
        checked,
        updatedAt,
        updatedBy: deviceId,
        rev: existing?.rev ?? 0,
      };
      const db = await getDb();
      await db.put("progress", record);
      set((state) => ({
        progress: {
          ...state.progress,
          [itemId]: { itemId, checked, updatedAt, updatedBy: deviceId, rev: record.rev },
        },
      }));
      await enqueue({
        t: "check.set",
        clientId: ulid(),
        itemId,
        checked,
        updatedAt,
      });
    }),

  applyUpdate: (update) =>
    serialized(async () => {
      const { roomId } = useSessionStore.getState();
      if (!roomId) return;
      const db = await getDb();
      const key = `${roomId}:${update.itemId}`;
      const existing = await db.get("progress", key);
      if (existing && existing.rev > update.rev) return;
      const record: ProgressRecord = { key, roomId, ...update };
      await db.put("progress", record);
      set((state) => ({
        progress: {
          ...state.progress,
          [update.itemId]: {
            itemId: update.itemId,
            checked: update.checked,
            updatedAt: update.updatedAt,
            updatedBy: update.updatedBy,
            rev: update.rev,
          },
        },
      }));
    }),

  reset: () => set({ progress: {}, loaded: false }),
}));
