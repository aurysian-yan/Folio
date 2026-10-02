# Mobile Foundation Validation

日期：2026-09-30。当前基线提交 `75869e7`；本次范围是路线图 D 的隔离基础工程，不是阶段 D 全部通过或阶段 E 正式移动客户端。

## Android Navigation Implementation

2026-09-30，底栏已接入 Expo `FolioNavigation` 模块，采用 Nexio 固定提交
`291e8b9b57c8f331d8f189c52553f41dfd0ce017` 的均衡材质与弹簧参数。
RN 页面通过独立 RenderNode 提供背景；来源和许可见
[源码记录](modules/folio-native/android/third-party/NOTICE.md)。

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS，未引入新 JS 依赖。 |
| `pnpm typecheck`、`pnpm lint` | PASS。 |
| Android `:app:assembleDebug` | PASS，新模块已进入 Expo 注册列表，生成 Debug APK。 |
| Android Expo export | PASS，生成 Hermes 包。 |
| 许可随 APK 打包 | PASS，包含六份许可原文及版权文件。 |
| 安装与启动 | 2026-10-01，USB 真机开发包安装及 MainActivity 启动命令通过；完整运行验收仍待完成。 |
| 交互、视觉、性能及旧版本验收 | 按用户要求留待后续，本轮未执行测试套件。 |

API 28–30、31–32 和 33+ 的效果分级已实现，运行表现尚未分别验证。

2026-10-01：拖动弹簧采用阻尼比 `0.65`、刚度 `5000`，左右边距各减少 4dp，底部距离增加 8dp，列表留白同步调整。
`pnpm typecheck`、`pnpm lint` 和 Android `:app:assembleDebug` 通过，已更新真机开发包。

2026-10-01：连续拖动改为按本次手势的完整位移计算，松手吸附使用同一目标；移动动画只保留最新任务，新手势取消上一轮移动及释放动画。
`pnpm typecheck`、`pnpm lint` 和 Android `:app:assembleDebug` 通过，已安装至 API 36 真机。
ADB 在已加载界面连续执行三次横向拖动（300ms、120ms、120ms），截图确认依次从设置到本地、从本地到设置、从设置到本地，均跨过全部菜单项并切换对应页面；手指操作的主观阻尼感及完整交互验收仍待确认。

2026-10-01：拖动位置改为同步状态更新，移除拖动过程中的位移弹簧；点击及松手后继续使用原有吸附弹簧，按压形变和折射保留。
Android `:app:assembleDebug` 通过，已更新 API 36 真机开发包。ADB 注入持续按下的触摸，依次移动到 x=310 和 x=540，截图确认滑块停留在菜单项之间，页面在松手前保持本地；松手后吸附到最近项。完整测试套件仍按用户要求留待后续。

## Android Progressive Header Blur

2026-10-01：标题栏接入 MeiloX 固定提交的双通道渐进式模糊，复用 RN RenderNode 背景源；列表滚入状态栏和标题栏下方，初始内容位置保持一致。滚动前 56dp 原生驱动材质淡入，底部保留 34dp 渐隐区，标题和操作按钮保持清晰。来源及许可见 [源码记录](modules/folio-native/android/third-party/NOTICE.md)。

`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、Android `:folio-native:compileDebugKotlin` 和 `:app:assembleDebug` 通过。已保留应用数据更新 API 36 真机开发包，截图确认浅色与深色的滚动背景模糊、底边过渡和清晰前景；搜索框可正常展开并显示键盘。检查后系统夜间模式恢复原来的自动设置。

API 31–32 的系统模糊渐隐与 API 28–30 的主题材质已实现，旧版本设备及性能压力测试未执行。

2026-10-01：修复视图菜单打开后按钮淡出、弹层内容持续透明的问题。Popup 插入后主动请求宿主原生布局与绘制，确保锚点坐标完成分发，解除 Compose 未完成定位时的透明保护。Android `:app:assembleDebug` 通过，已更新 API 36 真机；确认深色首次展开、滚动后再次展开、列表选择与恢复网格、浅色展开、菜单打开期间切换深色及关闭后重新打开均正常。系统夜间模式恢复原来的自动设置。

2026-10-01：视图、搜索、导入及关闭搜索按钮接入背景模糊与拖动形变，松手使用现有弹簧回弹。按钮拖动超过系统触摸阈值后消费移动事件，拖回起点也不提交点击；标准键盘与无障碍点击继续由 Compose 处理。按钮尺寸和描边沿用原样，宿主取消绘制裁切，允许形变轮廓越过按钮原边界。Android `:app:assembleDebug` 与 `git diff --check` 通过，已保留数据更新 API 36 真机。深色视图按钮按住拖动与拖回起点释放已确认形变、回弹且未展开菜单；后续检查时真机正在使用其他应用，已停止触摸注入并恢复系统自动夜间模式。裁切修正后的外观、其余按钮交互及浅色效果仍待运行确认。

## Batch Font Import

2026-10-01：修复显式文件来源的扩展名过滤，双端导入桥接改为 `importFonts(files)`，支持系统多选、ZIP、流式 SHA-256 去重及逐项报告。继续使用托管副本、既有 Rust 校验和数据库接口；未改变 Rust ABI 或数据库结构。

| 检查 | 结果与实际范围 |
| --- | --- |
| Rust 回归 | PASS，`cargo test -p folio-storage -p folio-ffi --locked`；新增 `.font`、无扩展名、错误扩展名的显式来源与重新打开回归，目录过滤保持原规则。`cargo fmt --all -- --check` 通过。 |
| JS 验证 | PASS，`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、`pnpm test`；8 项测试覆盖查询边界、批量参数与计数、导入错误与回滚提示。 |
| Android 原生导入 | PASS，`:folio-native:testDebugUnitTest` 的 8 项测试使用生产 Kotlin 导入器与主机 Rust/JNA 临时数据库；覆盖部分失败、同名不同内容、同批与跨批去重、收藏持久化、旧 `.font` 恢复、TTC 非零成员、可变轴、Stored/Deflate、中文子目录、说明文件、嵌套包忽略、空包、CRC、加密标记、不安全路径、实际流大小与数量限制、刷新失败回滚及临时文件清理。 |
| Swift 原生导入 | PASS，`pnpm test:swift`；原有 Swift ↔ Rust 冒烟及新增 6 组生产导入器场景通过，覆盖批量、ZIP、内容去重、逐项失败、资源限制、收藏保留、刷新回滚与临时文件清理。ZIPFoundation 固定为 0.9.20。主机验证不等于 iOS 实机验收。 |
| Rust 库与开发包 | PASS，`pnpm bindings`、`pnpm pods`、`pnpm rust:android`、`pnpm rust:ios`、Android `:app:assembleDebug` 和 iOS arm64 Simulator Debug `xcodebuild`；已更新 Android 真机及 iPhone/iPad 模拟器开发包。 |
| Android 已有来源恢复 | PASS，USB 真机 `23013RK75C`（Android 16 / API 36）保留应用数据更新、重启初始化后，沙盒数据库原有三个 `.font` 来源均为 `parsed`，无需重新导入或重建数据库；核对时 39 个来源全部已解析。 |
| iPhone Files | PASS，iOS 27 iPhone 18 Pro 模拟器的一批 63 项结果显示成功 42、重复 7、失败 14；结果明细可打开，刷新查询后汇总仍可见。 |
| iPad Files 与 ZIP | PASS，iPadOS 27 iPad mini 模拟器的工具栏入口：含中文子目录字体、损坏字体和说明文件的 ZIP 返回成功 1、失败 1；同时多选原字体和该 ZIP，返回成功 0、重复 2、失败 1，明细展示压缩包名与条目路径；字体库仍为 2 个托管文件、1 个字体家族，临时目录为空。取消选择不产生错误并保留原报告。 |

默认边界保持单字体 64 MiB、单 ZIP 256 MiB、每包 10,000 条目、每批 1,000 字体、字体读取与解压总量 512 MiB。资源限制测试使用缩小的内部测试额度，验证实际字节检查与清理逻辑；没有在设备上生成全部上限体积的压力样本。

Android 原生结果界面的完整交互、所有字体的真机预览与再次冷启动、iOS 实机 Files/iCloud 文件读取和性能压力测试仍待验收。本轮 iOS 设备 slice 已构建，未进行实机签名、安装或运行；阶段 D 仍为 PARTIAL。

## Realtime Filters and Manual Collections

2026-10-01：接入移动端实时筛选、星标范围及手动收藏夹；Swift/Kotlin 继续使用既有 Rust 查询与成员接口，没有修改 Rust ABI、数据库结构或 JS 依赖。智能收藏夹、最近历史与云同步不在本轮范围。

| 检查 | 结果与实际范围 |
| --- | --- |
| JS 检查 | PASS，`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、`pnpm test`；12 项测试覆盖查询透传、取消、facet 合并、零匹配保留、完整成员身份与失败结果。 |
| Swift ↔ Rust | PASS，`pnpm test:swift`；新增生产映射器场景覆盖九种 facet、同组并集、跨组交集、完整身份星标、收藏夹样式更新、重复加入、移出、删除及重新打开后的持久化。沿用真实临时数据库与仓库字体样本，主机测试不代表 iOS 实机验收。 |
| Kotlin ↔ Rust | PASS，`:folio-native:testDebugUnitTest`；新增映射器 2 项测试通过，原生导入器 8 项回归通过。使用主机 Rust/JNA 与临时数据库，验证条件组合、映射字段、非法范围和收藏夹完整生命周期。 |
| 双端构建 | PASS，Android `:app:assembleDebug`（arm64-v8a / x86_64）、iOS arm64 Simulator Debug `xcodebuild`，以及更新后的 Android/iOS Hermes export。 |
| iPhone 界面 | PASS，iOS 27 iPhone 18 Pro 模拟器确认筛选选择立即更新匹配数，类型多选从 3 增至 4，跨组组合降至 0，取消后恢复；确认范围入口、收藏夹名称输入、38 个图标选项与键盘布局。修复并检查启动画面移除、Sheet 锚点不占用列表、冷启动网格及顶栏留白。 |
| iPad 界面 | PASS，iPadOS 27 iPad mini 常规窗口确认原生分栏、收藏范围 Sheet、星标范围切换及空态，侧栏选择跟随范围更新。 |

本轮没有通过界面创建或删除模拟器中的收藏夹，也没有改变已有星标；持久化与成员变更的验证使用独立临时数据库。Android 当前没有连接设备，尚未执行本轮真机交互；iOS 实机、完整无障碍与压力测试仍待验收。

2026-10-01：移动筛选改为与 SwiftUI/Tauri 相同的可折叠分类卡片及换行标签流。卡片与标签圆角沿用桌面尺寸；标题触摸区和选项按钮至少 44 点高，标签文字从桌面 11 点放大至 14 点，使用既有浅深色语义主题。`pnpm typecheck`、筛选组件 ESLint 及 `git diff --check` 通过；iPhone 模拟器确认九组卡片、展开/折叠、选中标记、厂牌长名称换行与选择后匹配数立即从 21 更新为 3。本次仅更新 React Native 面板，没有重建原生包。

2026-10-01：Android 筛选接入 Gorhom Bottom Sheet 5.2.14，保留应用主题与既有卡片，使用组件内置拖动、遮罩与列表滚动协调。依赖安装、`pnpm typecheck`、`pnpm lint`、Expo 依赖兼容检查、双端 Hermes export 和 Android arm64 `:app:assembleDebug` 通过，已保留数据更新 API 36 USB 真机开发包。Android Studio 镜像确认抽屉呈现、分类展开及向下拖动关闭；本轮没有更改收藏夹或星标。

用户反馈下拉时短暂收缩回弹、列表底部安全区切断滚动后，将 SafeAreaProvider 移到静止的 Modal 根节点，固定抽屉停靠点引用；列表视口延伸到系统导航区，安全区留白放入列表内容底部。类型检查、相关组件 ESLint、Android Hermes export 与 `git diff --check` 通过；真机确认再次打开、下拉与返回键关闭，以及最后分类展开后的滚动和手势条留白。此次修正仅更新 JS，无需再次编译原生包；短暂闪动的连续帧及浅色外观未单独录制验收。

## Smart Collections and Recent Visits

2026-10-01：第三、四批接通移动端智慧收藏夹和最近访问，保留 RN/Expo、Swift/Kotlin 与共享 Rust 边界；未修改 Rust ABI、数据库 schema、同步协议或依赖版本。

- 手机范围入口与 iPad 常规宽度侧栏共用手动／智慧混排，智慧项附动态标记。编辑器沿用桌面「常规／筛选条件」两页、名称、图标网格、颜色与保存／取消；有条件保存为智慧，无条件保存为手动，互转增加明确确认。Android 范围入口复用现有 Gorhom Drawer 与滚动协调，编辑器为居中 Dialog；iOS 保持系统 Sheet。
- 新建继承当前搜索和筛选；在智慧范围内合并保存与临时条件，不保存导航范围、分页或滚动位置。草稿只用于预览查询，保存前不写数据库；动态匹配和计数直接复用 Rust `query_smart_folder`。导入、星标、成员与条件变更后刷新快照和当前查询。
- Android、iPhone 与紧凑 iPad 最近页面复用字体列表、搜索、实时筛选和详情。访问仅由详情打开事件记录，采用卡片代表字款身份；Rust 负责顺序、去重和持久化。返回详情入口保留原页面查询与已加载窗口，手动成员操作使用实际入口收藏夹。

| 检查 | 结果与实际范围 |
| --- | --- |
| JS 与依赖 | PASS，`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、`pnpm i18n:validate`（717 键）和 Expo 依赖兼容检查；未增加依赖。17 项 JS 回归覆盖智慧参数与非法范围、草稿隔离与字段白名单、条件合并、按条件判定类型、互转失败与代表字款访问透传；沿用查询取消、筛选、导入及成员回归。 |
| Swift ↔ Rust | PASS，`pnpm test:swift`；生产映射器与真实临时数据库覆盖智慧空库创建、导入动态匹配、同组并集／跨组交集与搜索拼接、条件编辑、星标刷新、双向互转、独立手动成员保留、JSON 映射与重新打开、删除边界、访问去重、顺序更新及搜索筛选；原有导入、ZIP、TTC 和变量字体回归通过。 |
| Kotlin ↔ Rust | PASS，`:folio-native:testDebugUnitTest`，查询映射器 3 项与导入器 8 项通过。新增场景与 Swift 同步，使用主机 Rust/JNA 临时数据库，不代表 Android 真机全部交互验收。 |
| Android 构建与安装 | PASS，`:app:assembleDebug -PreactNativeArchitectures=arm64-v8a`；保留数据安装至 USB 真机 `23013RK75C`，通过开发客户端打开 Metro，镜像确认现有 10 个字体库、预览和范围入口正常。未启动 Android 模拟器。 |
| iOS 原生构建 | PASS，`FolioDev.xcworkspace` / `FolioDev` arm64 Simulator Debug 完整编译与链接。首轮运行发现生成的 Pods 缺少项目已有 AsyncStorage，执行 `pnpm pods` 后重建并确认 iPhone 正常启动；未修改依赖版本，没有卸载或清空应用数据。 |
| Hermes 导出 | PASS，Android/iOS `expo export --platform all`。 |
| iPhone 界面 | PASS，iOS 27 iPhone 18 Pro 模拟器确认启动、单一收藏夹列表区、新建编辑器的「常规／筛选条件」页签、图标网格与键盘、条件草稿输入和取消返回；取消后没有新增收藏夹。最近页显示「最近访问」与专属空态，搜索及筛选入口可见。空库检查不代表有字体时的完整生命周期验收。 |
| Android 界面 | 真机随后在使用其他应用，已停止触摸操作；最终混排列表、Gorhom 范围面板、居中编辑器与最近页面的完整真机交互仍待验收。 |
| iPad 界面 | PARTIAL，iPadOS 27 iPad mini 模拟器保留数据更新后确认正常启动、原生宽屏分栏和最近入口。侧栏行未进入辅助功能树，设备窗口坐标点击返回 `windowNotFoundAtPosition`，本轮未完成最近切页、混排内容与紧凑窗口交互验收。 |

互转、星标与删除回归均使用独立临时数据库；没有通过 UI 改动真机中既有收藏夹或星标。iOS 实机、完整无障碍、旧版系统、分页长列表的位置恢复、压力及性能验收仍待完成，阶段 D 保持 PARTIAL。

## Panel Interaction and Sheet Presentation

2026-10-01：字体库范围移除外层分组卡片，以小标题分区；新建放右上角。编辑页标题居中、左右纯图标按钮，取消和保存使用同一个 44 点原生圆形玻璃容器，禁用状态降低不透明度。手动／智慧项保持混排，卡片侧滑操作提供编辑／删除，并附更多入口与读屏动作。iOS 筛选、字体库、收藏夹和导入结果统一系统 medium／large Sheet；Android 保留 Gorhom 范围面板，使用同尺寸主题胶囊按钮。没有修改 Rust、原生模块或依赖版本。

| 检查 | 结果与实际范围 |
| --- | --- |
| JS 回归与导出 | PASS，`pnpm typecheck`、`pnpm lint`、17 项 `pnpm test`、双端 Hermes export 与 `git diff --check`。共享文案校验通过，720 键。此轮改动限 RN／Expo 控件，没有重复原生构建；上节 Swift/Kotlin 回归与双端构建记录保持原有范围。 |
| iPhone Sheet 与外观 | PASS，iOS 27 iPhone 18 Pro 模拟器确认 medium 半屏系统玻璃、grabber 展开 large、居中标题、单层范围卡片和右上新建。编辑页原生分段轨道可辨识；保存与取消的圆形按钮可见直径一致，均为 44 点。 |
| 收藏夹交互 | PASS，临时空库中新建手动收藏夹并返回选中范围；更多入口展开侧滑操作区，编辑按钮打开预填名称与图标的编辑页，取消返回列表。删除最终提交由上节真实 Rust 临时数据库回归覆盖，本轮未通过 UI 提交删除。 |
| 横向手势 | 待验收。ReanimatedSwipeable 已接入，程序展开侧滑操作确认正常；Device Hub 横向拖动注入在 medium／large 两档均触发卡片点击，尚未用实际触摸确认手势。 |
| Android 与 iPad 外观 | 待验收。本轮未占用正在使用的 USB Android 真机，没有启动 Android 模拟器；iPad、浅色、旧版 iOS、实机材质与完整无障碍验收尚未完成。 |

界面测试只使用 iPhone 开发包的临时收藏夹；结束后恢复测试前数据库，不改变 Android 真机或生产包数据。系统两档呈现参考 [Apple Sheets HIG](https://developer.apple.com/design/human-interface-guidelines/sheets)。

## Cloud Sync Foundation (Batch 5)

2026-10-02：第五批接入既有设置与云端导航，继续使用 RN/Expo、Swift/Kotlin 和共享 Rust；没有重做字体主页、收藏夹编辑器或存储管理。开始时工作区干净；核对前四批的实际实现与既有验证记录后继续开发。

| 前四批核对 | 实际情况 |
| --- | --- |
| 第一批导入 | 已实现双端多选、ZIP、内容去重、TTC 成员及逐项失败；本轮 Swift/Kotlin 原生导入回归继续通过。原有完整设备预览和压力验收边界保留。 |
| 第二批筛选、星标与手动收藏夹 | 已实现九组实时 facet、完整身份星标、成员与样式持久化；本轮移动映射器和共享查询回归通过。 |
| 第三批智慧收藏夹 | 已实现动态条件、编辑、手动／智慧互转；本轮验证实际条件 JSON 的双向同步，未把云端未下载字体加入智慧匹配。 |
| 第四批最近记录 | 已实现详情访问记录、去重与顺序；本轮验证两端事件合并、重新打开和来源恢复后身份状态保留。 |
| 来源恢复与存储 | 原有导入器已能读取旧 `.font` 显式来源，iOS 初始化已有路径恢复；本轮补齐共享目录递归归并、扩展名规范化、资产路径更新及缓存验证后移除旧来源，保留存储页。 |

| 本轮检查 | 结果与实际范围 |
| --- | --- |
| 移动 JS | PASS，`pnpm typecheck`、`pnpm lint`、22 项 `pnpm test`；预设地址、参数校验、安全存储空密码恢复、原生取消、状态读取失败和错误分类。没有引入 JS 依赖。 |
| 文案与格式 | PASS，`pnpm i18n:validate`，735 字段；`cargo fmt --all --check`、`git diff --check`。UI 使用共享语言键；服务器地址右侧直接选「无／123 云盘／坚果云」，复用桌面地址，删除额外 123PAN 说明。 |
| 共享同步与 FFI | PASS，`cargo test -p folio-sync -p folio-ffi`，23 + 9 项；共享 `folio-storage`、`folio-query` 回归通过。UniFFI 新增托管来源恢复与本地范围查询方法，macOS 绑定同步生成；SQLite schema 与 WebDAV 协议保持原样。 |
| 本地双向 WebDAV | PASS，独立回环 HTTP WebDAV 服务与两个临时数据库，实际请求上传／下载字体与事件。移动端旧 `.font` 上传、桌面首次发现自动下载、桌面新增字体回传、星标、手动收藏夹名称／样式／成员、智慧条件和最近顺序均验证；再次同步没有重复导入、文件传输或事件新增。测试注入仅用于回环服务，生产地址仍强制 HTTPS。 |
| 来源迁移 | PASS，旧 `.font` TTF／OTF／TTC（包括非零成员）、嵌套目录、重复目录来源与旧沙盒移动；验证指纹和字体身份后才移除旧副本／来源，保留星标、手动成员和最近记录。坏字体或不被目录扫描支持的来源保留旧副本／来源，不伪造迁移成功。 |
| Swift 原生 | PASS，`pnpm test:swift`；原有真实 Rust 导入、筛选、收藏夹、智慧及最近回归，新增 Keychain 写入／读取／删除、连接重开、密码未进入数据库和来源恢复。安全存储测试在 macOS 主机运行，不等于 iOS 实机 Keychain 验收。 |
| Kotlin 原生 | PASS，`:folio-native:testDebugUnitTest`，11 项生产导入器与映射器回归；主机 Rust/JNA 和临时数据库。 |
| Android 真机安全存储／取消 | PASS，USB `23013RK75C`，Android 16 / API 36 / arm64；独立测试 APK instrumentation 验证 Keystore AES-GCM、私有密文无明文密码、重新打开连接、安全存储损坏错误、替换／删除、Rust 实际取消与断开。测试使用自己的私有数据和随机测试凭据，不操作开发包字体库；保留数据更新开发 APK。没有启动 Android 模拟器。 |
| 交叉库与构建 | PASS，`pnpm bindings`、`pnpm rust:android`（arm64-v8a／x86_64）、`pnpm rust:ios`（arm64 设备／模拟器 XCFramework）、Android Debug App／测试 APK、iOS arm64 Simulator Debug、macOS Debug，以及双端 Hermes export。iOS 设备 slice 构建不代表签名、安装或运行通过。 |
| 桌面回归 | PASS，桌面 React 类型检查、Lint 与 71 项测试；macOS 使用新增共享绑定完整编译。没有更改桌面界面。 |
| Rust Clippy | 严格 `-D warnings` 被既有 `folio-storage/path_codec.rs` 的 `manual_is_multiple_of`／`chunks_exact_to_as_chunks` 和既有同步代码的 `needless_borrow` 阻断。仅允许这三类已有告警后，对 `folio-sync`／`folio-ffi` 全目标检查通过；没有回退或混入无关修复。 |
| iPhone 界面 | PASS，iOS 27 iPhone 18 Pro 模拟器检查云端空态、真实未连接状态、禁用手动同步、设置导航、安全密码字段、地址预设菜单及正确填入 123 云盘地址；未填写凭据或保存测试连接。无效地址测试显示连接错误；已移除 123PAN 说明。 |

原生安全存储真机检查可以从 `experiments/mobile` 执行（设备需已通过 USB 授权）：

```sh
cd android
./gradlew :folio-native:assembleDebugAndroidTest
adb -s 7a287bb6 install -r ../modules/folio-native/android/build/outputs/apk/androidTest/debug/folio-native-debug-androidTest.apk
adb -s 7a287bb6 shell am instrument -w com.folio.poc.test/com.folio.poc.FolioSyncInstrumentation
```

测试 APK 的最终输出为 `PASS: Keystore AES-GCM, private ciphertext, reopen, corruption, cancellation, disconnect, detached Compose measurement`。取消测试针对预留测试地址并立即中断，只验证真实 Rust 取消边界，不代表服务商连通。

实网验收为 **PENDING**：当前没有独立测试 WebDAV 地址和凭据。尚未完成移动应用与桌面应用连接同一真实 HTTPS 服务的完整往返、网络中断及冷启动后实际连接测试；不得把回环服务、主机 FFI 重开或构建通过写作实网成功。iOS 实机、Android 云同步页面完整触摸交互、iPad 云端详情、浅深色全覆盖和旧系统仍待设备验收。

自动同步开关只保存偏好，当前仅手动触发。自动调度和完整删除／恢复／冲突操作留给第六批；阶段 D 仍为 PARTIAL。

2026-10-02 Android 导航复测：初次新 APK 实际更新的是生产包 `com.folio.mobile.poc`，前台 Folio Dev 仍使用旧开发包；核对 applicationId 后重新生成 development 工程，保留数据更新 `com.folio.mobile.poc.dev`。四个 Tab 恢复，字体主页既有 10 个字体、星标和最近状态保留；云端未连接空态、禁用手动同步、云同步配置、123 云盘／坚果云预设地址及缺少安全密码的明确错误均已通过镜像确认。搜索输入退出随后复现离窗 Compose 延迟测量崩溃，故上述页面检查不代表导航整体验收通过。

修复在三个 Compose 宿主离窗时跳过子视图测量和布局，重新附窗后请求布局；键盘避让改为保持底栏挂载，只隐藏显示与触摸／读屏入口。新增独立测试 APK 回归离窗后的真实 Expo 测量调用。最终类型检查、Lint、22 项 JS 测试、11 项 Kotlin 单元测试、Android arm64 Debug 与测试 APK 构建 PASS。18 时重新连接同一真机，系统实际为 Android 17 / API 37；最终开发包与测试包保留数据安装成功，Keystore、私有密文、配置重开、损坏检测、取消、断开及离窗测量全部 PASS，日志位于 `.build/sync-device-navigation-final.log`。

用户授权 adb 操作后，最终开发包确认本地／搜索／云端／设置四个 Tab 可见且能切页；实际搜索输入与返回键收起键盘后，底栏恢复，查询返回 1 个匹配结果，未出现新的 Compose 崩溃。云端显示未连接、0 次传输与禁用手动同步，设置入口可打开配置页。已有 10 个字体及 Mars 星标保留，最近页统计为 4 项（包含本轮正常打开详情产生的记录）。配置页复测期间 USB 再次断开，剩余详情返回、重复输入退出及冷启动页面验收仍待完成；原生后台回归不代替这些页面检查。截图位于 `.build/navigation-home.png`、`.build/navigation-keyboard-return-1.png`、`.build/navigation-cloud.png` 和 `.build/navigation-settings.png`。最终双端 Hermes 导出也已通过。

## Environment

macOS 27.2 arm64、Xcode 27.0（27A266a）、Rust 1.98.1、Node.js 24.14.1、pnpm 11.19.0、JDK 17.0.19、CocoaPods 1.16.2。Rust Android 库使用 NDK 29.0.13846066；Expo 生成工程使用其默认 NDK 27.1.12297006。依赖以本目录 `package.json` 和 `pnpm-lock.yaml` 为准。

## Verified

| 验证 | 结果与实际范围 |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS；独立 workspace，未改变桌面依赖或根锁文件。 |
| `pnpm bindings` | PASS；UniFFI 0.32.1 生成 Swift/Kotlin；使用全局配置及 Kotlin 错误字段 rename，未修改 Rust ABI。 |
| `pnpm rust:android` | PASS；arm64-v8a、x86_64 的真实 release `.so`；arm64 ELF 的 LOAD alignment 为 `0x4000`。 |
| `pnpm rust:ios` | PASS；arm64 iOS 设备与 arm64 模拟器静态库组成 XCFramework。 |
| 两端 Expo autolinking `resolve` | PASS；识别 `FolioNativeModule` 和本地模块工程。 |
| `pnpm typecheck` / `pnpm lint` | PASS。 |
| `pnpm test` | PASS，6 项；分页参数透传、无效参数、调用前取消、调用中取消与迟到结果、取消后原生失败、错误边界。 |
| `pnpm samples` / `pnpm test:swift` | PASS；真实 Swift ↔ Rust 临时数据库、五个合法样本导入、分页、不为零的 TTC index、变量轴读取、收藏重新打开后保留、损坏文件拒绝；macOS CoreText 指定 TTC index 1 得到 Lato Bold。不是移动预览验收。 |
| `pnpm exec expo install --check` | PASS，SDK 依赖匹配。 |
| `pnpm exec expo export --platform all --output-dir .build/bundle` | PASS，Android/iOS Hermes 包生成。 |
| Android `:app:assembleDebug` | PASS；APK 包含两种 ABI 的 `libfolio_ffi.so` 和 JNA `libjnidispatch.so`。 |
| iOS arm64 Simulator Debug `xcodebuild` | PASS，完整 App 编译与链接。无实机签名/发布验证。 |

原生应用构建命令（从本目录执行）：

```sh
cd android
./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a,x86_64
cd ..
xcodebuild -workspace ios/Folio.xcworkspace -scheme Folio \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .build/xcode ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
  CODE_SIGNING_ALLOWED=NO build
```

## Build Findings

- 初次 Kotlin 编译发现错误记录的 `message` 与 `Throwable.message` 冲突；已用 UniFFI 官方 rename 配置生成 `detail`，后续 APK 构建通过。生成前清理本地生成目录，避免遗留旧 package。
- 当前中文路径在 CocoaPods 1.16.2 的二进制子进程输出中发生编码冲突；`pnpm pods` 只对有效 UTF-8 输出恢复编码。
- 当前含空格路径暴露 Expo Constants 和 RN 打包入口的 shell 引用问题；`pnpm pods` 修正本实验生成的 Xcode 工程引用，后续完整 iOS 构建通过。第三方安装文件不改动。
- XCFramework 暂无 Intel Simulator slice。第一次通用模拟器构建包含 x86_64，已改用明确的 arm64 构建；不宣称 Intel Simulator 可用。

## Runtime Boundary

2026-09-30 补充运行验证：iOS 27 的 iPhone 18 Pro 模拟器已从 Xcode 直接构建启动，显示 Folio 主界面和空库查询结果。Android 改用 USB 真机 `23013RK75C`（Android 16 / API 36、arm64）：development build 编译、安装和启动通过，应用沙盒创建 `files/FolioMobilePoC/folio.sqlite`，前台 Activity 为 `.MainActivity`，用户确认显示导入按钮和搜索框。Android Studio 的 Gradle 同步通过，已识别 `app` 与该真机。

此前 Android API 37 模拟器的系统/Launcher ANR 不记作 UI 验收通过。本次按用户要求使用安卓真机，未再启动 Android 模拟器。两端完整的字体导入、TTC/变量预览和生命周期压力测试仍待验收。

字体主页已按 Figma 实现。iOS 27 模拟器确认原生 SwiftUI Menu 玻璃弹层、网格/列表菜单项、TabView 滑块拖动至云端空页、系统深色外观与 Inter 真实字体预览；更新开发包后托管字体路径恢复正常。用户确认界面无问题后停止后续测试，未将这些结果扩展为 Android 原生导航或实机性能验收。

本次未连接 WebDAV 或真实凭据，未实施正式数据库迁移。实验数据库由现有 Rust 在独立应用沙盒内创建。JS 取消不等于原生 Rust 中断。

## IDE Recovery

- Xcode 最初打开 `Folio.xcodeproj`，未包含 Pods，出现 Expo module map 缺失。打开 `Folio.xcworkspace` 后原生依赖可构建。
- iOS 27 / Xcode 27 随后暴露 Scene 生命周期启动断言。已在 `app.json` 启用当前 SDK 57 提供的 `ios.enableSceneSupport`，重新生成工程并执行 `pnpm pods`；再次 `xcodebuild` 和 Xcode `⌘R` 均通过，未升级技术栈。依据：[Apple UIKit Scene 生命周期](https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle)、当前安装的 `expo-build-properties/src/iosSceneSupport.ts`。
- Android Studio 从 GUI 启动时的 Gradle daemon 找不到 nvm Node。已复现精简 PATH 下的同一错误；停止旧 daemon 并携带当前 Node PATH 启动 IDE 后同步和构建通过。`pnpm ide:android` 固定此启动流程，`pnpm ide:ios` 固定 workspace 入口。
- Android 的 `buildArchs` 固定为 Rust 默认交付的 `arm64-v8a`、`x86_64`，避免 IDE 默认生成缺少 Rust 库的 32 位安装包。
- `pnpm prebuild` 使用 `--no-clean` 更新工程。SDK 57 的默认重建会删除原生目录；更新时保留工程并在 iOS 后执行 `pnpm pods`，避免正在打开的 IDE 引用失效。

真机启动命令（此型号已实际验证；从实验目录执行）：

```sh
pnpm start
pnpm android --device "23013RK75C" --no-bundler
```

两条命令分别在终端运行；后者复用前者的 Metro。设备通过名称选择，Expo 的 `--device` 参数不使用 adb 序列号。独立 IDE 安装时的 USB 转发和连接方法见 [README.md](README.md#ide-run)。

## Remaining Gates

| 路线图 D 实验 | 当前边界 |
| --- | --- |
| Rust ↔ RN/Expo | 双端打包/编译和主机真实调用已验证；移动实机上的查询、取消、生命周期、冷启动与内存仍待验收。 |
| 动态 TTF/OTF/TTC | 已有导入和原生预览实现及可复现样本；双端导入、非零成员、缺字、损坏/离线、反复切换需实机验证。 |
| Variable axes | 桥接返回轴范围，预览接收轴值；两轴连续拖动、实际字形变化与缓存/帧率/内存待做。 |
| iOS SwiftUI / Android Compose、MIUIX / Liquid Glass navigation | iOS 已接入原生 TabView、Menu 和 Button，模拟器玻璃菜单及 Tab 拖动切页已确认；Android Compose、MIUIX 与实机导航性能仍待验收。 |
| Android DocumentsProvider / SAF/USB | 未开始；系统 Picker 导入不等于字体 Provider 或导出。 |
| iOS Files/Share / File Provider 需求判定 | 文件选择接入；分享导出与 Provider 需求判定尚未完成。 |

阶段 D 保持 PARTIAL，生产采用结论仍待 go/no-go。真实设备、目标 ROM、许可和性能阈值需在后续实验记录中明确；不能从本次构建结果推断。

## Cloud Sync Cycle (Batch 6)

2026-10-02：先核对第三至五批代码及记录，继续沿用 RN／Expo、Swift／Kotlin、共享 Rust 和既有导航、主题与组件。保留现有字体库、收藏夹及设备数据；没有后台常驻同步、字体安装、DocumentsProvider 或 File Provider。本节的实现完成不代表全部实网和实机验收通过。

| 检查 | 结果与实际范围 |
| --- | --- |
| 第三至五批核对 | PASS，智慧查询与手动／智慧互转、详情事件最近记录、平台安全存储、手动同步、实际取消、进度、托管来源恢复和本地查询已有实现；第五批自动开关原先只保存偏好，本批接通前台调度，没有重做已完成界面。 |
| JS 与语言目录 | PASS，类型检查、Lint、33 项 JS 回归及 746 键共享 i18n 校验；未引入 JS 依赖。新测试覆盖前台补同步、重复启动、后台取消、迟到读数、本地写入使旧快照失效、收藏意图排序、导入暂停、系统选择器返回时保留导入任务门、合并下一轮、取消不立即重启、失败限频、认证失效和部分写入后真实刷新。 |
| Rust 回归 | PASS，`cargo test -p folio-sync -p folio-ffi -p folio-storage -p folio-query`，其中同步 27 项、FFI 9 项；storage／query 单元、集成与文档回归通过。`cargo fmt --all -- --check` 与 `git diff --check` 通过。严格 Clippy 被原有 `path_codec` 的 `manual_is_multiple_of`、`chunks_exact_to_as_chunks` 和同步代码 `needless_borrow` 阻挡；仅允许既有相应告警后的相关 crate Clippy 通过，未扩大修改范围。 |
| 独立受控 WebDAV 与桌面语义 | PASS，独立回环 DAV 服务和移动／桌面两份 Rust 数据库，真实仓库字体文件；覆盖双向字体、收藏、成员、智慧条件及最近访问，断开 GET 后重试、下载取消后保留已落地目录并续传、错误凭据、部分下载失败、并发集合和字体版本、三种冲突决策、仅保留云端、重新下载及删除恢复。不是实际桌面 UI 或独立服务商 HTTPS 实网结果。 |
| 来源与预览闭环 | PASS（Rust），真实 TTC 两成员及 Inter 变量字体完成上传、云端保留、重下、全设备删除及恢复；立即移除重叠文件／目录来源缓存和显式文件根，缓存库不再暴露旧预览。恢复后 fingerprint、TTC index 1、变量轴、星标、成员与最近身份保留。修复字体冲突把新下载版按 fingerprint 排序当成本地版的问题，三种决策分别验证。 |
| Swift ↔ Rust | PASS，最新绑定／主机库的 `pnpm test:swift`：Keychain 作用域与重开、真实字体导入、TTC 非零成员 CoreText、变量轴、批量与 ZIP、星标、手动／智慧互转和最近记录；仅主机验证。 |
| Kotlin ↔ Rust | PASS，`:folio-native:testDebugUnitTest` 的生产导入器 8 项、映射器 3 项；使用主机 JNA 与临时库，继续覆盖前几批用户状态和导入边界。 |
| 双端原生构建 | PASS，最新 Android arm64-v8a／x86_64 Rust 库、iOS arm64 device／Simulator XCFramework、Android arm64 Debug 连接修复包与正式身份双 ABI Release APK、iOS arm64 Simulator `FolioDev` Debug 编译链接。没有 Android 模拟器。 |
| Android 真机原生验证 | PASS，USB `23013RK75C`（设备当前报告 Android 17／API 37）的独立测试 APK：Keystore AES-GCM、密文与配置不含密码、重开、损坏、取消、断开、三种 Compose 宿主离窗测量，以及 Android 系统 TLS 对 123PAN 的错误凭据认证拒绝。生产塑形器读取 TTC index 1 与 Inter wght=700，校验实际源文件／成员并经 Canvas 绘制，删除文件后拒绝旧来源。未用这项结果代替下载字体验证。 |
| Android 保存连接修复 | PASS，补全现有 rustls Android 系统校验器 AAR／JNI 初始化和网络权限；保留数据更新 Folio Dev 后，用户确认专用 123PAN 连接保存成功。开发库有非秘密 profile，正式包库仍无连接；没有导出密码。 |
| iPhone | PASS（限定范围），iOS 27 iPhone 18 Pro 模拟器保留数据更新后启动、云端未连接状态、原生「云端字体／最近删除」控件与最近删除空态、配置页前台自动同步说明。当前开发库为空，不代表三种冲突及破坏性确认的全流程 UI 通过。 |
| iPad | PASS（限定范围），iPadOS 27 iPad mini 模拟器启动、原生分栏、云端导航和最近删除空态。修复云端 React 内容直接进入 SwiftUI 分栏导致右侧裁切：复用 RNHostView，两个分段和状态值完整显示。当前开发库为空，没有进行真实云端往返。 |
| 桌面前端回归 | PASS，既有桌面类型检查、Lint、71 项测试；共享 Rust 语义由上述 DAV 集成覆盖。本批没有实际桌面应用实网连接配置。 |

### 123PAN Live Network

使用用户明确授权的手机专用测试连接，安全凭据只在设备原生边界读取。新增实网 instrumentation 在配置目录下建立随机 `validation-*` 子目录和两份临时库，覆盖上传／下载、下载文件原生绘制、云端保留与重新下载、全设备删除与恢复、集合冲突三种决策、认证失效和取消恢复；临时本地数据先清理再报告结果，不更改用户原有字体库。

目前为 PARTIAL：连接保存已确认成功；完整往返在原生测试启动后遭遇 USB 再次断开，尚未收到完整测试结果，不能登记上传、下载及删除恢复 PASS。已请求重新连接并保持 USB 调试。USB 恢复后需先清理早期 instrumentation 中断遗留的自建测试目录及其中样本（只涉及本轮 `validation-5510b028-36e4-44b9-8585-a2dd86caf864` 和 `validation-e9cfed91-8899-48c3-864c-2ecdfd74d844`，位置为 `FolioMobilePoC/` 及其 `fonts/` 下），再重新执行；改进后的测试临时库位于用户库目录之外，即使中断也不会进入用户库扫描。该项有配置，待完成真机往返；独立服务商配置和桌面客户端实网配置另列缺口，不能由 123PAN 替代。

### Remaining Acceptance

- 独立服务商 HTTPS WebDAV 的 Android／桌面应用实网往返：无配置，待验收；受控回环故障测试已通过。
- 123PAN 完整真机往返和下载后原生预览：专用配置已保存，USB 中断后待完成；实际桌面客户端／123PAN 双端配置缺失，待验收。
- iPhone／iPad 的带字体、冲突确认、删除恢复、下载后 CoreText 和前后台切换实网矩阵：无设备连接配置，待验收；已有模拟器入口及主机原生回归不能代替。
- iOS 实机、Android 旧版系统、完整无障碍、长列表和持续前后台切换压力、性能与大文件：待验收。阶段 D 保持 PARTIAL。

### Release Artifact

用户追加要求：构建 `APP_VARIANT=production`、`com.folio.mobile.poc` 的 Android Release 包。PASS，正式包标签 `Folio`，applicationId `com.folio.mobile.poc`，versionName `0.1.0`／versionCode `1`，Release 构建且 Manifest 无 debuggable 开关，包含 arm64-v8a／x86_64 的 Rust 库和 8,412,820 字节内嵌 Hermes；字体测试样本未进入正式 APK。`apksigner verify` 的 v2 签名校验通过。沿用工程既有 Expo Android Debug keystore 签名，这不是商店发布密钥。

产物：[Folio-0.1.0-batch6-release.apk](.build/releases/Folio-0.1.0-batch6-release.apk)，147,387,803 字节（约 140.6 MiB）；SHA-256 `a496022294695c732b2201e834415ed1b39f2fb8c5db65858c4fc4d14d9d03c9`，同目录提供 `.apk.sha256` 与 `.json` 元数据。已按正式身份生成 Android 工程；iOS 工程仍保留开发身份。USB 未连接，未安装该正式包，也未覆盖手机正式包数据；离线启动及 Release 真机运行待验收。
