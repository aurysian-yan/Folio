# P2/P3 Validation

日期：2026-10-20。范围采用已确认的 P2/P3 实施计划；wire v1 保持不变，不启动 wire v2。
所有运行测试使用隔离库及样本；代码完成、自动测试、模拟器结果与目标设备验收分别记录。
2026-10-21 续验只读 File Provider 与独立系统调用方，结果见下方；既有全量回归数字仍属于前一批。

## Implementation

| 范围 | 已接入代码 | 验收边界 |
| --- | --- | --- |
| 共享来源与任务 | schema v12 本机来源、批次、逐项阶段、操作账本；来源可用性、迁移、重新检测、读取租约与跨进程锁 | 本机路径、URI、书签、安装信息不进入同步资料；旧库用户状态保留 |
| 云端文件 | 固定实际文件清单、指纹去重、单文件按需下载、校验、独立取消 | 受控 WebDAV 测试通过；各平台真实服务商矩阵继续沿用 P0 |
| Android | 进程级原生运行时、只读 DocumentsProvider、原生 GET_CONTENT Picker、SAF 文件／目录复制及持久引用、固定清单导出、收件确认与健康恢复 | 不依赖 Expo 模块或 JS 存活；真实 ROM、OTG 和外部云提供器仍需实机 |
| Windows | Explorer／单实例转交、独立安装窗口、最小命令权限、批次恢复、会话启用、当前用户安装、导出冲突决策 | 当前 macOS 只验证共享宿主逻辑及 Windows 交叉编译；系统实际注册与交互待 Windows |
| iOS/iPadOS | 无 Expo 原生文件服务、App Group 迁移、书签引用、协调读取、Files 导入／导出、Share Sheet、Share Extension、只读 File Provider | 配置插件生成独立 target；开发／正式组及钥匙串隔离；模拟器与实机分开验收 |

## Automated Checks

| 检查 | 结果 | 内容 |
| --- | --- | --- |
| Storage／Sync／FFI | 通过 | 137 项（含文档测试）；旧库迁移、用户状态、来源与本机信息隔离；来源失效；文档树／集合去重；跨进程活跃任务保护；读取期间清理保护；取消不影响另一读取；仅下载所请求云文件 |
| Tauri 原生宿主 | 通过 | 20 项通过、1 项既有忽略；路径转交、固定批次、导出冲突、不覆盖、失败阶段重试、外部原件保护 |
| Windows 交叉编译 | 通过 | x86_64-pc-windows-gnu；配置 x64／arm64 Windows CI 的原生测试与 NSIS 打包检查，未在本机代跑目标 OS |
| 桌面 React | 通过 | 类型、Lint、131 项测试及生产构建；高并发时出现超时，降为 2 个测试 worker 后全部通过，未扩大超时阈值 |
| 移动 React Native | 通过 | 类型、Lint、88 项查询／预览／字符表／收藏夹回归 |
| 共享语言目录 | 通过 | 2 种语言、1039 个字段 |
| Swift 原生主机烟测 | 通过 | 实际字体导入、ZIP、非零 TTC、两轴、字符表与集合映射 |
| Android Release／测试 APK | 通过 | arm64-v8a，自包含 JS；不需要开发服务器 |
| iOS Release Simulator | 通过 | 主应用及两个独立扩展、完整 JS、语言资源和模拟器签名；生成工程可重复执行 |

## Simulator Runs

| 环境 | 场景 | 结果 |
| --- | --- | --- |
| Android Pixel_10 | 独立 UID 调用方在无 React runtime 的测试宿主中，通过原生 GET_CONTENT 与标准 DocumentsUI OPEN_DOCUMENT 选择实际字体，核对字节摘要、读授权、拒绝写入、预先取消 | 最终包通过；测试清理模拟器启动遗留的 System UI 无响应弹窗，应用自身无响应不豁免 |
| iPhone／iOS 27 | 旧目录迁入 App Group、原件保留、读取取消、外部原件移除后引用不可用 | 原生隔离宿主通过 |
| iPhone／iOS 27 | 直接调用实际 File Provider 代码，枚举 4 个不同名称的目录、读取实际字体、拒绝写入 | 通过；此结果不替代系统物化及主应用退出后读取 |
| iPhone／iOS 27 | 完整主应用启动和读取迁移后的字体库 | 通过；Files 扩展语言资源漏打包已修正并补入绑定生成流程 |
| iPhone／iOS 27 | 系统启动独立扩展、取得本地化目录与文件元数据，并创建 Files 占位目录／读取 | 未通过：fileproviderd 在创建目录时返回 POSIX 1／libfssync.VFSFileError 22 cannotSetMetadata；系统链路尚未完成，未归因为产品或模拟器缺陷 |
| 干净 iPad／iPadOS 27 | 关闭 iPhone 后重置专用测试 iPad；重新迁移、注册并在 Files 启用 Folio；系统读取 | 复现相同 cannotSetMetadata／POSIX 1；新的隔离域也失败，排除仅为旧 iPhone 数据的问题 |

### Open Simulator Issue

iPhone 的隔离原生验证输出 `phase=provider-read`、`success=false`。此前的迁移、取消、
引用失效、扩展目录枚举、扩展字节读取及只读检查均为 true；系统日志确认独立 FolioFiles
进程已运行并返回更新后的本地化目录。失败发生于 fileproviderd 的占位目录元数据创建。
不能据此宣布 Files 浏览／物化成功，也未取得主应用终止后系统读取成功的证据。
Share Extension 的系统接收、Files 导入／导出冲突和完整 UI 矩阵继续待交互验收。

### Clean iPad Follow-up

按用户澄清，测试 iPad 前先关闭 iPhone，任意时刻只运行一个 Apple 模拟器。
干净 iPad 与单独新建的验证域均复现相同错误。另用不链接 Rust、不读取 Folio 数据库的
最小原生提供器返回一个目录和一个固定字体，系统日志确认已接收其独立元数据，仍在
创建目录时失败。以上证据将问题定位至系统物化／注册环境边界，尚不足以断言是操作系统缺陷。
本机仅安装 iOS 27.0（24A434），缺少第二个 iOS 运行时进行对照。

已补充元数据约束：目录不提供文件字节大小；元数据版本对资料与实际显示名称的规范 JSON 计算 SHA-256，
保持固定 32 字节，并覆盖长名称超过系统 128 字节版本上限的回归。直接原生检查通过；
这两项改动没有消除当前系统物化错误。临时修改权限标志／旧式扩展配置的尝试未解决问题，
未作为产品修复保留。额外验证域仅用于该隔离模拟器，测试后移除，不影响 App Group 内原始字体。
根目录「收藏」改用现有 `workflow.favorites` 语言键，修正无对应键时退回应用名的问题；
主应用仅在资料初始化后的快照通知中登记提供器，避免迁移准备完成前重复登记。

### Read-only Provider Control — 2026-10-21

本轮实际环境：macOS 27.2（26B5091g）、Xcode 27.1（27A9275）／iOS 27.1 SDK，
运行时仍为 iOS 27.0（24A434）。只启动专用 iPad
`08B6B7C0-3DC1-45E6-B945-A1C5FF0A583E`，iPhone 关闭；开始时 Android ADB 无在线设备，
没有启动新 Android 实例。构建串行执行，使用本地签名并保留模拟 App Group 权限。

采用 Apple 官方 [Synchronizing files using file provider extensions](https://developer.apple.com/documentation/fileprovider/synchronizing-files-using-file-provider-extensions)
样例作同机对照，下载样例源码，不下载运行时。iOS 应用与扩展先保持原样；使用官方 Server
框架、独立本地数据库及测试用内容存储适配器，不接入 Folio 数据库、Rust、账号或 WebDAV。
服务端建立 `Fonts/Lato-Regular.ttf`，随后只改变样例 `Item.capabilities`，其他元数据保持不变。
样例归档为 `612c24319d8c/SynchronizingFilesUsingFileProviderExtensions.zip`，SHA-256：
`b417fb3c58558bed5d38255e88a5f0af4572c906174c0cb097e7c2baca13d253`。

| 对照 | 系统结果 |
| --- | --- |
| 官方原始能力，包含写入 | Files 实际显示 `Fonts` 和 Lato，目录物化成功 |
| 与 Folio 相同的读取／枚举能力 | 新建 `ReadOnlyControl` 物化失败：POSIX 1 → DocumentWharfError 4 → VFSFileError 22 `cannotSetMetadata` |
| 读取／枚举再加 `allowsEvicting` | 新建 `EvictControl` 同样失败 |
| 读取／枚举再加 `allowsWriting` | 新建 `WriteControl` 物化成功 |
| Folio 显式返回本地缓存 rwx／rw 标志，仍保持只读能力 | 失败不变；尝试已撤回，未保留在产品源码中 |

对照日志中，成功目录为 `m:rwx`，只读失败目录为 `m:rwxl`；失败标志仍为
`8119226119`／`8085606151`。宿主日志确认经过 macOS `FPDSimSupport` 的占位创建代理。
因此已将触发条件缩小到当前宿主／运行时组合中的只读目录物化分支，不能继续归因于
Folio 的 Rust、库资料、目录字节大小或旧域。尚未确定具体失败系统调用，也不能泛化为所有
iOS／iPadOS 的系统缺陷。加入写入能力不符合本项目只读契约，未采用该绕行方法。
用户本轮确认暂不下载其他官方运行时；跨版本、实机和保留只读语义的修复仍待验收。

新增独立 `com.folio.filecaller` 验证宿主，不链接 Folio 原生服务，不持有 App Group 权限。
它通过标准 `UIDocumentPickerViewController` 取得 URL，再作安全作用域协调读取并比较实际字节。

| 本轮检查 | 判定与边界 |
| --- | --- |
| Folio 在系统 Files 及独立选取器中的浏览 | 均仍为空；后者在 Folio 主进程退出后复现，不能选取或读取字体 |
| 官方样例的系统选取及读取 | 通过；主应用退出后，独立调用方读到 656,568 字节，SHA-256 为 `d636e4683231f931eda222d588e944d082bfd3bdba02f928bee461c0f185b251`，与原始 Lato 一致 |
| 官方样例的书签重开读取 | 通过；终止并重启调用方后摘要仍一致，样例主应用持续未运行；此结果不算 Folio Provider 通过 |
| 系统选取器取消 | 通过，回调为取消，不记录字体读取成功 |
| Folio 直接原生检查 | 通过；元数据版本固定 32 字节、重复生成稳定、改名后变化，取消错误分类与既有枚举／字节读取／拒绝写入检查通过 |
| 迁移资料复核 | 本轮核对既有迁移后的字节、原件保留及引用失效；不冒充重新执行干净迁移 |

烟测已修正一个验收漏洞：协调读取目录未报错不再算枚举成功，必须实际出现预期根目录，
再分别核对系统字体读取。结果独立记录 `providerRootChildren`、`providerRootEnumeration`
和结构化 `errorChain`；本轮失败记录只有 `.Trash`，预期根目录缺失。
`--native-only` 的成功明确带 `scope=native-only`，不包含任何 Files 系统通过结论。

本轮证据在移动工作区 `.build/`：`p3-ipad-files-live.log`、
`p3-host-fileprovider-live-20261021.log`、`p3-apple-capabilities.diff`、
`p3-ipad-explicit-flags-validation.json`、`p3-ios-native-validation-20261021.json`、
`p3-apple-control-caller-read.json`、`p3-apple-control-caller-reopen.json`、
`p3-ios-caller-cancel.json`。官方样例能力改动仅用于对照，已恢复原始样例源码；
额外 Folio 验证域、官方样例域及独立调用方已清理，不修改正式库或真实云端配置。

本轮完整 iPad Release 构建恢复通过，已重新安装并实际确认 1 个 Lato 字族；
包中含完整 JS，App Group 模拟权限保留。最终 Files 仍只有一个 Folio 位置且为空。
恢复构建最终限定 arm64、单构建任务；日志为 `p3-ipad-app-restored-arm64-20261021.log`。
上轮 Android 标签构建日志没有完成标记，本轮以单 worker、禁用并行及常驻 Gradle daemon
重跑，通过（`p3-android-release-20261021.log`，836 个任务）。仅生成 APK，未启动 Android
实例、未安装测试宿主或操作原有真实连接；本轮不增加 Android 运行验收结论。
验证工具的 Swift 严格格式检查、JS 语法检查以及两个宿主的最终编译通过。
所有本轮构建、日志采集、对照 HTTP 服务与测试宿主均已停止；保留完整 Folio 和唯一运行的 iPad 窗口。

### Manual Samples

两个模拟器保留完整自包含 Folio 开发版。自动测试使用独立测试包／共享容器；Android
供手动试用的主应用沿用模拟器原有配置，未将该库作为隔离自动测试结果。Android
「Download」下提供 `P2-P3-20261020` 样本目录；主机样本位于移动工作区的
`.build/manual-samples/P2-P3-20261020`，包含 TTF、OTF、TTC、两轴变量字体、损坏字体、
ZIP，以及两个目录内同名而内容不同的 `Font.ttf`。此前写入 iPhone Documents 的样本
只证明沙盒中存在文件，尚未取得 Files 展示成功的证据；不能将其描述为已在 Files 可用。
样本用于手动追加测试，不纳入正式用户库迁移结论。

## Target Environment Acceptance

以下项目保持待验收，不能用构建或模拟器结果替代：

- Windows x64／arm64：Explorer 空格／Unicode／多选连续转交；主库与安装窗口并行；启用对另一应用可见、退出撤销、异常退出核对、重启不恢复；当前用户安装／卸载、其他应用注册保护；安装包实际运行。
- Android 国产 ROM／真实 OTG：系统 Picker 展示、fallback、多选持久授权、撤权／移动／拔盘／容量不足和外部云占位；无 JS／进程重启后的读取。
- iPhone／iPad 实机：开发／正式签名与分组、旧钥匙串迁移、云占位、持久书签重新授权、主应用退出后的扩展读取与取消、多窗口和 Share Sheet 锚点。
- 各平台真实 WebDAV 单文件下载、认证失败、共享下载取消与来源恢复，以及浅深色、长文本、键盘／读屏、安全区域的完整交互矩阵。

## Reproduction

- 共享：`cargo test --locked -p folio-storage -p folio-sync -p folio-ffi`。
- 桌面：`cargo test --locked --manifest-path apps/desktop-ui/src-tauri/Cargo.toml`；`pnpm --dir apps/desktop-ui typecheck`、`lint`、`test`、`build`。
- 移动：`pnpm --dir experiments/mobile typecheck`、`lint`、`test`、`test:swift`；`pnpm i18n:validate`。
- Android 独立调用方：`tools/testing/android-file-caller/build.py`；测试 instrumentation 为 `com.folio.poc.FolioFileInstrumentation`，只安装于隔离模拟器。
- iOS 原生系统链路：`tools/testing/ios-file-workflows/build.mjs` 复用 Release 原生服务与两个扩展；测试宿主会替换隔离模拟器中的开发版应用，完成后恢复完整 Folio 应用。
- iOS 独立调用方：`node tools/testing/ios-file-workflows/build.mjs --caller`；只在隔离模拟器安装生成的 `FolioFileCaller.app`。默认展示标准选取器并核对 Lato 原始字节；终止提供器主应用后选取，再终止调用方并用 `--read-bookmark` 重开读取。调用方自身不登记提供器域，测试后移除。
- Xcode 27 的模拟器窗口由 Device Hub 承载。模拟器签名需启用本地签名以嵌入 App Group 模拟权限；不使用禁用全部签名的产物作运行结论。

后续使用 iPad 时保持 iPhone 关闭，只保留一个 Apple 模拟器和既有 Android 模拟器。完整应用恢复后，
测试调用方已停止；未保留开发、预览、构建或测试服务。ADB 随 Android 模拟器保留供手动试用。
