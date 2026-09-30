"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Siren } from "lucide-react";
import { Logo } from "./logo";
import { Pill } from "@/components/ui/pill";
import { MeshProvider } from "@/components/providers/mesh-provider";
import { SosOverlay } from "@/components/sos/sos-overlay";
import { useMeshStore } from "@/stores/mesh";
import { useSessionStore } from "@/stores/session";
import { onColor } from "@/lib/utils/color";
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
  const roomName = useSessionStore((s) => s.roomName);
  const hasRoom = useSessionStore((s) => Boolean(s.roomId));

  return (
    <MeshProvider>
      <div className="flex min-h-full flex-col bg-canvas">
        <header className="sticky top-0 z-40 border-b border-hairline bg-canvas">
          <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center gap-3 px-4 lg:px-8">
            <Logo />
            <Pill tone={hasRoom ? "soft" : "outline"} className="ml-1 hidden max-w-[18ch] truncate sm:inline-flex">
              {hasRoom ? roomName : "no room"}
            </Pill>
            <div className="ml-auto flex items-center gap-2.5">
              <PeersBar />
              <StatusPill />
              <Link
                href="/beacon"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-pill bg-inverse-canvas px-4 py-1.5 text-button-sm font-medium text-inverse-ink hover:bg-inverse-canvas/90"
              >
                <Siren className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">SOS</span>
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
        <SosOverlay />
      </div>
    </MeshProvider>
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
          live{rtt !== null ? ` · ${rtt} ms` : ""}
        </Pill>
      );
    case "connecting":
      return <Pill tone="soft">connecting…</Pill>;
    case "reconnecting":
      return (
        <Pill tone="outline" className="bg-block-lilac border-transparent">
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
    <div className="hidden items-center -space-x-2 md:flex" aria-label={`${online.length} peers online`}>
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
