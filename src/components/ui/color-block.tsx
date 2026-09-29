import { cn } from "@/lib/utils/cn";

export type BlockColor =
  | "lime"
  | "lilac"
  | "cream"
  | "pink"
  | "mint"
  | "coral"
  | "navy";

const blockBg: Record<BlockColor, string> = {
  lime: "bg-block-lime text-ink",
  lilac: "bg-block-lilac text-ink",
  cream: "bg-block-cream text-ink",
  pink: "bg-block-pink text-ink",
  mint: "bg-block-mint text-ink",
  coral: "bg-block-coral text-ink",
  navy: "bg-block-navy text-inverse-ink",
};

/**
 * `{components.color-block-section}` — the signature surface.
 * Full-content-width pastel panel; no shadows (color is the depth device).
 * Inside a single viewport at most one block is shown (see DESIGN.md).
 */
export function ColorBlock({
  color = "lime",
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { color?: BlockColor }) {
  return (
    <div
      className={cn("color-block", blockBg[color], className)}
      {...props}
    />
  );
}
