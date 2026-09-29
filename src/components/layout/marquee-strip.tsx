const ITEMS = [
  "No internet required",
  "No accounts",
  "Encrypted rooms",
  "Files up to 512 MB",
  "SOS distress beacon",
  "Offline map & waypoints",
  "Works in any phone browser",
  "One machine is the hub",
] as const;

/** `{components.marquee-strip}` — black ribbon under the nav. */
export function MarqueeStrip() {
  const run = [...ITEMS, ...ITEMS];
  return (
    <div
      className="h-9 overflow-hidden bg-inverse-canvas text-inverse-ink"
      aria-hidden="true"
    >
      <div className="animate-marquee flex h-9 w-max items-center">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex h-9 items-center">
            {run.map((item) => (
              <span
                key={`${copy}-${item}`}
                className="flex items-center gap-6 whitespace-nowrap px-6 text-body-sm font-330"
              >
                {item}
                <span className="text-block-lime">✦</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
