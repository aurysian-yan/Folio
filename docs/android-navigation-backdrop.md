# Android 底栏背景与自适应边距

更新：2026-10-23。

## 背景源

RN 页面只把需要被采样的内容包进 `NavigationBackdrop`，由原生
`FolioBackdropSourceView` 录制到独立 `RenderNode`。底栏、网页标题条、顶部控制区
和弹出菜单通过 `sourceId` 读取同一份录制结果，再在 Compose 或原生画布中做实时
模糊、折射和边缘高光。导航、浮动条和弹层本身不进入录制，避免采样到自身。

每个页面只在处于前台时注册背景源；切页时旧源注销、新源注册。没有可用源时保留
半透明材质，不阻塞导航交互。

## WebView 与合成层

普通 View 的显示列表可以安全重放，同一份 `RenderNode` 被多处引用时每处都会重新
执行绘制。`WebView` 不同：Chromium 通过 draw functor 每帧只产出一个合成帧，第二次
重放会得到空白帧并露出网页底色，表现为网页闪屏或底部条发白。

因此，包含 `WebView`（以及视频、`SurfaceView` 等一次性绘制表面）的背景源必须设置
`compositingLayer`：

- `NavigationBackdrop` 的 `compositingLayer` 属性对应原生
  `RenderNode.setUseCompositingLayer(true, null)`。
- hwui 先把显示列表执行到离屏缓冲，再为屏幕绘制和背景采样分别拷贝纹理，Chromium
  functor 每帧只运行一次。
- 合成层会多占一张页面尺寸的纹理，并带来约 5 ms/帧的绘制开销，只对确实包含
  WebView 的源开启；普通字体列表仍走无层的轻量路径。

在线字体页的 WebView 区域由 `OnlineFontsScreen` 直接包裹在
`NavigationBackdrop compositingLayer` 中，底栏折叠或展开、标题条与菜单采样时都
不会再触发网页重绘。

## 自适应外边距

底栏底部与左右外边距按屏幕短边和底部圆角缩减 `6–12dp`：

- 屏幕短边按 `360–600dp` 线性归一化，底部圆角按 `8–32dp` 线性归一化；
- 圆角权重 `0.6`，屏幕尺寸权重 `0.4`，两者越大越保留呼吸空间；
- 左右外边距先沿用可用宽度的 `8% − 4dp`，再减去同一缩减量，最小保留 `8dp`；
- 底部保留系统手势区，并在其上至少留 `4dp`；
- API 31 以下没有公共底部圆角接口，按圆角 `0` 计算，只使用尺寸权重。

公式与边界在 `experiments/mobile/src/navigation-metrics.ts` 中集中维护，并由
`navigation-metrics.test.ts` 覆盖。

## 约束

- 背景源只包内容，不包导航、浮动条和面板；这些控件依赖采样结果但不能被采样。
- API 31 以下不启用实时模糊，保持半透明兼容材质。
- 新增含 `WebView`、视频或 `TextureView` 的页面时，包裹背景源必须同时开启
  `compositingLayer`，否则多处采样会重放一次性绘制并出现闪屏。
- 页面卸载、窗口不可见或切到后台时释放 `RenderNode`，合成层一并丢弃。
