import AppKit
import CoreText
import SwiftUI

struct FontPreviewView: NSViewRepresentable {
    let text: String
    let face: FaceSummary?
    let size: Double
    let color: Color
    let axes: [String: Double]
    var alignment: NSTextAlignment = .center
    var lineLimit = 1

    func makeNSView(context: Context) -> LocalFontPreviewNSView {
        LocalFontPreviewNSView()
    }

    func updateNSView(_ view: LocalFontPreviewNSView, context: Context) {
        view.text = text
        view.font = FontPreviewCache.shared.font(for: face, size: size, axes: axes)
        view.textColor = NSColor(color)
        view.alignment = alignment
        view.lineLimit = lineLimit
        view.needsDisplay = true
    }
}

@MainActor
private final class FontPreviewCache {
    static let shared = FontPreviewCache()

    private let cache = NSCache<NSString, CTFontBox>()

    func font(for face: FaceSummary?, size: Double, axes: [String: Double]) -> CTFont {
        let fallback = CTFontCreateWithName("Helvetica" as CFString, size, nil)
        guard let face, let path = face.sourcePath else {
            return fallback
        }
        let axisKey = axes.sorted { $0.key < $1.key }
            .map { "\($0.key):\($0.value)" }
            .joined(separator: ",")
        let key = "\(face.revisionID)|\(path)|\(face.faceIndex)|\(size)|\(axisKey)" as NSString
        if let cached = cache.object(forKey: key) {
            return cached.font
        }

        let url = URL(fileURLWithPath: path)
        let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor]
        let index = min(Int(face.faceIndex), max(0, (descriptors?.count ?? 1) - 1))
        let descriptor = descriptors?[index]
        var font = descriptor.map { CTFontCreateWithFontDescriptor($0, size, nil) } ?? fallback
        if !axes.isEmpty {
            let variations = Dictionary(uniqueKeysWithValues: axes.map {
                (NSNumber(value: Self.tagValue($0.key)), NSNumber(value: $0.value))
            })
            let descriptor = CTFontDescriptorCreateCopyWithAttributes(
                CTFontCopyFontDescriptor(font),
                [kCTFontVariationAttribute: variations] as CFDictionary
            )
            font = CTFontCreateWithFontDescriptor(descriptor, size, nil)
        }
        cache.setObject(CTFontBox(font), forKey: key)
        return font
    }

    private static func tagValue(_ tag: String) -> UInt32 {
        tag.utf8.prefix(4).reduce(0) { ($0 << 8) | UInt32($1) }
    }
}

private final class CTFontBox {
    let font: CTFont

    init(_ font: CTFont) {
        self.font = font
    }
}

final class LocalFontPreviewNSView: NSView {
    var text = ""
    var font: CTFont = CTFontCreateWithName("Helvetica" as CFString, 48, nil)
    var textColor = NSColor.labelColor
    var alignment: NSTextAlignment = .center
    var lineLimit = 1

    override var isFlipped: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        var textAlignment: CTTextAlignment = .center
        switch alignment {
        case .left, .natural:
            textAlignment = .left
        case .right:
            textAlignment = .right
        default:
            break
        }
        var lineBreakMode: CTLineBreakMode = lineLimit > 1 ? .byWordWrapping : .byTruncatingTail
        let paragraphStyle = CTParagraphStyleCreate([
            CTParagraphStyleSetting(
                spec: .alignment,
                valueSize: MemoryLayout<CTTextAlignment>.size,
                value: &textAlignment
            ),
            CTParagraphStyleSetting(
                spec: .lineBreakMode,
                valueSize: MemoryLayout<CTLineBreakMode>.size,
                value: &lineBreakMode
            ),
        ], 2)
        let attributed = NSAttributedString(
            string: text,
            attributes: [
                NSAttributedString.Key(kCTFontAttributeName as String): font,
                NSAttributedString.Key(kCTForegroundColorAttributeName as String): textColor.cgColor,
                NSAttributedString.Key(kCTParagraphStyleAttributeName as String): paragraphStyle,
            ]
        )
        if lineLimit > 1 {
            drawMultiline(attributed, in: context)
            return
        }
        let line = CTLineCreateWithAttributedString(attributed)
        var ascent: CGFloat = 0
        var descent: CGFloat = 0
        var leading: CGFloat = 0
        let width = CGFloat(CTLineGetTypographicBounds(line, &ascent, &descent, &leading))
        let x: CGFloat
        switch alignment {
        case .left, .natural:
            x = 0
        case .right:
            x = max(0, bounds.width - width)
        default:
            x = max(0, (bounds.width - width) / 2)
        }
        let baseline = max(descent, (bounds.height - ascent - descent) / 2 + descent)
        context.saveGState()
        context.clip(to: bounds)
        context.textMatrix = .identity
        context.textPosition = CGPoint(x: x, y: baseline)
        CTLineDraw(line, context)
        context.restoreGState()
    }

    private func drawMultiline(_ attributed: NSAttributedString, in context: CGContext) {
        let framesetter = CTFramesetterCreateWithAttributedString(attributed)
        let maximumHeight = min(
            bounds.height,
            ceil(CTFontGetSize(font) * CGFloat(lineLimit) * 1.15)
        )
        let suggested = CTFramesetterSuggestFrameSizeWithConstraints(
            framesetter,
            CFRange(),
            nil,
            CGSize(width: bounds.width, height: maximumHeight),
            nil
        )
        let height = min(maximumHeight, ceil(suggested.height))
        let rect = CGRect(
            x: 0,
            y: max(0, (bounds.height - height) / 2),
            width: bounds.width,
            height: height
        )
        let path = CGPath(rect: rect, transform: nil)
        let frame = CTFramesetterCreateFrame(framesetter, CFRange(), path, nil)
        context.saveGState()
        context.clip(to: bounds)
        context.textMatrix = .identity
        CTFrameDraw(frame, context)
        context.restoreGState()
    }
}
