import type { Metadata } from "next";
import { MapPage } from "@/components/map/map-page";

export const metadata: Metadata = { title: "Offline map" };

export default function Page() {
  return <MapPage />;
}
