# 安卓 M3E 运行时主题

## 使用与发布门槛

非 legacy（glasmio）开发构建的「设置 → 外观」提供 Glasmio、Material 3 Expressive
单选预览卡。默认仍是 Glasmio；M3E 选择入口通过 `__DEV__` 限定，正式构建不开放。
需重新编译原生 development build，不能只更新 JS 到旧原生安装包。

`androidUiStyle` 是非 legacy 安卓端唯一可写的风格偏好。`materialTheme` 是为旧客户端
保留的兼容字段，在偏好归一化时按所选风格覆盖，M3E 为真、Glasmio 为假。旧安装、
损坏和未知风格均回退 Glasmio，不根据旧配色开关自动切换 UI。iOS/legacy 的旧字段行为保留。

## 主题与原生宿主

`ui-style` 定义迁移与尺寸/形状/运动令牌；`UiThemeProvider` 不重建业务根节点。
`createTheme` 派生颜色快照与 revision，所有原生 UI 通过 `uiTheme` Map 接收同一快照。
原生输入事件携带 `themeRevision`，JS 通过提交阶段更新的 ref 拒绝旧快照事件。

原生宿主在 M3E 下使用 MaterialExpressiveTheme，本地绘制 Compose 内容；切回 Glasmio
后回到原有覆盖层。源容器始终保留业务子树，通过 `samplingEnabled` 释放 RenderNode
录制、取消注册与 pre-draw 采样监听。滑块切换时取消编辑，不额外提交最终值；菜单关闭不执行操作。

Material3 固定 **1.5.0-beta02**，原生模块与 Glasmio UI 对齐。1.4.0 的 MaterialExpressiveTheme
和 MotionScheme 接入点为 internal，不能通过应用调用，因此显式升级到公开 Expressive API。
该版本仍为 beta，需要对 Glasmio 同时做回归后才能发布。图标使用 Material 官方矢量源，
来自 `@material-design-icons/svg` 0.14.15；授权见 `material-icons-LICENSE`。
收藏夹数字标识作为用户内容保留原数字图形，不改变其编号语义。

## 组件覆盖登记

“已接入”表示代码接入，不代表已通过设备视觉或交互验收。

| 范围 | 接入方式 | 状态 |
| --- | --- | --- |
| 全页面背景/配色 | 同一语义色快照，应用与网页继承色板联动 | 已接入；待真机 |
| 开关/滑块 | 原生 Switch、Slider，保留受控值、读屏与步长 | 已接入；待真机 |
| 底栏/云端页签/面板页签 | NavigationBar、SegmentedButton，导航占位随主题变化 | 已接入；待真机 |
| 顶部操作区/搜索/菜单 | Material 图标按钮、TextField、DropdownMenu | 已接入；待真机 |
| 通用操作/云同步/存放位置 | 原生 Material 按钮与 Expressive 形状反馈 | 已接入；待真机 |
| 全局确认 | 原生 AlertDialog，保留已有按钮业务回调 | 已接入；待真机 |
| 抽屉/嵌套编辑 | 保留 Gorhom，Material 表面与28点顶角 | 已接入；待真机 |
| 设置/字体卡/云卡/收藏夹/Hero | 共享主题令牌及 Material 表面层级 | 已接入；待逐页检查 |
| 浏览器地址栏/字符检查面板 | 原生实体 Surface，停用玻璃采样 | 已接入；待真机 |
| 应用图标/加载反馈 | RN 语义图标分派、原生 Expressive LoadingIndicator | 已接入；待真机 |
| 文本/表单/低频状态 | 共享语义色、表单令牌；需逐页校核排版和焦点 | 待全量视觉审阅 |

系统文件/权限/分享/安装界面由 Android 控制。第三方网页只应用用户允许的站内配色，
不重建网页组件，不改变自定义 CSS 或来源许可。网页色板更新沿用原注入逻辑，不主动刷新网页。

## 验证

- 移动端执行 `pnpm typecheck`、`pnpm lint`、`pnpm test`，根目录执行 `pnpm i18n:validate`。
- `ui-style.test.ts` 覆盖默认值、旧开关、未知值、非法组合归一化、平台边界与采样令牌。
- 原生 backdrop instrumentation 增加浅深色循环切换、源录制释放、实体面板快照色、宿主还原与页面身份检查。
- 原生测试构建：在生成的 android 目录执行
  `./gradlew :folio-native:assembleGlasmioDebugAndroidTest -PfolioBackdropTest=true`，再使用已有
  `FolioGlasmioBackdropInstrumentation` 运行器安装运行。继承原测试清单与启动方式。
- 发布前必须完成 glasmio Debug/Release 构建，并逐页验证两主题、浅深色、长文本、大字体、
  横屏/分屏、TalkBack、减少动态效果、前后台和反复切换。

APK 构建尚未完成：首次尝试停在 JDK 17 工具链检查；后续已识别 API 37 的 SDK 包名为
`platforms;android-37.0`，用户随后改为提交代码，停止继续打包。原生 instrumentation 与
真机视觉/状态保留验收尚未执行，不能将代码接入视为正式发布验收通过。

合并最新 main（f1e04ec）后已通过：TypeScript 类型检查、ESLint、153 项 Node 测试、
1249 字段国际化校验、Glasmio 77 项来源/5 项补丁校验。保留最新的字母快速定位、
连续预览字号与 Glasmio 外观控件，并为新增外观宿主补齐 Material 分派。
合并前已完成 Android Metro JS 导出（4466 个模块）；以上结果不包含 Kotlin 编译、APK 安装或设备测试。
