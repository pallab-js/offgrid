export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[];

/**
 * Minimal class-name joiner (clsx-compatible subset, zero deps).
 */
export function cn(...parts: ClassValue[]): string {
  const out: string[] = [];
  for (const part of parts) {
    if (!part && part !== 0) continue;
    if (Array.isArray(part)) {
      const nested = cn(...part);
      if (nested) out.push(nested);
    } else {
      out.push(String(part));
    }
  }
  return out.join(" ");
}
