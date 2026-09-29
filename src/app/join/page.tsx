import type { Metadata } from "next";
import { JoinPageClient } from "./join-flow";

export const metadata: Metadata = { title: "Join a room" };

export default function JoinPage() {
  return <JoinPageClient />;
}
