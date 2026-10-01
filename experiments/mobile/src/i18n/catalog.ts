// 移动端语言目录：直接引用仓库根目录 locales/ 下的共享字段。
// 与桌面端、macOS 共用同一份 JSON，避免同一文案在多端重复登记。
import en from "../../../../locales/en.json" with { type: "json" };
import zhCN from "../../../../locales/zh-CN.json" with { type: "json" };

export const resources = {
  "zh-CN": { translation: zhCN },
  en: { translation: en },
};
