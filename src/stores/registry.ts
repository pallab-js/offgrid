"use client";

import { useSessionStore } from "./session";
import { useChatStore } from "./chat";
import { useFilesStore } from "./files";
import { useNotesStore } from "./notes";
import { useChecklistStore } from "./checklist";
import { useMapStore } from "./map";
import { useSosStore } from "./sos";
import { useBeaconStore } from "./beacon";
import { useMeshStore } from "./mesh";
import { useToastStore } from "./toast";

type StoreWithLifecycle = {
  getState: () => unknown;
  hydrate?: () => void | Promise<void>;
  reset?: () => void;
};

const stores: Array<{ name: string; store: StoreWithLifecycle }> = [
  {
    name: "session",
    store: {
      getState: useSessionStore.getState,
      hydrate: () => useSessionStore.getState().hydrate(),
      reset: () => useSessionStore.getState().reset(),
    },
  },
  {
    name: "chat",
    store: {
      getState: useChatStore.getState,
      hydrate: () => useChatStore.getState().hydrate(""),
      reset: () => useChatStore.getState().reset(),
    },
  },
  {
    name: "files",
    store: {
      getState: useFilesStore.getState,
      hydrate: () => useFilesStore.getState().hydrate(),
      reset: () => useFilesStore.getState().reset(),
    },
  },
  {
    name: "notes",
    store: {
      getState: useNotesStore.getState,
      hydrate: () => useNotesStore.getState().hydrate(),
      reset: () => useNotesStore.getState().reset(),
    },
  },
  {
    name: "checklist",
    store: {
      getState: useChecklistStore.getState,
      hydrate: () => useChecklistStore.getState().hydrate(),
      reset: () => useChecklistStore.getState().reset(),
    },
  },
  {
    name: "map",
    store: {
      getState: useMapStore.getState,
      hydrate: () => useMapStore.getState().hydrate(),
      reset: () => useMapStore.getState().reset(),
    },
  },
  {
    name: "sos",
    store: {
      getState: useSosStore.getState,
      hydrate: () => useSosStore.getState().hydrate(),
      reset: () => useSosStore.getState().reset(),
    },
  },
  {
    name: "beacon",
    store: { getState: useBeaconStore.getState },
  },
  {
    name: "mesh",
    store: { getState: useMeshStore.getState },
  },
  {
    name: "toast",
    store: { getState: useToastStore.getState },
  },
];

/** Hydrates all stores in dependency order. */
export async function hydrateAllStores(): Promise<void> {
  const errors: Array<{ store: string; error: Error }> = [];

  // Hydrate session first (provides roomId, deviceId for other stores)
  try {
    await useSessionStore.getState().hydrate();
  } catch (error) {
    errors.push({ store: "session", error: error as Error });
  }

  // Hydrate other stores that depend on session
  // Skip chat - it hydrates per-channel on demand when a channel is selected
  // Only hydrate stores that have a hydrate function
  const remaining = stores.filter((s) => s.name !== "session" && s.name !== "chat");
  await Promise.all(
    remaining.map(async ({ name, store }) => {
      try {
        if (store.hydrate) await store.hydrate();
      } catch (error) {
        errors.push({ store: name, error: error as Error });
      }
    }),
  );

  if (errors.length > 0) {
    console.error("[StoreRegistry] Hydration errors:", errors);
    // Don't throw - partial hydration is better than none
  }
}

/** Resets all stores in reverse dependency order. */
export function resetAllStores(): void {
  // Reset in reverse order (most dependent first)
  const reversed = [...stores].reverse();

  for (const { name, store } of reversed) {
    try {
      if (store.reset) store.reset();
    } catch (error) {
      console.error(`[StoreRegistry] Reset error for ${name}:`, error);
    }
  }
}

/** Flushes all outboxes across stores. */
export async function flushAllStoreOutboxes(): Promise<void> {
  const chatState = useChatStore.getState();
  if (chatState.flushOutbox) await chatState.flushOutbox();

  // Other stores use the generic outbox via mesh-provider
}

/** Returns the names of all registered stores. */
export function getStoreNames(): string[] {
  return stores.map((s) => s.name);
}

/** Checks if all stores are hydrated. */
export function isFullyHydrated(): boolean {
  const sessionState = useSessionStore.getState();
  if (!sessionState.hydrated) return false;

  for (const { name, store } of stores) {
    if (name === "session") continue;
    const state = store.getState() as { loaded?: boolean | Record<string, boolean> };
    if (typeof state.loaded === "boolean" && !state.loaded) return false;
    if (typeof state.loaded === "object" && Object.values(state.loaded).some((v) => v === false)) return false;
  }
  return true;
}