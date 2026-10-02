# Mobile PoC Boundary

## Status

2026-09-30，实验基础决策已采用；RN + Expo 的生产采用决策仍待阶段 D 的 go/no-go。双原生 Kotlin/Compose + SwiftUI 继续作为比较基线。

## Decision

在 `experiments/mobile` 建立独立 Expo development build，复用现有 UniFFI Swift/Kotlin bindings。RN 只负责输入、分页和页面状态，原生模块负责沙盒文件与后台调用，Rust 保持身份、解析、持久化和查询的唯一实现。iOS 原生库以 XCFramework 静态链接；Android 以 ABI 独立的 `.so` 加 JNA AAR 接入。

本实验暴露 `initialize`、`snapshot`、`query`、`importFonts`、`setFavorite`、收藏夹创建/更新/删除/成员操作、智慧收藏夹读取/保存/删除/互转、`recordRecent`、`copyText` 和原生视图，不为 PoC 新建 C ABI，不修改生产 SQLite schema；第五批只向既有 UniFFI 追加 `prepare_managed_sources` 与 `query_local_library`，两端及 macOS 绑定与原生库同步生成。Swift 串行后台队列和 Kotlin 单线程执行器持有各自的引擎；模块销毁后按顺序释放，JS 不持有 Rust 指针。

筛选及手动收藏夹复用现有 Rust DTO。查询返回完整字族身份、命中字款、实时 facet 计数与不可用成员数；星标和成员操作使用完整身份集合。变更成功后返回缓存快照并刷新当前查询，失败时保留原状态。筛选选择直接提交查询，各范围独立保存搜索与条件；第五批云同步沿用下述共享边界。

2026-10-01，第三、四批接入既有 UniFFI 智慧收藏夹与最近访问。智慧查询直接调用 `query_smart_folder`：同组条件并集、跨组交集，保存与临时搜索拼接；RN 只在新建草稿时按桌面语义合并条件，不实现匹配或计数。统一编辑器采用「常规／筛选条件」两页；有条件保存为智慧，无条件保存为手动，互转明确确认后调用 Rust 事务接口，不在 JS 中复制或删除成员。创建时只保存搜索与筛选；智慧范围内新建继承保存条件与临时条件，手动编辑从空条件开始，智慧编辑读取保存条件。草稿变更仅发预览查询，点击保存后才写入数据库。

手机入口与 iPad 宽屏侧栏共用手动／智慧混排列表，以标记区分动态收藏夹；Android 范围入口复用 Gorhom Drawer，编辑器使用居中 Dialog，iOS 继续系统 Sheet。最近页面复用列表、搜索、筛选与详情；只在详情打开事件中记录与卡片相同的代表字款身份，渲染、滚动与导入不记录。访问排序、去重及持久化均由 Rust 处理，列表不在 JS 重排；详情关闭后仍使用原页面状态，详情成员操作固定到实际入口的手动收藏夹。

2026-10-01，面板交互复用既有筛选结构：字体库范围以小标题分组，每个项目仅一层卡片；新建入口移到右上角。收藏夹编辑页标题居中，左侧取消、右侧保存均为 44 点纯图标按钮；原生强调按钮的额外内边距由同尺寸 plain Button 配合系统交互式圆形 glassEffect 取代，主操作使用主题 tint。iOS 所有相关面板统一系统 Sheet，使用 medium／large detents 与 grabber，保留系统半屏玻璃和展开后的材质，不覆盖 presentationBackground。常规／筛选条件使用原生 segmented Picker。卡片侧滑复用已安装的 ReanimatedSwipeable，另提供更多入口及无障碍编辑／删除动作；删除与互转仍需明确确认。Android 保留 Gorhom 范围抽屉和桌面式编辑 Dialog，按钮尺寸、主题色及胶囊结构与 iOS 对齐。参照 [Apple Sheets HIG](https://developer.apple.com/design/human-interface-guidelines/sheets) 和 [UIKit Liquid Glass 默认 Sheet 行为](https://developer.apple.com/videos/play/wwdc2025/323/?time=547)。

Android 筛选抽屉使用 `@gorhom/bottom-sheet` 5.2.14，复用其拖动、遮罩、收起动画和 `BottomSheetFlatList` 滚动协调；保留现有分类卡片与浅深色主题，不采用 Material 3 面板。手势与动画依赖固定为 Expo SDK 57 对应的 Gesture Handler 2.32.0、Reanimated 4.5.1 和 Worklets 0.10.1，不自行实现拖动逻辑。iOS 继续使用系统 Sheet。

批量导入的复制、SHA-256 去重和 ZIP 解压留在原生文件边界，Rust 继续负责字体内容校验、来源、身份与目录。Android 使用系统 `ZipFile`，iOS 本地模块固定使用 MIT 许可的 ZIPFoundation 0.9.20；依赖不进入桌面端或 Rust 核心。显式单文件来源按内容解析，扩展名筛选只用于目录发现，兼容已有安卓 `.font` 副本。

UniFFI 0.32.1 使用全局配置的 `crates.folio_ffi` 节点。Kotlin 的错误字段 `Operation.message` 通过官方 rename 配置映射为 `detail`，避免与 `Throwable.message` 冲突；该配置仅改变生成 Kotlin 的字段名，保持 Rust ABI 与校验检查。

动态字体不走 Expo Font 的应用级字体名称缓存。原生预览直接打开用户导入的托管副本，携带实际 Face index、revision 和轴值。Android 检查塑形结果中的源文件和 TTC index，再用具体 Font 绘制字形；iOS 从集合描述符选取指定成员、检查字形覆盖并限制 cascade。损坏、不可读或缺字状态必须返回给页面。

## Consequences

桌面客户端和数据库保持原有边界。实验可独立删除；独立锁文件防止把移动依赖加入桌面 workspace。生成绑定必须与正在打包的 `folio-ffi` 来自同一源码与 Cargo.lock；变更 Rust 后重新生成两端绑定及原生库。

普通 Rust 查询尚不可抢占，JS 查询取消只防止过期结果回写；云同步调用 Rust 原子取消标记，中断网络等待并等待真实结束状态。当前预览没有多字体缓存、复杂双向文本分段或两轴连续拖动界面；Android API 28–30 的准确字形绘制另验。安卓 Compose 玻璃底栏已通过本地 Expo 模块接入，来源和兼容策略见模块内的 `third-party/NOTICE.md`，运行与性能验收另行记录。第五批已接入 WebDAV 和平台安全凭据；仍不承诺 Provider、Files/Share 导出、MIUIX 或移动导航完整验收已经通过。

## Adoption Gate

阶段 D 的全部实验矩阵通过后，再记录生产 go/no-go：两端桥接线程/冷启动/内存、真实 TTF/OTF/TTC 与两轴拖动、系统导航与无障碍、Android Compose/MIUIX 和玻璃导航、DocumentsProvider URI/按需读取、iOS Files/Share 与 File Provider 需求判定。任何关键项失败都保留双原生方案，不以主机编译或模拟器代替实机数据。

## References

- [Expo 自定义原生代码](https://docs.expo.dev/workflow/customizing/)
- [Expo Modules API](https://docs.expo.dev/modules/module-api/)
- [Gorhom Bottom Sheet](https://gorhom.dev/react-native-bottom-sheet/)
- [UniFFI Kotlin/JNA](https://mozilla.github.io/uniffi-rs/latest/kotlin/gradle.html)
- [Android TextRunShaper](https://developer.android.com/reference/android/graphics/text/TextRunShaper)
- [Android Canvas.drawGlyphs](https://developer.android.com/reference/android/graphics/Canvas#drawGlyphs(int[],int,float[],int,int,android.graphics.fonts.Font,android.graphics.Paint))

## Cloud Sync Foundation (Batch 5)

2026-10-02：保留第一至四批 RN／Expo 页面、Swift／Kotlin 封装、存储管理和共享 Rust。云同步增加现有设置的一个二级页，不改变已完成导航与字体界面。123PAN 完全通过 WebDAV 连接，不增加服务商协议、数据库 schema、JS 依赖或后台调度。

每个原生模块只持有一个 `FolioSync`，存储维护和同步共用实例与运行锁；配置、状态、开始和取消在已有串行队列执行，传输由 Rust 工作线程负责。RN 不计算同步百分比或合并事件。只在 Rust completion generation 改变后刷新字体库，后台暂停状态轮询，前台恢复读取；失败保留最后快照但明确标记状态不可读。

服务器地址右侧使用下拉预设，地址与桌面端「无／123 云盘／坚果云」一致，仍支持直接输入自定义地址。配置不包含密码。安全存储按地址／目录／用户名建立作用域；空密码不能沿用另一个连接的凭据。保存前测试真实连接，先安全写入再保存非秘密配置，失败回滚；断开保留本地库。iOS Keychain 使用设备限定的 `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`，Android Keystore 管理 AES-GCM 密钥，带认证标签和作用域关联数据的密文通过 AtomicFile 保存至不参与备份的应用私有目录。缺少密码与安全存储读取失败分别返回可辨识状态，允许解锁重试或重新输入，不输出原生凭据。

来源恢复下沉 `folio-sync::prepare_managed_sources`，通过既有 UniFFI 暴露。新副本必须通过 Rust 解析、内容校验与目录缓存确认，旧缓存的字款身份也必须与新来源一致；之后才移除旧副本。保留当前托管目录，归并文件根、目录根和规范路径别名，更新移动沙盒重定位后的同步资产路径。导入器从托管目录建立内容去重索引，因此同步字体不会再次导入。共享协议、源语言目录与桌面首次自动下载行为保持一致。

移动本地范围调用 `query_local_library`，关闭桌面查询对云端占位记录的追加；智慧匹配继续使用真实 Rust 本地索引。云端列表以原生可读路径确认本机可用状态，未下载字体不进入预览、筛选或智慧计数。第六批负责自动调度与完整删除／恢复／冲突交互。

安全存储依据：[Apple Keychain 可访问性](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly)、[Android Keystore AES-GCM](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec)。运行验证和实网缺口见 [VALIDATION.md](VALIDATION.md#cloud-sync-foundation-batch-5)。

2026-10-02，Android 真机复测发现 Expo 延迟测量可能在 Compose 宿主离开窗口后执行，搜索键盘退出可触发窗口 recomposer 异常。顶栏、背景与底栏宿主在离窗时只记录测量尺寸，不测量或布局 Compose 子视图；重新附窗后请求正常布局。键盘避让保持底栏宿主挂载，隐藏期间关闭触摸与读屏；保留现有界面，补充独立测试 APK 的离窗测量回归。设备验收先确认 APK applicationId 与前台应用变体一致，原生后台测试与实际页面结果分别登记。

## Cloud Sync Cycle (Batch 6)

2026-10-02：第六批沿用现有导航、主题、分类卡片与成熟组件。新增云端字体操作、最近删除分段和三种冲突决策；不新增同步协议、数据库 schema 或 JS 依赖。云端保留与全设备删除使用明确确认，采用单一冲突版本再次确认。所有实际决策调用共享 Rust，不在 RN 重写合并规则。

共享来源删除接口按规范路径清理各根中对应的 `source_files` 及显式文件根，保留目录根与用户状态。仅保留云端必须已有发布记录；本地删除先移入已有恢复目录。远端删除也清理来源；接收阶段通过统一收尾刷新目录，即使取消或部分失败也保留真实已落地状态。字体冲突以下载前的本地资产集合确定本地版，复用既有稳定冲突记录及解决事件。

RN 使用单实例前台调度器；本地写入与同步共用任务门。导入在同步中拒绝，系统文件选择器打开至导入结束持续占用任务门，前台补同步不会抢先丢弃文件选择；连接和冲突操作暂停；收藏、成员和最近访问等意图串行排队，Rust 本轮结束后执行，再合并为下一轮。后台取消同时由原生生命周期兜底，原生开始与前后台状态切换共用锁；前台恢复读取实际状态。读取携带生命周期代次与写入版本，过期结果丢弃；完成代次变化后重新扫描并刷新所有库范围和当前详情。失败限频退避，认证错误停止定时重试，手动取消不立即重启。

Android 的 reqwest/rustls 系统 TLS 必须在首次连接前初始化 JVM 与应用上下文，并打包 Cargo.lock 中匹配的系统校验器 AAR。新增依赖仅为现有传输栈的 Android 平台支持；不改变 TLS 校验、服务商协议或应用权限边界。参照 [rustls-platform-verifier Android 接入](https://github.com/rustls/rustls-platform-verifier#android)；实际 HTTPS 与安全存储回归单独记录。

实网 instrumentation 仅在显式指定 Folio Dev 时以开发签名构建，保持应用自身数据和凭据作用域，原生读取凭据而不导出。在专用连接中建立随机测试子目录和两个临时库；不启动 Expo/Metro，不借用真实库作为测试副本。AGP 库测试默认自我 instrumentation，实网测试仅替换测试产物的 targetPackage；不改变应用 Manifest。Android 两个副本不等于实际桌面客户端，独立 WebDAV 与 123PAN 的验收范围分别登记。没有后台常驻同步、系统字体安装、DocumentsProvider 或 File Provider。
