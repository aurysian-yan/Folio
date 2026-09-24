# Folio 项目开发计划

> 本文汇总 Folio 的产品目标、阶段依赖和当前仓库进度。已完成内容以仓库阶段报告为准；规划内容不代表已实现。平台优先级采用产品规划中的最终顺序：macOS、Android、Windows、iOS/iPadOS、Linux。

## 1. 产品目标

Folio 是一款跨设备字体资产管理工具。用户可以从本地目录或单个字体文件建立字体库，查找、预览和整理字体，并在支持的平台上将字体临时启用或持久安装。未来还将支持 WebDAV/123PAN 同步、离线访问，以及移动端文件提供与导出。

Folio 管理的字体资产范围不等于操作系统可安装的字体范围。首期以 TTF、OTF、TTC、OTC 为主；WOFF 和 WOFF2 计划放在 v2，与 Linux 版同期推进。即使某种格式不能由目标操作系统直接安装，也应能在 Folio 中识别和管理。

## 2. 已确定的产品与技术决策

### 平台顺序

| 优先级 | 平台 | 技术栈 | 产品重点 |
| --- | --- | --- | --- |
| P0 | macOS | SwiftUI，必要时使用 AppKit；Rust 通过 UniFFI 接入 | 主力桌面字体管理、系统字体操作、开发目录刷新 |
| P1 | Android | Kotlin、Jetpack Compose、MIUIX；Rust 通过 UniFFI 接入 | 随身字体库、WebDAV、离线访问、向其他应用提供字体、USB/SAF 导出 |
| P2 | Windows | Tauri 2、React、TypeScript；Rust crates 由桌面宿主直接依赖 | 桌面字体库、Explorer 批量打开、Windows 字体操作 |
| P3 | iOS/iPadOS | SwiftUI；Rust 通过 UniFFI 接入 | 字体浏览、同步、离线访问和 Files/Share 工作流 |
| P4 | Linux | 复用 Tauri/React 桌面 UI，增加 Linux 平台适配 | v2 桌面支持；与 WOFF/WOFF2 计划同期推进 |

平台排序表达产品优先级，不意味着各平台必须共享原生控件。库数据、身份、搜索和筛选语义由 Rust 共用；平台 UI 与操作系统字体服务由各自客户端适配。

### 导入、收集、启用与安装

这些操作必须在领域与 UI 中保持不同含义：

- **添加文件夹**：把用户目录作为来源引用，后续可刷新；不复制文件。
- **收集到 Folio**：将选中的文件复制到 Folio 管理的库中，原位置可移除或离线。
- **启用字体**：临时向当前用户会话注册字体。
- **安装字体**：按平台支持的范围持久安装到系统或当前用户环境。
- **收集并启用**：先将文件纳入 Folio 管理，再执行启用。

Finder/Explorer 的批量打开是正式导入入口：用户可一次选择多个字体，Folio 汇总格式检查、重复项和冲突，再提供清晰的批量操作结果。不要把路径引用与托管副本混为一谈，也不要静默覆盖或删除字体。

### 桌面前端基线

macOS 使用原生 SwiftUI，只有必要时才通过 AppKit 补足系统能力。Windows 与 Linux 共用 React/TypeScript 页面，由 Tauri 2 承载；沿用仓库确定的 Vite、HeroUI v3 与 Tailwind CSS v4 依赖基线。开始 Windows UI 前先审计并复用已有脚手架，不重建或替换项目选定的组件库。

Android 使用 Kotlin、Jetpack Compose 与 MIUIX；iOS/iPadOS 使用 SwiftUI。各客户端都调用同一套 Rust 领域和查询语义，不能在 UI 中另写一套字体匹配规则。

## 3. 架构边界与长期约束

- `folio-core`：字体解析、身份/修订、领域模型和与平台无关的字体数据；不依赖 SQLite、UI 或系统字体 API。
- `folio-storage`：SQLite、持久用户状态和可重建的字体目录缓存。
- `folio-query`：共用的搜索、范围、排序、Facet 与冲突摘要语义。
- `folio-ffi`：macOS、Android、iOS/iPadOS 的 UniFFI 接口。
- Tauri 宿主：Windows/Linux 的 Rust 命令边界与平台适配。
- 平台客户端：呈现状态、收集输入并调用共享能力；CoreText、Windows 字体 API、fontconfig 等系统调用留在平台适配层。
- `FontIdentityId` 是收藏、最近项目和收藏夹等长期用户状态的锚点；`FontRevisionId` 表示具体二进制修订；`FontFaceId` 是当前目录中的具体物化记录，不作为长期用户数据引用。
- 路径属于来源上下文，不构成字体身份或内容指纹。
- 用户数据与可重建目录缓存分开保存。刷新、根目录离线或重建缓存不得悄悄抹掉收藏夹、收藏和最近项目。
- 收藏夹图标在共享数据中保存跨平台语义键，不保存 SF Symbols 名称；macOS 与 React 客户端分别映射到本平台图标。
- Facet 在单一分组内按 OR 组合、不同分组间按 AND 组合；同一次跨分组匹配必须落在同一个具体 Face 上。
- 生产 UI 只展示实际后端状态。未接入的云同步、配额、安装等能力不得用设计稿示例数据冒充真实状态。

## 4. 当前仓库基线

| 阶段 | 当前状态 | 依据 |
| --- | --- | --- |
| 阶段 1：Rust 字体核心 | 已完成 | `PHASE1_REPORT.md` |
| 阶段 2A：持久化与增量目录 | 已完成 | `PHASE2A_REPORT.md` |
| 阶段 2B：用户状态、元数据与查询 | 已完成 | `PHASE2B_REPORT.md` |
| 阶段 3A：macOS App、UniFFI 与真实目录加载 | 已完成 | `PHASE3_UI_REPORT.md` |
| 阶段 3B：macOS 字体库 UI | 已完成 | `PHASE3_UI_REPORT.md`，结论为可进入 macOS 字体操作阶段 |
| Windows/Linux 前端 | 只有依赖基线 | 尚无完整 Tauri 页面与生产流程 |
| WebDAV/123PAN | 未实现 | 规划能力 |
| 字符表 | 本计划新增的跨平台阶段 | 尚未实现 |
| Android、iOS/iPadOS、Linux 客户端 | 未实现 | 后续平台计划 |
| WOFF/WOFF2 | 未实现 | v2，与 Linux 版同期规划 |

收藏夹图标选择与创建后的编辑/重命名属于当前 macOS Library UI 的功能收尾，不代表 Windows、Android 等客户端已具备对应 UI。

## 5. 开发阶段

### 阶段 1：Rust 字体核心（已完成）

建立不依赖 UI 的字体目录基础：TTF/OTF/TTC/OTC 解析、Face 与 Family 聚合、身份和修订、基础分类、扫描诊断与 CLI。具体格式覆盖和已知限制以 `PHASE1_REPORT.md` 为准。

**完成门槛：**报告中的解析、身份、聚合和诊断结果可由实际源码与记录的验证结果支持；不将平台注册或界面逻辑放入 Core。

### 阶段 2：本地持久化与查询（已完成）

#### 2A：持久化与增量目录

使用 SQLite 保存 Library Roots 和可重建缓存，支持增量刷新、显式重建、不可用目录处理和事务安全。缓存重建不能删除持久用户数据。增量快路径的保证与限制见阶段报告。

#### 2B：用户状态、元数据与查询

持久化扁平收藏夹、收藏和最近项目；补充许可、厂牌、文字系统、分类和 OpenType 特征元数据；提供统一搜索、范围、Facet 和冲突分析。收藏夹成员等长期引用使用 `FontIdentityId`。

**完成门槛：**保持 2A/2B 报告记录的数据保留、迁移、查询和冲突语义；未来平台只消费同一套 Rust 查询结果。

### 阶段 3：P0 macOS 主力客户端

#### 3A：App 与数据边界（已完成）

维护 SwiftUI App target、UniFFI repository 边界、真实字体目录加载和应用状态。缓存读取与后台刷新通过同一 Rust 存储，不建立 Swift 专属目录模型。

#### 3B：字体库浏览界面（已完成）

维护原生侧栏、工具栏、搜索、Facet、浏览模式、字体预览、Inspector 与底部预览栏。收藏夹接入 Rust 持久化状态；图标使用共享语义键映射到固定英文形态 SF Symbols。收藏夹应支持创建后编辑名称与图标，保持原 `CollectionId` 和成员关系。

#### 3C：字符表（跨平台功能，紧接字体库基础之后）

为选定的具体字体 Face 提供字符表页面。这是一个横跨 macOS、Windows 和 Linux 的能力，不作为单独 macOS 小工具；Windows 与 Linux 共用同一 React/Tauri 页面和数据契约。Android/iOS 后续可使用同一映射接口实现适配自身屏幕的字符浏览。

共享能力与行为：

- Rust 从选中 Face 的 `cmap` 枚举 Unicode 标量、Glyph ID 和共享文字系统分类，按码点稳定排序并分页；根据真实来源与 TTC/OTC face index 定位正确成员。
- UniFFI 与 Tauri 暴露同一数据、错误和搜索/过滤语义；前端不得自行解析 cmap 或自行推断文字系统。
- 支持按单个字符或一个 `U+` 码点查找，并按接口提供的文字系统筛选。第一版不包含未编码 glyph、连字塑形或多码点序列浏览。
- 从字体详情入口进入独立字符表页面；返回时保留原字体库查询、筛选与选中项。页面提供字体/字样式上下文、搜索、文字系统筛选、按需加载的自适应网格；选中后显示较大字形、码点、Glyph ID，并可复制字符和 Unicode 值。
- 对加载、空映射、无匹配、来源离线/不可读、损坏文件提供真实且可恢复的状态。

平台验证：

- macOS 使用 CoreText 或经过验证的本地字体渲染方式，准确对应来源与 collection face index，不要求先安装字体。
- Windows 和 Linux 使用同一个 React 页面。先验证 WebView2 与 WebKitGTK 是否能准确加载本地字体、处理非零 collection face index 和可变轴；如果无法保证显示的是选中 Face，评审宿主侧预览适配，不得静默回退到系统中的相似字体。
- Linux 虽然整个客户端排在 P4，字符表的契约与 React 页面从设计之初就纳入 Linux；进入 Linux 阶段时必须在真实 Linux/WebKitGTK 环境完成验证，不能用 Windows 或 macOS 构建代替。
- 各平台的字形栅格像素可以不同，但映射、选择的 Face、轴值和回退行为要一致。

**完成门槛：**Rust 映射和跨端搜索/筛选结果一致；Windows 与 Linux 都验证实际字体来源和准确 Face 呈现；分页、大型 cmap、变量字体、collection member、键盘与读屏操作及明暗外观状态均有可复核结果。

#### 3D：macOS 字体操作与批量导入

实现 macOS 平台适配上的字体启用/停用、持久安装/卸载和安全恢复流程；Core 仍只提供平台无关的数据。

- 支持 Finder 中多选 TTF/OTF/TTC/OTC 后用 Folio 打开；一次接收整批路径，展示格式、重复项和冲突摘要。
- 在导入流程中区分添加目录、收集副本、临时启用、持久安装，以及组合操作；明确操作范围与逐项失败结果。
- 对已打开的应用提供文件重新打开/转交能力，避免重复启动造成多份导入流程。
- 使用合适的 macOS 系统 API 执行平台操作；每项结果对应具体文件和身份。卸载或覆盖类动作须可理解、可恢复，并明确会移除什么。

#### 3E：macOS 刷新与产品化

在已完成目录和操作基础上增加受控的文件系统监测、开发目录刷新与字体版本变化呈现；完善不可用根目录恢复、诊断入口、设置、启动与 Finder 工作流。监测事件应合并处理，避免重复全库扫描或覆盖用户状态。云端状态仅在同步后端存在时呈现。

**阶段 3 完成门槛：**macOS 端的本地浏览、收集、启用/安装和刷新流程来自真实数据，错误可恢复；平台 API 不进入 Core。

### 阶段 4：共享云同步基础（为 P1 Android 提供依赖）

在本地身份、修订、收藏夹与冲突基础稳定后，实现 WebDAV/123PAN 的共享同步能力，为 Android 的主要使用场景提供支持，同时允许其他桌面平台后续复用。

- 定义连接、认证、远端目录、上传/下载、离线副本与同步状态；凭据放在平台安全存储中。
- 处理中断、重试、取消、空间不足、远端不可用和增量同步；状态与数量必须来自真实服务响应。
- 根据身份、修订和来源识别远端新增、本地新增、多版本和命名冲突；任何覆盖/删除都需明确的用户选择，默认保留可恢复副本。
- 网络提供商逻辑不放进 `folio-core`；将通用同步状态与具体 WebDAV/123PAN 适配隔离。

**完成门槛：**断网时本地库仍可使用；连接恢复后可继续同步；认证与同步失败可恢复；冲突可由用户做出可逆选择。

### 阶段 5：P1 Android 随身字体库

使用 Kotlin、Jetpack Compose、MIUIX 和 UniFFI 接入同一 Rust Core，并消费阶段 4 的云同步能力。

- 提供字体库浏览、搜索、收藏夹、收藏/最近、预览、离线保留和 WebDAV/123PAN 访问。
- 提供 Android `DocumentsProvider`，将本地、收藏夹及可下载的云端字体以 `content://` URI 暴露给其他应用；按需读取云端文件并正确授予临时访问权限。
- 兼容 `ACTION_GET_CONTENT`。国产定制 ROM 的文件选择器可能由厂商应用呈现，不能假定它一定展示第三方 DocumentsProvider；标准 Provider 作为主路径，并提供自有字体选择 Activity 作为兼容入口，按真实 ROM 验证，避免不必要地重复注册造成 Picker 重复项。
- 支持 SAF/USB 工作流，将收藏夹或选择的字体导出到外部存储。明确“文件可访问”不等于“可注册为 Android 系统字体”。

**完成门槛：**在标准 Android Picker、至少目标国产 ROM Picker 与 Photo Editor/`GET_CONTENT` 调用流程中验证 URI 授权、云端按需下载、离线行为及 U 盘导出。

### 阶段 6：P2 Windows 桌面客户端

从仓库现有 Tauri/React 依赖基线起步；先审计版本、目录、命令和构建配置，再实现，不重建脚手架。

- `src-tauri` 直接依赖 Rust workspace crates，提供边界清晰的 Tauri 命令和平台操作适配。
- 使用 React、TypeScript、HeroUI v3 与 Tailwind v4 实现与 macOS 共用的 Library 信息架构、查询语义和字符表页面；交互遵循 Windows 桌面习惯。
- 支持 Explorer 多选字体后以 Folio 打开、单实例文件路径转交、导入分析与收集流程。
- 实现 Windows 平台字体启用/安装适配，明确权限、操作范围和恢复；系统级行为不进入 `folio-core`。
- 复用阶段 4 的云同步和阶段 2 的本地数据模型。

**完成门槛：**真实 Windows 构建与运行验证本地库、批量打开、字符表准确 Face 渲染、平台字体操作和查询一致性；不能把仅有依赖或 macOS 上的前端构建称为 Windows 完成。

### 阶段 7：P3 iOS/iPadOS 客户端

使用 SwiftUI 和 UniFFI，复用 Rust 查询、目录与同步语义，重点支持字体库浏览、搜索、预览、离线使用、WebDAV、Files/Share 导入导出。系统字体安装能力须单独按 Apple 平台规则评估，不把 macOS 能力直接照搬到 iOS/iPadOS。

**完成门槛：**Files/Share 与同步流程在真实设备上验证；离线数据可预期；平台能力边界对用户明确。

### 阶段 8：P4 Linux 与 WOFF/WOFF2（v2）

Linux 桌面与 WOFF/WOFF2 均按 v2 规划同期推进。Linux 复用 Windows 的 Tauri/React 页面，增加 Linux 字体服务、打包、权限、桌面环境和 WebKitGTK 适配；字符表必须在 Linux 真实环境验证。

WOFF/WOFF2 首期目标为 Folio 内部识别、目录管理、预览、搜索、收藏夹与同步，不等同于系统安装。评估从 Web Font 容器恢复本地桌面字体文件的可行性和授权呈现；该转换/恢复操作在单独明确范围前不视作必需交付。

**完成门槛：**在目标 Linux 发行环境验证 Tauri/WebKitGTK、fontconfig 适配、安装包和本地目录流程；WOFF/WOFF2 有合法测试样本、格式/元数据/预览验证，且 UI 明确显示不可直接系统安装的能力边界。

## 6. 所有阶段的交付要求

1. 开始阶段工作前阅读 `AGENTS.md`、相关阶段报告和架构文档，检查 Git 状态并保留无关审计改动。
2. 每阶段限定范围；未接入的后端不得作为真实生产状态展示。
3. 保持 Core/Storage/Query/FFI/Tauri/平台 API 的边界，不在多个 UI 中重复实现查询语义。
4. 依照仓库要求验证修改过的部分；跨平台能力必须在对应操作系统或 CI runner 实测，不能用单平台构建推断。
5. 阶段报告记录实际执行过的命令与结果，并区分已验证行为、假设和遗留限制。
6. 每个阶段形成一个可审查的交付节点，再进入下一阶段；不提前扩展未列入阶段的产品功能。

## 7. 当前执行顺序

1. 完成 macOS 收藏夹创建后的名称和图标编辑，并保持身份与成员数据不变。
2. 完成跨平台字符表的交互设计与字体渲染可行性验证，重点确认 Windows WebView2 和 Linux WebKitGTK 的准确 Face 渲染路径。
3. 完成 macOS 字体操作、批量导入和本地刷新产品化。
4. 建立 WebDAV/123PAN 同步基础，再推进 P1 Android 与其 Provider/Picker/USB 场景。
5. 推进 P2 Windows，复用共享 Rust 能力及 Tauri/React 基线。
6. 推进 P3 iOS/iPadOS。
7. 在 v2 推进 P4 Linux，并同期完成 WOFF/WOFF2 管理与预览能力。
