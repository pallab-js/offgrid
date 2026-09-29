import Link from "next/link";
import { buttonStyles, type ButtonSize, type ButtonVariant } from "./button";

/** Pill CTA rendered as a Next.js link — same shape as `Button`. */
export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Link>, "href"> & {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <Link href={href} className={buttonStyles(variant, size, className)} {...props}>
      {children}
    </Link>
  );
}
