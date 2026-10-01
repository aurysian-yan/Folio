// 移动端 i18next 入口：跟随系统语言，切换系统语言后重启应用生效。
import { getLocales } from "expo-localization";
import i18n, { SUPPORTED_LANGUAGES, type AppLanguage } from "./instance";

export { SUPPORTED_LANGUAGES, type AppLanguage };

// 按系统首选语言选择界面语言，非中文一律回退到英文。
export function detectLanguage(): AppLanguage {
  const tag = getLocales()[0]?.languageTag ?? "en";
  return tag.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

void i18n.changeLanguage(detectLanguage());

export default i18n;
