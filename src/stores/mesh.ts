"use client";

import { create } from "zustand";
import type { Channel, MeshEvent, Peer } from "@/lib/protocol";

export type LinkStatus = "idle" | "connecting" | "online" | "reconnecting" | "offline";

interface MeshState {
  status: LinkStatus;
  rttMs: number | null;
  peers: Peer[];
  channels: Channel[];
  typing: Record<string, string>; // channelId → deviceId (ephemeral)

  setStatus: (status: LinkStatus) => void;
  setRtt: (rttMs: number | null) => void;
  setPresence: (peers: Peer[]) => void;
  setChannels: (channels: Channel[]) => void;
  setTyping: (channelId: string, deviceId: string | null) => void;
  applyEvent: (event: MeshEvent) => void;
  reset: () => void;
}

const initial = {
  status: "idle" as LinkStatus,
  rttMs: null,
  peers: [] as Peer[],
  channels: [] as Channel[],
  typing: {} as Record<string, string>,
};

export const useMeshStore = create<MeshState>((set) => ({
  ...initial,

  setStatus: (status) => set({ status }),
  setRtt: (rttMs) => set({ rttMs }),
  setPresence: (peers) => set({ peers }),
  setChannels: (channels) => set({ channels }),

  setTyping: (channelId, deviceId) =>
    set((state) => {
      const next = { ...state.typing };
      if (deviceId) next[channelId] = deviceId;
      else delete next[channelId];
      return { typing: next };
    }),

  /** Idempotent reducer for live + synced events (SDA §5.2). */
  applyEvent: (event) =>
    set((state) => {
      switch (event.t) {
        case "channel.new": {
          if (state.channels.some((c) => c.id === event.channel.id)) return state;
          return { channels: [...state.channels, event.channel] };
        }
        default:
          return state;
      }
    }),

  reset: () => set(initial),
}));
