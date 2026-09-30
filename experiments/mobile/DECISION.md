# Mobile PoC Boundary

## Status

2026-09-30，实验基础决策已采用；RN + Expo 的生产采用决策仍待阶段 D 的 go/no-go。双原生 Kotlin/Compose + SwiftUI 继续作为比较基线。

## Decision

在 `experiments/mobile` 建立独立 Expo development build，复用现有 UniFFI Swift/Kotlin bindings。RN 只负责输入、分页和页面状态，原生模块负责沙盒文件与后台调用，Rust 保持身份、解析、持久化和查询的唯一实现。iOS 原生库以 XCFramework 静态链接；Android 以 ABI 独立的 `.so` 加 JNA AAR 接入。

本实验只暴露 `initialize`、`query`、`importFont` 和原生预览视图，不为 PoC 新建 C ABI、不修改 `folio-ffi` 或生产 SQLite schema。Swift 串行后台队列和 Kotlin 单线程执行器持有各自的引擎；模块销毁后按顺序释放，JS 不持有 Rust 指针。

UniFFI 0.32.1 使用全局配置的 `crates.folio_ffi` 节点。Kotlin 的错误字段 `Operation.message` 通过官方 rename 配置映射为 `detail`，避免与 `Throwable.message` 冲突；该配置仅改变生成 Kotlin 的字段名，保持 Rust ABI 与校验检查。

动态字体不走 Expo Font 的应用级字体名称缓存。原生预览直接打开用户导入的托管副本，携带实际 Face index、revision 和轴值。Android 检查塑形结果中的源文件和 TTC index，再用具体 Font 绘制字形；iOS 从集合描述符选取指定成员、检查字形覆盖并限制 cascade。损坏、不可读或缺字状态必须返回给页面。

## Consequences

桌面客户端和数据库保持原有边界。实验可独立删除；独立锁文件防止把移动依赖加入桌面 workspace。生成绑定必须与正在打包的 `folio-ffi` 来自同一源码与 Cargo.lock；变更 Rust 后重新生成两端绑定及原生库。

同步 Rust 查询尚不可抢占；JS 取消只防止过期结果回写。当前预览没有多字体缓存、复杂双向文本分段或两轴连续拖动界面；Android API 28–30 的准确字形绘制另验。当前库不接 WebDAV、不保存凭据，也不承诺 Provider、Files/Share 导出、MIUIX、Liquid Glass 或移动导航已经验证。

## Adoption Gate

阶段 D 的全部实验矩阵通过后，再记录生产 go/no-go：两端桥接线程/冷启动/内存、真实 TTF/OTF/TTC 与两轴拖动、系统导航与无障碍、Android Compose/MIUIX 和玻璃导航、DocumentsProvider URI/按需读取、iOS Files/Share 与 File Provider 需求判定。任何关键项失败都保留双原生方案，不以主机编译或模拟器代替实机数据。

## References

- [Expo 自定义原生代码](https://docs.expo.dev/workflow/customizing/)
- [Expo Modules API](https://docs.expo.dev/modules/module-api/)
- [UniFFI Kotlin/JNA](https://mozilla.github.io/uniffi-rs/latest/kotlin/gradle.html)
- [Android TextRunShaper](https://developer.android.com/reference/android/graphics/text/TextRunShaper)
- [Android Canvas.drawGlyphs](https://developer.android.com/reference/android/graphics/Canvas#drawGlyphs(int[],int,float[],int,int,android.graphics.fonts.Font,android.graphics.Paint))
