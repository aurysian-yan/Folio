# Mobile PoC Boundary

## Status

2026-09-30，实验基础决策已采用；RN + Expo 的生产采用决策仍待阶段 D 的 go/no-go。双原生 Kotlin/Compose + SwiftUI 继续作为比较基线。

## Decision

在 `experiments/mobile` 建立独立 Expo development build，复用现有 UniFFI Swift/Kotlin bindings。RN 只负责输入、分页和页面状态，原生模块负责沙盒文件与后台调用，Rust 保持身份、解析、持久化和查询的唯一实现。iOS 原生库以 XCFramework 静态链接；Android 以 ABI 独立的 `.so` 加 JNA AAR 接入。

本实验暴露 `initialize`、`snapshot`、`query`、`importFonts`、`setFavorite`、收藏夹创建/更新/删除/成员操作、智慧收藏夹读取/保存/删除/互转、`recordRecent`、`copyText` 和原生视图，不为 PoC 新建 C ABI、不修改 `folio-ffi` 或生产 SQLite schema。Swift 串行后台队列和 Kotlin 单线程执行器持有各自的引擎；模块销毁后按顺序释放，JS 不持有 Rust 指针。

筛选及手动收藏夹复用现有 Rust DTO。查询返回完整字族身份、命中字款、实时 facet 计数与不可用成员数；星标和成员操作使用完整身份集合。变更成功后返回缓存快照并刷新当前查询，失败时保留原状态。筛选选择直接提交查询，各范围独立保存搜索与条件；云同步仍未接入。

2026-10-01，第三、四批接入既有 UniFFI 智慧收藏夹与最近访问。智慧查询直接调用 `query_smart_folder`：同组条件并集、跨组交集，保存与临时搜索拼接；RN 只在新建草稿时按桌面语义合并条件，不实现匹配或计数。统一编辑器采用「常规／筛选条件」两页；有条件保存为智慧，无条件保存为手动，互转明确确认后调用 Rust 事务接口，不在 JS 中复制或删除成员。创建时只保存搜索与筛选；智慧范围内新建继承保存条件与临时条件，手动编辑从空条件开始，智慧编辑读取保存条件。草稿变更仅发预览查询，点击保存后才写入数据库。

手机入口与 iPad 宽屏侧栏共用手动／智慧混排列表，以标记区分动态收藏夹；Android 范围入口复用 Gorhom Drawer，编辑器使用居中 Dialog，iOS 继续系统 Sheet。最近页面复用列表、搜索、筛选与详情；只在详情打开事件中记录与卡片相同的代表字款身份，渲染、滚动与导入不记录。访问排序、去重及持久化均由 Rust 处理，列表不在 JS 重排；详情关闭后仍使用原页面状态，详情成员操作固定到实际入口的手动收藏夹。

2026-10-01，面板交互复用既有筛选结构：字体库范围以小标题分组，每个项目仅一层卡片；新建入口移到右上角。收藏夹编辑页标题居中，左侧取消、右侧保存均为 44 点纯图标按钮；原生强调按钮的额外内边距由同尺寸 plain Button 配合系统交互式圆形 glassEffect 取代，主操作使用主题 tint。iOS 所有相关面板统一系统 Sheet，使用 medium／large detents 与 grabber，保留系统半屏玻璃和展开后的材质，不覆盖 presentationBackground。常规／筛选条件使用原生 segmented Picker。卡片侧滑复用已安装的 ReanimatedSwipeable，另提供更多入口及无障碍编辑／删除动作；删除与互转仍需明确确认。Android 保留 Gorhom 范围抽屉和桌面式编辑 Dialog，按钮尺寸、主题色及胶囊结构与 iOS 对齐。参照 [Apple Sheets HIG](https://developer.apple.com/design/human-interface-guidelines/sheets) 和 [UIKit Liquid Glass 默认 Sheet 行为](https://developer.apple.com/videos/play/wwdc2025/323/?time=547)。

Android 筛选抽屉使用 `@gorhom/bottom-sheet` 5.2.14，复用其拖动、遮罩、收起动画和 `BottomSheetFlatList` 滚动协调；保留现有分类卡片与浅深色主题，不采用 Material 3 面板。手势与动画依赖固定为 Expo SDK 57 对应的 Gesture Handler 2.32.0、Reanimated 4.5.1 和 Worklets 0.10.1，不自行实现拖动逻辑。iOS 继续使用系统 Sheet。

批量导入的复制、SHA-256 去重和 ZIP 解压留在原生文件边界，Rust 继续负责字体内容校验、来源、身份与目录。Android 使用系统 `ZipFile`，iOS 本地模块固定使用 MIT 许可的 ZIPFoundation 0.9.20；依赖不进入桌面端或 Rust 核心。显式单文件来源按内容解析，扩展名筛选只用于目录发现，兼容已有安卓 `.font` 副本。

UniFFI 0.32.1 使用全局配置的 `crates.folio_ffi` 节点。Kotlin 的错误字段 `Operation.message` 通过官方 rename 配置映射为 `detail`，避免与 `Throwable.message` 冲突；该配置仅改变生成 Kotlin 的字段名，保持 Rust ABI 与校验检查。

动态字体不走 Expo Font 的应用级字体名称缓存。原生预览直接打开用户导入的托管副本，携带实际 Face index、revision 和轴值。Android 检查塑形结果中的源文件和 TTC index，再用具体 Font 绘制字形；iOS 从集合描述符选取指定成员、检查字形覆盖并限制 cascade。损坏、不可读或缺字状态必须返回给页面。

## Consequences

桌面客户端和数据库保持原有边界。实验可独立删除；独立锁文件防止把移动依赖加入桌面 workspace。生成绑定必须与正在打包的 `folio-ffi` 来自同一源码与 Cargo.lock；变更 Rust 后重新生成两端绑定及原生库。

同步 Rust 查询尚不可抢占；JS 取消只防止过期结果回写。当前预览没有多字体缓存、复杂双向文本分段或两轴连续拖动界面；Android API 28–30 的准确字形绘制另验。安卓 Compose 玻璃底栏已通过本地 Expo 模块接入，来源和兼容策略见模块内的 `third-party/NOTICE.md`，运行与性能验收另行记录。当前库不接 WebDAV、不保存凭据，也不承诺 Provider、Files/Share 导出、MIUIX 或移动导航完整验收已经通过。

## Adoption Gate

阶段 D 的全部实验矩阵通过后，再记录生产 go/no-go：两端桥接线程/冷启动/内存、真实 TTF/OTF/TTC 与两轴拖动、系统导航与无障碍、Android Compose/MIUIX 和玻璃导航、DocumentsProvider URI/按需读取、iOS Files/Share 与 File Provider 需求判定。任何关键项失败都保留双原生方案，不以主机编译或模拟器代替实机数据。

## References

- [Expo 自定义原生代码](https://docs.expo.dev/workflow/customizing/)
- [Expo Modules API](https://docs.expo.dev/modules/module-api/)
- [Gorhom Bottom Sheet](https://gorhom.dev/react-native-bottom-sheet/)
- [UniFFI Kotlin/JNA](https://mozilla.github.io/uniffi-rs/latest/kotlin/gradle.html)
- [Android TextRunShaper](https://developer.android.com/reference/android/graphics/text/TextRunShaper)
- [Android Canvas.drawGlyphs](https://developer.android.com/reference/android/graphics/Canvas#drawGlyphs(int[],int,float[],int,int,android.graphics.fonts.Font,android.graphics.Paint))
