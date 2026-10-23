# 在线字体站内配色

## 结论

Google Fonts 的浏览页把 Material 3 语义色集中定义在 `body` 与
`body.gf-dark-theme` 上的 CSS 变量中，包括 `--sys-primary`、`--sys-surface*`、
`--sys-on-surface*`、`--sys-outline*` 和一批 `--mat-*` 组件 token。因此可以在
页面加载后注入一个 `<style>` 节点，用当前应用色板覆盖这些变量，让站内背景、
卡片、文字、按钮、输入框、菜单和选择器跟随应用主题。

这是站点级覆盖，不是完整重绘：

- 插画、缩略图、品牌素材和少量硬编码颜色不会跟随。
- 站点改版可能调整变量名；内置覆盖需要随站点更新维护。
- 其他来源没有统一的变量体系，默认保持原样；可在来源编辑器中填写自定义 CSS。

## 注入方式

- Android 与原色板由 `materialWebPalette` 返回完整 Material3 角色；未开启
  Material3 时使用当前 Folio 语义色。
- iOS 没有 Monet，使用当前 Folio 主题生成同一套变量。
- React 生成一个只更新 `#folio-web-theme` 样式节点的脚本，由原生 WebView
  在页面加载完成、URL 变化或主题变化时执行。
- 脚本不注册消息桥接，不读取页面内容，只写入 CSS 变量和用户自定义 CSS。
- 自定义 CSS 追加在自动配色之后，按来源保存在本机，限制 20,000 字符。

## 开关与默认值

- 每个来源独立开关，默认只有 Google Fonts 开启。
- 关闭自动配色时仍会注入非空的自定义 CSS。
- 来源编辑器中提供开关和 CSS 输入区；设置页说明默认行为。

## 验证

- `src/online.test.ts` 覆盖关键词提取、默认开关与 CSS 变量生成。
- 人工验证 Google Fonts 浅色/深色、Material3 壁纸配色、按钮和表单对比度，
  以及关闭开关后的网站原样显示。
