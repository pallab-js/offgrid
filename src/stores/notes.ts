"use client";

import { create } from "zustand";
import type { Note } from "@/lib/protocol";
import { ulid } from "@/lib/utils/id";
import { sealText, openText } from "@/lib/crypto/keycache";
import { enqueue } from "@/lib/sync/outbox";
import { getDb, type NoteRecord } from "@/lib/idb/db";
import { useSessionStore } from "./session";

export interface NoteView {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
  updatedBy: string;
  deletedAt: number | null;
  rev: number;
}

interface NotesState {
  notes: NoteView[];
  loaded: boolean;
  activeId: string | null;

  hydrate: () => Promise<void>;
  setActive: (id: string | null) => void;
  save: (id: string | null, title: string, body: string) => Promise<string>;
  remove: (id: string) => Promise<void>;
  applyIncoming: (note: Note, rev: number) => Promise<void>;
  applyDeleted: (id: string, rev: number) => Promise<void>;
  reset: () => void;
}

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function toView(record: NoteRecord): Promise<NoteView> {
  return {
    id: record.id,
    title: (await openText(record.title)) ?? "",
    body: (await openText(record.body)) ?? "",
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
    deletedAt: record.deletedAt,
    rev: record.rev,
  };
}

function sortNotes(notes: NoteView[]): NoteView[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
}

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  loaded: false,
  activeId: null,

  hydrate: () =>
    serialized(async () => {
      if (get().loaded) return;
      const { roomId } = useSessionStore.getState();
      if (!roomId) return;
      const db = await getDb();
      const rows = await db.getAllFromIndex("notes", "by-room", roomId);
      const records = rows.filter(
        (r) => r.roomId === roomId && r.deletedAt === null,
      );
      const views = await Promise.all(records.map(toView));
      set({ notes: sortNotes(views), loaded: true });
    }),

  setActive: (id) => set({ activeId: id }),

  save: (id, title, body) =>
    serialized(async () => {
      const { roomId, deviceId } = useSessionStore.getState();
      if (!roomId || !deviceId) throw new Error("no session");
      const noteId = id ?? ulid();
      const [titleCipher, bodyCipher] = await Promise.all([
        sealText(title),
        sealText(body),
      ]);
      const updatedAt = Date.now();

      const db = await getDb();
      const existing = await db.get("notes", noteId);
      const record: NoteRecord = {
        id: noteId,
        roomId,
        title: titleCipher,
        body: bodyCipher,
        updatedAt,
        updatedBy: deviceId,
        deletedAt: null,
        rev: existing?.rev ?? 0,
      };
      await db.put("notes", record);

      const view = await toView(record);
      set((state) => ({
        notes: sortNotes([view, ...state.notes.filter((n) => n.id !== noteId)]),
        activeId: noteId,
      }));

      await enqueue({
        t: "note.save",
        clientId: ulid(),
        id: noteId,
        title: titleCipher,
        body: bodyCipher,
        updatedAt,
      });
      return noteId;
    }),

  remove: (id) =>
    serialized(async () => {
      const { deviceId } = useSessionStore.getState();
      if (!deviceId) throw new Error("no session");
      const updatedAt = Date.now();
      const db = await getDb();
      const existing = await db.get("notes", id);
      if (existing) {
        await db.put("notes", { ...existing, deletedAt: updatedAt });
      }
      set((state) => ({
        notes: state.notes.filter((n) => n.id !== id),
        activeId: state.activeId === id ? null : state.activeId,
      }));
      await enqueue({ t: "note.del", clientId: ulid(), id, updatedAt });
    }),

  applyIncoming: (note, rev) =>
    serialized(async () => {
      const { roomId } = useSessionStore.getState();
      if (!roomId) return;
      const db = await getDb();
      const existing = await db.get("notes", note.id);
      if (existing && existing.rev > rev) return;
      const record: NoteRecord = {
        id: note.id,
        roomId,
        title: note.title,
        body: note.body,
        updatedAt: note.updatedAt,
        updatedBy: note.updatedBy,
        deletedAt: note.deletedAt,
        rev,
      };
      await db.put("notes", record);
      if (record.deletedAt !== null) {
        set((state) => ({ notes: state.notes.filter((n) => n.id !== note.id) }));
        return;
      }
      const view = await toView(record);
      set((state) => ({
        notes: sortNotes([view, ...state.notes.filter((n) => n.id !== note.id)]),
      }));
    }),

  applyDeleted: (id, rev) =>
    serialized(async () => {
      const db = await getDb();
      const existing = await db.get("notes", id);
      if (existing && existing.rev > rev) return;
      if (existing) {
        await db.put("notes", { ...existing, deletedAt: Date.now(), rev });
      }
      set((state) => ({
        notes: state.notes.filter((n) => n.id !== id),
        activeId: state.activeId === id ? null : state.activeId,
      }));
    }),

  reset: () => set({ notes: [], loaded: false, activeId: null }),
}));
