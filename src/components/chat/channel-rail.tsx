"use client";

import { useState } from "react";
import { Hash, Plus } from "lucide-react";
import { useMeshStore } from "@/stores/mesh";
import { useChatStore } from "@/stores/chat";
import { meshSocket, FrameError } from "@/lib/ws/client";
import { ulid } from "@/lib/utils/id";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/utils/cn";

export function ChannelRail() {
  const channels = useMeshStore((s) => s.channels);
  const active = useChatStore((s) => s.activeChannelId);
  const pending = useChatStore((s) => s.pendingCount);
  const setActive = useChatStore((s) => s.setActive);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await meshSocket.request({
        t: "channel.create",
        clientId: ulid(),
        name: trimmed,
      });
      setName("");
      setCreating(false);
    } catch (err) {
      setError(err instanceof FrameError ? err.message : "Channel not created");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex shrink-0 flex-col gap-4 md:w-[240px]">
      <Eyebrow className="text-ink">Channels</Eyebrow>
      <ul className="flex gap-1.5 overflow-x-auto pb-1 md:flex-col md:overflow-visible">
        {channels.map((channel) => (
          <li key={channel.id}>
            <button
              type="button"
              onClick={() => setActive(channel.id)}
              aria-current={active === channel.id ? "true" : undefined}
              className={cn(
                "inline-flex min-h-[40px] w-max items-center gap-2 rounded-pill px-4 py-1.5 text-button-sm font-medium transition-colors md:w-full",
                active === channel.id
                  ? "bg-primary text-on-primary"
                  : "bg-canvas text-ink hover:bg-surface-soft",
              )}
            >
              <Hash className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{channel.name}</span>
            </button>
          </li>
        ))}
      </ul>

      {creating ? (
        <form onSubmit={create} className="flex flex-col gap-2">
          <TextInput
            autoFocus
            value={name}
            maxLength={40}
            placeholder="channel name"
            aria-label="Channel name"
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={busy || !name.trim()}>
              Create
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setName("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
          {error ? <p className="caption text-ink">{error}</p> : null}
        </form>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          className="w-max"
          onClick={() => setCreating(true)}
        >
          <Plus className="size-4" aria-hidden="true" />
          New channel
        </Button>
      )}

      {pending > 0 ? (
        <Pill tone="soft" className="w-max">
          {pending} queued
        </Pill>
      ) : null}
    </aside>
  );
}
