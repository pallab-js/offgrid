"use client";

import { useCallback, useEffect, useRef } from "react";
import { meshSocket } from "@/lib/ws/client";
import { useMeshStore } from "@/stores/mesh";
import { useSessionStore } from "@/stores/session";
import type { ServerFrame } from "@/lib/protocol";
import { isMeshEvent } from "@/lib/protocol";

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
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastRttPush = useRef(0);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const applyFrame = useCallback((frame: ServerFrame) => {
    const mesh = useMeshStore.getState();
    switch (frame.t) {
      case "joined":
        mesh.setChannels(frame.channels);
        meshSocket.send({ t: "sync.pull", cursor: useSessionStore.getState().cursor });
        break;
      case "sync.batch":
        frame.events.forEach((event) => mesh.applyEvent(event));
        setCursor(frame.cursor);
        if (!frame.done) meshSocket.send({ t: "sync.pull", cursor: frame.cursor });
        break;
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
        if (isMeshEvent(frame)) mesh.applyEvent(frame);
        break;
    }
  }, [setCursor]);

  // Socket lifecycle ---------------------------------------------------
  useEffect(() => {
    if (!deviceId || !profileName || !profileColor || !roomId || !token) return;

    const offFrame = meshSocket.onFrame(applyFrame);
    const offStatus = meshSocket.onStatus((status) =>
      useMeshStore.getState().setStatus(status),
    );
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
