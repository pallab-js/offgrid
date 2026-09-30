"use client";

import { create } from "zustand";
import { ulid } from "@/lib/utils/id";

export interface Toast {
  id: string;
  message: string;
  tone: "error" | "info";
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, tone?: Toast["tone"]) => void;
  dismiss: (id: string) => void;
}

const AUTO_DISMISS_MS = 5000;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  push: (message, tone = "info") => {
    const id = ulid();
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }].slice(-3) }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, AUTO_DISMISS_MS);
  },

  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export function toast(message: string, tone: Toast["tone"] = "info"): void {
  useToastStore.getState().push(message, tone);
}
