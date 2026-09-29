"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Siren } from "lucide-react";
import { Logo } from "./logo";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/utils/cn";

const TABS = [
  { href: "/chat", label: "Chat" },
  { href: "/files", label: "Files" },
  { href: "/notes", label: "Notes" },
  { href: "/checklist", label: "Checklists" },
  { href: "/map", label: "Map" },
  { href: "/beacon", label: "Beacon" },
  { href: "/status", label: "Status" },
  { href: "/settings", label: "Settings" },
] as const;

/**
 * Application chrome: 56px top bar + pill tab strip (selected tab uses the
 * primary surface, per `{components.pricing-tab-selected}`).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <header className="sticky top-0 z-40 border-b border-hairline bg-canvas">
        <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center gap-3 px-4 lg:px-8">
          <Logo />
          <Pill tone="outline" className="ml-2 hidden sm:inline-flex">
            no room
          </Pill>
          <div className="ml-auto flex items-center gap-2.5">
            <Pill tone="soft" className="hidden md:inline-flex">
              hub offline
            </Pill>
            <Link
              href="/join"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-pill bg-inverse-canvas px-4 py-1.5 text-button-sm font-medium text-inverse-ink hover:bg-inverse-canvas/90"
            >
              <Siren className="size-4" aria-hidden="true" />
              SOS
            </Link>
          </div>
        </div>
        <nav
          aria-label="App"
          className="mx-auto w-full max-w-[1280px] overflow-x-auto px-4 pb-2.5 lg:px-8"
        >
          <ul className="flex w-max items-center gap-1.5">
            {TABS.map((tab) => {
              const active =
                pathname === tab.href || pathname.startsWith(`${tab.href}/`);
              return (
                <li key={tab.href}>
                  <Link
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex min-h-[40px] items-center rounded-pill px-4 py-1.5 text-button-sm font-medium transition-colors",
                      active
                        ? "bg-primary text-on-primary"
                        : "bg-canvas text-ink hover:bg-surface-soft",
                    )}
                  >
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-8 lg:px-8">
        {children}
      </main>
    </div>
  );
}
