# iOS Installed Fonts Report

日期：2026-09-30。范围：评估 Folio 实验手机端读取、展示和更新 iOS 已安装字体的可行性；本次不修改字体桥接、权限、签名、Rust ABI 或数据库。

## Conclusion

可以使用和预览系统允许 Folio 访问的字体，并自动更新这些字体的可用状态。普通 Fonts capability 不提供全部用户安装字体的清单；要自动展示完整清单，需要向 Apple 申请 **Font Enumeration entitlement**，获批前不能把全量自动扫描作为可交付功能。[Apple Fonts](https://developer.apple.com/documentation/technologyoverviews/fonts)

## Capability Matrix

| 需求 | 可行性与边界 |
| --- | --- |
| 展示系统公开可用的字体 | 可用 UIKit/CoreText 获取当前应用可见的字体并预览；不使用 Apple 私有字体名称。 |
| 使用其他应用或描述文件安装的字体 | 添加 Fonts 的 Use Installed Fonts 能力，由 `UIFontPickerViewController` 返回用户选择的字体描述符，再由 CoreText 预览。选择器不把完整清单交给应用。 |
| 按已知名称解析已安装字体 | 可调用 `CTFontManagerRequestFonts` 请求指定描述符；返回无法解析的项，系统可能显示缺失字体提示。它不是全量枚举接口。 |
| 自动列出所有用户安装字体 | 需要申请 Font Enumeration 特许权限。申请须解释系统选择器为何不足，以及枚举数据的用途；是否获批尚未确定。 |
| 自动响应字体新增或移除 | 可监听注册变化通知并在回到前台时重新解析应用已获准访问的字体；通知不授予额外访问权限。 |
| 将已安装字体导出或同步为原始文件 | 不应承诺。取得字体描述符不等于取得可复制的原文件；没有原文件时只提供本机预览和可用状态。 |

选择器与枚举权限依据：[Apple Fonts](https://developer.apple.com/documentation/technologyoverviews/fonts)。Fonts capability 配置依据：[Configuring custom fonts](https://developer.apple.com/documentation/xcode/configuring-custom-fonts)。指定字体请求的返回值与系统提示依据：[CTFontManagerRequestFonts](https://developer.apple.com/documentation/coretext/ctfontmanagerrequestfonts(_:_:))。

## API Boundaries

`CTFontManagerCopyRegisteredFontDescriptors(.persistent, true)` 在 iOS 上只返回当前应用进程注册的字体，不能用来获取其他应用安装的全部字体。[Apple API 文档](https://developer.apple.com/documentation/coretext/ctfontmanagercopyregisteredfontdescriptors(_:_:))

当前 Xcode 27 的 iPhoneOS SDK 中，`CTFontManagerCopyAvailableFontURLs` 明确标记为 iOS 不可用，因此不能照搬 macOS 的全局字体路径扫描。描述符中即使出现 URL，也不应把它当作稳定、可读、可导出的文件权限。这是基于 SDK 声明与当前沙盒边界的实现判断。

`kCTFontManagerRegisteredFontsChangedNotification` 可用于刷新状态。字体提供方安装或卸载字体后，使用方应重新解析描述符；Folio 不能注销其他字体提供应用拥有的字体。[Apple WWDC19：Font Management and Text Scaling](https://developer.apple.com/videos/play/wwdc2019/227/)

## Current Project

目前 `app.json` 没有 Fonts capability。`FolioNativeModule.swift` 只导入用户选择的文件到应用托管目录；`FolioFontPreview.swift` 通过 `managedFont(sourcePath)` 读取这些副本，再按文件成员和轴值生成预览。现有字体条目使用文件路径、内容身份和 revision，不能直接容纳只有系统描述符的字体。

系统字体接入需要独立的来源类型与原生预览入口，不能伪造沙盒文件路径，也不能把 PostScript 名称当成内容哈希。名称相同不保证版本或文件相同；与已导入文件合并时应保留来源。

## Proposed Integration

第一步使用系统字体选择器取得用户选中的字体，在 Swift 层保存可重新解析的描述符信息；按描述符和变量轴生成真实 CoreText 预览。启动及前台恢复时重新检查可用性，注册变化时刷新，字体被移除或解析失败时显示不可用状态。该方案无需修改跨平台 Rust 核心来调用 iOS API。

如果目标是让主页自动列出设备全部已安装字体，先申请 Font Enumeration 权限。获批后再评估全量枚举、增量刷新和现有搜索/收藏的接入；没有原始文件的条目不启用文件导出或云端上传。

以上是文档与源码评估，尚未验证当前开发者账号的特许权限或真机字体可见范围。本次没有接入系统字体功能，也没有发起权限申请。
