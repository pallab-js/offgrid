import type { Metadata } from "next";
import { ChatWorkspace } from "@/components/chat/workspace";

export const metadata: Metadata = { title: "Channels & messages" };

export default function Page() {
  return <ChatWorkspace />;
}
