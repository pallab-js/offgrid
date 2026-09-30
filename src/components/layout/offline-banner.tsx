"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { outboxStats, flushOutbox, retryFailed, type OutboxStats } from "@/lib/sync/outbox";
import { useMeshStore } from "@/stores/mesh";
import { useSessionStore } from "@/stores/session";
import { Button } from "@/components/ui/button";

/**
 * Persistent connectivity strip: offline warning + outbox visibility
 * (pending / failed counts, manual retry) per plan 5.2 / AC-OFFLINE.
 */
export function OfflineBanner() {
  const status = useMeshStore((s) => s.status);
  const hasRoom = useSessionStore((s) => Boolean(s.roomId));
  const [stats, setStats] = useState<OutboxStats>({ pending: 0, failed: 0 });

  const refresh = useCallback(() => {
    void outboxStats().then(setStats).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hasRoom) return;
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [hasRoom, refresh, status]);

  if (!hasRoom) return null;

  const offline = status === "offline" || status === "reconnecting";
  const failed = stats.failed > 0;
  if (!offline && !failed && stats.pending === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-hairline bg-block-lilac"
    >
      <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 lg:px-8">
        {offline ? (
          <>
            <WifiOff className="size-4 shrink-0" aria-hidden="true" />
            <span className="text-body-sm font-medium">
              Offline — the hub is unreachable. History stays readable and
              changes queue locally.
            </span>
          </>
        ) : null}
        {!offline && stats.pending > 0 ? (
          <span className="text-body-sm">
            {stats.pending} change{stats.pending === 1 ? "" : "s"} waiting to sync
          </span>
        ) : null}
        {failed ? (
          <span className="text-body-sm font-medium">
            {stats.failed} frame{stats.failed === 1 ? "" : "s"} failed to send
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void (failed ? retryFailed() : flushOutbox()).then(refresh)}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Retry now
          </Button>
        </div>
      </div>
    </div>
  );
}
