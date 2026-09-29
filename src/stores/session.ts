"use client";

import { create } from "zustand";
import { ulid } from "@/lib/utils/id";

export interface Profile {
  name: string;
  color: string;
}

interface SessionState {
  deviceId: string | null;
  profile: Profile | null;
  roomId: string | null;
  roomName: string | null;
  token: string | null;
  cursor: number;
  roomKeyB64: string | null;
  hydrated: boolean;

  hydrate: () => void;
  ensureDevice: (name: string, color: string) => string;
  setProfile: (profile: Profile) => void;
  enterRoom: (input: {
    roomId: string;
    roomName: string;
    token: string;
    roomKeyB64: string;
    cursor?: number;
  }) => void;
  setCursor: (cursor: number) => void;
  reset: () => void;
}

const STORAGE_KEY = "offgrid.session.v1";
const KEY_CACHE = "offgrid.roomkey.v1";

interface PersistedSession {
  deviceId: string;
  profile: Profile;
  roomId: string;
  roomName: string;
  token: string;
  cursor: number;
}

function readPersisted(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSession>;
    if (!parsed.deviceId || !parsed.roomId || !parsed.token) return null;
    return parsed as PersistedSession;
  } catch {
    return null;
  }
}

function writePersisted(state: Partial<PersistedSession> | null): void {
  try {
    if (!state) {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(KEY_CACHE);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — session stays in memory */
  }
}

export const useSessionStore = create<SessionState>((set, get) => ({
  deviceId: null,
  profile: null,
  roomId: null,
  roomName: null,
  token: null,
  cursor: 0,
  roomKeyB64: null,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    let roomKeyB64: string | null = null;
    try {
      roomKeyB64 = sessionStorage.getItem(KEY_CACHE);
    } catch {
      roomKeyB64 = null;
    }
    const saved = readPersisted();
    if (saved) {
      set({
        deviceId: saved.deviceId,
        profile: saved.profile ?? null,
        roomId: saved.roomId,
        roomName: saved.roomName,
        token: saved.token,
        cursor: saved.cursor ?? 0,
        roomKeyB64,
        hydrated: true,
      });
    } else {
      set({ roomKeyB64, hydrated: true });
    }
  },

  ensureDevice: (name, color) => {
    const existing = get().deviceId;
    if (existing && get().profile) return existing;
    const deviceId = existing ?? ulid();
    const profile = { name, color };
    set({ deviceId, profile });
    const saved = readPersisted();
    writePersisted({
      deviceId,
      profile,
      roomId: saved?.roomId ?? "",
      roomName: saved?.roomName ?? "",
      token: saved?.token ?? "",
      cursor: saved?.cursor ?? 0,
    });
    return deviceId;
  },

  setProfile: (profile) => {
    set({ profile });
    const saved = readPersisted();
    if (saved) writePersisted({ ...saved, profile });
  },

  enterRoom: ({ roomId, roomName, token, roomKeyB64, cursor = 0 }) => {
    const { deviceId, profile } = get();
    set({ roomId, roomName, token, cursor, roomKeyB64 });
    try {
      sessionStorage.setItem(KEY_CACHE, roomKeyB64);
    } catch {
      /* ignore */
    }
    if (deviceId && profile) {
      writePersisted({ deviceId, profile, roomId, roomName, token, cursor });
    }
  },

  setCursor: (cursor) => {
    set({ cursor });
    const saved = readPersisted();
    if (saved) writePersisted({ ...saved, cursor });
  },

  reset: () => {
    writePersisted(null);
    set({
      deviceId: null,
      profile: null,
      roomId: null,
      roomName: null,
      token: null,
      cursor: 0,
      roomKeyB64: null,
      hydrated: true,
    });
  },
}));
