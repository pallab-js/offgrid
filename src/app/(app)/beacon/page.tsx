import type { Metadata } from "next";
import { BeaconPage } from "@/components/beacon/beacon-page";

export const metadata: Metadata = { title: "Morse beacon" };

export default function Page() {
  return <BeaconPage />;
}
