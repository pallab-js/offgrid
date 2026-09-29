import type { Metadata } from "next";
import { PageStub } from "@/components/layout/page-stub";

export const metadata: Metadata = { title: "Shared notes" };

export default function Page() {
  return (
    <PageStub
      phase="Phase 4"
      title="Shared notes"
      blurb="An encrypted group journal that syncs across every peer — conflict-tolerant and readable offline — lands in Phase 4."
    />
  );
}
