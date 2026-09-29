import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Logo } from "./logo";
import { ButtonLink } from "@/components/ui/button-link";

const NAV_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#how", label: "How it works" },
  { href: "/#field-tools", label: "Field tools" },
] as const;

/** `{components.top-nav}` — sticky 56px white bar; hamburger below 960px. */
export function TopNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-canvas">
      <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center justify-between gap-4 px-6 lg:px-8">
        <Logo />

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full px-3 py-2 text-body-sm font-330 text-ink hover:bg-surface-soft"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          <ButtonLink href="/chat" variant="secondary" size="sm" className="hidden sm:inline-flex">
            Open app
          </ButtonLink>
          <ButtonLink href="/join" variant="primary" size="sm">
            Get started
          </ButtonLink>
          <MobileMenuButton />
        </div>
      </div>
    </header>
  );
}

function MobileMenuButton() {
  return (
    <details className="group relative lg:hidden">
      <summary className="flex size-10 list-none items-center justify-center rounded-full bg-surface-soft text-ink marker:hidden">
        <Menu className="size-5 group-open:hidden" aria-hidden="true" />
        <X className="size-5 hidden group-open:block" aria-hidden="true" />
        <span className="sr-only">Menu</span>
      </summary>
      <nav
        aria-label="Mobile"
        className="absolute right-0 top-12 z-50 flex w-60 flex-col gap-1 rounded-lg border border-hairline bg-canvas p-4 shadow-tile"
      >
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-md px-3 py-2.5 text-body-sm font-330 text-ink hover:bg-surface-soft"
          >
            {link.label}
          </Link>
        ))}
        <Link
          href="/chat"
          className="rounded-md px-3 py-2.5 text-body-sm font-330 text-ink hover:bg-surface-soft"
        >
          Open app
        </Link>
      </nav>
    </details>
  );
}
