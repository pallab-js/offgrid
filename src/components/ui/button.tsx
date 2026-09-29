import { cn } from "@/lib/utils/cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "magenta"
  | "inverse";

export type ButtonSize = "sm" | "md" | "lg";

/**
 * Pill-only button styles per DESIGN.md `{components.button-primary}` etc.
 * Every variant is a pill; icon buttons use `rounded-full`.
 */
export function buttonStyles(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-pill font-medium " +
    "transition-transform active:scale-[0.98] select-none whitespace-nowrap " +
    "disabled:opacity-40 disabled:pointer-events-none";

  const variants: Record<ButtonVariant, string> = {
    primary: "bg-primary text-on-primary hover:bg-primary/90",
    secondary:
      "bg-canvas text-ink border border-hairline hover:border-ink/40",
    ghost: "bg-transparent text-ink hover:bg-surface-soft",
    magenta: "bg-accent-magenta text-on-primary hover:brightness-95",
    inverse:
      "bg-on-inverse-soft/16 text-inverse-ink hover:bg-on-inverse-soft/26",
  };

  const sizes: Record<ButtonSize, string> = {
    sm: "text-button-sm px-4 py-1.5 min-h-[44px]",
    md: "text-button px-5 py-2 min-h-[44px]",
    lg: "text-button px-7 py-2.5 min-h-[52px]",
  };

  return cn(base, variants[variant], sizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type={type}
      className={buttonStyles(variant, size, className)}
      {...props}
    />
  );
}

/** Circular icon button — `{components.button-icon-circular}`. */
export function IconButton({
  inverse = false,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { inverse?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex size-10 items-center justify-center rounded-full " +
          "transition-colors disabled:opacity-40 disabled:pointer-events-none",
        inverse
          ? "bg-on-inverse-soft/16 text-inverse-ink hover:bg-on-inverse-soft/26"
          : "bg-surface-soft text-ink hover:bg-hairline-soft",
        className,
      )}
      {...props}
    />
  );
}
