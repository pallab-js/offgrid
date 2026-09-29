import Link from "next/link";
import { Logo } from "./logo";
import { Caption } from "@/components/ui/eyebrow";

const COLUMNS = [
  {
    head: "Product",
    links: [
      { label: "Messaging", href: "/#features" },
      { label: "File sharing", href: "/#features" },
      { label: "How the hub works", href: "/#how" },
      { label: "Open app", href: "/chat" },
    ],
  },
  {
    head: "Field tools",
    links: [
      { label: "SOS beacon", href: "/#field-tools" },
      { label: "Offline map", href: "/#field-tools" },
      { label: "Checklists", href: "/#field-tools" },
      { label: "Morse signaling", href: "/#field-tools" },
    ],
  },
  {
    head: "Get started",
    links: [
      { label: "Create a room", href: "/join" },
      { label: "Join a room", href: "/join" },
      { label: "Status board", href: "/status" },
      { label: "Settings", href: "/settings" },
    ],
  },
  {
    head: "Workspace",
    links: [
      { label: "Shared notes", href: "/notes" },
      { label: "Beacon", href: "/beacon" },
      { label: "Checklists", href: "/checklist" },
      { label: "Settings", href: "/settings" },
    ],
  },
] as const;

/** `{components.footer}` — dense caption link grid, display wordmark. */
export function Footer() {
  return (
    <footer className="border-t border-hairline-soft bg-canvas">
      <div className="mx-auto w-full max-w-[1280px] px-6 py-section lg:px-8">
        <Logo className="text-display-lg mb-12" />
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-4">
          {COLUMNS.map((column) => (
            <div key={column.head} className="flex flex-col gap-4">
              <Caption className="text-ink">{column.head}</Caption>
              <ul className="flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-body-sm font-330 text-ink underline-offset-4 hover:underline"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col gap-3 border-t border-hairline-soft pt-8 sm:flex-row sm:items-center sm:justify-between">
          <Caption>OffGrid · local mesh for the field</Caption>
          <Caption>Runs entirely on your own hardware</Caption>
        </div>
      </div>
    </footer>
  );
}
