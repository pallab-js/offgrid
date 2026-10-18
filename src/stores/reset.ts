"use client";

import { useMeshStore } from "./mesh";
import { useChatStore } from "./chat";
import { useFilesStore } from "./files";
import { useNotesStore } from "./notes";
import { useChecklistStore } from "./checklist";
import { useMapStore } from "./map";
import { useSosStore } from "./sos";
import { useBeaconStore } from "./beacon";

/**
 * Reset every domain store for a room transition.
 *
 * Each store guards hydration with a `loaded` flag that is only cleared by
 * `reset()` — without this, leaving room A and joining room B in the same tab
 * kept showing room A's data (and never re-hydrated), and room A's pending
 * chat could flush while connected to room B. Must be called on leave and
 * before entering a *different* room; IndexedDB records are untouched (they
 * are roomId-scoped and reload when that room is re-entered).
 *
 * Lives in its own module so stores never import each other's cycles just to
 * reach this function.
 */
export function resetRoomStores(): void {
  useMeshStore.getState().reset();
  useChatStore.getState().reset();
  useFilesStore.getState().reset();
  useNotesStore.getState().reset();
  useChecklistStore.getState().reset();
  useMapStore.getState().reset();
  useSosStore.getState().reset();
  useBeaconStore.getState().reset();
}
