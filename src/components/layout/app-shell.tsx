"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import {
  Activity,
  ChevronDown,
  FolderOpen,
  ListChecks,
  Map,
  MessageSquare,
  NotebookPen,
  Radio,
  Settings,
  Siren,
} from "lucide-react";
import { Logo } from "./logo";
import { Pill } from "@/components/ui/pill";
import { MeshProvider } from "@/components/providers/mesh-provider";
import { OfflineBanner } from "./offline-banner";
import { Toaster } from "@/components/ui/toaster";
import { SosOverlay } from "@/components/sos/sos-overlay";
import { useMeshStore } from "@/stores/mesh";
import { useSessionStore } from "@/stores/session";
import { onColor } from "@/lib/utils/color";
import { cn } from "@/lib/utils/cn";

// Top-level tabs for desktop (full labels)
const DESKTOP_TABS = [
  { href: "/chat", label: "Chat", Icon: MessageSquare },
  { href: "/files", label: "Files", Icon: FolderOpen },
  { href: "/notes", label: "Notes", Icon: NotebookPen },
  { href: "/checklist", label: "Checklists", Icon: ListChecks },
  { href: "/map", label: "Map", Icon: Map },
  { href: "/beacon", label: "Beacon", Icon: Radio },
  { href: "/status", label: "Status", Icon: Activity },
  { href: "/settings", label: "Settings", Icon: Settings },
] as const;

// Mobile bottom bar: 4 tabs + SOS in header
const MOBILE_TABS = [
  { href: "/chat", label: "Chat", short: "Chat", Icon: MessageSquare },
  { href: "/tools", label: "Tools", short: "Tools", Icon: Settings }, // Will use a custom Tools icon
  { href: "/status", label: "Status", short: "Status", Icon: Activity },
  { href: "/settings", label: "Settings", short: "Settings", Icon: Settings },
] as const;

// Tools sub-menu items
const TOOLS_ITEMS = [
  { href: "/files", label: "Files", Icon: FolderOpen },
  { href: "/notes", label: "Notes", Icon: NotebookPen },
  { href: "/checklist", label: "Checklists", Icon: ListChecks },
  { href: "/map", label: "Map", Icon: Map },
  { href: "/beacon", label: "Beacon", Icon: Radio },
] as const;

/**
 * Application chrome: 56px top bar + pill tab strip (selected tab uses the
 * primary surface). Below 560px the strip is replaced by a fixed bottom bar
 * of 4 icon tabs (Chat, Tools, Status, Settings) with SOS always in header.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const roomName = useSessionStore((s) => s.roomName);
  const hasRoom = useSessionStore((s) => Boolean(s.roomId));
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  // Close tools dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) {
        setToolsOpen(false);
      }
    }
    if (toolsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [toolsOpen]);

  const isActive = (href: string): boolean =>
    pathname === href || pathname.startsWith(`${href}/`);

  const isToolsActive = (): boolean =>
    TOOLS_ITEMS.some((item) => isActive(item.href));

  return (
    <MeshProvider>
      <div className="flex min-h-full flex-col bg-canvas">
        <header className="sticky top-0 z-40 border-b border-hairline bg-canvas">
          <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center gap-3 px-4 lg:px-8">
            <Logo className="shrink-0" />
            <Pill tone={hasRoom ? "soft" : "outline"} className="ml-1 hidden max-w-[18ch] truncate sm:inline-flex">
              {hasRoom ? roomName : "no room"}
            </Pill>
            <div className="ml-auto flex items-center gap-2.5">
              <PeersBar />
              <StatusPill />
              <Link
                href="/beacon"
                aria-label="SOS"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-pill bg-inverse-canvas px-4 py-1.5 text-button-sm font-medium text-inverse-ink hover:bg-inverse-canvas/90"
              >
                <Siren className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">SOS</span>
              </Link>
            </div>
          </div>
          <nav
            aria-label="App"
            className="mx-auto hidden w-full max-w-[1280px] overflow-x-auto px-4 pb-2.5 xs:block lg:px-8"
          >
            <ul className="flex w-max items-center gap-1.5">
              {DESKTOP_TABS.map((tab) => (
                <li key={tab.href}>
                  <TabLink
                    href={tab.href}
                    label={tab.label}
                    active={isActive(tab.href)}
                  />
                </li>
              ))}
            </ul>
          </nav>
        </header>

        {/* Mobile bottom bar */}
        <nav
          aria-label="App"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-canvas pb-[env(safe-area-inset-bottom)] xs:hidden"
        >
          <div className="relative">
            <ul className="grid grid-cols-4">
              {MOBILE_TABS.map((tab) => (
                <li key={tab.href}>
                  {tab.href === "/tools" ? (
                    <div ref={toolsRef}>
                      <button
                        type="button"
                        onClick={() => setToolsOpen(!toolsOpen)}
                        aria-expanded={toolsOpen}
                        aria-haspopup="true"
                        aria-label="Tools"
                        aria-current={isToolsActive() ? "page" : undefined}
                        className={cn(
                          "mx-0.5 flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-pill py-1.5 text-[10px] font-medium leading-none transition-colors w-full",
                          toolsOpen || isToolsActive()
                            ? "bg-primary text-on-primary"
                            : "bg-canvas text-ink hover:bg-surface-soft",
                        )}
                      >
                        <Settings className="size-5 shrink-0" aria-hidden="true" />
                        <span className="block w-full truncate text-center">
                          {tab.short}
                        </span>
                        <ChevronDown className={`size-3 transition-transform ${toolsOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                      </button>
                      {toolsOpen && (
                        <div
                          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 rounded-md border border-hairline bg-canvas shadow-lg overflow-hidden z-50"
                          role="menu"
                        >
                          {TOOLS_ITEMS.map((item) => (
                            <Link
                              key={item.href}
                              href={item.href}
                              role="menuitem"
                              className={cn(
                                "flex items-center gap-2 px-3 py-2 text-body-sm text-ink hover:bg-surface-soft",
                                isActive(item.href) && "font-medium text-primary",
                              )}
                            >
                              <item.Icon className="size-4 shrink-0" aria-hidden="true" />
                              {item.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <Link
                      href={tab.href}
                      aria-current={isActive(tab.href) ? "page" : undefined}
                      className={cn(
                        "mx-0.5 flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-pill py-1.5 text-[10px] font-medium leading-none transition-colors",
                        isActive(tab.href)
                          ? "bg-primary text-on-primary"
                          : "bg-canvas text-ink hover:bg-surface-soft",
                      )}
                    >
                      <tab.Icon className="size-5 shrink-0" aria-hidden="true" />
                      <span className="block w-full truncate text-center">
                        {tab.short}
                      </span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <OfflineBanner />

        <main
          aria-label="Main"
          className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-24 pt-8 xs:pb-8 lg:px-8"
        >
          {children}
        </main>
        <Toaster />
        <SosOverlay />
      </div>
    </MeshProvider>
  );
}

function TabLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-[44px] items-center rounded-pill px-4 py-1.5 text-button-sm font-medium transition-colors",
        active ? "bg-primary text-on-primary" : "bg-canvas text-ink hover:bg-surface-soft",
      )}
    >
      {label}
    </Link>
  );
}

function StatusPill() {
  const status = useMeshStore((s) => s.status);
  const rtt = useMeshStore((s) => s.rttMs);
  const hasRoom = useSessionStore((s) => Boolean(s.roomId));

  if (!hasRoom) return <Pill tone="outline">no room</Pill>;

  switch (status) {
    case "online":
      return (
        <Pill tone="success">
          <span className="size-1.5 rounded-full bg-semantic-success" aria-hidden="true" />
          <span className="sr-only">Online</span>
          live{rtt !== null ? ` · ${rtt} ms` : ""}
        </Pill>
      );
    case "connecting":
      return <Pill tone="soft">connecting…</Pill>;
    case "reconnecting":
      return (
        <Pill tone="outline" className="bg-block-lilac border-transparent">
          <span className="sr-only">Reconnecting</span>
          reconnecting
        </Pill>
      );
    default:
      return <Pill tone="dark">offline</Pill>;
  }
}

function PeersBar() {
  const peers = useMeshStore((s) => s.peers);
  const online = peers.filter((p) => p.online);
  if (online.length === 0) return null;
  const shown = online.slice(0, 4);
  const rest = online.length - shown.length;

  return (
    <div
      className="hidden items-center -space-x-2 md:flex"
      role="group"
      aria-label={`${online.length} peers online`}
    >
      {shown.map((peer) => (
        <span
          key={peer.deviceId}
          title={`${peer.name}${peer.rttMs !== null ? ` · ${peer.rttMs} ms` : ""}`}
          className="inline-flex size-8 items-center justify-center rounded-full border-2 border-canvas caption"
          style={{ backgroundColor: peer.color, color: onColor(peer.color) }}
        >
          {peer.name.slice(0, 2).toUpperCase()}
        </span>
      ))}
      {rest > 0 ? (
        <span className="inline-flex size-8 items-center justify-center rounded-full border-2 border-canvas bg-surface-soft caption text-ink">
          +{rest}
        </span>
      ) : null}
    </div>
  );
}
