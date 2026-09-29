# 桌面端滚动条

Windows 与 Linux 的 React 界面统一使用 OverlayScrollbars `2.16.0`，依赖版本固定在 `package.json` 和 `pnpm-lock.yaml`。

## 接入方式

`src/scrollbars.ts` 在主窗口和设置窗口挂载时初始化滚动条。现有滚动元素同时作为目标和视口，不生成内容包装层，保留原有的 `scrollTop`、滚动事件、焦点定位与 React Aria 行为。主列表的 Hero、虚拟卡片和自动分页继续共用同一视口。

覆盖主列表、左右侧栏、设置页、筛选组、收藏夹编辑器、云字体页，以及 HeroUI 的 Select、Dropdown、ColorPicker 和可滚动 Modal。通过 DOM 观察器接管新打开的 Portal；滚动区域移除后销毁实例，窗口卸载时统一清理。普通卡片追加不重新扫描滚动区域。

新增滚动区域时，同时更新 `scrollbars.ts` 的区域选择器和 `style.css` 的初始化前滚动条隐藏选择器。不得只隐藏原生滚动条而不初始化 OverlayScrollbars。

## 样式与交互

使用 `os-theme-folio` 主题，颜色基于现有 `--text` 变量，随浅色、深色和系统主题变化。滑块支持拖动与轨道点击；鼠标离开后延迟 600 ms 隐藏，滚轮、触控和键盘仍使用原生滚动。遵循 `prefers-reduced-motion`，减少动态效果时关闭滚动条过渡。

## 左侧状态卡避让

底部云同步状态卡保持悬浮。通过 `ResizeObserver` 读取 `.sidebar-status` 的实际高度，再增加 8 px 间距，写入滚动区域的 `--sidebar-status-clearance`。

内容下方留白和竖向轨道底边使用同一变量，使最后一项可滚到卡片上方，并让轨道在卡片上方结束。首次测量前使用 72 px 留白。窗口宽度、状态文案或卡片高度变化后重新测量；设置页中的模糊预览导航保留原有 12 px 下边距。

## 验证

49 项前端测试、类型检查、Lint 和构建通过。滚动条专项测试检查现有视口与列表结构保留、Portal 开关后的实例生命周期，以及状态卡高度变化后的留白更新。

在 Chromium 中使用模拟 Tauri IPC 数据，检查 1120 × 760 和 720 × 520 两种窗口：左侧轨道与最后一项均位于状态卡上方约 8 px；拖动滑块可滚动侧栏，主列表追加分页后滚动位置保持不变，Select 和收藏夹弹窗均接管滚动。打开弹窗后未发现遗漏的可见原生滚动区域；深色与减少动态效果正确应用，设置页预览导航仍为 12 px 下边距。此验证不代表真实 WebView 的渲染性能采样。

接口与样式依据：[OverlayScrollbars 官方文档](https://kingsora.github.io/OverlayScrollbars/)。
