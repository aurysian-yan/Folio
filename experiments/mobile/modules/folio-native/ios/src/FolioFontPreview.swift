import CoreText
import ExpoModulesCore
import UIKit

final class FolioFontPreview: ExpoView {
    var selection = FolioPreviewSelection()
    let onStatus = EventDispatcher()
    private var lines: [CTLine] = []
    private var lastKey: String?
    private let workQueue = DispatchQueue(label: "com.folio.mobile.poc.preview", qos: .userInitiated)
    private var generation = 0

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        isOpaque = false
        contentMode = .redraw
    }

    func renderSelection() {
        let value = selection
        let axes = value.axes.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ";")
        let key = "\(value.sourcePath)|\(value.faceIndex)|\(value.revisionId)|\(axes)|\(value.text)|\(value.fontSize)|\(value.centered)"
        guard key != lastKey else { return }
        lastKey = key
        generation += 1
        let token = generation
        lines = []
        setNeedsDisplay()
        workQueue.async { [weak self] in
            let result = Self.makeFont(value)
            DispatchQueue.main.async { [weak self] in
                guard let self, self.generation == token else { return }
                switch result {
                case let .success(font):
                    let paragraphs = value.text.components(separatedBy: .newlines)
                    let supported = paragraphs.allSatisfy { paragraph in
                        let characters = Array(paragraph.utf16)
                        var glyphs = [CGGlyph](repeating: 0, count: characters.count)
                        return CTFontGetGlyphsForCharacters(font, characters, &glyphs, characters.count)
                    }
                    if supported {
                        let attributes: [NSAttributedString.Key: Any] = [
                            NSAttributedString.Key(kCTFontAttributeName as String): font,
                            NSAttributedString.Key(kCTForegroundColorAttributeName as String): UIColor.label.cgColor,
                        ]
                        self.lines = paragraphs.map {
                            CTLineCreateWithAttributedString(NSAttributedString(string: $0, attributes: attributes))
                        }
                    }
                    self.onStatus(["status": supported ? "ready" : "missing-glyph"])
                case .failure:
                    self.onStatus(["status": "error"])
                }
                self.setNeedsDisplay()
            }
        }
    }

    private static func makeFont(_ value: FolioPreviewSelection) -> Result<CTFont, Error> {
        Result {
            guard value.fontSize.isFinite, (8...160).contains(value.fontSize) else {
                throw NSError(domain: "FolioPreview", code: 4)
            }
            let url = try FolioPaths.managedFont(value.sourcePath)
            guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor],
                  descriptors.indices.contains(value.faceIndex) else {
                throw NSError(domain: "FolioPreview", code: 1)
            }
            let base = CTFontCreateWithFontDescriptor(descriptors[value.faceIndex], CGFloat(value.fontSize), nil)
            let available = CTFontCopyVariationAxes(base) as? [[CFString: Any]] ?? []
            var variation: [NSNumber: NSNumber] = [:]
            for (tag, number) in value.axes {
                guard tag.utf8.count == 4, number.isFinite else { throw NSError(domain: "FolioPreview", code: 2) }
                let identifier = tag.utf8.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
                guard let axis = available.first(where: {
                    ($0[kCTFontVariationAxisIdentifierKey] as? NSNumber)?.uint32Value == identifier
                }), let minimum = axis[kCTFontVariationAxisMinimumValueKey] as? NSNumber,
                let maximum = axis[kCTFontVariationAxisMaximumValueKey] as? NSNumber,
                (minimum.doubleValue...maximum.doubleValue).contains(number) else {
                    throw NSError(domain: "FolioPreview", code: 3)
                }
                variation[NSNumber(value: identifier)] = NSNumber(value: number)
            }
            let attributes = [kCTFontVariationAttribute: variation, kCTFontCascadeListAttribute: []] as CFDictionary
            let descriptor = CTFontDescriptorCreateCopyWithAttributes(CTFontCopyFontDescriptor(base), attributes)
            return CTFontCreateWithFontDescriptor(descriptor, CGFloat(value.fontSize), nil)
        }
    }

    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext(), !lines.isEmpty,
              bounds.width > 0, bounds.height > 0 else { return }
        let lineHeight = CGFloat(selection.fontSize) * 1.05
        let height = lineHeight * CGFloat(lines.count)
        let widths = lines.map { CGFloat(CTLineGetTypographicBounds($0, nil, nil, nil)) }
        let scale = selection.centered
            ? min(1, bounds.width / max(1, widths.max() ?? 1), bounds.height / max(1, height)) : 1
        context.saveGState()
        context.textMatrix = .identity
        context.translateBy(x: 0, y: bounds.height)
        context.scaleBy(x: scale, y: -scale)
        for (index, line) in lines.enumerated() {
            var ascent: CGFloat = 0
            var descent: CGFloat = 0
            CTLineGetTypographicBounds(line, &ascent, &descent, nil)
            let x = selection.centered ? (bounds.width / scale - widths[index]) / 2 : 0
            let y = (bounds.height / scale - height) / 2
                + CGFloat(lines.count - index - 1) * lineHeight
                + (lineHeight - ascent - descent) / 2 + descent
            context.textPosition = CGPoint(x: x, y: y)
            CTLineDraw(line, context)
        }
        context.restoreGState()
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        if traitCollection.hasDifferentColorAppearance(comparedTo: previousTraitCollection) {
            lastKey = nil
            renderSelection()
        }
    }
}
