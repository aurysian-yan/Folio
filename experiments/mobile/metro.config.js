// Expo Metro 配置：允许打包仓库根目录中的共享语言与 Hero 逻辑。
// 移动端不是仓库级 pnpm workspace 成员，需要通过 watchFolders 显式放开上级目录。
// package.json 声明了 "type": "module"，因此这里使用 ESM 语法；Metro 支持读取
// ESM 配置，同时 Expo 开发服务器也只监听 metro.config.js 这一文件名。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const config = getDefaultConfig(projectRoot);

config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(projectRoot, "../../locales"),
  path.resolve(projectRoot, "../../shared"),
];

export default config;
