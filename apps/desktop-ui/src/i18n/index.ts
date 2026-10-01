// 桌面端 i18next 初始化：默认跟随系统语言，用户可在设置中覆盖并持久化。
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./catalog";

export const SUPPORTED_LANGUAGES = ["zh-CN", "en"] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = "folio.language";

// 语言设置：「跟随系统」或某个明确语言。
export type LanguageSetting = AppLanguage | "system";

function isSupported(value: string | null): value is AppLanguage {
  return value !== null && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

// 优先使用用户选择，其次按浏览器语言判断，最后回退到英文。
export function detectLanguage(): AppLanguage {
  const stored = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
  if (isSupported(stored)) return stored;
  const preferred = typeof navigator === "undefined" ? "" : navigator.language;
  return preferred.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

// 读取当前设置：没有显式选择时视为「跟随系统」。
export function currentLanguageSetting(): LanguageSetting {
  const stored = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
  return isSupported(stored) ? stored : "system";
}

// 应用语言设置并持久化；「跟随系统」会清除显式选择。
export function setLanguageSetting(setting: LanguageSetting): void {
  if (setting === "system") localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, setting);
  const resolved = setting === "system" ? detectLanguage() : setting;
  document.documentElement.lang = resolved;
  void i18n.changeLanguage(resolved);
}

const initialLanguage = detectLanguage();
document.documentElement.lang = initialLanguage;

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: "en",
  supportedLngs: [...SUPPORTED_LANGUAGES],
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
