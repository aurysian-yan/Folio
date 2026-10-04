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
        FolioTabCrossfade()
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
