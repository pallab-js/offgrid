/** Morse encoder with Farnsworth-style gap timing (PRD §4.6). */

const TABLE: Record<string, string> = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.",
  G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..",
  M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.",
  S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
  Y: "-.--", Z: "--..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
  "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
  ".": ".-.-.-", ",": "--..--", "?": "..--..", "'": ".----.", "!": "-.-.--",
  "/": "-..-.", "(": "-.--.", ")": "-.--.-", "&": ".-...", ":": "---...",
  ";": "-.-.-.", "=": "-...-", "+": ".-.-.", "-": "-....-", "_": "..--.-",
  '"': ".-..-.", "$": "...-..-", "@": ".--.-.",
};

export const MORSE_PRESETS = {
  SOS: "SOS",
  HELP: "HELP",
  DISTRESS: "MAYDAY",
} as const;

/** Human-readable Morse ("... --- ...  /  .... . .-.. .--."). */
export function toMorse(text: string): string {
  const words = text.toUpperCase().trim().split(/\s+/);
  return words
    .map((word) =>
      word
        .split("")
        .map((ch) => TABLE[ch])
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean)
    .join(" / ");
}

export interface Segment {
  on: boolean;
  ms: number;
}

/**
 * Timing plan: dot = 1 unit at `wpm`; inter-letter gaps use the slower
 * Farnsworth rate (`gapWpm`, default 60 % of character speed) so spaced-out
 * letters stay readable at high character rates.
 */
export function toSegments(
  text: string,
  wpm: number,
  gapWpm: number = Math.max(5, Math.round(wpm * 0.6)),
): Segment[] {
  const unit = 1200 / Math.max(1, wpm);
  const gapUnit = 1200 / Math.max(1, gapWpm);
  const segments: Segment[] = [];
  const words = text.toUpperCase().trim().split(/\s+/).filter(Boolean);

  words.forEach((word, wi) => {
    if (wi > 0) segments.push({ on: false, ms: 7 * gapUnit });
    const letters = word.split("").map((ch) => TABLE[ch]).filter(Boolean);
    letters.forEach((code, li) => {
      if (li > 0) segments.push({ on: false, ms: 3 * gapUnit });
      for (let i = 0; i < code.length; i++) {
        if (i > 0) segments.push({ on: false, ms: unit });
        segments.push({ on: true, ms: (code[i] === "." ? 1 : 3) * unit });
      }
    });
  });

  if (segments.length && segments[segments.length - 1]!.on === false) {
    segments.pop(); // no trailing gap
  }
  return segments;
}
