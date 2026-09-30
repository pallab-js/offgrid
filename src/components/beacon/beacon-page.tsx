"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Radio, Send, Siren, Square } from "lucide-react";
import {
  MORSE_PRESETS,
  toMorse,
  toSegments,
  type Segment,
} from "@/lib/morse/encode";
import { playSegments, type PlayController } from "@/lib/morse/play";
import { useBeaconStore } from "@/stores/beacon";
import { useSosStore } from "@/stores/sos";
import { useSessionStore } from "@/stores/session";
import { useMeshStore } from "@/stores/mesh";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { TextArea } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

export function BeaconPage() {
  const hasRoom = useSessionStore((s) => Boolean(s.roomId));
  const [text, setText] = useState("SOS");
  const [wpm, setWpm] = useState(18);
  const [flash, setFlash] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [audioOn, setAudioOn] = useState(true);
  const [shared, setShared] = useState(false);
  const controllerRef = useRef<PlayController | null>(null);

  const history = useBeaconStore((s) => s.history);
  const share = useBeaconStore((s) => s.share);
  const raise = useSosStore((s) => s.raise);
  const raising = useSosStore((s) => s.raising);
  const sosEvents = useSosStore((s) => s.events);
  const sosHydrate = useSosStore((s) => s.hydrate);
  const peers = useMeshStore((s) => s.peers);
  const myId = useSessionStore((s) => s.deviceId);
  const [sosNote, setSosNote] = useState("");

  const activeSos = sosEvents.find((e) => e.active) ?? null;

  useEffect(() => {
    void sosHydrate();
  }, [sosHydrate]);

  useEffect(() => {
    return () => controllerRef.current?.stop();
  }, []);

  const morsePreview = toMorse(text);

  function play(): void {
    controllerRef.current?.stop();
    const segments: Segment[] = toSegments(text, wpm);
    if (segments.length === 0) return;
    setPlaying(true);
    controllerRef.current = playSegments(segments, {
      onVisual: setFlash,
      audio: audioOn,
      onDone: () => setPlaying(false),
    });
  }

  function stop(): void {
    controllerRef.current?.stop();
    controllerRef.current = null;
    setPlaying(false);
  }

  async function onShare(): Promise<void> {
    setShared(true);
    try {
      await share(text, wpm);
    } finally {
      setTimeout(() => setShared(false), 2000);
    }
  }

  async function onRaise(withGps: boolean): Promise<void> {
    if (withGps && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => void raise(sosNote || undefined, pos.coords.latitude, pos.coords.longitude),
        () => void raise(sosNote || undefined),
        { timeout: 5000 },
      );
    } else {
      await raise(sosNote || undefined);
    }
  }

  if (!hasRoom) {
    return (
      <div className="flex max-w-[56ch] flex-col items-start gap-5">
        <Eyebrow className="text-ink">Phase 4</Eyebrow>
        <h1 className="text-display-lg">Morse beacon</h1>
        <p className="text-body-lg">
          Visual and audio signalling for the team — plus the distress call.
          Join a room to broadcast.
        </p>
        <Link
          href="/join"
          className="inline-flex min-h-[44px] items-center rounded-pill border border-hairline bg-canvas px-5 py-2 text-button font-medium text-ink hover:border-ink/40"
        >
          Set up a room
        </Link>
      </div>
    );
  }

  const mySos = activeSos && activeSos.deviceId === myId ? activeSos : null;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Eyebrow className="text-ink">Beacon</Eyebrow>
        <h1 className="text-display-lg">Morse beacon</h1>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="flex flex-col gap-4 rounded-xl bg-block-coral p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="caption text-ink">Presets</span>
            {Object.entries(MORSE_PRESETS).map(([name, value]) => (
              <button
                key={name}
                type="button"
                onClick={() => setText(value)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-pill border border-hairline bg-canvas px-3 py-1 caption whitespace-nowrap text-ink hover:bg-surface-soft"
              >
                {value}
              </button>
            ))}
          </div>

          <TextArea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 140))}
            rows={3}
            aria-label="Beacon text"
            placeholder="Text to flash"
            className="bg-canvas"
          />

          <p className="caption text-ink break-all">
            <span className="font-medium">Morse: </span>
            {morsePreview || "—"}
          </p>

          <label className="flex items-center gap-3">
            <span className="caption text-ink whitespace-nowrap">
              Speed {wpm} WPM
            </span>
            <input
              type="range"
              min={5}
              max={40}
              value={wpm}
              onChange={(e) => setWpm(Number(e.target.value))}
              className="h-11 w-full accent-black"
              aria-label="Words per minute"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            {!playing ? (
              <Button onClick={play}>
                <Radio className="size-4" aria-hidden="true" />
                Play
              </Button>
            ) : (
              <Button variant="secondary" onClick={stop}>
                <Square className="size-4" aria-hidden="true" />
                Stop
              </Button>
            )}
            <Button variant="secondary" onClick={() => void onShare()}>
              <Send className="size-4" aria-hidden="true" />
              {shared ? "Shared" : "Share to room"}
            </Button>
            <label className="inline-flex min-h-[44px] items-center gap-2 caption">
              <input
                type="checkbox"
                checked={audioOn}
                onChange={(e) => setAudioOn(e.target.checked)}
                className="size-4 accent-black"
              />
              tone
            </label>
          </div>
        </section>

        <aside className="flex flex-col gap-4 rounded-xl border border-hairline bg-canvas p-5">
          <div className="flex items-center gap-2">
            <Siren className="size-5" aria-hidden="true" />
            <h2 className="text-card-title">Distress</h2>
          </div>
          {activeSos ? (
            <Pill tone="magenta">SOS active on this room</Pill>
          ) : (
            <p className="text-body-sm">
              Raises a full-screen alert on every connected device until
              someone clears it.
            </p>
          )}
          <TextArea
            value={sosNote}
            onChange={(e) => setSosNote(e.target.value.slice(0, 120))}
            rows={2}
            placeholder="Optional: what's wrong, where we are"
            aria-label="SOS note"
          />
          <Button
            variant="magenta"
            size="lg"
            disabled={raising || Boolean(mySos)}
            onClick={() => void onRaise(false)}
          >
            <Siren className="size-4" aria-hidden="true" />
            {mySos ? "SOS sent" : raising ? "Sending…" : "Raise SOS"}
          </Button>
          {!mySos ? (
            <Button variant="secondary" disabled={raising} onClick={() => void onRaise(true)}>
              Raise SOS + GPS
            </Button>
          ) : null}
        </aside>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-card-title">Shared beacons</h2>
        {history.length === 0 ? (
          <p className="text-body-sm">Nothing shared yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((entry) => {
              const who =
                entry.deviceId === myId
                  ? "You"
                  : peers.find((p) => p.deviceId === entry.deviceId)?.name ?? "Peer";
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-hairline px-4 py-2"
                >
                  <span className="text-body-sm font-medium">{who}</span>
                  <Pill tone="soft">{entry.wpm} wpm</Pill>
                  <span className="font-mono text-body-sm">{entry.text}</span>
                  <span className="caption ml-auto text-ink">
                    {new Date(entry.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex min-h-[44px] items-center rounded-pill border border-hairline px-3 py-1 caption",
                      "hover:border-ink/40",
                    )}
                    onClick={() => setText(entry.text)}
                  >
                    reuse
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {playing ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Beacon flashing"
          className={cn(
            "fixed inset-0 z-[65] flex flex-col items-center justify-center gap-8",
            flash ? "bg-canvas" : "bg-inverse-canvas",
          )}
        >
          <span
            className={cn(
              "text-display-xl font-mono",
              flash ? "text-ink" : "text-inverse-ink",
            )}
          >
            {flash ? "•" : "·"}
          </span>
          <div className="absolute bottom-12 flex max-w-[calc(100%-2rem)] flex-wrap items-center justify-center gap-4 px-4">
            <span
              className={cn("caption", flash ? "text-ink" : "text-inverse-ink")}
            >
              {toMorse(text)}
            </span>
            <Button
              variant="magenta"
              onClick={stop}
              className="min-h-[52px] px-8"
            >
              <Square className="size-4" aria-hidden="true" />
              Stop beacon
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
