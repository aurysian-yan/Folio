# 安卓液态导航源码记录

## 来源

- NexioSchedule：`HaoZai000/NexioSchedule`，固定提交 `291e8b9b57c8f331d8f189c52553f41dfd0ce017`，AGPL-3.0。
- `LiquidBottomTabs`、液态动效及边光来自该提交的 `com/haooz/chedule/ui`；Backdrop、Capsule 与形状接口来自该提交的 `com/kyant`。
- Capsule 与 AndroidLiquidGlass 上游为 Kyant0，Apache-2.0；着色器的原始版权声明保留于 `Kyant-Shaders-NOTICE.txt`。
- 四项图标路径来自已安装的 `phosphor-react-native@3.0.6`，MIT，常规字重。

## Android View Menu

- 顶栏视图菜单参考 MeiloX（`NEORUAA/MeiloX`）固定提交 `1d830d3f9cd11294e2bb977c7d0ba77f0fb8ca29`，GPL-3.0；原文随 `MeiloX-LICENSE.txt` 打包。
- 参考 [`IosPopupMenu` / `IosContextMenu`](https://github.com/NEORUAA/MeiloX/blob/1d830d3f9cd11294e2bb977c7d0ba77f0fb8ca29/app/src/main/java/com/ljyh/mei/ui/glass/Ios27Components.kt) 的同一弹层生命周期、角点展开、弹簧与收起禁用行为；展开阻尼比 `0.78`、刚度 `240`，收起刚度 `400`。
- 背景继续使用现有 RN RenderNode、Backdrop 与 Capsule，没有新增动画或 UI 依赖；跨窗口采样参考 [`CrossWindowBackdrop`](https://github.com/NEORUAA/MeiloX/blob/1d830d3f9cd11294e2bb977c7d0ba77f0fb8ca29/app/src/main/java/com/ljyh/mei/ui/glass/GlassBackdrop.kt)，统一采用屏幕坐标。采样源只包裹字体内容，避免顶部控件反复采样自身。
- Android 专用文件承载顶部按钮、搜索和菜单，iOS 保持现有 SwiftUI Menu；菜单覆盖触发按钮，并以其角点展开。菜单尺寸沿用原视图菜单，颜色由 RN 语义主题传入；按钮、菜单与搜索框使用同一条 0.5dp 淡描边，不添加高光。菜单圆角取 44dp 操作按钮高度的一半，阴影复用 Backdrop 默认参数，随展开进度出现。菜单保留浅色 16dp、深色 12dp 模糊及 70% 背景覆盖；API 33+ 使用折射，31–32 保留模糊，28–30 使用不透明度较高的兼容材质。
- 菜单拖动复用现有 `InteractiveHighlight` 的手势与回弹状态，仅接入手势层，省略高光绘制；形变与背景采样共用完整变换，拖动超过触摸阈值时不提交选项。系统关闭动画时停用拖动形变。
- 视图、搜索、导入和搜索关闭按钮共用同一套背景采样与拖动回弹；浅色 16dp、深色 12dp 模糊，保留原有胶囊尺寸、淡描边与主题色，背景覆盖率在 API 31+ 为 70%，低版本为 96%。按钮拖动超过系统触摸阈值后消费移动事件并取消本次点击，拖回起点仍不触发操作；其余导航与菜单的手势行为保持原有方式。系统关闭动画时保留点击和拖动取消逻辑，停用视觉形变。
- 搜索框从搜索按钮位置展开并收回，顶部信息使用 RN Animated 淡入淡出；系统关闭动画时直接完成转场。导入按钮使用原生 ProgressBar，完成、取消或失败后恢复加号。
- 顶栏的网格、列表、勾选、箭头、搜索、加号与关闭路径同样来自已安装的 Phosphor 常规字重。

## Android Progressive Header Blur

- 顶部标题栏渐进式模糊参考同一 MeiloX 固定提交的 [`IosPinnedListPage.kt`](https://github.com/NEORUAA/MeiloX/blob/1d830d3f9cd11294e2bb977c7d0ba77f0fb8ca29/app/src/main/java/com/ljyh/mei/ui/glass/IosPinnedListPage.kt)，GPL-3.0；复用已保留的 `MeiloX-LICENSE.txt`。上游高斯采样算法参考 [AndroidX 固定提交](https://android.googlesource.com/platform/frameworks/support/+/7e1430f6c57df22b6ceeaa66ff4e18b53a67edd9)，Apache-2.0，许可原文已随模块打包。
- API 33+ 使用横向、纵向两次高斯采样，每个像素的半径从上方 10dp 向底边递减至零；前 42% 保持最大半径，纵向采样同时叠加页面语义背景色。着色器尺寸与半径匹配现有 Backdrop 的降采样比例，标题栏底部额外保留 34dp 过渡区。
- API 31–32 使用系统模糊和纵向透明遮罩，API 28–30 使用同样的渐隐主题材质。标题栏与状态栏覆盖列表，列表初始留白保持原位置；滚动前 56dp 通过 RN 原生动画驱动背景透明度，标题、按钮、搜索框及弹层不参与采样。搜索期间保留背景记录，浅色和深色均采用页面主题色。

## 适配范围

- 保留原版均衡材质、连续曲率、分层采样及吸附弹簧参数；导航内容扩展为 Folio 四项。拖动位置同步跟随手势，点击及松手后使用吸附弹簧；左右边距各为可用宽度的 8% 减 4dp，最小为零；底部距离采用 `max(32dp, 系统底部 inset + 16dp)`。
- 页面背景由独立的 RN 子树 RenderNode 提供，导航通过窗口坐标采样。
- 移除课表、平板侧栏、应用材质设置、未使用的形状及 SVG 导出入口；上游过程性注释移入此记录。
- 使用 `SystemClock.uptimeMillis()` 适配现有 Kotlin 版本；为连续操作取消过期的释放动画。
- 手势按按下点到当前位置的完整位移计算目标，移动动画只保留最新任务；只提交一次选择，取消时恢复。补充无障碍语义和系统动画缩减处理。

## 许可文件

许可原文位于 `META-INF/licenses/folio-navigation/`，并随 APK 打包：

`NexioSchedule-LICENSE.txt`、`AndroidLiquidGlass-LICENSE.txt`、`Capsule-LICENSE.txt`、
`Apache-2.0.txt`、`Kyant-Shaders-NOTICE.txt`、`Phosphor-LICENSE.txt` 和 `MeiloX-LICENSE.txt` 与移植源码一同保留。

## 构建约定

Compose UI/Foundation 固定为 `1.10.6`，与现有 Expo UI 一致；Compose 编译插件采用
Expo 提供的 Kotlin 版本。最低 API 28：API 33 及以上支持胶囊折射，API 31–32
保留模糊，低版本使用半透明材质。iOS 导航继续由现有 SwiftUI 控件负责。
