import type { Metadata } from "next";
import { PageStub } from "@/components/layout/page-stub";

export const metadata: Metadata = { title: "Checklists & guides" };

export default function Page() {
  return (
    <PageStub
      phase="Phase 4"
      title="Checklists & guides"
      blurb="Bundled offline checklists and field guides with per-room progress arrive in Phase 4."
    />
  );
}
