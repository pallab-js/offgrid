"use client";

import { create } from "zustand";
import type { Message, Reaction } from "@/lib/protocol";
import { ulid } from "@/lib/utils/id";
import { sealText } from "@/lib/crypto/keycache";
import {
  decryptText,
  findByClientId,
  findByServerId,
  getRecord,
  listByChannel,
  listPending,
  patchRecord,
  putRecord,
  recordFromServer,
  removeRecord,
} from "@/lib/sync/messages";
import type { MessageRecord } from "@/lib/idb/db";
import { meshSocket, FrameError } from "@/lib/ws/client";
import { useSessionStore } from "./session";

export interface ChatMessage {
  uid: string;
  channelId: string;
  serverId: string | null;
  clientId: string | null;
  deviceId: string;
  author: string;
  kind: "text" | "file" | "system";
  text: string | null;
  replyTo: string | null;
  attachments: string[];
  reactions: Reaction[];
  createdAt: number;
  deletedAt: number | null;
  rev: number;
  status: MessageRecord["status"];
}

interface ChatState {
  activeChannelId: string | null;
  messages: Record<string, ChatMessage[]>;
  loaded: Record<string, boolean>;
  pendingCount: number;

  setActive: (channelId: string) => void;
  hydrate: (channelId: string) => Promise<void>;
  sendText: (channelId: string, text: string, replyTo?: string | null) => Promise<void>;
  sendAttachment: (channelId: string, fileId: string) => Promise<void>;
  deleteMessage: (message: ChatMessage) => Promise<void>;
  retryMessage: (uid: string) => Promise<void>;
  toggleReaction: (message: ChatMessage, emoji: string) => Promise<void>;
  applyIncoming: (msg: Message) => Promise<void>;
  markAcked: (clientId: string, patch: { serverId: string; rev: number }) => Promise<void>;
  flushOutbox: () => Promise<void>;
  reset: () => void;
}

const MAX_ATTEMPTS = 5;
const RETRYABLE = new Set(["INTERNAL", "RATE_LIMITED"]);

/* Serializes store mutations so IDB reads/writes keep a stable order. */
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function scheduleFlush(delayMs: number): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void useChatStore.getState().flushOutbox();
  }, delayMs);
}

function compareViews(a: ChatMessage, b: ChatMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
}

async function toView(record: MessageRecord): Promise<ChatMessage> {
  return {
    uid: record.uid,
    channelId: record.channelId,
    serverId: record.serverId,
    clientId: record.clientId,
    deviceId: record.deviceId,
    author: record.author,
    kind: record.kind,
    text: await decryptText(record),
    replyTo: record.replyTo,
    attachments: record.attachments,
    reactions: record.reactions ?? [],
    createdAt: record.createdAt,
    deletedAt: record.deletedAt,
    rev: record.rev,
    status: record.status,
  };
}

const reactionQueue: Array<{ uid: string; id: string; emoji: string; on: boolean }> = [];
const MAX_REACT_QUEUE = 200;

async function flushReactions(): Promise<void> {
  while (reactionQueue.length && meshSocket.isOpen) {
    const entry = reactionQueue[0]!;
    reactionQueue.shift();
    try {
      await meshSocket.request({
        t: "msg.react",
        clientId: ulid(),
        id: entry.id,
        emoji: entry.emoji,
        on: entry.on,
      });
    } catch {
      if (!meshSocket.isOpen) {
        reactionQueue.unshift(entry);
        return;
      }
    }
  }
}

export const useChatStore = create<ChatState>((set, get) => {
  function upsertView(view: ChatMessage): void {
    set((state) => {
      const list = state.messages[view.channelId] ?? [];
      const idx = list.findIndex((m) => m.uid === view.uid);
      let next: ChatMessage[];
      if (idx === -1) {
        next = [...list, view];
      } else {
        if (list[idx]!.rev > view.rev) return state;
        next = [...list];
        next[idx] = view;
      }
      next.sort(compareViews);
      return { messages: { ...state.messages, [view.channelId]: next } };
    });
  }

  function replaceView(uid: string, channelId: string, patch: Partial<ChatMessage>): void {
    set((state) => {
      const list = state.messages[channelId];
      if (!list) return state;
      const idx = list.findIndex((m) => m.uid === uid);
      if (idx === -1) return state;
      const next = [...list];
      next[idx] = { ...next[idx]!, ...patch };
      next.sort(compareViews);
      return { messages: { ...state.messages, [channelId]: next } };
    });
  }

  function removeView(uid: string, channelId: string): void {
    set((state) => {
      const list = state.messages[channelId];
      if (!list) return state;
      return {
        messages: {
          ...state.messages,
          [channelId]: list.filter((m) => m.uid !== uid),
        },
      };
    });
  }

  async function refreshPendingCount(): Promise<void> {
    const pending = await listPending();
    set({ pendingCount: pending.length });
  }

  return {
    activeChannelId: null,
    messages: {},
    loaded: {},
    pendingCount: 0,

    setActive: (channelId) => set({ activeChannelId: channelId }),

    hydrate: (channelId) =>
      serialized(async () => {
        if (get().loaded[channelId]) return;
        const records = await listByChannel(channelId);
        const views = (await Promise.all(records.map(toView))).sort(compareViews);
        set((state) => ({
          messages: { ...state.messages, [channelId]: views },
          loaded: { ...state.loaded, [channelId]: true },
        }));
        await refreshPendingCount();
      }),

    sendText: (channelId, text, replyTo = null) =>
      serialized(async () => {
        const { deviceId, profile, roomId } = useSessionStore.getState();
        if (!deviceId || !profile || !roomId) throw new Error("no session");
        const clientId = ulid();
        const body = await sealText(text);
        const record: MessageRecord = {
          uid: clientId,
          roomId,
          clientId,
          serverId: null,
          channelId,
          deviceId,
          author: profile.name,
          kind: "text",
          body,
          replyTo,
          attachments: [],
          createdAt: Date.now(),
          deletedAt: null,
          rev: 0,
          status: "pending",
          attempts: 0,
          deletePending: false,
        };
        await putRecord(record);
        if (get().loaded[channelId]) upsertView(await toView(record));
        await refreshPendingCount();
        void get().flushOutbox();
      }),

    sendAttachment: (channelId, fileId) =>
      serialized(async () => {
        const { deviceId, profile, roomId } = useSessionStore.getState();
        if (!deviceId || !profile || !roomId) throw new Error("no session");
        const clientId = ulid();
        const record: MessageRecord = {
          uid: clientId,
          roomId,
          clientId,
          serverId: null,
          channelId,
          deviceId,
          author: profile.name,
          kind: "file",
          body: null,
          replyTo: null,
          attachments: [fileId],
          createdAt: Date.now(),
          deletedAt: null,
          rev: 0,
          status: "pending",
          attempts: 0,
          deletePending: false,
        };
        await putRecord(record);
        if (get().loaded[channelId]) upsertView(await toView(record));
        await refreshPendingCount();
        void get().flushOutbox();
      }),

    deleteMessage: (message) =>
      serialized(async () => {
        if (!message.serverId) {
          await removeRecord(message.uid);
          removeView(message.uid, message.channelId);
        } else {
          await patchRecord(message.uid, { deletePending: true });
          removeView(message.uid, message.channelId);
        }
        await refreshPendingCount();
        void get().flushOutbox();
      }),

    retryMessage: (uid) =>
      serialized(async () => {
        const next = await patchRecord(uid, { status: "pending", attempts: 0 });
        if (next && get().loaded[next.channelId]) {
          replaceView(uid, next.channelId, { status: "pending" });
        }
        await refreshPendingCount();
        void get().flushOutbox();
      }),

    toggleReaction: (message, emoji) =>
      serialized(async () => {
        const { deviceId, roomId } = useSessionStore.getState();
        if (!deviceId || !roomId) return;
        const record = await getRecord(message.uid);
        if (!record) return;
        const base = record.reactions ?? [];
        const mine = base.some((r) => r.emoji === emoji && r.deviceId === deviceId);
        const on = !mine;
        const next = on
          ? [...base, { emoji, deviceId, at: Date.now() }]
          : base.filter((r) => !(r.emoji === emoji && r.deviceId === deviceId));
        await patchRecord(record.uid, { reactions: next });
        if (get().loaded[record.channelId]) {
          replaceView(record.uid, record.channelId, { reactions: next });
        }
        if (!record.serverId) return;
        if (reactionQueue.length >= MAX_REACT_QUEUE) reactionQueue.shift();
        reactionQueue.push({ uid: record.uid, id: record.serverId, emoji, on });
        void flushReactions();
      }),

    applyIncoming: (msg) =>
      serialized(async () => {
        const roomId = useSessionStore.getState().roomId;
        if (!roomId) return;
        const existing =
          (await findByServerId(msg.id)) ??
          (msg.clientId ? await findByClientId(msg.clientId) : null);
        if (existing && existing.rev > msg.rev) return;

        const merged = recordFromServer(msg, roomId);
        if (existing) {
          merged.uid = existing.uid;
          merged.deletePending = msg.deletedAt ? false : existing.deletePending;
        }
        await putRecord(merged);
        if (get().loaded[merged.channelId]) upsertView(await toView(merged));
      }),

    markAcked: (clientId, patch) =>
      serialized(async () => {
        const record = await findByClientId(clientId);
        if (!record) return;
        const next = await patchRecord(record.uid, {
          serverId: patch.serverId,
          rev: Math.max(record.rev, patch.rev),
          status: "synced",
          attempts: 0,
        });
        if (next && get().loaded[next.channelId]) {
          replaceView(next.uid, next.channelId, {
            serverId: next.serverId,
            rev: next.rev,
            status: "synced",
          });
        }
      }),

    flushOutbox: async () => {
      if (flushing) return;
      flushing = true;
      try {
        if (!meshSocket.isOpen) return;
        await flushReactions();
        const pending = await listPending();
        for (const record of pending) {
          if (!meshSocket.isOpen) return;
          try {
            if (record.deletePending && record.serverId) {
              const ack = await meshSocket.request({
                t: "msg.del",
                clientId: ulid(),
                id: record.serverId,
              });
              await serialized(() =>
                patchRecord(record.uid, {
                  deletePending: false,
                  rev: Math.max(record.rev, ack.rev),
                }),
              );
              continue;
            }
            if (record.status !== "pending" || !record.clientId) continue;
            if (record.kind === "system") continue;
            const ack = await meshSocket.request({
              t: "msg.send",
              clientId: record.clientId,
              channelId: record.channelId,
              kind: record.kind,
              body: record.body,
              attachments: record.attachments,
              replyTo: record.replyTo,
            });
            await get().markAcked(record.clientId, { serverId: ack.id, rev: ack.rev });
          } catch (error) {
            const retryable = error instanceof FrameError && RETRYABLE.has(error.code);
            const attempts = record.attempts + 1;
            if (retryable && attempts < MAX_ATTEMPTS) {
              await serialized(() => patchRecord(record.uid, { attempts }));
              scheduleFlush(Math.min(1500 * 2 ** attempts, 30_000));
              return;
            }
            if (record.status === "pending") {
              await serialized(async () => {
                const next = await patchRecord(record.uid, {
                  status: "failed",
                  attempts,
                });
                if (next && get().loaded[next.channelId]) {
                  replaceView(next.uid, next.channelId, { status: "failed" });
                }
              });
            } else {
              await serialized(() => patchRecord(record.uid, { deletePending: false }));
            }
          }
        }
        await refreshPendingCount();
      } finally {
        flushing = false;
      }
    },

    reset: () => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      set({ activeChannelId: null, messages: {}, loaded: {}, pendingCount: 0 });
    },
  };
});
