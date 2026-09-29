"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useChatStore } from "@/stores/chat";
import { useFilesStore } from "@/stores/files";
import { useMeshStore } from "@/stores/mesh";
import { useSessionStore } from "@/stores/session";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ChannelRail } from "./channel-rail";
import { Thread } from "./thread";

export function ChatWorkspace() {
  const hasRoom = useSessionStore((s) => Boolean(s.roomId));
  const channels = useMeshStore((s) => s.channels);
  const active = useChatStore((s) => s.activeChannelId);
  const setActive = useChatStore((s) => s.setActive);
  const hydrate = useChatStore((s) => s.hydrate);
  const hydrateFiles = useFilesStore((s) => s.hydrate);

  useEffect(() => {
    void hydrateFiles();
  }, [hydrateFiles]);

  useEffect(() => {
    if (channels.length === 0) return;
    if (!active || !channels.some((c) => c.id === active)) {
      const preferred =
        channels.find((c) => c.name === "general") ?? channels[0]!;
      setActive(preferred.id);
    }
  }, [channels, active, setActive]);

  useEffect(() => {
    if (active) void hydrate(active);
  }, [active, hydrate]);

  if (!hasRoom) {
    return (
      <div className="flex max-w-[56ch] flex-col items-start gap-5">
        <Eyebrow className="text-ink">Phase 2</Eyebrow>
        <h1 className="text-display-lg">Channels & messages</h1>
        <p className="text-body-lg">
          Chat lives inside a room. Set one up with a passphrase and your
          messages sync across every device that joins.
        </p>
        <Link
          href="/join"
          className="inline-flex min-h-[44px] items-center rounded-pill border border-hairline bg-canvas px-5 py-2 text-button font-medium text-ink hover:border-ink/40"
        >
          Set up a room
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow className="text-ink">Chat</Eyebrow>
          <h1 className="text-display-lg">Channels & messages</h1>
        </div>
      </header>

      <div className="flex flex-col gap-6 md:flex-row md:gap-8">
        <ChannelRail />
        {active ? (
          <Thread key={active} channelId={active} />
        ) : (
          <p className="flex-1 py-16 text-center text-body">
            Loading channels…
          </p>
        )}
      </div>
    </div>
  );
}
