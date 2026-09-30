# Claralight 滑块接入

Windows/Linux React UI 的全部数值滑块统一使用 Claralight Slider，包括主窗口
底部预览字号、设置窗口的预览字号、侧栏模糊度和卡片悬停延时。颜色面板使用
成熟的 react-colorful 完整组件及其内置色相、透明度控件；其余 UI 组件继续使用 HeroUI。

官方 npm 包 `@claralight-design/react@0.0.3` 尚未导出 Slider，源码注册表也尚未
包含该组件，因此采用官方支持的源码引入方式，固定到提交
`7b98a2bf93234847cc19ac040fc29c9323159047`。来源：

- [官方 Slider 源码](https://github.com/ClaralightDesign/react/blob/7b98a2bf93234847cc19ac040fc29c9323159047/packages/claralight/src/ui/slider.tsx)
- [官方接入说明](https://github.com/ClaralightDesign/react/blob/7b98a2bf93234847cc19ac040fc29c9323159047/README.md)
- [上游 MIT 许可声明](https://github.com/ClaralightDesign/react/blob/7b98a2bf93234847cc19ac040fc29c9323159047/packages/claralight/package.json)

本地组件位于 `apps/desktop-ui/src/components/ClaralightSlider.tsx`，保留官方的
三段轨道、胶囊手柄形变、弹簧、指针捕获和键盘交互。适配内容如下：

- 按产品要求移除数值气泡及其物理动画、浮层测量和相关依赖。
- 使用现有 Tailwind 工具类和 Folio 主题变量，不导入 Claralight 的全局主题。
- 预览字号范围和保存值裁剪统一为 SwiftUI 端的 `18…106`，步长为 `1`；
  模糊度和悬停延时沿用原有范围及步长。展开卡片的滚轮速度使用 `0.50…2.00×`、
  `0.05×` 步长，默认 `1.25×`，在设置窗口修改后同步到主窗口。
- 展开卡片的位置滑块在拖动中直接快切；连续快速拖过未加载位置时合并请求，
  忽略过期结果，松手后确认最终字体，不为中间位置逐次记录访问。
- 密集步长使用连续轨道，避免档位缝隙遮住轨道。
- 提供开始与结束回调，指针松开、取消、捕获丢失、键盘松开和窗口失焦时结束调整。
- 减少动态效果时，手柄形变与位置直接到达目标，不运行弹簧过渡。
- 上游注释改为必要的简洁中文说明。

Scritto 使用固定版本 `@scritto/react@0.1.0`，仅在主窗口底部的字号读数中动画
显示数字，`px` 单位保持静态；两位数字前补一个透明度为 `0.5` 的 `0`，
三位数字不补零，与 SwiftUI 主窗口的三位读数布局一致。补位零不参与读屏。
设置窗口的读数保持原样。开启
`respectMotionPreference`，遵循系统减少动态效果设置，并由外层 `output` 和
滑块的 `aria-valuetext` 提供完整读屏文本。

## 预览栏配色与同步

文字色和卡片背景色使用固定版本 `react-colorful@5.8.1` 的 `HexAlphaColorPicker`
与 `HexColorInput`，不自行实现拾色、色相和透明度控件。HeroUI `ColorPicker`
仅负责入口与弹窗；React Aria `parseColor` 负责将色值归一为带透明度的八位十六进制。
默认文字色跟随主题，默认背景沿用卡片样式，两个入口均支持恢复默认。

`preview-appearance.ts` 分开维护当前调整值和已确认值。字号、文字色、背景色
调整开始时固定选中卡片；没有选中项时使用首张卡片。调整过程中，只有该卡片
和对应检查器使用当前值，其余卡片使用已确认值。松手、键盘松开、结束输入或
取消操作后，统一更新其余卡片并保存设置，再通过存储事件同步其他窗口。
正常浏览时，仅受影响的卡片接收新属性，维持虚拟列表和组件缓存。

浏览器字体通过 CSS 着色；原生位图预览使用其透明通道作为遮罩，跟随同一文字
颜色和透明度，配色变化无需重新传输字体或请求位图。预设菜单采用 SwiftUI
的 `32×28` 图标入口和选中勾选结构，底部栏高度保持 `52px`，窄窗口隐藏颜色
标签并缩短字号滑块。

- [react-colorful 官方文档](https://github.com/omgovich/react-colorful)
