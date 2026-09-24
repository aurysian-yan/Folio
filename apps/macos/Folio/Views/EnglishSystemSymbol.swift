import AppKit
import SwiftUI

extension Image {
    static func englishSystemName(_ name: String) -> Image {
        guard let symbol = NSImage(systemSymbolName: name, accessibilityDescription: nil) else {
            return Image(systemName: name)
        }
        return Image(nsImage: symbol.withLocale(Locale(identifier: "en")))
    }
}
