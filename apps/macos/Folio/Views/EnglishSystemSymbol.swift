import SwiftUI

extension Image {
    static func englishSystemName(_ name: String) -> some View {
        Image(systemName: name)
            .environment(\.locale, Locale(identifier: "en"))
    }
}
