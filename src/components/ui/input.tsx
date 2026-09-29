import { cn } from "@/lib/utils/cn";

/** `{components.text-input}` — hairline border, rounded-md, ring on focus. */
export function TextInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-md border border-hairline bg-canvas px-3.5 py-3 " +
          "text-body text-ink placeholder:text-ink/50 " +
          "focus:border-ink focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function TextArea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-md border border-hairline bg-canvas px-3.5 py-3 " +
          "text-body text-ink placeholder:text-ink/50 resize-y " +
          "focus:border-ink focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-2", className)}>
      <span className="caption text-ink">{label}</span>
      {children}
      {hint ? (
        <span className="text-body-sm font-330 text-ink">{hint}</span>
      ) : null}
    </label>
  );
}
