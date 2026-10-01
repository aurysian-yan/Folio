// i18next 单例：只装配语言目录，不依赖原生模块。
// 供非 React 的纯逻辑模块（如 library.ts）与 Node 测试复用，默认源语言。
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./catalog.ts";

export const SUPPORTED_LANGUAGES = ["zh-CN", "en"] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// i18next 同时导出 use 方法与同名命名导出，这里调用实例方法。
// eslint-disable-next-line import/no-named-as-default-member
void i18n.use(initReactI18next).init({
  resources,
  lng: "zh-CN",
  fallbackLng: "en",
  supportedLngs: [...SUPPORTED_LANGUAGES],
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
