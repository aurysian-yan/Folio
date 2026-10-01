import ExpoModulesCore
import SwiftUI
import UIKit

// 滚动内容延伸至系统栏下方，键盘安全区域仍由系统管理。
final class FolioTabContentProps: ExpoSwiftUI.ViewProps {}

struct FolioTabContent: ExpoSwiftUI.View {
    @ObservedObject var props: FolioTabContentProps

    var body: some View {
        Children()
            .ignoresSafeArea(.container, edges: .vertical)
    }
}

// 将虚拟列表与系统栏连接，并为浮动顶栏启用原生滚动边缘效果。
final class FolioScrollContainer: ExpoView {
    let onInsetsChange = EventDispatcher()
    var hasHeader = false { didSet { setNeedsLayout() } }
    private weak var scrollView: UIScrollView?
    private weak var contentController: UIViewController?
    private weak var headerView: UIView?
    private var headerInteraction: UIInteraction?
    private weak var maskedContent: UIView?
    private let headerMask = CAGradientLayer()
    private var lastInsets: UIEdgeInsets?
    private var lastContentTop: CGFloat?
    private var updateScheduled = false

    override func layoutSubviews() {
        super.layoutSubviews()
        scheduleUpdate()
    }

    override func didAddSubview(_ subview: UIView) {
        super.didAddSubview(subview)
        scheduleUpdate()
    }

    override func willRemoveSubview(_ subview: UIView) {
        super.willRemoveSubview(subview)
        scheduleUpdate()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil {
            disconnect()
            lastInsets = nil
            lastContentTop = nil
        } else {
            scheduleUpdate()
        }
    }

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        scheduleUpdate()
    }

    private func scheduleUpdate() {
        guard !updateScheduled else { return }
        updateScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.updateScheduled = false
            self.connectScrollView()
        }
    }

    private func connectScrollView() {
        guard let window, bounds.height > 0 else { return }
        guard let currentScroll = subviews.lazy.compactMap({ self.findScrollView(in: $0) }).first else { return }
        let controller = containingContentController()
        let header = hasHeader ? subviews.first(where: { !currentScroll.isDescendant(of: $0) }) : nil

        if scrollView !== currentScroll || contentController !== controller || headerView !== header {
            disconnect()
            scrollView = currentScroll
            contentController = controller
            headerView = header
            controller?.setContentScrollView(currentScroll, for: .all)

            if #available(iOS 26.0, *) {
                currentScroll.topEdgeEffect.style = .soft
                currentScroll.bottomEdgeEffect.style = .soft
                if let header {
                    let interaction = UIScrollEdgeElementContainerInteraction()
                    interaction.scrollView = currentScroll
                    interaction.edge = .top
                    header.addInteraction(interaction)
                    headerInteraction = interaction
                }
            }
        }

        // 系统栏完成布局后，按列表的实际可视区域计算遮挡。
        controller?.navigationController?.view.layoutIfNeeded()
        controller?.tabBarController?.view.layoutIfNeeded()
        let safeFrame = convert(window.safeAreaLayoutGuide.layoutFrame, from: window)
        let scrollFrame = convert(currentScroll.bounds, from: currentScroll)
        var top = max(0, safeFrame.minY - bounds.minY)
        var contentTop = max(0, safeFrame.minY - scrollFrame.minY)
        var bottom = max(0, scrollFrame.maxY - safeFrame.maxY)
        if let bar = controller?.navigationController?.navigationBar, !bar.isHidden {
            let frame = convert(bar.bounds, from: bar)
            if frame.intersects(bounds) { top = max(top, frame.maxY - bounds.minY) }
            if frame.intersects(scrollFrame) { contentTop = max(contentTop, frame.maxY - scrollFrame.minY) }
        }
        if let bar = controller?.tabBarController?.tabBar, !bar.isHidden {
            let frame = convert(bar.bounds, from: bar)
            if frame.intersects(scrollFrame) { bottom = max(bottom, scrollFrame.maxY - frame.minY) }
        }
        if let header {
            let frame = convert(header.bounds, from: header)
            contentTop = max(contentTop, frame.maxY + frame.height / 4 - scrollFrame.minY)
        }
        contentTop = min(contentTop, scrollFrame.height)
        let insets = UIEdgeInsets(top: min(top, bounds.height), left: 0,
                                  bottom: min(bottom, scrollFrame.height), right: 0)
        updateHeaderMask(for: currentScroll, header: header)
        if lastInsets != insets || lastContentTop != contentTop {
            lastInsets = insets
            lastContentTop = contentTop
            onInsetsChange(["top": insets.top, "bottom": insets.bottom, "contentTop": contentTop])
        }
    }

    // 顶栏下方仅渐隐滚动内容，避免正文透过模糊后干扰品牌文字。
    private func updateHeaderMask(for scroll: UIScrollView, header: UIView?) {
        guard let header, let content = scroll.superview, content !== self,
              content.bounds.height > 0,
              content.layer.mask == nil || content.layer.mask === headerMask else { return }
        let frame = content.convert(header.bounds, from: header)
        let transition = frame.height / 4
        let start = min(1, max(0, (frame.maxY - transition) / content.bounds.height))
        let end = min(1, max(start, (frame.maxY + transition) / content.bounds.height))
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        headerMask.frame = content.bounds
        headerMask.colors = [UIColor.clear.cgColor, UIColor.clear.cgColor,
                             UIColor.black.cgColor, UIColor.black.cgColor]
        headerMask.locations = [0, NSNumber(value: start), NSNumber(value: end), 1]
        content.layer.mask = headerMask
        maskedContent = content
        CATransaction.commit()
    }

    private func findScrollView(in view: UIView) -> UIScrollView? {
        if let scroll = view as? UIScrollView, scroll.bounds.height > bounds.height / 2 { return scroll }
        return view.subviews.lazy.compactMap { self.findScrollView(in: $0) }.first
    }

    private func containingContentController() -> UIViewController? {
        var responder: UIResponder? = self
        while let current = responder {
            if var controller = current as? UIViewController {
                while let parent = controller.parent,
                      !(parent is UITabBarController), !(parent is UINavigationController),
                      !(parent is UISplitViewController) {
                    controller = parent
                }
                return controller
            }
            responder = current.next
        }
        return nil
    }

    private func disconnect() {
        if maskedContent?.layer.mask === headerMask { maskedContent?.layer.mask = nil }
        maskedContent = nil
        if let headerInteraction { headerView?.removeInteraction(headerInteraction) }
        headerInteraction = nil
        for edge: NSDirectionalRectEdge in [.top, .bottom] {
            if let scrollView, contentController?.contentScrollView(for: edge) === scrollView {
                contentController?.setContentScrollView(nil, for: edge)
            }
        }
        scrollView = nil
        contentController = nil
        headerView = nil
    }
}
