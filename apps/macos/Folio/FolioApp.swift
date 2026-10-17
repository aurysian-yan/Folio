import SwiftUI

@main
struct FolioApp: App {
    @State private var model = LibraryViewModel()
    var body: some Scene {
        Window("Folio", id: "library") {
            // 单元测试不启动真实字体库与云同步。
            if NSClassFromString("XCTestCase") == nil {
                RootView(model: model)
            } else {
                Color.clear
            }
        }
        .defaultSize(width: 1200, height: 800)
        .commands {
            SidebarCommands()
            CommandGroup(replacing: .appInfo) { AboutMenuButton() }
        }

        Window(L.text("import.installationWindow"), id: "font-installation") {
            ImportReportView(model: model)
        }
        .defaultSize(width: 720, height: 520)

        Settings {
            SettingsView()
        }
    }
}

private struct AboutMenuButton: View {
    @Environment(\.openSettings) private var openSettings
    var body: some View {
        Button(L.text("settings.about")) {
            UserDefaults.standard.set("about", forKey: "settings.requestedPage")
            NotificationCenter.default.post(name: Notification.Name("FolioShowAbout"), object: nil)
            openSettings()
        }
    }
}
