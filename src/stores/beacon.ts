"use client";

import { create } from "zustand";
import type { Beacon } from "@/lib/protocol";
import { ulid } from "@/lib/utils/id";
import { sealText, openText } from "@/lib/crypto/keycache";
import { enqueue } from "@/lib/sync/outbox";

export interface BeaconView {
  id: string;
  deviceId: string;
  text: string;
  wpm: number;
  createdAt: number;
}

interface BeaconState {
  history: BeaconView[];

  share: (text: string, wpm: number) => Promise<void>;
  applyBeacon: (beacon: Beacon) => Promise<void>;
  reset: () => void;
}

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

export const useBeaconStore = create<BeaconState>((set, get) => ({
  history: [],

  share: (text, wpm) =>
    serialized(async () => {
      const cipher = await sealText(text);
      await enqueue({ t: "beacon.share", clientId: ulid(), text: cipher, wpm });
    }),

  applyBeacon: (beacon) =>
    serialized(async () => {
      if (get().history.some((b) => b.id === beacon.id)) return;
      const view: BeaconView = {
        id: beacon.id,
        deviceId: beacon.deviceId,
        text: (await openText(beacon.text)) ?? "",
        wpm: beacon.wpm,
        createdAt: beacon.createdAt,
      };
      set((state) => ({
        history: [view, ...state.history].slice(0, 50),
      }));
    }),

  reset: () => set({ history: [] }),
}));
