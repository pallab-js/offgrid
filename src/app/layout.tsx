import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "OffGrid — off-grid messaging & field tools",
    template: "%s · OffGrid",
  },
  description:
    "Real-time messaging, file sharing and survival tooling for teams beyond the reach of the internet. One machine is the hub — everyone else just joins.",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
