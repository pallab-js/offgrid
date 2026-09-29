import type { Metadata } from "next";
import { PageStub } from "@/components/layout/page-stub";

export const metadata: Metadata = { title: "Offline map" };

export default function Page() {
  return (
    <PageStub
      phase="Phase 4"
      title="Offline map"
      blurb="Calibrate a local map image, drop waypoints and share coordinates with the room — no internet tiles — in Phase 4."
    />
  );
}
