import SwiftUI

@main
struct FolioApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
        .defaultSize(width: 1200, height: 800)
        .commands {
            SidebarCommands()
            CommandGroup(replacing: .appInfo) { AboutMenuButton() }
        }

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
