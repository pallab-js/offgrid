import type { Metadata } from "next";
import { PageStub } from "@/components/layout/page-stub";

export const metadata: Metadata = { title: "Status board" };

export default function Page() {
  return (
    <PageStub
      phase="Phase 4"
      title="Status board"
      blurb="Peer battery, connection quality and last-seen arrive in Phase 4; live presence lands with the hub in Phase 1."
    />
  );
}
