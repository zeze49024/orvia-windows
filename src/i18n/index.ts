import { languageRegistry, type Locale, type MessageKey } from "./registry";
export { languageRegistry, type MessageKey } from "./registry";
export function translator(locale: Locale) {
  const language =
    languageRegistry.find((item) => item.code === locale) ??
    languageRegistry[0];
  return (key: MessageKey): string => language.resource[key];
}
export function formatTime(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
