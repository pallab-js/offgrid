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
  reads: Record<string, Record<string, number>>; // channelId → deviceId → at

  setStatus: (status: LinkStatus) => void;
  setRtt: (rttMs: number | null) => void;
  setPresence: (peers: Peer[]) => void;
  setChannels: (channels: Channel[]) => void;
  setTyping: (channelId: string, deviceId: string | null) => void;
  setRead: (channelId: string, deviceId: string, at: number) => void;
  applyEvent: (event: MeshEvent) => void;
  reset: () => void;
}

const initial = {
  status: "idle" as LinkStatus,
  rttMs: null,
  peers: [] as Peer[],
  channels: [] as Channel[],
  typing: {} as Record<string, string>,
  reads: {} as Record<string, Record<string, number>>,
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

  setRead: (channelId, deviceId, at) =>
    set((state) => {
      const channel = state.reads[channelId];
      if (channel && (channel[deviceId] ?? 0) >= at) return state;
      return {
        reads: {
          ...state.reads,
          [channelId]: { ...channel, [deviceId]: at },
        },
      };
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
