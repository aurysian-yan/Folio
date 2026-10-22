#if canImport(FolioFileServices)
import FolioFileServices
#endif
import ExpoModulesCore
import UIKit

// 卡片材质独立于内容，系统玻璃向旧系统回退为模糊背景。
final class FolioPanelBackdrop: ExpoView {
    private let material = UIVisualEffectView()
    var dark = false { didSet { overrideUserInterfaceStyle = dark ? .dark : .light } }
    var cornerRadius: Double = 24 { didSet { material.layer.cornerRadius = cornerRadius } }

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        isUserInteractionEnabled = false
        isOpaque = false
        material.layer.cornerCurve = .continuous
        material.clipsToBounds = true
        if #available(iOS 26.0, *) {
            material.effect = UIGlassEffect(style: .regular)
        } else {
            material.effect = UIBlurEffect(style: .systemMaterial)
        }
        addSubview(material)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        material.frame = bounds
        material.layer.cornerRadius = cornerRadius
    }
}
