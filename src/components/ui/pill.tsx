import { cn } from "@/lib/utils/cn";

export type PillTone = "soft" | "dark" | "success" | "magenta" | "outline";

const tones: Record<PillTone, string> = {
  soft: "bg-surface-soft text-ink",
  dark: "bg-inverse-canvas text-inverse-ink",
  success: "bg-block-mint text-ink",
  magenta: "bg-accent-magenta text-on-primary",
  outline: "border border-hairline text-ink bg-canvas",
};

/** Small status/taxonomy chip. Always pill-shaped. */
export function Pill({
  tone = "soft",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: PillTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-3 py-1 " +
          "caption whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
