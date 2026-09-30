"use client";

import { useEffect } from "react";
import { Siren } from "lucide-react";
import { useSosStore } from "@/stores/sos";
import { useMeshStore } from "@/stores/mesh";
import { useSessionStore } from "@/stores/session";
import { Pill } from "@/components/ui/pill";

/** Distress timeline shown inside the `#sos` channel (AC-SOS). */
export function SosTimeline() {
  const events = useSosStore((s) => s.events);
  const hydrate = useSosStore((s) => s.hydrate);
  const clear = useSosStore((s) => s.clear);
  const peers = useMeshStore((s) => s.peers);
  const myId = useSessionStore((s) => s.deviceId);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (events.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-hairline bg-surface-soft px-4 py-3">
        <Siren className="size-4" aria-hidden="true" />
        <p className="text-body-sm">
          No SOS events. Raise one from the Beacon tab when someone needs help.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {events.map((event) => {
        const who =
          event.deviceId === myId
            ? "You"
            : peers.find((p) => p.deviceId === event.deviceId)?.name ?? "Peer";
        const time = new Date(event.createdAt).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        return (
          <li
            key={event.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-canvas px-4 py-3"
          >
            <Pill tone={event.active ? "magenta" : "outline"}>
              <Siren className="size-3" aria-hidden="true" />
              {event.active ? "ACTIVE" : "cleared"}
            </Pill>
            <span className="text-body-sm font-medium">
              {who} raised SOS
            </span>
            <span className="caption text-ink">{time}</span>
            {event.note ? (
              <span className="min-w-0 flex-1 truncate text-body-sm">
                “{event.note}”
              </span>
            ) : null}
            {event.active ? (
              <button
                type="button"
                onClick={() => void clear(event.id)}
                className="ml-auto rounded-pill border border-hairline px-3 py-1 caption hover:border-ink/40"
              >
                Clear
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
