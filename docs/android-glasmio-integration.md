# Android 双版本控件接入

## 当前边界

Glasmio 源码固定在 `b86f4a601fceb8e6ee2f4cdc817a2dbaf9159846`，
于 2026-10-28 开始本轮迁移时重新查询上游 main。该提交包含
`aad1605a2807cddaf5afacea131d528bc9452c9f` 的材质缓存与原生轮廓场优化，
以及后续菜单、选择和设备检查修复。四个源码模块、原始许可和文件校验值保存在
移动端 `vendor/glasmio/`；不引入上游 Scaffold、Preference 或示例资源。

高版本已注册导航、顶栏、菜单、Slider、Switch 和背景视图，React 页面继续使用原有业务接口。
控件绘制在页面采样树之外的原生 overlay；页面内容通过 RenderNode 和官方 Backdrop 接口提供，
Glasmio 保留默认材质、折射和动画；顶栏按钮背景模糊按应用要求提高到 24 dp，
覆盖合并操作组、独立返回按钮和顶栏菜单触发器。轨道与拨片组合取样由上游控件自身实现。
菜单触发器前景和菜单由同一 Compose 树管理，字款选择行的文字一起参与前景转移。
原生 overlay 的实际根节点显式绑定页面的 Lifecycle、SavedState 与 ViewModel owner，
让页面进入、返回及 RN 滚动裁切后的控件重挂载均能创建 Compose 重组器。
底栏与独立搜索按钮接入同一个 `BottomNavigationContact`，分离和融合时均共用材质归属。
在线地址栏、导航轨道及选中拨片、独立搜索按钮均使用按实际尺寸计算的 `Capsule` 轮廓，
展开、折叠与布局过渡不沿用固定圆角值；其他面板继续使用自身的圆角约定。
保留原有 RN 导航、业务回调和四模块边界；不导入 Scaffold、Preference、Sample、
Volume 音频控件及 Apple 图片。上游 Android 渲染测试只移除两个
依赖这些音频控件的方法，其他测试继续保留。

源码的模糊参数透传补丁位于 `vendor/glasmio/patches/toolbar-frost-radius.patch`，
保留上游默认 2 dp，只有 Folio 顶栏显式提高。菜单前景转移时沿用触发器的模糊半径。
`GlassSurface` 的 `frostRadius` 缓存键补丁已由上游吸收，本地不再重复维护。
`upstream.json` 的 `files` 保存上游原始哈希（含许可和随包法律文本来源），
`patchedFiles` 和 `patches` 分别记录补丁后的源码与补丁文件哈希。
`exclude-audio-tests.patch` 仅排除音频控件对应的两个上游测试。
`segmented-glass-track.patch` 为分段轨道添加可选玻璃背景，在线字体标题栏的图标分段
启用该选项。拨片常态复用底栏的浅色黑色 10%／深色白色 10% 底色，按住时共用
底栏的采样源、折射、边缘高光、内外阴影及表面叠色，保留分段自身的拖动形变与回弹。
减少透明度时使用实色轨道，其他分段控件保持上游默认材质。
运行 `node experiments/mobile/scripts/verify-glasmio.mjs [上游检出目录]` 校验来源、
四模块源码边界、随包许可与补丁；提供上游目录时还会核对提交并从原始文件重放全部补丁。

## 外观设置控件

「外观与显示」的字号选择接入 `GlasmioAdaptiveSlider`，使用离散模式映射已有
18／24／30 三档和共享的「小／中／大」语言键；默认预览视图使用 56 dp 的
图标分段控件，标签位于轨道下方，仅包含网格与列表，不创建自适应档位。
两者通过 `FolioAppearanceControlView` 复用页面背景源、主题与 overlay 生命周期，
事件计数拒绝迟到的偏好回写。偏好未加载和页面不活动时禁用，设置搜索可定位对应行。
iOS 与 Android 兼容包继续使用现有选项控件。

Adaptive 源码从同一锁定提交补入，`adaptive-slider-glyph.patch` 将默认音频图片
替换为应用字体图标，保留原始哈希及补丁记录，不导入 Apple 图片资源。
该补丁也让自建弹簧在减少动态效果时直接收敛；
`appearance-reduced-motion.patch` 为普通分段添加可选的按压形变开关，默认行为不变。
RN 监听系统减少动态效果变化，外观控件关闭弹簧过渡与形变，同时保留点击、拖动、
键盘及读屏调整。控件高度随系统字号增加，文案继续复用现有语言键。

本次控件接入验证（2026-10-29）：移动端 TypeScript、ESLint、141 项既有行为测试、
Android JS 导出、语言目录检查及 77 项来源／5 项补丁哈希校验通过。
从锁定提交重新下载两个相关源文件，原始哈希及三项相关补丁零模糊重放通过。
当前云环境未安装 Android SDK，未进行原生编译、设备截图、浅深色视觉或拖动手感验收。

## 页面取样与生命周期

Android 在线浏览器保留原网页视口和 `browserBottom` 避让，采样源扩展至该页面完整内容区，
覆盖地址栏和底栏所在区域。网页成功、加载中和失败状态使用同一页面语义底色。

背景源和每个玻璃消费者均显式接收当前页面的 `theme.background`，不使用卡片或控件表面色。
消费者持有自己的底色，因此背景源停用、切换或卸载时不会借用下一页颜色。
`FolioPageBackdrop` 在实际取样画布底层先绘制不透明页面色，再叠加可用的实时 RenderNode。
底色覆盖整张画布（含模糊、折射扩边），不受原 RenderNode 边界或坐标可用性限制；
随后仍经过原有 Glasmio 模糊、折射、内阴影和材质管线。源节点内部也填入同一底色，
避免 WebView 或正文透明区域向下透出空像素。

屏幕坐标映射包含 Compose 图层变换、祖先页面缩放位移及独立窗口位置；
四点映射支持透视变换。消费者与源的位置变化只使取样失效，不重新录制未变化的正文。
页面停用、隐藏、卸载或窗口进入后台时注销来源并丢弃 RenderNode；
隐藏后的最后一帧不会重建图层。恢复可见后重新登记并录制实时内容，
不永久保留旧帧。原生 overlay 的三个 lifecycle owner 绑定保持原样。

根因证据、场景覆盖和未验收范围见 [本轮验证记录](android-glasmio-validation.md)。

## 构建与兼容规则

| 类型 | 系统范围 | 最低 API | 控件实现 |
| --- | --- | --- | --- |
| `legacy` | Android 11–12L | 30 | 现有原生组件 |
| `glasmio` | Android 13+ | 33 | Glasmio 默认组件 |

应用和原生模块使用同名 `glassTier` flavor，共享原有正式／开发应用身份。
正式包共用签名和数据目录。构建号由发布序号乘十后分别加一、加二生成，
发布序号范围为 `1..209999999`。应用清单写入 `com.folio.android.GLASS_TIER`。

兼容版源码及原有 `com.kyant` 实现放入 `src/legacy/`，高版本源码放入
`src/glasmio/`。同一 APK 不包含两套同名 Backdrop 类。
兼容版保留 Compose `1.10.6`；新 Compose 依赖只进入高版本包。

Expo Config Plugin 可重复生成 flavor、模块注册和 Kotlin 版本配置。
宿主 Kotlin 固定为 `2.4.21`，构建使用 JDK 21，字节码目标保持 17。
Compose `1.12.1` 的 AAR 元数据要求 AGP `9.1.0+`，宿主使用 `9.1.0`。
兼容补丁移除 Expo 库模块已删除的 targetSdk 写入，并确保 React Native 全工程监听只注册一次。
保留独立 Kotlin 插件及旧 DSL，兼容现有 Expo/RN 构建配置；不跳过 AAR 兼容检查。
Gradle 堆内存为 4 GiB、Metaspace 为 2 GiB，最多两个并行工作线程，防止默认 512 MiB
Metaspace 导致 Reflection 初始化连带失败。

Expo 的 Pika 编译优化尚无该 Kotlin 版本的对应制品。通过受版本锁定的 pnpm
补丁，在关闭优化时不加载该编译器插件，并让属性／返回值转换使用已有反射路径。
补丁不修改玻璃渲染或动画，安装依赖时自动应用。

## 控件转换接口

`GlassControlScope` 随 `NavigationBackdrop` 传递背景源和页面活动状态。
Slider、Switch 和云端分段通过上下文取得 `sourceId`；Slider、Switch 还传递
稳定的 `controlId`。显式 `sourceId` 可以覆盖上下文，不改变现有业务回调。

- Slider 继续传递数值范围、步长、语义主题色和编辑状态；事件计数单调递增，
  拒绝非有限数值、重复事件和迟到事件。
- Switch 继续使用受控值、禁用态与应用主题色，页面不活动时不提交变化。
- 原生兼容实现接收背景源和身份字段，保持现有绘制方式。
- 高版本在相同接口后封装 Glasmio；顶栏按钮通过原生构建常量选择实现，不按 JS 系统版本判断。

原生 `aboutInfo()` 增加 `sdkInt`、`androidVariant` 和 `requiresVariantUpdate`。
正式兼容包在 API 33+ 必须进入更新页；未知构建信息不能放行主页面。
开发包由原生明确豁免正式包迁移，不尝试安装正式签名 APK。
业务提供器在兼容检查通过后才挂载；原生字体／同步运行时也检查兼容状态。

## 更新协议

保留旧 `folio-release.json`；新增客户端支持读取 schema 2 的
`folio-release-v2.json`。新清单的 Android 产物包含：

- `androidVariant`：`legacy` 或 `glasmio`；
- `minSdk`：分别为 30、33；
- `maxSdk`：只在兼容包中为 32，作为客户端选择条件；
- `versionCode`：与 APK 实际构建号一致。

选择顺序为系统类型和运行架构，不接受重复、范围重叠、错误文件名或不一致的构建号。
同次发布两种类型的构建号相差一，同类型两个 ABI 的构建号必须相同。

兼容包保留 `Folio-vX.Y.Z-android-<arch>.apk` 文件名，高版本包使用
`Folio-vX.Y.Z-android-glasmio-<arch>.apk`。
强制迁移先查询当前版本的 v2 清单，再查询最新正式版本，不回退到未知类型的旧清单包。

允许同版本由兼容包迁移到更高构建号的高版本包，禁止降级或重复安装。
下载缓存按版本、类型、架构和构建号隔离；旧任务重新校验或清理。
安装前核对实际包名、签名、版本、构建号、最低 API、类型元数据、ABI、大小和 SHA-256。
取消安装、断网或下载失败均不解除正式包的兼容限制。

发布工作流按 Gradle 输出元数据归档四包，逐包验收签名、ABI、版本、构建号、最低 API 与类型元数据，生成兼容旧客户端的清单和包含完整矩阵的 v2 清单。

## 验证入口

```sh
pnpm --dir experiments/mobile install --frozen-lockfile
node experiments/mobile/scripts/verify-glasmio.mjs
pnpm --dir experiments/mobile typecheck
pnpm --dir experiments/mobile lint
pnpm --dir experiments/mobile test
pnpm --dir apps/desktop-ui test src/android-release.test.ts src/mobile-update.test.ts
pnpm i18n:validate
```

原生单元测试使用 `:folio-native:testLegacyDebugUnitTest`。
安装安全测试使用 `ANDROID_SERIAL=<临时模拟器序列号> pnpm --dir experiments/mobile test:updates`，
仅允许名为 `FolioUpdateTest` 的 Android 13+ 临时模拟器，测试签名与数据完全独立。
测试覆盖错误类型、系统范围、ABI、构建号、签名、哈希、旧任务与同版本任务恢复。

转换层阶段已通过 24 项更新协议测试、26 项原生单元测试和独立模拟器上的
26 项安装安全检查。控件接入后已重新通过移动端类型检查、Lint、141 项行为测试、24 项更新协议测试、
26 项原生单元测试，以及 Glasmio Release APK 构建。
此结果不代表四套正式 APK、控件视觉、动画手感或性能指标已完成验收。

`pnpm --dir experiments/mobile android` 要求已连接设备，按设备 API 选择 `legacyDebug`
或 `glasmioDebug`，并使用 JDK 21，避免默认 `assembleDebug` 同时构建两套版本。
多个设备时通过 `--device <序列号>` 指定。手动打包使用 `assembleLegacyRelease` 或
`assembleGlasmioRelease`，本机可加 `-Pfolio.android.abi=arm64|x64` 缩小构建范围。

Glasmio 取样回归使用独立测试 APK，不读取应用字体库、同步账号或偏好设置：

```sh
cd experiments/mobile/android
./gradlew :folio-native:assembleGlasmioDebugAndroidTest -PfolioBackdropTest=true -PreactNativeArchitectures=arm64-v8a
adb install -r ../modules/folio-native/android/build/outputs/apk/androidTest/glasmio/debug/folio-native-glasmio-debug-androidTest.apk
adb shell am instrument -w com.folio.poc.test/com.folio.poc.navigation.FolioGlasmioBackdropInstrumentation
```

测试包含原始取样像素、完整材质对照、缺源、越界、无坐标、图层变换、语义底色变化、
重复出入与 overlay 重挂载、后台恢复，以及离线 WebView 成功／独立网络失败场景。
该测试不是完整视觉与手感验收。
