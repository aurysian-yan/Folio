# P0 / P1 Implementation and Validation

日期：2026-10-17。起始提交：`a0552ed`；以下结果对应本批实现变更。
主机 macOS 27.2 arm64、Xcode 27.1（27A9275）；Android 为 Pixel 10 模拟器、
Android 17／API 37／arm64，串号 `emulator-5580`。

P0、P1 **已开始，整体仍为 PARTIAL**。本记录将实现、主机回归、原生模拟器验证与
实际客户端／服务商验收分开。没有开始 wire v2 或后续平台重建。

## P0 Changes

- 修正历史 Windows 存储测试的两个平台假设：事务回滚样本使用真实临时目录的
  绝对路径；时间往返按 Windows 100 纳秒精度断言，仍检查负值和溢出拒绝。
  本轮只在 macOS 执行，**Windows 实测仍待补齐**。
- 共享 Storage 可从缓存恢复文件级诊断，损坏文件没有有效 Face 也不会消失；
  损坏数按实际文件去重，重叠根目录不重复计数。未增加数据库 schema 或同步格式。
- UniFFI 重开后重新读取损坏统计，不再依靠进程内初始零；最近刷新中的离线、
  读取失败等瞬时问题可供 macOS 展示。缓存诊断是上次解析结果，不能代表全面检测。
- 增加隔离的本机 HTTPS WebDAV 服务和显式测试证书构建。生产默认配置、HTTPS
  要求和系统信任行为不变。复现和清理说明见 [Local WebDAV Validation](../tools/testing/README.md)。

## P1 Changes

- macOS 使用 SwiftUI `Window(id: "font-installation")` 承载安装工作流，移除主窗
  导入结果 Sheet。应用持有共享模型，关闭窗口不会销毁正在执行的任务或结果；
  系统窗口菜单可重新打开。
- 导入先只读分析：格式、Family／Face、集合索引、已存在的相同修订和其他修订
  来自 Rust；分析不登记来源、不复制文件。用户在窗口选择 Reference、Collect、
  Activate、Install 或 Collect + Activate，批次执行期间固定输入，新输入留待处理。
  原有默认导入偏好保留；关闭“每次询问”时，仅无重复、冲突或文件问题的批次
  自动采用默认方式，结果显示实际来源决策。
- Collect + Activate 分开记录复制与启用结果；失败重试只处理失败文件／阶段。
  操作后的刷新失败不会把已经完成的操作改写成失败。
- 新的持久安装始终使用独立安装副本；托管副本与安装副本分别记账。外部原件
  不可用时仍保留 Folio 安装副本的卸载入口；旧账本的完整迁移与系统回归未在此宣告完成。
- Collect 与 Export 先暂存、核对字节指纹并重新解析暂存文件；已有目标内容不符
  时报告错误，拒绝覆盖。
  单字体、导入批量和当前查询／手动／智慧收藏夹可导出；收藏夹采用完整共享查询的
  匹配 Face 快照，不只导出已加载的一页。按实际文件去重，TTC／OTC 保持原文件，
  同名目标逐项失败，原件保留。
- macOS 健康页接入文件问题、Finder 定位与重新检测；首次检测完成前隐藏损坏
  数摘要和健康计数。Tauri 损坏数改为真实缓存统计，并验证重开和修复。

## Local HTTPS / Android Evidence

两个实例均为 WsgiDAV 4.3.3 + Cheroot 11.0.0，监听本机 `127.0.0.1:9443`／`:9444`，
各自使用独立目录。模拟器通过 ADB 端口转发访问，显式验收构建仅为回环地址使用
指定证书根，仍验证链与主机名。没有安装系统 CA，没有读取已保存的服务商账号。

模拟器采用 `-read-only -no-snapshot`；目标包为 `com.folio.mobile.poc.dev`。
原生 Instrumentation 使用生产 Kotlin／UniFFI／Rust／原生预览模块，建立两个
临时子库；不启动 Expo JS。临时 debug manifest 只移除发生测试资源 ID 冲突的
AndroidX Startup provider，验收后恢复。因此本结果**不是完整应用启动／页面交互，
也不是 macOS↔Android 实际应用往返**。

| Check | 9443 | 9444 |
| --- | --- | --- |
| 上传、第二库下载与目录刷新 | PASS | PASS |
| TTF／OTF／TTC 成员 1／变量 `wght=700`，四个真实文件、原字节 SHA-256、实际来源原生绘制 | PASS | PASS |
| 仅云端、另一库保留、明确重下和重新解析 | PASS | PASS |
| 全设备删除、最近删除恢复、收藏／成员／最近记录保留 | PASS | PASS |
| 独立冲突样本的 KEEP_BOTH／USE_LOCAL／USE_REMOTE | PASS | PASS |
| 错误认证不丢本地资料、改正后重试 | PASS | PASS |
| 取消、完成取消与重新同步 | PASS | PASS |

测试显式开启临时库下载，按字节定位下载结果；统一目录的可见 Face 数包含云占位，
不能用它替代实际文件下载证明。每种冲突决策使用独立收藏夹，避免上一种决策改变
下一种样本的实体。两实例属于**相同服务端实现的独立本地测试**，不算两个真实服务商。

- 9443 测试目录：`local-validation/validation-0c9bab0c-80fc-4208-b3b2-f71b2513e38b`。
- 9444 测试目录：`local-validation/validation-74acad78-9210-4b50-bbcc-2858c9fd664c`。
- 本机日志：`experiments/mobile/.build/p0-local-webdav/android-cycle-final.log`、
  `android-cycle-second.log`；原生临时库由测试释放并删除，服务数据保留在指定测试目录。

## Automated Checks

| Check | Result |
| --- | --- |
| Storage／FFI | PASS，96 项，含 v11／v6 缺表迁移、缓存重建与用户资料保留、新的缓存诊断／重开／修复与只读分析回归 |
| Query | PASS，18 项受控回归 |
| Sync | PASS，31 项受控回归；含来源、上传排除、墓碑／恢复、连接切换、取消和冲突场景 |
| Tauri Rust | PASS，完整套件 14 项及新增健康定向 1 项；1 项忽略未执行 |
| macOS | PASS，27 项；实际 App scene 打开、非模态、无 Sheet 父窗、关闭／重开，以及原件保留、复制去重、部分失败、只读分析、字节导出与不覆盖 |
| Desktop React | PASS，类型检查、Lint、104 项测试及构建；构建保留既有大 chunk 提示 |
| Mobile shared layer | PASS，类型检查、Lint、87 项测试 |
| Mobile Swift native | PASS，Keychain、来源恢复、导入／ZIP／回滚、查询／收藏／智慧条件与字符表主机冒烟；不算 iOS 实机 |
| Native artifacts | PASS，更新 Swift／Kotlin 绑定、Android arm64 库与测试 APK、iOS 设备／模拟器 XCFramework；构建不代表目标平台产品验收 |
| i18n／format／diff | PASS，2 种语言、948 个源字段；Rust 格式与 diff 空白检查 |

运行中主机内存交换使系统盘空间短暂不足，第一次移动 Swift 大文件样本与隔离 UI
启动失败。停止本次构建守护进程、转移本次失败样本释放资源后，使用正常临时目录
重跑通过；失败尝试没有计入 PASS。

## Remaining Acceptance

1. 123PAN 与独立 HTTPS 服务商的完整实网矩阵、macOS↔Android 实际应用往返；
   Windows／iOS 的实际客户端矩阵跟随平台验收。当前本地双库不能替代这些项目。
2. 真实断网／重连、前后台和重启恢复、服务端配额、本地满盘、部分传输等完整故障
   矩阵；本机偶发空间不足不作为受控满盘验收。
3. macOS Library 与安装窗口同时搜索／预览、Finder 连续转交、浅深色、长文本、
   键盘／读屏、权限失效、真实持久安装／停用／卸载／重启的整套人工回归。
4. 持久批次 ID、多批次结果历史、进程重启后的恢复和明确取消执行中的操作；本批
   只保留当前进程中的输入队列、当前结果与关闭后继续执行。
5. 同步、清理、原生预览／文件提供与字体操作之间的统一在用文件协调；本批没有
   用窗口忙状态代替共享来源保护，也没有宣告相关有损操作全部安全。
6. 云占位导出的按需下载协调；当前没有可读源的项目明确失败，不静默跳过。旧安装
   账本迁移、跨平台未扫描／离线／撤权统计、健康恢复与移动健康入口继续验收。

完成上述对应项前，保持 P0／P1 为 PARTIAL，不推进 wire v2 的产品投入门槛。

## Cleanup

已恢复临时 debug manifest 与普通 Android Rust 库，并重新构建普通 Debug APK。
两套 WebDAV、本轮模拟器、ADB 及构建／测试守护进程均已停止；相关监听端口与
子进程在结束前核对。验证日志和
本机隔离测试数据留在忽略的 `.build` 目录；不保存真实账号或私钥到版本库。
