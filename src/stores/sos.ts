"use client";

import { create } from "zustand";
import type { Sos } from "@/lib/protocol";
import { ulid } from "@/lib/utils/id";
import { sealText, openText } from "@/lib/crypto/keycache";
import { enqueue } from "@/lib/sync/outbox";
import { getDb, type SosRecord } from "@/lib/idb/db";
import { useSessionStore } from "./session";

export interface SosView {
  id: string;
  deviceId: string;
  note: string | null;
  lat: number | null;
  lng: number | null;
  active: boolean;
  createdAt: number;
  clearedAt: number | null;
  rev: number;
}

interface SosState {
  events: SosView[];
  loaded: boolean;
  raising: boolean;

  hydrate: () => Promise<void>;
  raise: (note?: string, lat?: number | null, lng?: number | null) => Promise<void>;
  clear: (id: string) => Promise<void>;
  applyRaised: (sos: Sos, rev: number) => Promise<void>;
  applyCleared: (id: string, rev: number) => Promise<void>;
  reset: () => void;
}

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

function sortEvents(list: SosView[]): SosView[] {
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

export const useSosStore = create<SosState>((set, get) => ({
  events: [],
  loaded: false,
  raising: false,

  hydrate: () =>
    serialized(async () => {
      if (get().loaded) return;
      const { roomId } = useSessionStore.getState();
      if (!roomId) return;
      const db = await getDb();
      const rows = await db.getAllFromIndex("sos", "by-room", roomId);
      const records = rows.filter((r) => r.roomId === roomId);
      set({ events: sortEvents(await Promise.all(records.map(toView))), loaded: true });
    }),

  raise: (note, lat = null, lng = null) =>
    serialized(async () => {
      const { deviceId } = useSessionStore.getState();
      if (!deviceId) throw new Error("no session");
      const cipher = note ? await sealText(note) : null;
      set({ raising: true });
      await enqueue({
        t: "sos.raise",
        clientId: ulid(),
        lat: lat ?? undefined,
        lng: lng ?? undefined,
        note: cipher ?? undefined,
        updatedAt: Date.now(),
      });
    }),

  clear: (id) =>
    serialized(async () => {
      await enqueue({ t: "sos.clear", clientId: ulid(), id, updatedAt: Date.now() });
      set((state) => ({
        events: state.events.map((e) =>
          e.id === id ? { ...e, active: false, clearedAt: Date.now() } : e,
        ),
      }));
    }),

  applyRaised: (sos, rev) =>
    serialized(async () => {
      const { roomId, deviceId } = useSessionStore.getState();
      if (!roomId) return;
      const db = await getDb();
      const existing = await db.get("sos", sos.id);
      if (existing && existing.rev > rev) return;
      const record: SosRecord = {
        id: sos.id,
        roomId,
        deviceId: sos.deviceId,
        note: sos.note,
        lat: sos.lat,
        lng: sos.lng,
        active: sos.active,
        createdAt: sos.createdAt,
        clearedAt: sos.clearedAt,
        rev,
      };
      await db.put("sos", record);
      const view = await toView(record);
      set((state) => ({
        events: sortEvents([view, ...state.events.filter((e) => e.id !== sos.id)]),
        raising: sos.deviceId === deviceId ? false : state.raising,
      }));
    }),

  applyCleared: (id, rev) =>
    serialized(async () => {
      const db = await getDb();
      const existing = await db.get("sos", id);
      if (existing && existing.rev > rev) return;
      const record: SosRecord | undefined = existing
        ? { ...existing, active: false, clearedAt: Date.now(), rev }
        : undefined;
      if (record) await db.put("sos", record);
      set((state) => ({
        events: state.events.map((e) =>
          e.id === id ? { ...e, active: false, clearedAt: e.clearedAt ?? Date.now(), rev } : e,
        ),
        raising: false,
      }));
    }),

  reset: () => set({ events: [], loaded: false, raising: false }),
}));

async function toView(record: SosRecord): Promise<SosView> {
  return {
    id: record.id,
    deviceId: record.deviceId,
    note: record.note ? await openText(record.note) : null,
    lat: record.lat,
    lng: record.lng,
    active: record.active,
    createdAt: record.createdAt,
    clearedAt: record.clearedAt,
    rev: record.rev,
  };
}
