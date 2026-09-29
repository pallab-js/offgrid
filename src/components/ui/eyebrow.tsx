import { cn } from "@/lib/utils/cn";

/** `{typography.eyebrow}` — mono, uppercase, positive tracking. Taxonomy only. */
export function Eyebrow({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("eyebrow", className)} {...props} />;
}

/** `{typography.caption}` — small mono label for column heads and meta. */
export function Caption({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("caption", className)} {...props} />;
}
