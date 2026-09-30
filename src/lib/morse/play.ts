"use client";

import type { Segment } from "./encode";

export interface PlayController {
  stop: () => void;
}

/**
 * Steps through segments with one clock driving both the visual flasher
 * and a WebAudio tone (PRD §4.6). `onVisual` receives true/false per segment.
 */
export function playSegments(
  segments: Segment[],
  opts: {
    onVisual: (on: boolean) => void;
    audio?: boolean;
    frequency?: number;
    onDone?: () => void;
  },
): PlayController {
  let index = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let ctx: AudioContext | null = null;
  const frequency = opts.frequency ?? 620;

  if (opts.audio !== false) {
    try {
      ctx = new AudioContext();
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    } catch {
      ctx = null;
    }
  }

  function tone(ms: number): void {
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      const now = ctx.currentTime;
      const end = now + ms / 1000;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
      gain.gain.setValueAtTime(0.2, Math.max(now + 0.01, end - 0.02));
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(end + 0.02);
    } catch {
      /* audio is best-effort */
    }
  }

  function step(): void {
    if (stopped) return;
    if (index >= segments.length) {
      opts.onVisual(false);
      opts.onDone?.();
      void ctx?.close().catch(() => undefined);
      ctx = null;
      return;
    }
    const segment = segments[index]!;
    opts.onVisual(segment.on);
    if (segment.on) tone(segment.ms);
    index += 1;
    timer = setTimeout(step, segment.ms);
  }

  step();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      opts.onVisual(false);
      void ctx?.close().catch(() => undefined);
      ctx = null;
    },
  };
}
