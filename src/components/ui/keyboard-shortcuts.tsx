"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface Shortcut {
  keys: string;
  description: string;
}

const GLOBAL_SHORTCUTS: Shortcut[] = [
  { keys: "⌘ K / Ctrl K", description: "Open search (chat, files, notes)" },
  { keys: "⌘ N / Ctrl N", description: "New note" },
  { keys: "⌘ , / Ctrl ,", description: "Open settings" },
  { keys: "Esc", description: "Close modal / cancel" },
];

const CHAT_SHORTCUTS: Shortcut[] = [
  { keys: "Enter", description: "Send message" },
  { keys: "Shift + Enter", description: "New line" },
  { keys: "↑ / ↓", description: "Navigate messages" },
  { keys: "R", description: "Reply to selected message" },
];

const FILE_SHORTCUTS: Shortcut[] = [
  { keys: "⌘ U / Ctrl U", description: "Upload file" },
  { keys: "Enter", description: "Download selected file" },
  { keys: "Delete", description: "Delete own file" },
];

const NOTES_SHORTCUTS: Shortcut[] = [
  { keys: "⌘ S / Ctrl S", description: "Save note" },
  { keys: "⌘ N / Ctrl N", description: "New note" },
  { keys: "Delete", description: "Delete note" },
];

function ShortcutTable({ shortcuts, title }: { shortcuts: Shortcut[]; title: string }) {
  return (
    <section className="mb-6">
      <h3 className="text-card-title mb-3">{title}</h3>
      <table className="w-full text-left text-body-sm">
        <tbody>
          {shortcuts.map((s, i) => (
            <tr key={i} className="border-b border-hairline last:border-0">
              <td className="py-2 pr-4 font-mono text-ink">{s.keys}</td>
              <td className="py-2 text-ink/80">{s.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function KeyboardShortcutsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay-scrim/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-w-[600px] w-full max-h-[85vh] flex-col gap-4 rounded-xl bg-canvas p-5 shadow-modal overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-card-title">
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-10 items-center justify-center rounded-full text-ink hover:bg-surface-soft"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <ShortcutTable shortcuts={GLOBAL_SHORTCUTS} title="Global" />
        <ShortcutTable shortcuts={CHAT_SHORTCUTS} title="Chat" />
        <ShortcutTable shortcuts={FILE_SHORTCUTS} title="Files" />
        <ShortcutTable shortcuts={NOTES_SHORTCUTS} title="Notes" />

        <p className="caption text-ink pt-2">
          Shortcuts use ⌘ (Mac) / Ctrl (Windows/Linux). Some shortcuts are context-sensitive.
        </p>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

/**
 * Hook for registering global keyboard shortcuts.
 * Usage:
 *   useKeyboardShortcuts({
 *     "mod+k": () => openSearch(),
 *     "mod+n": () => newNote(),
 *   });
 */
export function useKeyboardShortcuts(
  shortcuts: Record<string, () => void>,
  deps: React.DependencyList = [],
): void {
  const shortcutsRef = useRef(shortcuts);

  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push("mod");
      if (e.shiftKey) parts.push("shift");
      if (e.altKey) parts.push("alt");
      if (e.key !== "Control" && e.key !== "Meta" && e.key !== "Shift" && e.key !== "Alt") {
        parts.push(e.key.toLowerCase());
      }
      const combo = parts.join("+");

      const handler = shortcutsRef.current[combo];
      if (handler) {
        e.preventDefault();
        handler();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is a parameter, not a static array
}, deps);
}

/** Button to open the keyboard shortcuts help modal. */
export function KeyboardShortcutsHelp({ className = "" }: { className?: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Keyboard shortcuts"
        className={cn(
          "inline-flex size-10 items-center justify-center rounded-full text-ink hover:bg-surface-soft",
          className,
        )}
      >
        <HelpCircle className="size-4" aria-hidden="true" />
      </button>
      <KeyboardShortcutsModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}