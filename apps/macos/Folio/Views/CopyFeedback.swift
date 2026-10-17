import AppKit
import SwiftUI

// 每个入口独立计时，取消后不再回写反馈。
@MainActor @Observable
final class CopyFeedbackState {
    private(set) var copied = false
    private var resetTask: Task<Void, Never>?

    func show(duration: Duration = .seconds(2)) {
        resetTask?.cancel()
        copied = true
        resetTask = Task { [weak self] in
            do { try await Task.sleep(for: duration) } catch { return }
            self?.copied = false
        }
    }

    func reset() {
        resetTask?.cancel()
        resetTask = nil
        copied = false
    }
}

struct CopyFeedbackButton<Content: View>: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var feedback = CopyFeedbackState()
    let identity: String
    var iconOnly = false
    let action: () -> Bool
    @ViewBuilder let content: (Bool) -> Content

    var body: some View {
        Button {
            if action() {
                feedback.show()
                NSAccessibility.post(element: NSApp as Any, notification: .announcementRequested,
                    userInfo: [.announcement: L.text("common.copied"), .priority: NSAccessibilityPriorityLevel.medium.rawValue])
            } else { feedback.reset() }
        } label: {
            ZStack {
                content(false)
                    .opacity(feedback.copied ? 0 : 1)
                    .blur(radius: feedback.copied && !reduceMotion ? 8 : 0)
                content(true)
                    .accessibilityHidden(true)
                    .opacity(feedback.copied ? 1 : 0)
                    .blur(radius: !feedback.copied && !reduceMotion ? 8 : 0)
            }
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.22), value: feedback.copied)
        }
        .accessibilityValue(feedback.copied ? L.text("common.copied") : "")
        .overlay(alignment: .trailing) {
            if iconOnly {
                Text(L.text("common.copied"))
                    .font(.caption).foregroundStyle(.secondary)
                    .padding(4).background(.regularMaterial)
                    .fixedSize().offset(x: -30)
                    .opacity(feedback.copied ? 1 : 0)
                    .blur(radius: !feedback.copied && !reduceMotion ? 8 : 0)
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.22), value: feedback.copied)
                    .allowsHitTesting(false).accessibilityHidden(true)
            }
        }
        .onChange(of: identity) { _, _ in feedback.reset() }
        .onDisappear { feedback.reset() }
    }
}

// 吐司使用菜单打开时的屏幕坐标，独立面板避免滚动容器裁切。
@MainActor
final class CopyToastPresenter {
    weak var window: NSWindow?
    private var anchor: NSPoint?
    private var screenFrame: NSRect?
    private var panel: NSPanel?
    private let feedback = CopyFeedbackState()
    private var hideTask: Task<Void, Never>?

    func record(_ event: NSEvent) {
        guard let window, event.window === window else { return }
        let point = window.convertPoint(toScreen: event.locationInWindow)
        anchor = point
        screenFrame = NSScreen.screens.first(where: { NSMouseInRect(point, $0.frame, false) })?.visibleFrame
            ?? window.screen?.visibleFrame
    }

    static func frame(size: NSSize, anchor: NSPoint, visible: NSRect) -> NSRect {
        let width = min(size.width, visible.width)
        let height = min(size.height, visible.height)
        return NSRect(x: min(max(anchor.x, visible.minX), visible.maxX - width),
                      y: min(max(anchor.y - height, visible.minY), visible.maxY - height), width: width, height: height)
    }

    func show() {
        guard let window, let anchor, let screenFrame else { return }
        hideTask?.cancel()
        if let panel { window.removeChildWindow(panel); panel.orderOut(nil) }
        feedback.reset()
        let host = NSHostingView(rootView: CopyToastView(feedback: feedback))
        let panel = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.isReleasedWhenClosed = false
        panel.contentView = host
        panel.setFrame(Self.frame(size: host.fittingSize, anchor: anchor, visible: screenFrame), display: true)
        self.panel = panel
        window.addChildWindow(panel, ordered: .above)
        panel.orderFront(nil)
        hideTask = Task { [weak self] in
            await Task.yield()
            guard let self, !Task.isCancelled else { return }
            self.feedback.show()
            NSAccessibility.post(element: window, notification: .announcementRequested,
                userInfo: [.announcement: L.text("common.copied"), .priority: NSAccessibilityPriorityLevel.medium.rawValue])
            do { try await Task.sleep(for: .milliseconds(2220)) } catch { return }
            self.dismiss()
        }
    }

    func dismiss() {
        hideTask?.cancel(); hideTask = nil
        feedback.reset()
        if let panel { panel.parent?.removeChildWindow(panel); panel.orderOut(nil) }
        panel = nil
    }
}

private struct CopyToastView: View {
    let feedback: CopyFeedbackState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        HStack(spacing: 8) { Text(L.text("common.copied")); Image.englishSystemName("checkmark") }
            .fixedSize()
            .font(.callout).padding(8).background(.regularMaterial)
            .padding(8)
            .opacity(feedback.copied ? 1 : 0)
            .blur(radius: feedback.copied || reduceMotion ? 0 : 8)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.22), value: feedback.copied)
            .allowsHitTesting(false).accessibilityHidden(true)
    }
}

struct CopyToastHost: NSViewRepresentable {
    let presenter: CopyToastPresenter
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        context.coordinator.monitor = NSEvent.addLocalMonitorForEvents(matching: [.rightMouseDown, .leftMouseDown]) { event in
            if event.type == .rightMouseDown || event.modifierFlags.contains(.control) { presenter.record(event) }
            return event
        }
        return view
    }
    func updateNSView(_ view: NSView, context: Context) {
        Task { @MainActor [weak view] in presenter.window = view?.window }
    }
    func makeCoordinator() -> Coordinator { Coordinator(presenter: presenter) }
    static func dismantleNSView(_ view: NSView, coordinator: Coordinator) {
        if let monitor = coordinator.monitor { NSEvent.removeMonitor(monitor) }
        coordinator.presenter.dismiss()
    }
    @MainActor final class Coordinator {
        let presenter: CopyToastPresenter
        var monitor: Any?
        init(presenter: CopyToastPresenter) { self.presenter = presenter }
    }
}
