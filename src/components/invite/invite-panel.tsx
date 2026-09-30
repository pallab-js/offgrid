"use client";

import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function InvitePanel({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    return qr.createSvgTag({ cellSize: 8, margin: 32, scalable: true });
  }, [url]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-4">
      <div className="rounded-2xl border border-hairline bg-canvas p-4">
        <div
          aria-hidden="true"
          className="size-[200px] [&>svg]:block [&>svg]:size-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <div className="flex w-full max-w-[420px] flex-col gap-3">
        <a
          href={url}
          className="caption block truncate normal-case text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink"
        >
          {url}
        </a>
        <div>
          <Button variant="secondary" onClick={() => void copy()}>
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
        <p className="text-body-sm">
          Scan to open the join page — the passphrase travels separately.
        </p>
      </div>
    </div>
  );
}
