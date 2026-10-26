#if canImport(FolioFileServices)
import FolioFileServices
#endif
import ExpoModulesCore
import SwiftUI
import UIKit

// 仅为原生标签页内容添加交叉淡化，保留系统标签栏与选择回调。
struct FolioTabTransitionInstaller: UIViewRepresentable {
    func makeUIView(context: Context) -> FolioTabTransitionView { FolioTabTransitionView() }

    func updateUIView(_ view: FolioTabTransitionView, context: Context) { view.scheduleInstall() }
}

final class FolioTabTransitionView: UIView {
    private static var delegateKey: UInt8 = 0
    private var installScheduled = false

    override func didMoveToWindow() {
        super.didMoveToWindow()
        scheduleInstall()
    }

    func scheduleInstall() {
        guard !installScheduled else { return }
        installScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.installScheduled = false
            guard self.window != nil else { return }
            var responder: UIResponder? = self
            while let current = responder {
                if let controller = current as? UIViewController, let tabs = controller.tabBarController {
                    guard !(tabs.delegate is FolioTabTransitionDelegate) else { return }
                    let delegate = FolioTabTransitionDelegate(original: tabs.delegate)
                    objc_setAssociatedObject(tabs, &Self.delegateKey, delegate, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
                    tabs.delegate = delegate
                    return
                }
                responder = current.next
            }
        }
    }
}

// 未定制的代理方法继续交给 SwiftUI，避免影响标签选择与系统交互。
private final class FolioTabTransitionDelegate: NSObject, UITabBarControllerDelegate {
    private weak var original: UITabBarControllerDelegate?

    init(original: UITabBarControllerDelegate?) { self.original = original }

    override func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || original?.responds(to: selector) == true
    }

    override func forwardingTarget(for selector: Selector!) -> Any? {
        original?.responds(to: selector) == true ? original : super.forwardingTarget(for: selector)
    }

    func tabBarController(_ tabBarController: UITabBarController,
                          animationControllerForTransitionFrom fromVC: UIViewController,
                          to toVC: UIViewController) -> UIViewControllerAnimatedTransitioning? {
        if let search = tabBarController.viewControllers?.last, fromVC === search || toVC === search {
            return original?.tabBarController?(tabBarController, animationControllerForTransitionFrom: fromVC, to: toVC)
        }
        return FolioTabCrossfade()
    }

    func tabBarController(_ tabBarController: UITabBarController,
                          interactionControllerFor animationController: UIViewControllerAnimatedTransitioning)
        -> UIViewControllerInteractiveTransitioning? {
        if animationController is FolioTabCrossfade { return nil }
        return original?.tabBarController?(tabBarController, interactionControllerFor: animationController)
    }
}

private final class FolioTabCrossfade: NSObject, UIViewControllerAnimatedTransitioning {
    func transitionDuration(using transitionContext: UIViewControllerContextTransitioning?) -> TimeInterval {
        UIAccessibility.isReduceMotionEnabled ? 0 : 0.22
    }

    func animateTransition(using context: UIViewControllerContextTransitioning) {
        guard let from = context.view(forKey: .from), let to = context.view(forKey: .to),
              let controller = context.viewController(forKey: .to) else {
            context.completeTransition(false)
            return
        }
        let container = context.containerView
        let snapshot = from.snapshotView(afterScreenUpdates: false)
        snapshot?.frame = container.convert(from.bounds, from: from)
        to.frame = context.finalFrame(for: controller)
        container.addSubview(to)
        if let snapshot { container.addSubview(snapshot) }
        else { to.alpha = 0 }

        UIView.animate(withDuration: transitionDuration(using: context), delay: 0,
                       options: [.curveEaseInOut, .beginFromCurrentState]) {
            snapshot?.alpha = 0
            to.alpha = 1
        } completion: { _ in
            snapshot?.removeFromSuperview()
            to.alpha = 1
            if context.transitionWasCancelled { to.removeFromSuperview() }
            context.completeTransition(!context.transitionWasCancelled)
        }
    }
}

// 系统标签栏负责滚动最小化、独立搜索入口与地址附加栏。
final class FolioNativeTabsProps: ExpoSwiftUI.ViewProps {
    @Field var selection: String = "local"
    @Field var labels: [String] = []
    @Field var minimize: Bool = true
    @Field var accessoryVisible: Bool = false
    @Field var addressTitle: String = ""
    @Field var address: String = ""
    @Field var addressLabel: String = ""
    @Field var addressStart: Bool = true
    @Field var addressBadge: Int = 0
    @Field var addressAttention: Bool = false
    var onSelectionChange = EventDispatcher()
    var onAddressPress = EventDispatcher()
}

struct FolioNativeTabs: ExpoSwiftUI.View {
    @ObservedObject var props: FolioNativeTabsProps
    private let destinations = ["local", "online", "cloud", "settings", "search"]
    private let symbols = ["textformat.alt", "globe", "cloud", "gear", "magnifyingglass"]

    @State private var selectedTab = "local"
    var body: some View {
        tabs
            .onChange(of: props.selection) { value in
                if selectedTab != value { selectedTab = value }
            }
            .onAppear { selectedTab = props.selection }
    }

    @ViewBuilder
    private var tabs: some View {
        if #available(iOS 26.1, *) {
            modernTabs
                .tabBarMinimizeBehavior(props.minimize ? .onScrollDown : .never)
                .tabViewBottomAccessory(isEnabled: props.accessoryVisible) { FolioBrowserAccessory(props: props) }
        } else if #available(iOS 26.0, *) {
            modernTabs
                .tabBarMinimizeBehavior(props.minimize ? .onScrollDown : .never)
                .tabViewBottomAccessory {
                    if props.accessoryVisible { FolioBrowserAccessory(props: props) }
                }
        } else if #available(iOS 18.0, *) {
            modernTabs
        } else {
            SwiftUI.TabView(selection: selection) {
                ForEach(destinations.indices, id: \.self) { index in
                    content(index)
                        .tabItem { Label(title(index), systemImage: symbols[index]) }
                        .tag(destinations[index])
                }
            }
        }
    }

    @available(iOS 18.0, *)
    private var modernTabs: some View {
        SwiftUI.TabView(selection: selection) {
            ForEach(0..<4, id: \.self) { index in
                SwiftUI.Tab(title(index), systemImage: symbols[index], value: destinations[index]) {
                    content(index)
                }
            }
            SwiftUI.Tab(title(4), systemImage: symbols[4], value: "search", role: .search) { content(4) }
        }
    }

    private var selection: Binding<String> {
        Binding(get: { selectedTab }, set: { value in
            guard value != selectedTab else { return }
            selectedTab = value
            props.onSelectionChange(["selection": value])
        })
    }

    private func title(_ index: Int) -> String {
        props.labels.indices.contains(index) ? props.labels[index] : ""
    }

    @ViewBuilder
    private func content(_ index: Int) -> some View {
        if let children = props.children, children.indices.contains(index) {
            let view: any View = children[index].childView
            AnyView(view)
        }
    }
}

@available(iOS 26.0, *)
private struct FolioBrowserAccessory: View {
    @ObservedObject var props: FolioNativeTabsProps
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    var body: some View {
        Button { props.onAddressPress([:]) } label: {
            HStack {
                Image(systemName: props.addressStart ? "magnifyingglass" : "globe")
                    .foregroundStyle(.secondary)
                VStack(spacing: 2) {
                    Text(props.addressTitle)
                        .font(.subheadline)
                        .fontWeight(props.addressStart ? .regular : .semibold)
                        .lineLimit(1)
                    if placement != .inline && !props.addressStart {
                        Text(props.address)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                if props.addressBadge > 0 {
                    Text(props.addressBadge, format: .number).font(.caption).foregroundStyle(.tint)
                } else if props.addressAttention {
                    Image(systemName: "exclamationmark.circle").foregroundStyle(.tint)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.horizontal)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(props.addressLabel)
    }
}
