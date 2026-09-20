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
        }
    }
}
