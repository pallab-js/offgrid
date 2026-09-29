import type { Metadata } from "next";
import { PageStub } from "@/components/layout/page-stub";

export const metadata: Metadata = { title: "File library" };

export default function Page() {
  return (
    <PageStub
      phase="Phase 3"
      title="File library"
      blurb="Streaming uploads with live progress, resumable downloads and in-browser previews arrive in Phase 3."
    />
  );
}
