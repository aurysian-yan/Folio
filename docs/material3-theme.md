# 安卓 Material3 配色主题

## 目标

安卓端在外观页提供独立的「Material3 配色主题」开关，开启后使用 Material3
语义色板显示卡片、背景、文字与强调色；主题色新增「根据壁纸配色」，以系统
壁纸主色作为种子。iOS 与桌面端不受影响，开关关闭时保持既有配色。

## 架构决策

- 色板生成放在原生侧，使用 `com.google.android.material:material` 自带的
  `com.google.android.material.color.utilities`（`SchemeTonalSpot` / `Hct`），
  由种子色派生完整语义色板。JS 只做角色到 Folio 语义 token 的映射，不重复
  实现调色板算法，保证与 Material3 一致。
- 壁纸种子取自 `android.R.color.system_accent1_500`，仅 Android 12
  （API 31）及以上可用；低版本 `wallpaperSeed` 返回 `null`，外观页不显示
  「根据壁纸配色」项。
- 关闭「Material3 配色主题」时完全不进入色板分支，行为与既有版本一致。

## 角色映射

原生返回以下角色，`src/material-theme.ts` 将其映射到 `Theme` token：

| Material3 角色 | Folio token |
| --- | --- |
| `primary` | `accent`、`selection` 基底 |
| `onPrimary` | `onAccent` |
| `primaryContainer` | `activeTab` |
| `surface` | 深色 `background`；浅色 `surface`、`tab`、`listCardSurface`、`buttonSurface`、`buttonPressed` |
| `surfaceContainer` | 浅色 `background`；深色 `surface`（设置卡片等）、`buttonSurface`、`buttonPressed` |
| `surfaceContainerHigh` | `raised`；深色 `tab`、`listCardSurface` |
| `surfaceContainerHighest` | `switchTrack` |
| `onSurface` | `label`、`buttonPressedLabel` |
| `onSurfaceVariant` | `secondary`、`muted` |
| `outlineVariant` | `border`、`backButtonBorder`、`listCardBorder` |
| `error` | `danger` |

英雄态语义色、`scrim`、`shadow` 与开关拨片保持既有语义，不参与映射。

安卓图标按钮统一使用 `buttonSurface` 与 `buttonPressed` 表示常态和按压
底色，描边沿用 `backButtonBorder`，宽度与返回按钮一致。按钮底色独立于
`tab`，不会改变底部导航、搜索框和卡片配色。开启 MD3 后，按钮始终使用
卡片前景底色，`buttonSurfaceOpacity` 为 0.9，仅背景半透明；滚动、标题
折叠和按压均不改变底色，图标与描边保持清晰。

## 原生接口

`FolioNative` 模块（`modules/folio-native`）新增同步方法：

- `wallpaperSeed(): string | null`：返回壁纸主色十六进制，低版本为 `null`。
- `materialPalette(seed: string, dark: boolean): MaterialRoles`：由种子色
  生成语义色板。

两者均为同步调用，供 React 在派生主题时直接读取。

## 偏好与兼容

- `Preferences` 新增 `materialTheme: boolean`（默认关闭）。
- `AccentId` 新增 `'wallpaper'`，`sanitize` 保留该值；种子缺失时强调色回退
  到 Folio 橙，不改变存储结构，沿用 `folio.mobile.preferences.v1`。
- 更换壁纸后进入前台会重新读取种子并刷新主题。

## 覆盖范围

主题经 `createTheme` 统一派生后传给所有界面与原生控件，顶栏、底部导航、
玻璃开关、菜单与面板页签一并跟随。原先直接读取基础配色的
`HeaderControls.android` 已改为从派生主题取色，避免顶栏遗漏。

## 验证

- `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm i18n:validate`。
- `src/material-theme.test.ts` 覆盖角色映射与浅深色选中态。
- 安卓实机核对固定四色与壁纸色、开关开闭、浅深色下的顶栏、卡片、底部
  导航与玻璃开关。
