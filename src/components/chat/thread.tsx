"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CornerUpLeft,
  Download,
  FileText,
  Paperclip,
  RotateCcw,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useChatStore, type ChatMessage } from "@/stores/chat";
import { useFilesStore } from "@/stores/files";
import { SosTimeline } from "@/components/sos/sos-timeline";
import { formatBytes } from "@/lib/files/api";
import { useMeshStore } from "@/stores/mesh";
import { useSessionStore } from "@/stores/session";
import { meshSocket } from "@/lib/ws/client";
import { onColor } from "@/lib/utils/color";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";

const EMPTY: ChatMessage[] = [];

type Row =
  | { kind: "day"; key: string; label: string }
  | { kind: "msg"; key: string; msg: ChatMessage; showAuthor: boolean };

function dayKey(ts: number): string {
  return new Date(ts).toDateString();
}

function dayLabel(ts: number): string {
  const date = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildRows(messages: ChatMessage[], query: string): Row[] {
  const q = query.trim().toLowerCase();
  const shown = q
    ? messages.filter(
        (m) =>
          (m.text ?? "").toLowerCase().includes(q) ||
          m.author.toLowerCase().includes(q),
      )
    : messages;

  const rows: Row[] = [];
  let lastDay = "";
  let prev: ChatMessage | null = null;
  for (const msg of shown) {
    const day = dayKey(msg.createdAt);
    if (day !== lastDay) {
      rows.push({ kind: "day", key: `day-${day}-${msg.uid}`, label: dayLabel(msg.createdAt) });
      lastDay = day;
      prev = null;
    }
    const showAuthor =
      !prev ||
      prev.deviceId !== msg.deviceId ||
      prev.kind === "system" ||
      msg.kind === "system" ||
      msg.createdAt - prev.createdAt > 5 * 60_000;
    rows.push({ kind: "msg", key: msg.uid, msg, showAuthor });
    prev = msg;
  }
  return rows;
}

export function Thread({ channelId }: { channelId: string }) {
  const channel = useMeshStore((s) => s.channels.find((c) => c.id === channelId));
  const messages = useChatStore((s) => s.messages[channelId] ?? EMPTY);
  const peers = useMeshStore((s) => s.peers);
  const typingId = useMeshStore((s) => s.typing[channelId]);
  const myId = useSessionStore((s) => s.deviceId);

  const [query, setQuery] = useState("");
  const [reply, setReply] = useState<ChatMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const byUid = useMemo(() => new Map(messages.map((m) => [m.uid, m])), [messages]);
  const rows = useMemo(() => buildRows(messages, query), [messages, query]);
  const typingName = typingId
    ? peers.find((p) => p.deviceId === typingId)?.name ?? "Someone"
    : null;
  const online = peers.filter((p) => p.online).length;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows]);

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-card-title">
            {channel ? `#${channel.name}` : "Loading…"}
          </h2>
          <p className="caption text-ink">
            {online} online · {messages.length} messages
          </p>
        </div>
        <div className="relative w-full sm:w-[260px]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink"
            aria-hidden="true"
          />
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this channel"
            aria-label="Search messages"
            className="pl-9"
          />
        </div>
      </header>

      {channel?.kind === "sos" ? <SosTimeline /> : null}

      <div
        ref={scrollRef}
        className="max-h-[calc(100vh-420px)] min-h-[300px] flex-1 overflow-y-auto pr-1"
      >
        {rows.length === 0 ? (
          <p className="py-16 text-center text-body">
            {query ? "No messages match your search." : "No messages yet — say hello."}
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {rows.map((row) =>
              row.kind === "day" ? (
                <li key={row.key} className="flex items-center gap-3 py-2">
                  <span className="h-px flex-1 bg-hairline" aria-hidden="true" />
                  <span className="caption text-ink">{row.label}</span>
                  <span className="h-px flex-1 bg-hairline" aria-hidden="true" />
                </li>
              ) : (
                <li key={row.key}>
                  <MessageRow
                    msg={row.msg}
                    showAuthor={row.showAuthor}
                    isOwn={row.msg.deviceId === myId}
                    color={peers.find((p) => p.deviceId === row.msg.deviceId)?.color}
                    replied={row.msg.replyTo ? byUid.get(row.msg.replyTo) ?? null : null}
                    onReply={() => setReply(row.msg)}
                  />
                </li>
              ),
            )}
          </ol>
        )}
      </div>

      <div className="h-5">
        {typingName ? (
          <p className="caption text-ink">{typingName} is typing…</p>
        ) : null}
      </div>

      <Composer
        channelId={channelId}
        reply={reply}
        onCancelReply={() => setReply(null)}
      />
    </section>
  );
}

function MessageRow({
  msg,
  showAuthor,
  isOwn,
  color,
  replied,
  onReply,
}: {
  msg: ChatMessage;
  showAuthor: boolean;
  isOwn: boolean;
  color: string | undefined;
  replied: ChatMessage | null;
  onReply: () => void;
}) {
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const retryMessage = useChatStore((s) => s.retryMessage);

  if (msg.kind === "system") {
    return (
      <div className="flex justify-center py-1">
        <Pill tone="outline">{`${msg.author} joined`}</Pill>
      </div>
    );
  }

  if (msg.deletedAt !== null) {
    return (
      <div className="flex justify-center py-1">
        <span className="caption text-ink">message deleted</span>
      </div>
    );
  }

  const avatarColor = color ?? "#c5b0f4";

  return (
    <div className={cn("group flex gap-3", isOwn && "flex-row-reverse")}>
      {isOwn ? null : showAuthor ? (
        <span
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full caption"
          style={{ backgroundColor: avatarColor, color: onColor(avatarColor) }}
          aria-hidden="true"
        >
          {msg.author.slice(0, 2).toUpperCase()}
        </span>
      ) : (
        <span className="size-8 shrink-0" aria-hidden="true" />
      )}

      <div className={cn("flex min-w-0 max-w-[68ch] flex-col gap-1", isOwn && "items-end")}>
        {showAuthor && !isOwn ? (
          <span className="caption text-ink">{msg.author}</span>
        ) : null}

        <div
          className={cn(
            "rounded-2xl px-4 py-2 text-body-sm break-words whitespace-pre-wrap",
            isOwn
              ? "rounded-br-md bg-inverse-canvas text-inverse-ink"
              : "rounded-bl-md bg-surface-soft text-ink",
          )}
        >
          {replied ? (
            <div
              className={cn(
                "mb-1.5 max-w-[40ch] truncate border-l-2 pl-2 caption",
                isOwn ? "border-on-inverse-soft/40" : "border-hairline",
              )}
            >
              {replied.author}: {replied.text ?? "…"}
            </div>
          ) : null}
          {msg.kind === "file" ? (
            <AttachmentChip fileId={msg.attachments[0] ?? null} isOwn={isOwn} />
          ) : (
            (msg.text ?? "message unavailable")
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="caption text-ink">{clock(msg.createdAt)}</span>
          {isOwn && msg.status === "pending" ? (
            <span className="inline-flex items-center gap-1 caption text-ink">
              queued
            </span>
          ) : null}
          {isOwn && msg.status === "failed" ? (
            <span className="inline-flex items-center gap-1.5 caption text-ink">
              failed
              <button
                type="button"
                onClick={() => void retryMessage(msg.uid)}
                className="inline-flex items-center gap-1 rounded-pill border border-hairline px-2 py-0.5 hover:border-ink/40"
              >
                <RotateCcw className="size-3" aria-hidden="true" />
                retry
              </button>
            </span>
          ) : null}
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={onReply}
              aria-label="Reply to message"
              className="inline-flex size-7 items-center justify-center rounded-full text-ink hover:bg-surface-soft"
            >
              <CornerUpLeft className="size-3.5" aria-hidden="true" />
            </button>
            {isOwn ? (
              <button
                type="button"
                onClick={() => void deleteMessage(msg)}
                aria-label="Delete message"
                className="inline-flex size-7 items-center justify-center rounded-full text-ink hover:bg-surface-soft"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}

function AttachmentChip({ fileId, isOwn }: { fileId: string | null; isOwn: boolean }) {
  const item = useFilesStore((s) =>
    fileId ? s.items.find((f) => f.id === fileId) : undefined,
  );
  const progress = useFilesStore((s) => (fileId ? s.downloads[fileId] : undefined));
  const download = useFilesStore((s) => s.download);

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
      : null;

  return (
    <span
      className={cn(
        "mt-1 inline-flex max-w-[42ch] items-center gap-2 rounded-md border px-3 py-2",
        isOwn ? "border-on-inverse-soft/40" : "border-hairline",
      )}
    >
      <FileText className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate text-body-sm">{item?.name ?? "shared file"}</span>
      <span className="caption shrink-0">{item ? formatBytes(item.size) : ""}</span>
      <button
        type="button"
        disabled={!item || pct !== null}
        onClick={() => item && void download(item)}
        aria-label="Download attachment"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-surface-soft disabled:opacity-40"
      >
        <Download className="size-3.5" aria-hidden="true" />
      </button>
      {pct !== null ? <span className="caption shrink-0">{pct}%</span> : null}
    </span>
  );
}

function Composer({
  channelId,
  reply,
  onCancelReply,
}: {
  channelId: string;
  reply: ChatMessage | null;
  onCancelReply: () => void;
}) {
  const sendText = useChatStore((s) => s.sendText);
  const sendAttachment = useChatStore((s) => s.sendAttachment);
  const startUpload = useFilesStore((s) => s.startUpload);
  const status = useMeshStore((s) => s.status);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  async function attach(file: File): Promise<void> {
    setAttachBusy(true);
    setAttachError(null);
    try {
      const fileId = await startUpload(file);
      await sendAttachment(channelId, fileId);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setAttachBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  useEffect(() => {
    if (reply) taRef.current?.focus();
  }, [reply]);

  function notifyTyping(): void {
    const now = Date.now();
    if (now - lastTyping.current < 2500) return;
    lastTyping.current = now;
    meshSocket.send({ t: "typing", channelId, on: true });
  }

  function grow(el: HTMLTextAreaElement): void {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  async function submit(): Promise<void> {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await sendText(channelId, value, reply?.uid ?? null);
      setText("");
      onCancelReply();
      meshSocket.send({ t: "typing", channelId, on: false });
      const el = taRef.current;
      if (el) {
        el.style.height = "auto";
        el.focus();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {reply ? (
        <div className="flex items-center gap-2 rounded-md border border-hairline bg-surface-soft px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="caption text-ink">Replying to {reply.author}</p>
            <p className="truncate text-body-sm font-330 text-ink">
              {reply.text ?? "…"}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-ink hover:bg-hairline-soft"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        aria-label="Attach a file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void attach(file);
        }}
      />
      <div className="flex items-end gap-2">
        <button
          type="button"
          disabled={attachBusy}
          onClick={() => fileRef.current?.click()}
          aria-label={attachBusy ? "Uploading file" : "Attach a file"}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-soft text-ink hover:bg-hairline-soft disabled:opacity-40"
        >
          <Paperclip className="size-4" aria-hidden="true" />
        </button>
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          placeholder="Message the channel — Enter to send"
          aria-label="Message"
          onChange={(e) => {
            setText(e.target.value);
            grow(e.currentTarget);
            if (e.target.value) notifyTyping();
            else meshSocket.send({ t: "typing", channelId, on: false });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          className="max-h-[160px] min-h-[48px] w-full resize-none rounded-2xl border border-hairline bg-canvas px-4 py-3 text-body-sm text-ink placeholder:text-ink/50 focus:border-ink focus:outline-none"
        />
        <Button
          size="md"
          disabled={!text.trim() || busy}
          onClick={() => void submit()}
          className="shrink-0"
        >
          <Send className="size-4" aria-hidden="true" />
          Send
        </Button>
      </div>

      {attachError ? <p className="caption text-ink">{attachError}</p> : null}
      {status === "offline" || status === "reconnecting" ? (
        <p className="caption text-ink">
          Offline — messages queue and send when the hub is reachable.
        </p>
      ) : null}
    </div>
  );
}
