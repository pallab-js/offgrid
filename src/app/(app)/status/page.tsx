import type { Metadata } from "next";
import { StatusPage } from "@/components/status/status-page";

export const metadata: Metadata = { title: "Team status board" };

export default function Page() {
  return <StatusPage />;
}
