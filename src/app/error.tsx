"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function RootError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[56ch] flex-col items-start justify-center gap-5 px-6 py-16">
      <p className="caption text-ink">Something went wrong</p>
      <h1 className="text-display-lg">This page hit an error</h1>
      <p className="text-body-lg">
        The app is still running — retry, or go back to the hub home.
      </p>
      {error.digest ? <p className="caption text-ink">ref {error.digest}</p> : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={retry}
          className="inline-flex min-h-[52px] items-center rounded-pill bg-primary px-7 py-2.5 text-button font-medium text-on-primary"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex min-h-[52px] items-center rounded-pill border border-hairline px-7 py-2.5 text-button font-medium text-ink"
        >
          Back home
        </Link>
      </div>
    </div>
  );
}
