export default function Loading() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
      <span
        className="size-8 animate-spin rounded-full border-2 border-hairline border-t-ink motion-reduce:animate-none"
        aria-hidden="true"
      />
      <p className="caption text-ink">loading</p>
    </div>
  );
}
