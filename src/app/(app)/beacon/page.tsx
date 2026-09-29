import type { Metadata } from "next";
import { PageStub } from "@/components/layout/page-stub";

export const metadata: Metadata = { title: "Beacon" };

export default function Page() {
  return (
    <PageStub
      phase="Phase 4"
      title="Beacon"
      blurb="One-tap SOS signaling and morse transmission with audio and screen-flash output arrive in Phase 4."
    />
  );
}
