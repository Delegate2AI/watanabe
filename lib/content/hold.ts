import type { Database as DatabaseType } from "better-sqlite3";
import type { PromotionTarget } from "@/lib/db/chat-docs-types";

export interface HoldState {
  held: boolean;
  gates: string[];
  overriddenBy: string | null;
  overrideReason: string | null;
  overriddenAt: string | null;
  message: string | null;
}

const CLEAR: HoldState = {
  held: false,
  gates: [],
  overriddenBy: null,
  overrideReason: null,
  overriddenAt: null,
  message: null,
};

export const holdForDoc: (db: DatabaseType, docId: string, ownerEmail: string) => HoldState = () => CLEAR;

export const holdForTarget: (
  db: DatabaseType,
  targetType: PromotionTarget,
  targetId: string,
  ownerEmail: string,
) => HoldState = () => CLEAR;

export const holdNoteForMr: (db: DatabaseType, docId: string, ownerEmail: string) => string = () => "";
