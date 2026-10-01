# 安卓液态导航源码记录

## 来源

- NexioSchedule：`HaoZai000/NexioSchedule`，固定提交 `291e8b9b57c8f331d8f189c52553f41dfd0ce017`，AGPL-3.0。
- `LiquidBottomTabs`、液态动效及边光来自该提交的 `com/haooz/chedule/ui`；Backdrop、Capsule 与形状接口来自该提交的 `com/kyant`。
- Capsule 与 AndroidLiquidGlass 上游为 Kyant0，Apache-2.0；着色器的原始版权声明保留于 `Kyant-Shaders-NOTICE.txt`。
- 四项图标路径来自已安装的 `phosphor-react-native@3.0.6`，MIT，常规字重。

## 适配范围

- 保留原版均衡材质、连续曲率、分层采样及吸附弹簧参数；导航内容扩展为 Folio 四项。拖动位置同步跟随手势，点击及松手后使用吸附弹簧；左右边距各为可用宽度的 8% 减 4dp，最小为零；底部距离采用 `max(32dp, 系统底部 inset + 16dp)`。
- 页面背景由独立的 RN 子树 RenderNode 提供，导航通过窗口坐标采样。
- 移除课表、平板侧栏、应用材质设置、未使用的形状及 SVG 导出入口；上游过程性注释移入此记录。
- 使用 `SystemClock.uptimeMillis()` 适配现有 Kotlin 版本；为连续操作取消过期的释放动画。
- 手势按按下点到当前位置的完整位移计算目标，移动动画只保留最新任务；只提交一次选择，取消时恢复。补充无障碍语义和系统动画缩减处理。

## 许可文件

许可原文位于 `META-INF/licenses/folio-navigation/`，并随 APK 打包：

`NexioSchedule-LICENSE.txt`、`AndroidLiquidGlass-LICENSE.txt`、`Capsule-LICENSE.txt`、
`Apache-2.0.txt`、`Kyant-Shaders-NOTICE.txt` 和 `Phosphor-LICENSE.txt` 与移植源码一同保留。

## 构建约定

Compose UI/Foundation 固定为 `1.10.6`，与现有 Expo UI 一致；Compose 编译插件采用
Expo 提供的 Kotlin 版本。最低 API 28：API 33 及以上支持胶囊折射，API 31–32
保留模糊，低版本使用半透明材质。iOS 导航继续由现有 SwiftUI 控件负责。
