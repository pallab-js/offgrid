import { describe, expect, it } from "vitest";
import { MORSE_PRESETS, toMorse, toSegments } from "./encode";

describe("toMorse", () => {
  it("encodes SOS", () => {
    expect(toMorse("SOS")).toBe("... --- ...");
  });

  it("uppercases input", () => {
    expect(toMorse("sos")).toBe("... --- ...");
  });

  it("separates words with a slash", () => {
    expect(toMorse("A B")).toBe(".- / -...");
  });

  it("drops unknown characters", () => {
    expect(toMorse("S#O")).toBe("... ---");
  });

  it("returns empty string for blank input", () => {
    expect(toMorse("   ")).toBe("");
  });

  it("exposes the three distress presets", () => {
    expect(MORSE_PRESETS.SOS).toBe("SOS");
    expect(MORSE_PRESETS.HELP).toBe("HELP");
    expect(MORSE_PRESETS.DISTRESS).toBe("MAYDAY");
  });
});

describe("toSegments", () => {
  it("returns nothing for blank input", () => {
    expect(toSegments("  ", 18)).toEqual([]);
  });

  it("uses dot = 1 unit with unit gaps between elements", () => {
    const unit = 1200 / 20;
    const segments = toSegments("S", 20);
    expect(segments).toHaveLength(5);
    expect(segments.map((s) => s.on)).toEqual([true, false, true, false, true]);
    expect(segments.every((s) => s.ms === unit)).toBe(true);
  });

  it("uses 3 units for a dash", () => {
    const unit = 1200 / 15;
    const segments = toSegments("O", 15);
    const flashes = segments.filter((s) => s.on);
    expect(flashes).toHaveLength(3);
    expect(flashes.every((s) => s.ms === 3 * unit)).toBe(true);
  });

  it("schedules inter-letter gaps at the Farnsworth rate", () => {
    const wpm = 20;
    const gapWpm = 12;
    const gapUnit = 1200 / gapWpm;
    const segments = toSegments("SO", wpm, gapWpm);
    const gaps = segments.filter((s) => !s.on);
    expect(gaps.some((g) => g.ms === 3 * gapUnit)).toBe(true);
    expect(gaps.some((g) => g.ms === 1200 / wpm)).toBe(true);
  });

  it("adds a word gap of 7 units", () => {
    const gapWpm = 10;
    const gapUnit = 1200 / gapWpm;
    const segments = toSegments("E E", 20, gapWpm);
    expect(segments).toEqual([
      { on: true, ms: 60 },
      { on: false, ms: 7 * gapUnit },
      { on: true, ms: 60 },
    ]);
  });

  it("never ends with a trailing gap", () => {
    const segments = toSegments("SOS", 18);
    expect(segments[segments.length - 1]?.on).toBe(true);
  });

  it("starts with a flash", () => {
    const segments = toSegments("SOS", 18);
    expect(segments[0]?.on).toBe(true);
  });
});
