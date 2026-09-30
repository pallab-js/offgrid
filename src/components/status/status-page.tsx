"use client";

import { useCallback, useEffect, useState } from "react";
import { BatteryMedium, RefreshCcw, Wifi } from "lucide-react";
import { useMeshStore } from "@/stores/mesh";
import { useSessionStore } from "@/stores/session";
import { getDb } from "@/lib/idb/db";
import { meshSocket } from "@/lib/ws/client";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { TextInput } from "@/components/ui/input";

interface Health {
  ok: boolean;
  uptimeMs: number;
  clients: number;
  rev: number;
  version: string;
}

function relative(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function uptime(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${total % 60}s`;
  return `${total}s`;
}

export function StatusPage() {
  const peers = useMeshStore((s) => s.peers);
  const status = useMeshStore((s) => s.status);
  const rtt = useMeshStore((s) => s.rttMs);
  const myId = useSessionStore((s) => s.deviceId);
  const [health, setHealth] = useState<Health | null>(null);
  const [manualBattery, setManualBattery] = useState<string>("");
  const [hasNativeBattery] = useState(() => {
    if (typeof navigator === "undefined") return true;
    return Boolean((navigator as Navigator & { getBattery?: () => unknown }).getBattery);
  });

  const refresh = useCallback(() => {
    void fetch("/api/health")
      .then((r) => r.json())
      .then((data: Health) => setHealth(data))
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    void getDb()
      .then((db) => db.get("meta", "battery"))
      .then((meta) => {
        if (meta?.manualBattery != null) setManualBattery(String(meta.manualBattery));
      })
      .catch(() => undefined);
  }, []);

  function applyManual(value: string): void {
    setManualBattery(value);
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return;
    const battery = Math.round(parsed);
    void getDb().then((db) =>
      db.put("meta", { key: "battery", manualBattery: battery }),
    );
    meshSocket.send({ t: "presence.update", battery });
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Eyebrow className="text-ink">Status</Eyebrow>
        <h1 className="text-display-lg">Team status board</h1>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-2 rounded-xl bg-block-mint p-5">
          <span className="caption text-ink">Link</span>
          <span className="text-card-title">
            {status === "online" ? "Live" : status}
          </span>
          <span className="caption text-ink">
            {rtt !== null ? `${rtt} ms round trip` : "measuring…"}
          </span>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-canvas p-5">
          <span className="caption text-ink">Hub</span>
          <span className="text-card-title">
            {health ? `up ${uptime(health.uptimeMs)}` : "unreachable"}
          </span>
          <span className="caption text-ink">
            {health
              ? `v${health.version} · rev ${health.rev} · ${health.clients} sockets`
              : "check the hub process"}
          </span>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-canvas p-5">
          <span className="caption text-ink">Peers online</span>
          <span className="text-card-title">
            {peers.filter((p) => p.online).length} / {peers.length}
          </span>
          <span className="caption text-ink">devices joined this room</span>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-canvas p-5">
          <span className="caption text-ink">Your battery</span>
          <span className="inline-flex items-center gap-2 text-card-title">
            <BatteryMedium className="size-5" aria-hidden="true" />
            {peers.find((p) => p.deviceId === myId)?.battery ?? (manualBattery || "n/a")}
            {peers.find((p) => p.deviceId === myId)?.battery != null ? "%" : ""}
          </span>
          {!hasNativeBattery ? (
            <label className="flex items-center gap-2">
              <span className="caption text-ink">manual</span>
              <TextInput
                type="number"
                min={0}
                max={100}
                value={manualBattery}
                onChange={(e) => applyManual(e.target.value)}
                placeholder="0–100"
                className="w-24 min-h-[44px] px-2 py-1"
                aria-label="Manual battery percent"
              />
            </label>
          ) : (
            <span className="caption text-ink">reported by this device</span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-card-title">Devices</h2>
        <Button variant="secondary" size="sm" onClick={refresh}>
          <RefreshCcw className="size-3.5" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-hairline">
        <table className="w-full caption text-ink">
          <thead>
            <tr className="border-b border-hairline bg-surface-soft text-left">
              <th className="px-4 py-3 font-medium">Device</th>
              <th className="px-4 py-3 font-medium">State</th>
              <th className="px-4 py-3 font-medium">Battery</th>
              <th className="px-4 py-3 font-medium">RTT</th>
              <th className="px-4 py-3 font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {peers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center">
                  No devices yet — share the room passphrase.
                </td>
              </tr>
            ) : (
              peers.map((peer) => (
                <tr key={peer.deviceId} className="border-b border-hairline-soft last:border-0">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="size-3 rounded-full"
                        style={{ backgroundColor: peer.color }}
                        aria-hidden="true"
                      />
                      {peer.name}
                      {peer.deviceId === myId ? " (you)" : ""}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Pill tone={peer.online ? "success" : "outline"}>
                      <Wifi className="size-3" aria-hidden="true" />
                      {peer.online ? "online" : "offline"}
                    </Pill>
                  </td>
                  <td className="px-4 py-3">
                    {peer.battery !== null ? `${peer.battery}%` : "—"}
                  </td>
                  <td className="px-4 py-3">{peer.rttMs !== null ? `${peer.rttMs} ms` : "—"}</td>
                  <td className="px-4 py-3">{relative(peer.lastSeen)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
