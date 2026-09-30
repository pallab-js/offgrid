"use client";

import { create } from "zustand";
import type { FileMeta } from "@/lib/protocol";
import { ulid } from "@/lib/utils/id";
import { sealText, openText } from "@/lib/crypto/keycache";
import {
  fileRecordFromMeta,
  getFileRecord,
  listFileRecords,
  patchFileRecord,
  putFileRecord,
} from "@/lib/sync/files";
import type { FileRecord } from "@/lib/idb/db";
import { downloadFile, saveBlob, uploadFile } from "@/lib/files/api";
import { meshSocket } from "@/lib/ws/client";
import { useSessionStore } from "./session";

export const MAX_CACHE_BYTES = 32 * 1024 * 1024;

export interface FileView {
  id: string;
  deviceId: string;
  name: string | null;
  mime: string;
  size: number;
  sha256: string | null;
  createdAt: number;
  deletedAt: number | null;
  rev: number;
  cached: boolean;
}

export interface UploadTask {
  id: string;
  file: File;
  name: string;
  loaded: number;
  total: number;
  status: "running" | "failed";
  error?: string;
}

interface FilesState {
  items: FileView[];
  loaded: boolean;
  uploads: Record<string, UploadTask>;
  downloads: Record<string, { loaded: number; total: number }>;

  hydrate: () => Promise<void>;
  startUpload: (file: File) => Promise<string>;
  retryUpload: (fileId: string) => Promise<string>;
  cancelUpload: (fileId: string) => void;
  getFileBlob: (item: FileView) => Promise<Blob>;
  download: (item: FileView) => Promise<void>;
  deleteFile: (item: FileView) => Promise<void>;
  applyIncoming: (meta: FileMeta, rev: number) => Promise<void>;
  markDeleted: (id: string, rev: number) => Promise<void>;
  reset: () => void;
}

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

const aborts = new Map<string, AbortController>();

async function toView(record: FileRecord): Promise<FileView> {
  return {
    id: record.id,
    deviceId: record.deviceId,
    name: await openText(record.name),
    mime: record.mime,
    size: record.size,
    sha256: record.sha256,
    createdAt: record.createdAt,
    deletedAt: record.deletedAt,
    rev: record.rev,
    cached: record.blob !== null,
  };
}

function upsert(items: FileView[], view: FileView): FileView[] {
  const idx = items.findIndex((f) => f.id === view.id);
  if (idx === -1) return [view, ...items];
  if (items[idx]!.rev > view.rev) return items;
  const next = [...items];
  next[idx] = view;
  return next;
}

export const useFilesStore = create<FilesState>((set, get) => ({
  items: [],
  loaded: false,
  uploads: {},
  downloads: {},

  hydrate: () =>
    serialized(async () => {
      if (get().loaded) return;
      const { roomId } = useSessionStore.getState();
      if (!roomId) return;
      const records = await listFileRecords(roomId);
      const views = await Promise.all(
        records
          .filter((r) => r.deletedAt === null)
          .sort((a, b) => b.createdAt - a.createdAt)
          .map(toView),
      );
      set({ items: views, loaded: true });
    }),

  startUpload: (file) => runUpload(file),

  retryUpload: (fileId) => {
    const task = get().uploads[fileId];
    if (!task) return Promise.reject(new Error("nothing to retry"));
    return runUpload(task.file, fileId);
  },

  cancelUpload: (fileId) => {
    aborts.get(fileId)?.abort();
    aborts.delete(fileId);
    set((state) => {
      const uploads = { ...state.uploads };
      delete uploads[fileId];
      return { uploads };
    });
  },

  getFileBlob: async (item) => {
    const record = await getFileRecord(item.id);
    if (record?.blob) return record.blob;
    const { roomId, token } = useSessionStore.getState();
    if (!roomId || !token) throw new Error("no session");
    return downloadFile({
      roomId,
      token,
      fileId: item.id,
      size: item.size,
      mime: item.mime,
      enc: record?.enc ?? "none",
      onProgress: (loaded, total) =>
        set((state) => ({
          downloads: { ...state.downloads, [item.id]: { loaded, total } },
        })),
    });
  },

  download: async (item) => {
    try {
      const blob = await get().getFileBlob(item);
      if (item.size <= MAX_CACHE_BYTES) {
        const record = await getFileRecord(item.id);
        if (record && record.blob === null) {
          await patchFileRecord(item.id, { blob });
        }
        set((state) => ({
          items: state.items.map((f) =>
            f.id === item.id ? { ...f, cached: true } : f,
          ),
        }));
      }
      saveBlob(blob, item.name ?? `file-${item.id}`);
    } finally {
      set((state) => {
        const downloads = { ...state.downloads };
        delete downloads[item.id];
        return { downloads };
      });
    }
  },

  deleteFile: async (item) => {
    await meshSocket.request({
      t: "file.del",
      clientId: ulid(),
      fileId: item.id,
      updatedAt: Date.now(),
    });
    await get().markDeleted(item.id, item.rev + 1);
  },

  applyIncoming: (meta, rev) =>
    serialized(async () => {
      const { roomId } = useSessionStore.getState();
      if (!roomId) return;
      const existing = await getFileRecord(meta.id);
      if (existing && existing.rev > rev) return;
      const record = fileRecordFromMeta({ ...meta, rev }, roomId);
      if (existing) record.blob = existing.blob; // keep the local cache
      await putFileRecord(record);
      if (meta.deletedAt === null) {
        const view = await toView(record);
        set((state) => ({ items: upsert(state.items, view) }));
      } else {
        set((state) => ({
          items: state.items.filter((f) => f.id !== meta.id),
        }));
      }
    }),

  markDeleted: (id, rev) =>
    serialized(async () => {
      const existing = await getFileRecord(id);
      if (existing && existing.rev > rev) return;
      if (existing) {
        await patchFileRecord(id, {
          deletedAt: Date.now(),
          rev,
          blob: null,
        });
      }
      set((state) => ({ items: state.items.filter((f) => f.id !== id) }));
    }),

  reset: () => {
    for (const controller of aborts.values()) controller.abort();
    aborts.clear();
    set({ items: [], loaded: false, uploads: {}, downloads: {} });
  },
}));

async function runUpload(file: File, existingId?: string): Promise<string> {
  const { roomId, token, deviceId } = useSessionStore.getState();
  if (!roomId || !token || !deviceId) throw new Error("no session");

  const fileId = existingId ?? ulid();
  const name = await sealText(file.name);
  useFilesStore.setState((state) => ({
    uploads: {
      ...state.uploads,
      [fileId]: {
        id: fileId,
        file,
        name: file.name,
        loaded: 0,
        total: file.size,
        status: "running",
      },
    },
  }));

  const controller = new AbortController();
  aborts.set(fileId, controller);

  try {
    const handle = uploadFile({
      roomId,
      token,
      fileId,
      file,
      name,
      signal: controller.signal,
      onProgress: (loaded, total) =>
        useFilesStore.setState((state) => ({
          uploads: {
            ...state.uploads,
            [fileId]: { ...state.uploads[fileId]!, loaded, total },
          },
        })),
    });
    const result = await handle.promise;

    const record: FileRecord = {
      id: fileId,
      roomId,
      deviceId,
      name,
      mime: file.type || "application/octet-stream",
      size: result.size,
      sha256: result.sha256,
      enc: result.enc ?? "gcm1",
      createdAt: Date.now(),
      deletedAt: null,
      rev: result.rev,
      blob: file.size <= MAX_CACHE_BYTES ? file : null,
    };
    await putFileRecord(record);
    const view = await toView(record);
    useFilesStore.setState((state) => ({
      items: upsert(state.items, view),
      loaded: true,
    }));

    // Tell the room; if the socket is down, sync.pull replays it later.
    void meshSocket
      .request({ t: "file.announce", clientId: ulid(), fileId })
      .catch(() => undefined);

    useFilesStore.setState((state) => {
      const uploads = { ...state.uploads };
      delete uploads[fileId];
      return { uploads };
    });
    return fileId;
  } catch (error) {
    const message = error instanceof Error ? error.message : "upload failed";
    useFilesStore.setState((state) => {
      const current = state.uploads[fileId];
      if (!current || controller.signal.aborted) {
        const uploads = { ...state.uploads };
        delete uploads[fileId];
        return { uploads };
      }
      return {
        uploads: {
          ...state.uploads,
          [fileId]: { ...current, status: "failed", error: message },
        },
      };
    });
    throw error;
  } finally {
    aborts.delete(fileId);
  }
}
