import type { Metadata } from "next";
import { PageStub } from "@/components/layout/page-stub";

export const metadata: Metadata = { title: "Channels & messages" };

export default function Page() {
  return (
    <PageStub
      phase="Phase 2"
      title="Channels & messages"
      blurb="Local-first encrypted messaging with an offline queue, typing indicators and replies lands in Phase 2. Rooms, presence and the realtime spine arrive first in Phase 1."
    />
  );
}
