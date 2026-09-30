import type { Metadata } from "next";
import { ChecklistPage } from "@/components/checklist/checklist-page";

export const metadata: Metadata = { title: "Checklists & guides" };

export default function Page() {
  return <ChecklistPage />;
}
