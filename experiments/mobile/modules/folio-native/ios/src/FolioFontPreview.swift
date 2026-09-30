import CoreText
import ExpoModulesCore
import UIKit

final class FolioFontPreview: ExpoView {
    var selection = FolioPreviewSelection()
    let onStatus = EventDispatcher()
    private var line: CTLine?
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
        let key = "\(value.sourcePath)|\(value.faceIndex)|\(value.revisionId)|\(axes)|\(value.text)"
        guard key != lastKey else { return }
        lastKey = key
        generation += 1
        let token = generation
        line = nil
        setNeedsDisplay()
        workQueue.async { [weak self] in
            let result = Self.makeFont(value)
            DispatchQueue.main.async { [weak self] in
                guard let self, self.generation == token else { return }
                switch result {
                case let .success(font):
                    let characters = Array(value.text.utf16)
                    var glyphs = [CGGlyph](repeating: 0, count: characters.count)
                    let supported = CTFontGetGlyphsForCharacters(font, characters, &glyphs, characters.count)
                    if supported {
                        let attributes: [NSAttributedString.Key: Any] = [
                            NSAttributedString.Key(kCTFontAttributeName as String): font,
                            NSAttributedString.Key(kCTForegroundColorAttributeName as String): UIColor.label.cgColor,
                        ]
                        self.line = CTLineCreateWithAttributedString(NSAttributedString(string: value.text, attributes: attributes))
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
            let url = try FolioPaths.managedFont(value.sourcePath)
            guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor],
                  descriptors.indices.contains(value.faceIndex) else {
                throw NSError(domain: "FolioPreview", code: 1)
            }
            let base = CTFontCreateWithFontDescriptor(descriptors[value.faceIndex], 32, nil)
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
            return CTFontCreateWithFontDescriptor(descriptor, 32, nil)
        }
    }

    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext(), let line else { return }
        context.saveGState()
        context.textMatrix = .identity
        context.translateBy(x: 0, y: bounds.height)
        context.scaleBy(x: 1, y: -1)
        context.textPosition = CGPoint(x: 0, y: (bounds.height - 32) / 2)
        CTLineDraw(line, context)
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
