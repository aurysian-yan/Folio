# Folio 项目协作规范

## 适用范围

本文件适用于 Folio 仓库。Rust 字体目录核心保持跨平台、无界面；Windows
与 Linux 桌面端共用 React 前端，并由 Tauri 2 承载。当前仓库只建立前端
依赖基线，暂不添加 UI 源码。

## 技术栈

- React、TypeScript、Vite、Tauri 2 是 Windows/Linux 前端的默认技术栈。
- 禁止引入 Next.js、Vue、Nuxt 或其他 SSR/元框架。
- JavaScript 依赖和脚本统一使用 `pnpm`。
- UI 组件库固定使用 HeroUI v3：`@heroui/react` 与 `@heroui/styles`。
  这是根据 Folio 的 macOS 设计稿作出的项目级选择，覆盖通用规则中的
  Chakra UI 默认项。
- 使用 Tailwind CSS v4 处理页面布局和少量结构样式。
- 不得引入或混用 Fluent UI、Chakra UI、MUI、Radix、Ant Design、Mantine。
- PrimeReact 只允许作为数据密集型功能的后续备选；引入前必须先记录架构
  决策，且不能和 HeroUI 混用在同一页面。

## UI 约定

- macOS 界面的 SF Symbols 固定使用英文图形形态，不随系统或界面语言本地化；
  SwiftUI 中统一通过 `Image.englishSystemName(_:)` 显示。
- Windows 与 Linux 使用同一套 React 页面和交互模型。
- 设计稿中的侧栏、工具栏、搜索框、字体卡片网格和底部预览栏作为后续
  前端实现的基础结构。
- 侧栏抽屉使用 HeroUI `Drawer`，操作区使用 `Toolbar`，字体预览使用
  `Card`，字号与颜色控制使用 `Slider`、`ColorPicker`。
- UI 文案默认使用中文，必须是可以直接交付的产品文案；不得出现 TODO、
  FIXME、调试信息或开发过程说明。
- 使用语义化 HTML 和 HeroUI 提供的 React Aria 行为，确保键盘、焦点和读屏
  支持。

## 样式与动效

- 使用 HeroUI 语义主题变量支持浅色、深色和系统主题。
- 遵循 `prefers-reduced-motion`。默认使用 HeroUI 内置的 CSS transitions 和
  keyframes，不增加独立动画库；复杂页面转场需要单独评估。
- 不添加渐变、无依据的装饰、任意设计 token 或大范围组件覆盖。自定义 CSS
  只用于应用级布局和主题变量。
- 图标统一使用 Phosphor Icons，优先使用带 `Icon` 后缀的导出，例如
  `HouseIcon`；导入失败时再使用无后缀导出。

## 代码与验证

- 代码注释必须使用简洁中文，且只保留模块、区块和必要的关键逻辑说明。
- 规则、架构和接口说明使用中文；面向用户的界面文本使用中文。
- Rust 核心与桌面 UI 保持边界，不得向 `folio-core` 添加平台 API。
- HeroUI、Tailwind、React 和 Vite 使用稳定版本，并在
  `package.json` 与 `pnpm-lock.yaml` 中固定版本；禁止使用 `latest` 或预发布
  范围。
- UI 源码加入后，使用 `pnpm` 执行类型检查、Lint 和构建；Rust 改动继续执行
  对应的 Cargo 检查。
- 不得覆盖或回退与当前任务无关的审计改动。

## Git 提交规范

- 提交信息必须使用中文，格式为 `<type>: <中文描述>`。
- `type` 使用以下小写英文类别：
  - `feat`：新增功能
  - `fix`：修复问题
  - `docs`：文档或规范
  - `refactor`：重构且不改变行为
  - `test`：测试
  - `chore`：依赖、构建或仓库维护
- 描述使用动词开头，简明说明实际变更，不写句号，不夹带无关内容。
- 一次提交只表达一个完整主题；提交前先检查 `git diff` 和验证结果。
- 示例：`chore: 配置 HeroUI 前端依赖基线`。
