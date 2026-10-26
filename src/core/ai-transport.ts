import { invoke } from "@tauri-apps/api/core";
import { native } from "./storage";
export const aiAvailable = native;
export type AiConfig = {
  enabled: boolean;
  provider: "deepseek" | "openai";
  model: string;
  maxOutputTokens: number;
  maxInputChars: number;
  maxRounds: number;
};
export type AiStatus = { config: AiConfig; hasKey: boolean };
export type AiSnapshot = {
  id: string;
  title: string;
  body: string;
  fingerprint: string;
  encrypted: boolean;
};
export type AiRequest = {
  id: string;
  snapshot: AiSnapshot;
  task: string;
  mode: "answer" | "edit";
  locale: string;
};
export type AiOutput = {
  answer: string;
  proposal: { title: string; body: string } | null;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  actions: string[];
};
export const aiTransport = {
  load: () => invoke<AiStatus>("ai_config"),
  save: (config: AiConfig) => invoke<void>("ai_save_config", { config }),
  saveKey: (provider: string, key: string) =>
    invoke<void>("ai_save_key", { provider, key }),
  deleteKey: (provider: string) => invoke<void>("ai_delete_key", { provider }),
  models: (provider: string) => invoke<string[]>("ai_models", { provider }),
  run: (request: AiRequest) => invoke<AiOutput>("ai_run", { request }),
  cancel: (id: string) => invoke<void>("ai_cancel", { id }),
};
