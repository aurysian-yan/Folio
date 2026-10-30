#if canImport(FolioFileServices)
import FolioFileServices
#endif
import ExpoModulesCore
import UIKit

// 卡片材质独立于内容，系统玻璃向旧系统回退为模糊背景。
final class FolioPanelBackdrop: ExpoView {
    private let material = UIVisualEffectView()
    private let frost = UIVisualEffectView()
    var blurRadius: Double = -1 { didSet { updateMaterial() } }
    var liquid = false { didSet { updateMaterial() } }
    var dark = false { didSet { overrideUserInterfaceStyle = dark ? .dark : .light } }
    var cornerRadius: Double = 24 { didSet { material.layer.cornerRadius = cornerRadius } }

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        isUserInteractionEnabled = false
        isOpaque = false
        material.layer.cornerCurve = .continuous
        material.clipsToBounds = true
        frost.layer.cornerCurve = .continuous
        frost.clipsToBounds = true
        addSubview(frost)
        addSubview(material)
        updateMaterial()
    }

    // 提示浮层叠加厚材质，拨片保留清晰的系统玻璃折射。
    private func updateMaterial() {
        frost.effect = blurRadius >= 16 ? UIBlurEffect(style: .systemThickMaterial) : nil
        if #available(iOS 26.0, *) {
            material.effect = UIGlassEffect(style: liquid ? .clear : .regular)
        } else {
            material.effect = UIBlurEffect(style: blurRadius >= 16 ? .systemThickMaterial : liquid ? .systemUltraThinMaterial : .systemMaterial)
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        frost.frame = bounds
        frost.layer.cornerRadius = cornerRadius
        material.frame = bounds
        material.layer.cornerRadius = cornerRadius
    }
}
