import type { Metadata } from "next";
import { PageStub } from "@/components/layout/page-stub";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <PageStub
      phase="Phase 5"
      title="Settings"
      blurb="Profile, room management, data export and destructive wipe arrive in Phase 5."
    />
  );
}
