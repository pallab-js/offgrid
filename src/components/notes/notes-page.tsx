"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FilePlus2, Save, Trash2 } from "lucide-react";
import { useNotesStore } from "@/stores/notes";
import { useSessionStore } from "@/stores/session";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { TextInput, TextArea } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

function editedAt(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NotesPage() {
  const hasRoom = useSessionStore((s) => Boolean(s.roomId));
  const notes = useNotesStore((s) => s.notes);
  const loaded = useNotesStore((s) => s.loaded);
  const activeId = useNotesStore((s) => s.activeId);
  const hydrate = useNotesStore((s) => s.hydrate);
  const setActive = useNotesStore((s) => s.setActive);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!hasRoom) {
    return (
      <div className="flex max-w-[56ch] flex-col items-start gap-5">
        <Eyebrow className="text-ink">Phase 4</Eyebrow>
        <h1 className="text-display-lg">Field notes</h1>
        <p className="text-body-lg">
          Encrypted notes that sync through the room and survive offline
          edits. Join a room to start writing.
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
          <Eyebrow className="text-ink">Notes</Eyebrow>
          <h1 className="text-display-lg">Field notes</h1>
        </div>
        <Button onClick={() => setActive(null)}>
          <FilePlus2 className="size-4" aria-hidden="true" />
          New note
        </Button>
      </header>

      <div className="flex flex-col gap-6 md:flex-row md:gap-8">
        <aside className="flex shrink-0 flex-col gap-2 md:w-[260px]">
          <Eyebrow className="text-ink">All notes</Eyebrow>
          {loaded && notes.length === 0 ? (
            <p className="text-body-sm">No notes yet — create one.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {notes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => setActive(note.id)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors",
                      activeId === note.id
                        ? "border-ink bg-block-cream"
                        : "border-hairline bg-canvas hover:border-ink/40",
                    )}
                  >
                    <span className="truncate text-body-sm font-medium">
                      {note.title || "Untitled"}
                    </span>
                    <span className="caption text-ink">
                      {editedAt(note.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <NoteEditor key={activeId ?? "new"} activeId={activeId} />
      </div>
    </div>
  );
}

function NoteEditor({ activeId }: { activeId: string | null }) {
  const notes = useNotesStore((s) => s.notes);
  const save = useNotesStore((s) => s.save);
  const remove = useNotesStore((s) => s.remove);
  const active = notes.find((n) => n.id === activeId) ?? null;

  const [title, setTitle] = useState(active?.title ?? "");
  const [body, setBody] = useState(active?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function onSave(): Promise<void> {
    setBusy(true);
    try {
      await save(activeId, title, body);
      setSavedAt(Date.now());
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(): Promise<void> {
    if (!activeId) return;
    setBusy(true);
    try {
      await remove(activeId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-3">
      <TextInput
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Note title"
        aria-label="Note title"
        className="text-card-title"
      />
      <TextArea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write it down — edits sync to every device in the room."
        aria-label="Note body"
        rows={14}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void onSave()} disabled={busy}>
          <Save className="size-4" aria-hidden="true" />
          Save
        </Button>
        {activeId ? (
          <Button variant="ghost" onClick={() => void onDelete()} disabled={busy}>
            <Trash2 className="size-4" aria-hidden="true" />
            Delete
          </Button>
        ) : null}
        <span className="caption text-ink">
          {savedAt
            ? `Saved ${new Date(savedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}`
            : active
              ? `Last edited ${editedAt(active.updatedAt)}`
              : "New note — not saved yet"}
        </span>
      </div>
    </section>
  );
}
