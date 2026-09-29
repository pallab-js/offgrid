import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/** Broadcast mark + wordmark. Monochrome — the brand signature. */
export function Logo({
  className,
  inverse = false,
}: {
  className?: string;
  inverse?: boolean;
}) {
  return (
    <Link
      href="/"
      className={cn(
        "group inline-flex items-center gap-2.5 text-body-lg font-540 tracking-[-0.14px]",
        inverse ? "text-inverse-ink" : "text-ink",
        className,
      )}
      aria-label="OffGrid home"
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <circle cx="11" cy="15" r="3" fill="currentColor" />
        <path
          d="M5.2 10.4a7.5 7.5 0 0 1 11.6 0"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M2 6.6a12 12 0 0 1 18 0"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      OffGrid
    </Link>
  );
}
