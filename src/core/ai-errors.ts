import type { MessageKey } from "@/i18n";
export function aiError(error: unknown, t: (key: MessageKey) => string) {
  const message = String(error);
  let key: MessageKey = "aiError";
  if (/AI_CANCELLED|AbortError/.test(message)) key = "aiCancelled";
  else if (message.includes("AI_HISTORY_LIMIT")) key = "aiHistoryLimit";
  else if (message.includes("AI_SOURCE_REQUIRED")) key = "aiSourceRequired";
  else if (message.includes("AI_CONFLICT")) key = "aiConflict";
  else if (message.includes("AI_AUTH")) key = "aiAuthError";
  else if (message.includes("AI_KEY_FORMAT")) key = "aiKeyFormat";
  else if (message.includes("AI_KEY_STORE")) key = "aiStoreError";
  else if (message.includes("AI_KEY_MISSING")) key = "aiKeyMissing";
  else if (/AI_NETWORK|AI_TIMEOUT/.test(message)) key = "aiNetworkError";
  else if (/AI_MODEL|AI_CONFIG/.test(message)) key = "aiModelError";
  else if (message.includes("AI_RATE_LIMIT")) key = "aiRateError";
  else if (
    /AI_(INPUT_LIMIT|RESPONSE_LIMIT|ROUND_LIMIT|OUTPUT_TRUNCATED)/.test(message)
  )
    key = "aiLimitError";
  else if (message.includes("AI_IMAGE_REFERENCES")) key = "aiImageError";
  else if (/AI_(TOOL|PROPOSAL|READ_REQUIRED|RESPONSE_FORMAT)/.test(message))
    key = "aiToolError";
  else if (message.includes("AI_DISABLED")) key = "aiSetup";
  else if (message.includes("AI_BUSY")) key = "aiBusy";
  return t(key);
}
