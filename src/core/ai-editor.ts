import type { AiAnchor } from "./ai-history";
export type AiEditorBridge = {
  capture(): AiAnchor;
  preview(
    anchor: AiAnchor,
    markdown: string,
    operation: "replace" | "insert",
  ): string;
};
export type AiSelectionRequest = {
  serial: number;
  action: "ask" | "polish" | "expand" | "summarize" | "translate";
  anchor: AiAnchor;
  body: string;
};
