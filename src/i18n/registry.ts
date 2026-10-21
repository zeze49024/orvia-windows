import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";
import en from "./locales/en.json";
export type MessageKey = keyof typeof en;
export const languageRegistry = [
  { code: "zh-CN", name: "简体中文", resource: zhCN },
  { code: "zh-TW", name: "繁體中文", resource: zhTW },
  { code: "en", name: "English", resource: en },
] as const satisfies readonly {
  code: string;
  name: string;
  resource: Record<MessageKey, string>;
}[];
export type Locale = (typeof languageRegistry)[number]["code"];
export const localeCodes = languageRegistry.map(
  (language) => language.code,
) as [Locale, ...Locale[]];
