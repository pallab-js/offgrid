"use client";

import { AlertTriangle, Info, X } from "lucide-react";
import { useToastStore } from "@/stores/toast";
import { cn } from "@/lib/utils/cn";

/** Transient message stack, bottom-left, auto-dismissing (plan 5.4). */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-24 left-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2 xs:bottom-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg",
            t.tone === "error"
              ? "border-accent-magenta bg-canvas"
              : "border-hairline bg-canvas",
          )}
        >
          {t.tone === "error" ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent-magenta" aria-hidden="true" />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          )}
          <p className="min-w-0 flex-1 text-body-sm">{t.message}</p>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full p-1 hover:bg-surface-soft xs:size-8"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
