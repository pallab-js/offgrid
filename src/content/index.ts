import kit from "./field-kit.json";

export interface ChecklistItemDef {
  id: string;
  label: string;
}

export interface ChecklistDef {
  id: string;
  title: string;
  items: ChecklistItemDef[];
}

export interface GuideSection {
  heading: string;
  body: string;
}

export interface GuideDef {
  id: string;
  title: string;
  sections: GuideSection[];
}

export const CHECKLISTS: ChecklistDef[] = kit.checklists;
export const GUIDES: GuideDef[] = kit.guides;

export function allItemIds(): string[] {
  return CHECKLISTS.flatMap((list) => list.items.map((item) => item.id));
}
