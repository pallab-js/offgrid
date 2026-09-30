"use client";

import { useEffect } from "react";

/** Registers the offline shell worker (production only — dev HMR must bypass it). */
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => undefined);
  }, []);

  return null;
}
