"use client";

import { useCallback, useEffect, useRef } from "react";
import { meshSocket } from "@/lib/ws/client";
import { useMeshStore } from "@/stores/mesh";
import { useSessionStore } from "@/stores/session";
import { isMeshEvent } from "@/lib/protocol/constants";
import type { MeshEvent, ServerFrame } from "@/lib/protocol";
import { useChatStore } from "@/stores/chat";
import { useFilesStore } from "@/stores/files";
import { useNotesStore } from "@/stores/notes";
import { useChecklistStore } from "@/stores/checklist";
import { useMapStore } from "@/stores/map";
import { useSosStore } from "@/stores/sos";
import { useBeaconStore } from "@/stores/beacon";
import { flushAllOutboxes } from "@/lib/sync/outbox";
import { resetRoomStores } from "@/stores/reset";
import { toast } from "@/stores/toast";
import { useRouter } from "next/navigation";

/** Applies one sync/live event; resolves only when the store write lands in
 * IndexedDB — callers gate cursor advancement on this (see sync.batch). */
async function routeEvent(event: MeshEvent): Promise<void> {
  switch (event.t) {
    case "msg.new":
      await useChatStore.getState().applyIncoming(event.msg);
      break;
    case "file.new":
      await useFilesStore.getState().applyIncoming(event.file, event.rev);
      break;
    case "file.deleted":
      await useFilesStore.getState().markDeleted(event.id, event.rev);
      break;
    case "note.upsert":
      await useNotesStore.getState().applyIncoming(event.note, event.rev);
      break;
    case "note.deleted":
      await useNotesStore.getState().applyDeleted(event.id, event.rev);
      break;
    case "check.update":
      await useChecklistStore.getState().applyUpdate(event);
      break;
    case "wp.upsert":
      await useMapStore.getState().applyUpsert(event.waypoint, event.rev);
      break;
    case "wp.deleted":
      await useMapStore.getState().applyDelete(event.id, event.rev);
      break;
    case "sos.raised":
      await useSosStore.getState().applyRaised(event.sos, event.rev);
      break;
    case "sos.cleared":
      await useSosStore.getState().applyCleared(event.id, event.rev);
      break;
    case "beacon.new":
      await useBeaconStore.getState().applyBeacon(event.beacon);
      break;
    case "channel.read":
      useMeshStore.getState().setRead(event.channelId, event.deviceId, event.at);
      break;
    default:
      useMeshStore.getState().applyEvent(event);
  }
}

/**
 * Connects the hub socket to the stores. Mounted once inside the app shell.
 */
export function MeshProvider({ children }: { children: React.ReactNode }) {
  const deviceId = useSessionStore((s) => s.deviceId);
  const profileName = useSessionStore((s) => s.profile?.name);
  const profileColor = useSessionStore((s) => s.profile?.color);
  const roomId = useSessionStore((s) => s.roomId);
  const token = useSessionStore((s) => s.token);
  const setCursor = useSessionStore((s) => s.setCursor);
  const hydrate = useSessionStore((s) => s.hydrate);
  const router = useRouter();
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastRttPush = useRef(0);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  /**
   * A ref-less `error { code: "BAD_TOKEN" }` is a join rejection: the hub
   * refuses this token because it was revoked (device kicked / left remotely)
   * or the room passphrase was rotated (rotation revokes every token). The
   * session can never recover on its own — drop it and send the user to the
   * join screen instead of silently hanging half-connected.
   */
  const endSession = useCallback(() => {
    if (!useSessionStore.getState().roomId) return; // already ended (reconnect race)
    resetRoomStores();
    useSessionStore.getState().leaveRoom();
    toast("Your session ended — rejoin with the room's current passphrase", "error");
    router.push("/join");
  }, [router]);

  const applyFrame = useCallback((frame: ServerFrame) => {
    const mesh = useMeshStore.getState();
    switch (frame.t) {
      case "joined":
        mesh.setChannels(frame.channels);
        useSessionStore.getState().setModerators(frame.moderators);
        meshSocket.send({ t: "sync.pull", cursor: useSessionStore.getState().cursor });
        void flushAllOutboxes();
        break;
      case "room.settings":
        useSessionStore.getState().setModerators(frame.moderators);
        break;
      case "room.rotated":
        // Live signal only: a close (4001) follows immediately and the BAD_TOKEN
        // join rejection on the next attempt ends the session with a toast. The
        // rotator itself is unaffected — it rejoins with the new passphrase
        // before its own socket ever retries.
        break;
      case "error":
        if (frame.code === "BAD_TOKEN" && !frame.ref) endSession();
        break;
      case "sync.batch": {
        // The cursor asserts "every event before it is durably in IndexedDB".
        // Advancing it before the async applies resolve lets a crash in
        // between permanently skip the batch (it would never be re-requested).
        // The cursor therefore moves only after the whole batch is applied,
        // and the next pull goes out only then — so batches stay sequential.
        void Promise.all(frame.events.map(routeEvent))
          .then(() => {
            const current = useSessionStore.getState().cursor;
            if (frame.cursor <= current) return; // stale batch from a dropped connection
            setCursor(frame.cursor);
            if (!frame.done) meshSocket.send({ t: "sync.pull", cursor: frame.cursor });
          })
          .catch((error) => {
            // Cursor stays put: the batch replays (idempotent LWW guards)
            // on the next pull/reconnect.
            console.error("sync.batch: apply failed, cursor not advanced", error);
          });
        break;
      }
      case "presence":
        mesh.setPresence(frame.peers);
        break;
      case "typing": {
        const current = useMeshStore.getState().typing[frame.channelId];
        if (frame.on) {
          mesh.setTyping(frame.channelId, frame.deviceId);
          const existing = typingTimers.current.get(frame.channelId);
          if (existing) clearTimeout(existing);
          typingTimers.current.set(
            frame.channelId,
            setTimeout(() => useMeshStore.getState().setTyping(frame.channelId, null), 4000),
          );
        } else if (current === frame.deviceId) {
          mesh.setTyping(frame.channelId, null);
        }
        break;
      }
      default:
        if (isMeshEvent(frame)) void routeEvent(frame);
        break;
    }
  }, [setCursor, endSession]);

  // Socket lifecycle ---------------------------------------------------
  useEffect(() => {
    if (!deviceId || !profileName || !profileColor || !roomId || !token) return;

    const offFrame = meshSocket.onFrame(applyFrame);
    const offStatus = meshSocket.onStatus((status) => {
      useMeshStore.getState().setStatus(status);
      if (status === "online") {
        void flushAllOutboxes();
      }
    });
    const offRtt = meshSocket.onRtt((rttMs) => {
      useMeshStore.getState().setRtt(rttMs);
      const now = Date.now();
      if (now - lastRttPush.current > 10_000) {
        lastRttPush.current = now;
        meshSocket.send({ t: "presence.update", rttMs });
      }
    });

    meshSocket.start({
      token,
      device: { id: deviceId, name: profileName, color: profileColor },
    });

    // Battery (Chromium only — manual entry covers the rest, PRD §4.1).
    let batteryCleanup: (() => void) | undefined;
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{
        level: number;
        addEventListener: (type: string, listener: () => void) => void;
        removeEventListener: (type: string, listener: () => void) => void;
      }>;
    };
    if (nav.getBattery) {
      void nav.getBattery().then((battery) => {
        const push = () =>
          meshSocket.send({
            t: "presence.update",
            battery: Math.round(battery.level * 100),
          });
        push();
        battery.addEventListener("levelchange", push);
        batteryCleanup = () => battery.removeEventListener("levelchange", push);
      });
    }

    return () => {
      offFrame();
      offStatus();
      offRtt();
      batteryCleanup?.();
      meshSocket.stop();
    };
  }, [deviceId, profileName, profileColor, roomId, token, applyFrame]);

  useEffect(() => {
    const timers = typingTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return <>{children}</>;
}
