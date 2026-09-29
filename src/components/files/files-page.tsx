"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Download,
  Film,
  Image as ImageIcon,
  Music,
  Paperclip,
  RefreshCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useFilesStore, type FileView } from "@/stores/files";
import { useMeshStore } from "@/stores/mesh";
import { useSessionStore } from "@/stores/session";
import { formatBytes } from "@/lib/files/api";
import { cn } from "@/lib/utils/cn";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";

type Filter = "all" | "cached" | "mine";

function iconFor(mime: string): React.ReactNode {
  if (mime.startsWith("image/")) return <ImageIcon className="size-5" aria-hidden="true" />;
  if (mime.startsWith("video/")) return <Film className="size-5" aria-hidden="true" />;
  if (mime.startsWith("audio/")) return <Music className="size-5" aria-hidden="true" />;
  if (mime === "application/pdf" || mime.startsWith("text/")) {
    return <Paperclip className="size-5" aria-hidden="true" />;
  }
  return <Paperclip className="size-5" aria-hidden="true" />;
}

function previewKind(mime: string): "image" | "video" | "audio" | "text" | "pdf" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("text/")) return "text";
  if (mime === "application/pdf") return "pdf";
  return null;
}

function formatDay(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function FilesPage() {
  const hasRoom = useSessionStore((s) => Boolean(s.roomId));
  const myId = useSessionStore((s) => s.deviceId);
  const items = useFilesStore((s) => s.items);
  const loaded = useFilesStore((s) => s.loaded);
  const uploads = useFilesStore((s) => s.uploads);
  const downloads = useFilesStore((s) => s.downloads);
  const hydrate = useFilesStore((s) => s.hydrate);
  const startUpload = useFilesStore((s) => s.startUpload);
  const retryUpload = useFilesStore((s) => s.retryUpload);
  const cancelUpload = useFilesStore((s) => s.cancelUpload);
  const peers = useMeshStore((s) => s.peers);

  const [filter, setFilter] = useState<Filter>("all");
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<FileView | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!hasRoom) {
    return (
      <div className="flex max-w-[56ch] flex-col items-start gap-5">
        <Eyebrow className="text-ink">Phase 3</Eyebrow>
        <h1 className="text-display-lg">Shared files</h1>
        <p className="text-body-lg">
          Files sync through the room hub — encrypted filenames, resumable
          downloads, and an offline cache for the small stuff.
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

  const nameOf = (deviceId: string): string => {
    if (deviceId === myId) return "you";
    return peers.find((p) => p.deviceId === deviceId)?.name ?? "peer";
  };

  const shown = items.filter((f) => {
    if (filter === "cached") return f.cached;
    if (filter === "mine") return f.deviceId === myId;
    return true;
  });

  async function pick(files: FileList | File[] | null): Promise<void> {
    if (!files) return;
    for (const file of Array.from(files)) {
      await startUpload(file).catch(() => undefined);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow className="text-ink">Files</Eyebrow>
          <h1 className="text-display-lg">Shared files</h1>
        </div>
        <div className="flex gap-2" aria-label="Filter files">
          {(["all", "cached", "mine"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={cn(
                "inline-flex min-h-[40px] items-center rounded-pill px-4 py-1.5 text-button-sm font-medium",
                filter === key
                  ? "bg-primary text-on-primary"
                  : "bg-canvas text-ink hover:bg-surface-soft",
              )}
            >
              {key === "all" ? "All" : key === "cached" ? "Cached" : "Mine"}
            </button>
          ))}
        </div>
      </header>

      {/* Dropzone — the page's single color block (DESIGN.md). */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void pick(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
          dragging ? "border-ink bg-block-lime" : "border-hairline bg-block-lime",
        )}
      >
        <Upload className="size-6" aria-hidden="true" />
        <p className="text-body-lg">Drop files to share with the room</p>
        <Button onClick={() => inputRef.current?.click()}>
          <Upload className="size-4" aria-hidden="true" />
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          aria-label="Choose files to upload"
          onChange={(e) => {
            void pick(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {Object.keys(uploads).length > 0 ? (
        <ul className="flex flex-col gap-3">
          {Object.values(uploads).map((task) => {
            const pct =
              task.total > 0
                ? Math.min(100, Math.round((task.loaded / task.total) * 100))
                : 0;
            return (
              <li
                key={task.id}
                className="flex flex-col gap-2 rounded-md border border-hairline bg-canvas px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-body-sm">
                    {task.name}
                  </span>
                  <span className="caption text-ink">
                    {task.status === "failed"
                      ? task.error ?? "failed"
                      : `${pct}%`}
                  </span>
                  {task.status === "failed" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void retryUpload(task.id).catch(() => undefined)}
                    >
                      <RefreshCcw className="size-3.5" aria-hidden="true" />
                      Retry
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => cancelUpload(task.id)}
                  >
                    Cancel
                  </Button>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-pill bg-hairline">
                  <div
                    className={cn(
                      "h-full transition-[width]",
                      task.status === "failed" ? "bg-accent-magenta" : "bg-primary",
                    )}
                    style={{ width: `${task.status === "failed" ? 100 : pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {loaded && shown.length === 0 ? (
        <p className="py-12 text-center text-body">
          {items.length === 0
            ? "No files shared yet — drop one above."
            : "No files match this filter."}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((file) => {
            const progress = downloads[file.id];
            const pct =
              progress && progress.total > 0
                ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
                : null;
            const kind = previewKind(file.mime);
            return (
              <li
                key={file.id}
                className="flex flex-col gap-3 rounded-xl border border-hairline bg-canvas p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-soft text-ink">
                    {iconFor(file.mime)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      disabled={!kind}
                      onClick={() => setPreview(file)}
                      className="block max-w-full truncate text-left text-card-title disabled:cursor-default"
                      title={file.name ?? file.id}
                    >
                      {file.name ?? `file-${file.id.slice(-6)}`}
                    </button>
                    <p className="caption text-ink">
                      {formatBytes(file.size)} · {formatDay(file.createdAt)} ·{" "}
                      {nameOf(file.deviceId)}
                    </p>
                  </div>
                  {file.cached ? (
                    <Pill tone="success">cached</Pill>
                  ) : null}
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pct !== null}
                    onClick={() =>
                      useFilesStore.getState().download(file).catch(() => undefined)
                    }
                  >
                    <Download className="size-3.5" aria-hidden="true" />
                    {pct !== null ? `${pct}%` : "Download"}
                  </Button>
                  {file.deviceId === myId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        useFilesStore
                          .getState()
                          .deleteFile(file)
                          .catch(() => undefined)
                      }
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      Delete
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {preview ? <PreviewModal file={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}

function PreviewModal({ file, onClose }: { file: FileView; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kind = previewKind(file.mime);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    void useFilesStore
      .getState()
      .getFileBlob(file)
      .then((blob) => {
        if (cancelled) return;
        if (kind === "text") {
          void blob.text().then((value) => {
            if (!cancelled) setText(value.slice(0, 200_000));
          });
        } else {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load a preview — try downloading instead.");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${file.name ?? "file"}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay-scrim/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-[900px] flex-col gap-3 rounded-xl bg-canvas p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-card-title">
            {file.name ?? "file"}
          </span>
          <span className="caption text-ink">{formatBytes(file.size)}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="inline-flex size-9 items-center justify-center rounded-full text-ink hover:bg-surface-soft"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {error ? (
            <p className="py-8 text-center text-body">{error}</p>
          ) : !url && text === null ? (
            <p className="py-8 text-center text-body">Loading preview…</p>
          ) : kind === "image" && url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={file.name ?? "preview"} className="mx-auto max-h-[70vh]" />
          ) : kind === "video" && url ? (
            <video src={url} controls className="mx-auto max-h-[70vh]" />
          ) : kind === "audio" && url ? (
            <audio src={url} controls className="w-full" />
          ) : kind === "text" && text !== null ? (
            <pre className="whitespace-pre-wrap rounded-md bg-surface-soft p-4 text-body-sm">
              {text}
            </pre>
          ) : kind === "pdf" && url ? (
            <iframe src={url} title="PDF preview" className="h-[70vh] w-full border-0" />
          ) : null}
        </div>
      </div>
    </div>
  );
}
