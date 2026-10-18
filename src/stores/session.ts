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
  /** Devices with moderation powers in the current room (rooms.settings.moderators). */
  moderators: string[];
  hydrated: boolean;

  hydrate: () => void;
  ensureDevice: (name: string, color: string) => string;
  setProfile: (profile: Profile) => void;
  enterRoom: (input: {
    roomId: string;
    roomName: string;
    token: string;
    roomKeyB64: string;
    moderators?: string[];
    cursor?: number;
  }) => void;
  setModerators: (moderators: string[]) => void;
  setCursor: (cursor: number) => void;
  leaveRoom: () => void;
  reset: () => void;
}

const STORAGE_KEY = "offgrid.session.v1";
const KEY_CACHE = "offgrid.roomkey.v1";
/**
 * Tab-scoped room metadata (moderator list) kept next to the tab-scoped room
 * key: it is re-fetched on every join/`joined` frame, so caching it is a UX
 * optimization, not a source of truth.
 */
const ROOM_META_KEY = "offgrid.roommeta.v1";

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
      sessionStorage.removeItem(ROOM_META_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — session stays in memory */
  }
}

function readRoomMeta(): { moderators: string[] } {
  try {
    const raw = sessionStorage.getItem(ROOM_META_KEY);
    if (!raw) return { moderators: [] };
    const parsed = JSON.parse(raw) as { moderators?: unknown };
    return { moderators: Array.isArray(parsed.moderators) ? parsed.moderators : [] };
  } catch {
    return { moderators: [] };
  }
}

function writeRoomMeta(moderators: string[]): void {
  try {
    sessionStorage.setItem(ROOM_META_KEY, JSON.stringify({ moderators }));
  } catch {
    /* ignore — moderators refresh on the next joined frame */
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
  moderators: [],
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
      const { moderators } = readRoomMeta();
      set({
        deviceId: saved.deviceId,
        profile: saved.profile ?? null,
        roomId: saved.roomId,
        roomName: saved.roomName,
        token: saved.token,
        cursor: saved.cursor ?? 0,
        roomKeyB64,
        moderators,
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

  enterRoom: ({ roomId, roomName, token, roomKeyB64, moderators = [], cursor = 0 }) => {
    const { deviceId, profile } = get();
    set({ roomId, roomName, token, cursor, roomKeyB64, moderators });
    try {
      sessionStorage.setItem(KEY_CACHE, roomKeyB64);
    } catch {
      /* ignore */
    }
    writeRoomMeta(moderators);
    if (deviceId && profile) {
      writePersisted({ deviceId, profile, roomId, roomName, token, cursor });
    }
  },

  setModerators: (moderators) => {
    if (!get().roomId) return; // room-less sessions have no moderation context
    set({ moderators });
    writeRoomMeta(moderators);
  },

  setCursor: (cursor) => {
    // Sync cursors only ever move forward: a stale in-flight batch from a
    // dropped connection must not regress the cursor (belt-and-braces behind
    // the guard in mesh-provider's sync.batch handler).
    if (cursor <= get().cursor) return;
    set({ cursor });
    const saved = readPersisted();
    if (saved) writePersisted({ ...saved, cursor });
  },

  leaveRoom: () => {
    try {
      sessionStorage.removeItem(KEY_CACHE);
      sessionStorage.removeItem(ROOM_META_KEY);
    } catch {
      /* ignore */
    }
    const saved = readPersisted();
    if (saved) writePersisted({ ...saved, roomId: "", roomName: "", token: "", cursor: 0 });
    set({
      roomId: null,
      roomName: null,
      token: null,
      cursor: 0,
      roomKeyB64: null,
      moderators: [],
    });
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
      moderators: [],
      hydrated: true,
    });
  },
}));
