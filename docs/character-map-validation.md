# 字符表实施与验证记录

验证日期：2026-10-10 至 2026-10-11。本轮优先完成核心：字符映射、共享渲染与 UniFFI/Tauri/Expo 桥接已收尾。阶段 C 保持 **PARTIAL**，现有 UI 原型保留，导航调整与目标设备验收后续进行。移动实现保留在 `experiments/mobile`，不改变 RN/Expo 生产采用决策，不新增数据库迁移或同步协议。

## 本轮完成与后续范围

- 已完成：实际字体字节与非零 collection 成员的字符索引、搜索/脚本/分页、固定版本渲染依赖、彩色/位图/SVG、来源与 revision 快照、32 MiB 图片缓存及四项桥接接口。
- 已完成：接口默认值与上限、无效请求和过期字款、独立会话容量回收、损坏字形隔离与缓存释放的自动化验证；渲染失败不会驱逐已有成功图片。
- UI 暂停调整：桌面应双击字体卡片进入二级页面，并复用一级页面右侧栏；移动应从字体详情进入三级页面。现有桌面弹窗原型不作为导航验收通过的依据。
- 目标设备人工验收继续保留待验收状态；本轮不以核心测试或主机编译替代这些结果。

## 实现范围

- 已有 UI 原型继承当前字款、来源与轴值。Windows/Linux 使用同一 React/HeroUI 实现；macOS 使用 SwiftUI；Android、iOS/iPadOS 使用现有原生导航与共享 RN 页面。桌面入口与二级导航待按上述要求调整。
- 实际编码 Unicode 单字符按码点升序排列。默认每页 256 项，支持单字符或 `U+XXXX` 精确搜索、脚本筛选、轴值调整、放大查看及复制字符/码位。多个码点映射到同一 Glyph ID 时仍保留各条目。
- 桌面和宽屏 iPad 使用网格加详情区；手机在网格下显示详情。页面关闭保留父级字体库与详情状态。
- 网格只挂载可见及邻近内容；Rust 图片 LRU 缓存预算为 32 MiB，估算包含传输字符串与解码像素。关闭释放句柄与对应缓存，解析/渲染不持有字体库锁，客户端丢弃过期请求结果。
- 新文案登记在根目录 `locales/`。单色字形使用当前主题前景色，彩色字形保留原色和透明度；空白字符保留元数据，不借用其他字体。

未编码字形、连字、ZWJ/变体序列、WOFF/WOFF2、Unicode 名称检索、调色板编辑和字形导出不在范围内。

## 共享接口

`folio-core::CharacterMapIndex` 只解析字体字节与 collection face index，不依赖平台 API。`folio-render::CharacterMapService` 管理只读快照与 PNG 渲染；UniFFI、Tauri 和 Expo 传递同一 camelCase JSON 契约，TypeScript 定义位于 `shared/character-map.ts`。

| 操作 | 输入 | 输出 |
| --- | --- | --- |
| `openCharacterMap` | `faceId`、`revisionId`、`sourcePath` | `handle`、revision、来源、face index、字符数及脚本统计 |
| `queryCharacterMap` | `handle`、`text`、`script`、`offset`、`limit` | 有序 `entries`（`codepoint`、`glyphId`、`script`）、总数及 offset；默认 limit 256，上限 1024 |
| `renderCharacterMap` | `handle`、`glyphIds`、`axes`、`size`、`foreground` RGBA | 按请求顺序返回 PNG data URL，状态为 `ready`、`empty` 或 `error` |
| `closeCharacterMap` | `handle` | 释放会话；重复关闭安全 |

打开必须使用目录中登记的来源和 revision，完整文件 hash 核验后绑定快照。后续请求检查文件可读性、大小、修改和创建时间，拒绝检测到的删除/替换，不重新选择来源。时间及大小均被刻意保留的原地篡改不做逐请求完整 hash；打开时始终完整校验。请求退出后，正在执行的渲染在字形边界检查关闭状态。

错误键区分未下载、来源不可读、版本变化、字体损坏、输入无效、轴值无效、会话关闭和渲染失败；无匹配字符返回空页。单字形损坏只返回该项错误，失败图片不缓存，可单独重试。云端未下载时复用各端已有下载入口。

渲染固定使用 Vello CPU `0.3.0`、resvg `0.48.1`、image `0.25.10`。SVG 禁用系统字体与文件/网络路径解析，仅允许字体内嵌资源；支持 SVGZ、当前前景色和首个 CPAL 调色板变量。字体文件上限 512 MiB，单次渲染最多 256 字形、图片边长 16–1024；内嵌资源限制编码/解压大小、像素尺寸及总资源预算。

## 自动化验证

| 范围 | 样本及断言 | 结果 |
| --- | --- | --- |
| Core 映射 | TTF、CFF OTF、混合 TTC/OTC 非零成员，cmap 6/10/12/13，131,072 个别名映射分页，非 BMP、U+10FFFF、私用区、组合和空白字符，脚本与精确搜索 | 通过：5 项集成测试及搜索/分页单元测试 |
| 轮廓及变量 | Lato、Source Serif、Inter，指定 Glyph ID、语义前景色、透明背景、空白字形、轴值改变像素及越界轴拒绝 | 通过 |
| COLR v0/v1＋CPAL | 上游 font-test-data 彩色、变量和渐变样本，保留颜色与透明度，放大后存在多种渐变色 | 通过 |
| CBDT/CBLC | 上游嵌入 PNG 样本及构造 BGRA 样本，像素与 alpha | 通过 |
| sbix | Noto 样本及构造 PNG/JPEG/TIFF/dupe，重复字形像素一致，保留定位 | 通过 |
| EBDT/EBLC | 构造单色掩码、复合字形、循环引用，前景色/alpha 与损坏隔离 | 通过 |
| OpenType SVG | 构造内嵌 SVG、半透明、CPAL 变量与回退色、损坏字形隔离、外部文件资源不读取 | 通过 |
| 快照与缓存 | 来源不匹配、替换/删除、关闭句柄、独立会话与容量回收、32 MiB 驱逐与关闭释放 | 通过：渲染 crate 共 14 项集成测试、1 项缓存单元测试 |
| 桥接输入边界 | JSON 默认分页与 camelCase 字段、图片尺寸/批量/Glyph ID/轴值上限，无效 JSON、目录中已不存在的字款、关闭后查询 | 通过；真实 Swift 四项绑定调用另见下方执行记录 |
| 桌面页面 | 256 项页只挂载邻近行、非 BMP 精确搜索、关闭释放 | 通过；前端全套 85 项测试 |
| 移动会话 | 打开中退出后释放迟到句柄；分页、非 BMP、轴值和前景色原样传递 | 通过；移动全套 58 项测试 |

执行记录：

- `cargo test --workspace --locked`：268 项通过，3 项既有测试按原配置忽略。
- `cargo clippy -p folio-render --all-targets --locked -- -D warnings`：通过；`cargo fmt --all --check`：通过。
- `cargo test --manifest-path apps/desktop-ui/src-tauri/Cargo.toml --offline`：通过；主机为 macOS，不能替代 Windows/Linux 运行验收。
- `pnpm --dir apps/desktop-ui typecheck`、`lint`、`test`、`build`：通过。构建保留现有大 chunk 提示。
- `pnpm --dir experiments/mobile typecheck`、`lint`、`test`：通过。
- `pnpm --dir experiments/mobile test:swift`：通过，包含真实字体的字符表四项绑定调用、默认分页、精确搜索、PNG 签名、非零 TTC 成员、变量轴与关闭后拒绝查询。
- `pnpm i18n:validate`：通过，2 种语言、899 个源字段；`pnpm i18n:build`：通过。
- `pnpm --dir experiments/mobile bindings`：生成 Swift/Kotlin 绑定；移动生成产物沿用仓库忽略规则。
- `pnpm --dir experiments/mobile rust:android`：arm64-v8a、x86_64 通过；`rust:ios`：arm64 设备与模拟器 XCFramework 通过。

核心收尾复核：最终源码重新通过上述 268 项 Rust 测试、渲染 Clippy、Tauri 主机测试、更新后的 FFI 动态库与 Swift 冒烟验证，以及 Android 双 ABI、iOS 设备/模拟器 Rust Release 编译。下方原生应用与页面运行证据来自本轮此前的构建；本次 UI 暂停后不另作页面验收结论。

## 平台验收

| 平台 | 构建与运行证据 | 未完成验收 |
| --- | --- | --- |
| macOS | Xcode Debug 构建通过；本机运行进入 `.Aqua Kana` 字符表，显示 13,250 个字符、52 页，选择 U+0041 放大，精确搜索与复制码位通过，返回仍选中原字族；最终构建实测 192.1 MB 系统 Apple Color Emoji 的 U+1F600，网格与放大预览颜色、透明背景和 Glyph ID 2096 正确 | 完整浅深色、VoiceOver、键盘及所有彩色格式的人工对照 |
| Windows | 共享 React 页面与 Tauri 后端已接入；主机测试通过 | 缺少 Windows 设备，安装包与实际运行待验收 |
| Linux | 共用 React/Tauri 实现 | 缺少 Linux 环境，WebKitGTK、打包与实际运行待验收 |
| Android | Release APK 构建通过；Rust 双 ABI 构建通过 | Pixel 10 / Android 37 模拟器在初始化图形后崩溃，切换软件渲染仍失败，未连接到 ADB；页面实际运行及物理设备、TalkBack、减少动态效果待验收 |
| iOS/iPadOS | Rust arm64 设备/模拟器库及 Release 模拟器应用构建通过；iPhone 18 Pro 与 iPad Pro 13-inch (M5) / iOS 27 安装及启动命令成功；Swift 主机桥接验证通过 | Device Hub 窗口读取出现 `noWindowsAvailable` / `cgWindowNotFound`，未完成字符表页面操作；iPhone/iPad 物理设备、VoiceOver、安全区域与横竖屏待验收 |

通用待验收：真实云端断网/下载重试流程、目标设备连续切换字款/轴值及退出的压力测试、运行内存与大型字体滚动性能。自动化验证不能替代这些设备结果。

首次通用 iOS Simulator 构建请求了 arm64 和 x86_64，仓库 XCFramework 只含 arm64 模拟器切片，因此失败；本轮限定 `ARCHS=arm64 ONLY_ACTIVE_ARCH=YES` 进行现有支持范围的验证，不声明 x86_64 模拟器支持。

模拟器并行运行时，前端已有用例出现 5 秒超时；释放模拟器资源后以 `pnpm --dir apps/desktop-ui test --maxWorkers=2` 重跑，85 项通过。没有为资源压力修改测试超时阈值。

收尾已核查进程与监听端口：本任务的应用、模拟器、开发/预览/测试服务器均已退出，无遗留构建进程；保留用户已有应用与 ADB 服务。
