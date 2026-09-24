import AppKit
import CoreText
import SwiftUI

enum FontPreviewVerticalAlignment {
    case top
    case center
}

struct FontPreviewView: NSViewRepresentable {
    let text: String
    let face: FaceSummary?
    let size: Double
    let color: Color
    let axes: [String: Double]
    var alignment: NSTextAlignment = .center
    var verticalAlignment: FontPreviewVerticalAlignment = .center
    var lineLimit = 1
    var lineHeight: Double?

    func makeNSView(context: Context) -> LocalFontPreviewNSView {
        let view = LocalFontPreviewNSView()
        view.wantsLayer = true
        view.layer?.masksToBounds = true
        return view
    }

    func updateNSView(_ view: LocalFontPreviewNSView, context: Context) {
        view.text = text
        view.font = FontPreviewCache.shared.font(for: face, size: size, axes: axes)
        view.textColor = NSColor(color)
        view.alignment = alignment
        view.verticalAlignment = verticalAlignment
        view.lineLimit = lineLimit
        view.lineHeight = lineHeight
        view.needsDisplay = true
    }

    func sizeThatFits(
        _ proposal: ProposedViewSize,
        nsView: LocalFontPreviewNSView,
        context: Context
    ) -> CGSize? {
        guard let width = proposal.width, width.isFinite else { return nil }
        let requiredHeight = nsView.requiredHeight(for: width)
        guard let height = proposal.height, height.isFinite, height > 0 else {
            return CGSize(width: width, height: requiredHeight)
        }
        return CGSize(width: width, height: min(requiredHeight, height))
    }
}

@MainActor
func localFontGlyphCount(for face: FaceSummary) -> Int? {
    FontPreviewCache.shared.glyphCount(for: face)
}

@MainActor
func localFont(for face: FaceSummary, size: Double, axes: [String: Double]) -> NSFont {
    FontPreviewCache.shared.font(for: face, size: size, axes: axes) as NSFont
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

    func glyphCount(for face: FaceSummary) -> Int? {
        guard face.sourcePath != nil else { return nil }
        return CTFontGetGlyphCount(font(for: face, size: 12, axes: [:]))
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
    var verticalAlignment: FontPreviewVerticalAlignment = .center
    var lineLimit = 1
    var lineHeight: Double?

    override var isFlipped: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        let attributed = attributedString()
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
        let baseline: CGFloat
        switch verticalAlignment {
        case .top:
            baseline = max(descent, bounds.height - ascent)
        case .center:
            baseline = max(descent, (bounds.height - ascent - descent) / 2 + descent)
        }
        context.saveGState()
        context.clip(to: bounds)
        context.textMatrix = .identity
        context.textPosition = CGPoint(x: x, y: baseline)
        CTLineDraw(line, context)
        context.restoreGState()
    }

    func requiredHeight(for width: CGFloat) -> CGFloat {
        guard lineLimit > 1 else {
            let naturalHeight = CTFontGetAscent(font)
                + CTFontGetDescent(font)
                + CTFontGetLeading(font)
            return ceil(CGFloat(lineHeight ?? Double(naturalHeight)))
        }
        let framesetter = CTFramesetterCreateWithAttributedString(attributedString())
        let maximumHeight = ceil(
            CGFloat(lineHeight ?? CTFontGetSize(font) * 1.15) * CGFloat(lineLimit)
        )
        let suggested = CTFramesetterSuggestFrameSizeWithConstraints(
            framesetter,
            CFRange(),
            nil,
            CGSize(width: width, height: maximumHeight),
            nil
        )
        return min(maximumHeight, ceil(suggested.height))
    }

    private func attributedString() -> NSAttributedString {
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
        var resolvedLineHeight = CGFloat(lineHeight ?? 0)
        let hasLineHeight = resolvedLineHeight > 0
        let paragraphStyle = withUnsafePointer(to: &textAlignment) { alignmentPointer in
            withUnsafePointer(to: &lineBreakMode) { lineBreakPointer in
                withUnsafePointer(to: &resolvedLineHeight) { lineHeightPointer in
                    var settings = [
                        CTParagraphStyleSetting(
                            spec: .alignment,
                            valueSize: MemoryLayout<CTTextAlignment>.size,
                            value: alignmentPointer
                        ),
                        CTParagraphStyleSetting(
                            spec: .lineBreakMode,
                            valueSize: MemoryLayout<CTLineBreakMode>.size,
                            value: lineBreakPointer
                        ),
                    ]
                    if hasLineHeight {
                        settings.append(CTParagraphStyleSetting(
                            spec: .minimumLineHeight,
                            valueSize: MemoryLayout<CGFloat>.size,
                            value: lineHeightPointer
                        ))
                        settings.append(CTParagraphStyleSetting(
                            spec: .maximumLineHeight,
                            valueSize: MemoryLayout<CGFloat>.size,
                            value: lineHeightPointer
                        ))
                    }
                    return CTParagraphStyleCreate(settings, settings.count)
                }
            }
        }
        return NSAttributedString(
            string: text,
            attributes: [
                NSAttributedString.Key(kCTFontAttributeName as String): font,
                NSAttributedString.Key(kCTForegroundColorAttributeName as String): textColor.cgColor,
                NSAttributedString.Key(kCTParagraphStyleAttributeName as String): paragraphStyle,
            ]
        )
    }

    private func drawMultiline(_ attributed: NSAttributedString, in context: CGContext) {
        let framesetter = CTFramesetterCreateWithAttributedString(attributed)
        let maximumHeight = min(
            bounds.height,
            ceil(CGFloat(lineHeight ?? CTFontGetSize(font) * 1.15) * CGFloat(lineLimit))
        )
        let suggested = CTFramesetterSuggestFrameSizeWithConstraints(
            framesetter,
            CFRange(),
            nil,
            CGSize(width: bounds.width, height: maximumHeight),
            nil
        )
        let height = min(maximumHeight, ceil(suggested.height))
        let originY: CGFloat
        switch verticalAlignment {
        case .top:
            originY = max(0, bounds.height - height)
        case .center:
            originY = max(0, (bounds.height - height) / 2)
        }
        let rect = CGRect(x: 0, y: originY, width: bounds.width, height: height)
        let path = CGPath(rect: rect, transform: nil)
        let frame = CTFramesetterCreateFrame(framesetter, CFRange(), path, nil)
        context.saveGState()
        context.clip(to: bounds)
        context.textMatrix = .identity
        CTFrameDraw(frame, context)
        context.restoreGState()
    }
}
