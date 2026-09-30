import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[56ch] flex-col items-start justify-center gap-5 px-6 py-16">
      <p className="caption text-ink">404</p>
      <h1 className="text-display-lg">No such page</h1>
      <p className="text-body-lg">
        The link may be from an older session, or the route does not exist.
      </p>
      <Link
        href="/"
        className="inline-flex min-h-[52px] items-center rounded-pill bg-primary px-7 py-2.5 text-button font-medium text-on-primary"
      >
        Back home
      </Link>
    </div>
  );
}
