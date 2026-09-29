import Link from "next/link";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ButtonLink } from "@/components/ui/button-link";

/** Temporary placeholder shown until the owning phase lands. */
export function PageStub({
  phase,
  title,
  blurb,
}: {
  phase: string;
  title: string;
  blurb: string;
}) {
  return (
    <div className="flex max-w-[56ch] flex-col items-start gap-5">
      <Eyebrow className="text-ink">{phase}</Eyebrow>
      <h1 className="text-display-lg">{title}</h1>
      <p className="text-body-lg">{blurb}</p>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/">Back to home</ButtonLink>
        <Link
          href="/join"
          className="inline-flex min-h-[44px] items-center rounded-pill border border-hairline bg-canvas px-5 py-2 text-button font-medium text-ink hover:border-ink/40"
        >
          Set up a room
        </Link>
      </div>
    </div>
  );
}
