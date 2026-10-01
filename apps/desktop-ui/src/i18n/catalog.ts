// 桌面端语言目录：直接引用仓库根目录 locales/ 下的共享字段。
// 三套客户端共用同一份 JSON，新增或修改文案只需在 locales/ 中处理一次。
import en from "../../../../locales/en.json";
import zhCN from "../../../../locales/zh-CN.json";

export const resources = {
  "zh-CN": { translation: zhCN },
  en: { translation: en },
};
