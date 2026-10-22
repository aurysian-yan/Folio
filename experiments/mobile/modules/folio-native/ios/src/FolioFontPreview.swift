#if canImport(FolioFileServices)
import FolioFileServices
#endif
import CoreText
import ExpoModulesCore
import UIKit

final class FolioFontPreview: ExpoView, UITextViewDelegate {
    var selection = FolioPreviewSelection()
    var editable = false
    var editorTintColor = ""
    var mostRecentTextEventCount = 0
    let onStatus = EventDispatcher()
    let onTextChange = EventDispatcher()
    private var editor: UITextView?
    private var textEventCount = 0
    private var syncingText = false
    private var committedFont: CTFont?
    private var editorViewportSize = CGSize.zero
    private var lines: [CTLine] = []
    private var lastKey: String?
    private let workQueue = DispatchQueue(label: "com.folio.mobile.poc.preview", qos: .userInitiated)
    private var generation = 0
    private var committedSelection = FolioPreviewSelection()
    private var pending: (FolioPreviewSelection, Int)?
    private var rendering = false
    private var sourceKey: String?
    private var baseFont: CTFont?
    private var baseFontKey: String?

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        isOpaque = false
        contentMode = .redraw
    }

    func renderSelection() {
        syncEditor()
        let value = selection
        let axes = value.axes.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ";")
        let key = "\(value.sourcePath)|\(value.faceIndex)|\(value.revisionId)|\(axes)|\(value.text)|\(value.fontSize)|\(value.centered)|\(value.wrapWidth)|\(value.foregroundColor)|\(value.requestId ?? "")"
        guard key != lastKey else { return }
        lastKey = key
        generation += 1
        let token = generation
        let identity = "\(value.sourcePath)|\(value.faceIndex)|\(value.revisionId)"
        if sourceKey != identity {
            sourceKey = identity
            lines = []
            committedFont = nil
            syncEditor()
            setNeedsDisplay()
        }
        pending = (value, token)
        renderNext()
    }

    // 字体构建、字形检查与换行在后台完成，只提交最新的完整帧。
    private func renderNext() {
        guard !rendering, let (value, token) = pending else { return }
        pending = nil
        rendering = true
        let color = Self.foreground(value.foregroundColor).cgColor
        workQueue.async { [weak self] in
            guard let self else { return }
            let result = self.makeFont(value).map { font -> (CTFont, [CTLine], Bool) in
                let paragraphs = value.text.components(separatedBy: .newlines)
                let supported = paragraphs.allSatisfy { paragraph in
                    let characters = Array(paragraph.utf16)
                    var glyphs = [CGGlyph](repeating: 0, count: characters.count)
                    return CTFontGetGlyphsForCharacters(font, characters, &glyphs, characters.count)
                }
                let attributes: [NSAttributedString.Key: Any] = [
                    NSAttributedString.Key(kCTFontAttributeName as String): font,
                    NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
                ]
                let lines = paragraphs.flatMap { paragraph -> [CTLine] in
                    let text = NSAttributedString(string: paragraph, attributes: attributes)
                    guard value.wrapWidth > 0, text.length > 0 else {
                        return [CTLineCreateWithAttributedString(text)]
                    }
                    let typesetter = CTTypesetterCreateWithAttributedString(text)
                    var wrapped: [CTLine] = []
                    var offset = 0
                    while offset < text.length {
                        let count = max(1, CTTypesetterSuggestLineBreak(typesetter, offset, value.wrapWidth))
                        wrapped.append(CTTypesetterCreateLine(typesetter, CFRange(location: offset, length: count)))
                        offset += count
                    }
                    return wrapped
                }
                return (font, lines, supported)
            }
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.rendering = false
                if self.generation == token {
                    var status: [String: Any] = [:]
                    if let requestId = value.requestId { status["requestId"] = requestId }
                    switch result {
                    case let .success((font, lines, supported)):
                        self.lines = supported ? lines : []
                        self.committedFont = font
                        self.committedSelection = value
                        self.syncEditor()
                        status["status"] = supported ? "ready" : "missing-glyph"
                        status["contentHeight"] = supported ? value.fontSize * (value.wrapWidth > 0 ? 1.3 : 1.05) * Double(lines.count) : 0
                    case .failure:
                        self.lines = []
                        self.committedFont = nil
                        self.syncEditor()
                        status["status"] = "error"
                    }
                    self.onStatus(status)
                    self.setNeedsDisplay()
                }
                self.renderNext()
            }
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil {
            editor?.resignFirstResponder()
            generation += 1
            pending = nil
            lines = []
            lastKey = nil
        } else {
            renderSelection()
        }
    }

    private func makeFont(_ value: FolioPreviewSelection) -> Result<CTFont, Error> {
        Result {
            guard value.fontSize.isFinite, (8...160).contains(value.fontSize),
                  value.wrapWidth.isFinite, value.wrapWidth >= 0 else {
                throw NSError(domain: "FolioPreview", code: 4)
            }
            let url = try FolioPaths.previewFont(value.sourcePath)
            let identity = "\(value.sourcePath)|\(value.faceIndex)|\(value.revisionId)"
            if baseFontKey != identity {
                guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor],
                      descriptors.indices.contains(value.faceIndex) else {
                    throw NSError(domain: "FolioPreview", code: 1)
                }
                baseFont = CTFontCreateWithFontDescriptor(descriptors[value.faceIndex], CGFloat(value.fontSize), nil)
                baseFontKey = identity
            }
            guard let base = baseFont else { throw NSError(domain: "FolioPreview", code: 1) }
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
        if editable { return }
        guard let context = UIGraphicsGetCurrentContext(), !lines.isEmpty,
              bounds.width > 0, bounds.height > 0 else { return }
        let selection = committedSelection
        let lineHeight = CGFloat(selection.fontSize) * (selection.wrapWidth > 0 ? 1.3 : 1.05)
        let height = lineHeight * CGFloat(lines.count)
        let widths = lines.map { CGFloat(CTLineGetTypographicBounds($0, nil, nil, nil)) }
        let scale = selection.wrapWidth == 0
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

    // 编辑器与只读预览使用同一份字体实例，保留可变轴、真实字号与光标定位。
    private func syncEditor() {
        guard editable else { editor?.isHidden = true; return }
        let input: UITextView
        if let editor {
            input = editor
        } else {
            input = UITextView(frame: bounds)
            input.backgroundColor = .clear
            input.textContainer.lineFragmentPadding = 0
            input.textContainerInset = .zero
            input.autocorrectionType = .no
            input.autocapitalizationType = .none
            input.spellCheckingType = .no
            input.smartQuotesType = .no
            input.smartDashesType = .no
            input.returnKeyType = .done
            input.adjustsFontForContentSizeCategory = false
            input.alwaysBounceVertical = false
            input.delegate = self
            addSubview(input)
            editor = input
        }
        isAccessibilityElement = false
        input.isHidden = false
        input.accessibilityLabel = accessibilityLabel
        input.tintColor = Self.foreground(editorTintColor)
        input.keyboardAppearance = traitCollection.userInterfaceStyle == .dark ? .dark : .light
        let font = committedFont.map {
            CTFontCreateCopyWithAttributes($0, CGFloat(selection.fontSize), nil, nil) as UIFont
        } ?? UIFont.systemFont(ofSize: CGFloat(selection.fontSize))
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = selection.centered ? .center : .left
        paragraph.minimumLineHeight = CGFloat(selection.fontSize) * 1.3
        paragraph.maximumLineHeight = CGFloat(selection.fontSize) * 1.3
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font, .foregroundColor: Self.foreground(selection.foregroundColor), .paragraphStyle: paragraph,
        ]
        syncingText = true
        if mostRecentTextEventCount >= textEventCount && input.text != selection.text {
            input.text = selection.text
            input.selectedRange = NSRange(location: (selection.text as NSString).length, length: 0)
        }
        input.typingAttributes = attributes
        input.textStorage.addAttributes(attributes, range: NSRange(location: 0, length: input.textStorage.length))
        syncingText = false
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let editor, editable else { return }
        let resized = editorViewportSize != bounds.size
        editorViewportSize = bounds.size
        editor.frame = bounds
        let height = editor.sizeThatFits(CGSize(width: bounds.width, height: .greatestFiniteMagnitude)).height
            - editor.textContainerInset.top - editor.textContainerInset.bottom
        let inset = max(0, (bounds.height - height) / 2)
        editor.textContainerInset = UIEdgeInsets(top: inset, left: 0, bottom: inset, right: 0)
        // 缩小视口后从第一行显示，保留普通编辑时的原生光标滚动。
        if resized || height <= bounds.height {
            editor.layoutIfNeeded()
            editor.setContentOffset(.zero, animated: false)
        }
    }

    func textViewDidChange(_ textView: UITextView) {
        guard !syncingText else { return }
        textEventCount += 1
        onTextChange(["text": textView.text ?? "", "eventCount": textEventCount])
        setNeedsLayout()
    }

    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
        if text == "\n" { textView.resignFirstResponder(); return false }
        return true
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        if traitCollection.hasDifferentColorAppearance(comparedTo: previousTraitCollection) {
            lastKey = nil
            renderSelection()
        }
    }

    // 应用语义前景色与原生字体绘制保持一致。
    private static func foreground(_ hex: String) -> UIColor {
        guard hex.hasPrefix("#"), hex.count == 7,
              let rgb = UInt32(hex.dropFirst(), radix: 16) else { return .label }
        return UIColor(red: CGFloat((rgb >> 16) & 255) / 255,
                       green: CGFloat((rgb >> 8) & 255) / 255,
                       blue: CGFloat(rgb & 255) / 255, alpha: 1)
    }
}
