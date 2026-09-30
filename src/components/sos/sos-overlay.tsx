"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX, X } from "lucide-react";
import { useSosStore } from "@/stores/sos";
import { useMeshStore } from "@/stores/mesh";
import { useSessionStore } from "@/stores/session";
import { Button } from "@/components/ui/button";

/**
 * Full-room distress overlay: strobe + WebAudio siren while any SOS is
 * active (AC-SOS). Reduced-motion gets a static banner; audio can be muted.
 */
export function SosOverlay() {
  const events = useSosStore((s) => s.events);
  const hydrate = useSosStore((s) => s.hydrate);
  const clear = useSosStore((s) => s.clear);
  const peers = useMeshStore((s) => s.peers);
  const myId = useSessionStore((s) => s.deviceId);
  const [muted, setMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const active = events.find((e) => e.active) ?? null;

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!active || muted) return;
    // Two-tone siren loop via a data-free WebAudio oscillation.
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtor) return;
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioCtor();
      void ctx.resume().catch(() => undefined);
    } catch {
      return;
    }
    const beep = (): void => {
      if (!ctx) return;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        const now = ctx.currentTime;
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(660, now + 0.25);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.setValueAtTime(0.0001, now + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.55);
      } catch {
        /* best-effort */
      }
    };
    beep();
    const interval = setInterval(beep, 600);
    return () => {
      clearInterval(interval);
      void ctx?.close().catch(() => undefined);
    };
  }, [active, muted]);

  if (!active) return null;

  const who =
    active.deviceId === myId
      ? "You raised SOS"
      : `${peers.find((p) => p.deviceId === active.deviceId)?.name ?? "A peer"} needs help`;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="SOS active"
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 bg-inverse-canvas text-inverse-ink animate-sos-strobe"
    >
      <div className="flex w-full max-w-[560px] flex-col items-center gap-4 px-6 text-center">
        <span className="inline-flex items-center gap-3 rounded-pill bg-accent-magenta px-6 py-2 text-button font-medium text-on-primary">
          SOS
        </span>
        <p className="text-display-lg text-inverse-ink">{who}</p>
        {active.note ? <p className="text-body-lg">{active.note}</p> : null}
        {active.lat !== null && active.lng !== null ? (
          <p className="caption text-inverse-ink">
            {active.lat.toFixed(5)}, {active.lng.toFixed(5)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="primary"
            size="lg"
            onClick={() => void clear(active.id)}
            className="bg-inverse-canvas text-inverse-ink hover:bg-inverse-canvas/80"
          >
            <X className="size-4" aria-hidden="true" />
            Clear SOS
          </Button>
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? "Unmute siren" : "Mute siren"}
            className="inline-flex size-11 items-center justify-center rounded-full bg-on-inverse-soft/16 text-inverse-ink hover:bg-on-inverse-soft/26"
          >
            {muted ? (
              <VolumeX className="size-5" aria-hidden="true" />
            ) : (
              <Volume2 className="size-5" aria-hidden="true" />
            )}
          </button>
        </div>
        <p className="caption text-inverse-ink">
          Strobes and siren repeat on every device until it is cleared.
        </p>
      </div>
      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
