"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CHECKLISTS, GUIDES } from "@/content";
import { useChecklistStore } from "@/stores/checklist";
import { useMeshStore } from "@/stores/mesh";
import { useSessionStore } from "@/stores/session";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { TextInput } from "@/components/ui/input";

type Tab = "checklists" | "guides";

function relative(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export function ChecklistPage() {
  const hasRoom = useSessionStore((s) => Boolean(s.roomId));
  const deviceId = useSessionStore((s) => s.deviceId);
  const peers = useMeshStore((s) => s.peers);
  const progress = useChecklistStore((s) => s.progress);
  const hydrate = useChecklistStore((s) => s.hydrate);
  const setItem = useChecklistStore((s) => s.setItem);

  const [tab, setTab] = useState<Tab>("checklists");
  const [query, setQuery] = useState("");
  const [openGuide, setOpenGuide] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<string | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!hasRoom) {
    return (
      <div className="flex max-w-[56ch] flex-col items-start gap-5">
        <Eyebrow className="text-ink">Phase 4</Eyebrow>
        <h1 className="text-display-lg">Checklists & field guides</h1>
        <p className="text-body-lg">
          Bundled checklists and field guides that sync per-room progress and
          stay readable offline. Join a room to start ticking items off.
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

  const q = query.trim().toLowerCase();
  const nameOf = (id: string): string =>
    peers.find((peer) => peer.deviceId === id)?.name ?? "peer";

  const shownLists = !q
    ? CHECKLISTS.map((list) => ({ list, items: list.items }))
    : CHECKLISTS.flatMap((list) => {
        if (list.title.toLowerCase().includes(q)) {
          return [{ list, items: list.items }];
        }
        const items = list.items.filter((item) =>
          item.label.toLowerCase().includes(q),
        );
        return items.length > 0 ? [{ list, items }] : [];
      });

  const shownGuides = !q
    ? GUIDES.map((guide) => ({ guide, sections: guide.sections }))
    : GUIDES.flatMap((guide) => {
        if (guide.title.toLowerCase().includes(q)) {
          return [{ guide, sections: guide.sections }];
        }
        const sections = guide.sections.filter(
          (section) =>
            section.heading.toLowerCase().includes(q) ||
            section.body.toLowerCase().includes(q),
        );
        return sections.length > 0 ? [{ guide, sections }] : [];
      });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Eyebrow className="text-ink">Checklists</Eyebrow>
        <h1 className="text-display-lg">Checklists & guides</h1>
      </header>

      <div className="flex flex-col gap-4 rounded-xl bg-block-lime p-5">
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search checklists and guides"
          aria-label="Search checklists and guides"
        />
        <div className="flex flex-wrap gap-2" aria-label="Checklist views">
          <Button
            variant={tab === "checklists" ? "primary" : "secondary"}
            aria-pressed={tab === "checklists"}
            onClick={() => setTab("checklists")}
          >
            Checklists
          </Button>
          <Button
            variant={tab === "guides" ? "primary" : "secondary"}
            aria-pressed={tab === "guides"}
            onClick={() => setTab("guides")}
          >
            Guides
          </Button>
        </div>
      </div>

      {tab === "checklists" ? (
        shownLists.length === 0 ? (
          <p className="py-12 text-center text-body">
            Nothing matches your search.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {shownLists.map(({ list, items }) => {
              const done = list.items.filter(
                (item) => progress[item.id]?.checked,
              ).length;
              const pct =
                list.items.length > 0
                  ? Math.round((done / list.items.length) * 100)
                  : 0;
              return (
                <li
                  key={list.id}
                  className="flex flex-col gap-4 rounded-xl border border-hairline bg-canvas p-5"
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="text-card-title">{list.title}</h2>
                      <Pill tone="soft">
                        {done}/{list.items.length}
                      </Pill>
                    </div>
                    <div className="w-full h-2 rounded-pill bg-surface-soft">
                      <div
                        className="h-full rounded-pill bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <ul className="flex flex-col gap-3">
                    {items.map((item) => {
                      const entry = progress[item.id];
                      const inputId = `${list.id}-${item.id}`;
                      return (
                        <li key={item.id} className="flex items-start gap-3">
                          <input
                            id={inputId}
                            type="checkbox"
                            className="size-4 accent-black"
                            checked={entry?.checked ?? false}
                            onChange={(e) =>
                              void setItem(item.id, e.target.checked)
                            }
                          />
                          <div className="flex min-w-0 flex-col gap-1.5">
                            <label htmlFor={inputId} className="text-body-sm">
                              {item.label}
                            </label>
                            {entry && entry.updatedBy !== deviceId ? (
                              <span className="caption text-ink">
                                checked {relative(entry.updatedAt)} by{" "}
                                {nameOf(entry.updatedBy)}
                              </span>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        )
      ) : shownGuides.length === 0 ? (
        <p className="py-12 text-center text-body">
          Nothing matches your search.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {shownGuides.map(({ guide, sections }) => {
            const expanded = q.length > 0 || openGuide === guide.id;
            return (
              <li
                key={guide.id}
                className="flex flex-col gap-4 rounded-xl border border-hairline bg-canvas p-5"
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() =>
                    setOpenGuide(openGuide === guide.id ? null : guide.id)
                  }
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <span className="text-card-title">{guide.title}</span>
                  <span className="caption text-ink">
                    {sections.length} sections
                  </span>
                </button>
                {expanded ? (
                  <ul className="flex flex-col gap-3">
                    {sections.map((section, index) => {
                      const key = `${guide.id}:${index}`;
                      const open = q.length > 0 || openSection === key;
                      return (
                        <li
                          key={key}
                          className="flex flex-col gap-2 border-t border-hairline-soft pt-3"
                        >
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() =>
                              setOpenSection(openSection === key ? null : key)
                            }
                            className="text-left text-card-title"
                          >
                            {section.heading}
                          </button>
                          {open ? (
                            <p className="text-body-sm">{section.body}</p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
