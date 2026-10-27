import ExpoModulesCore
import UIKit

struct FolioReleaseMirrorItem: Record {
    @Field var id: String = ""
    @Field var label: String = ""
}

// 系统菜单显式回传展开与关闭，测速结果原位更新。
private final class FolioReleaseMenuButton: UIButton {
    var expanded: ((Bool) -> Void)?
    override func contextMenuInteraction(_ interaction: UIContextMenuInteraction, willDisplayMenuFor configuration: UIContextMenuConfiguration, animator: UIContextMenuInteractionAnimating?) {
        super.contextMenuInteraction(interaction, willDisplayMenuFor: configuration, animator: animator)
        expanded?(true)
    }
    override func contextMenuInteraction(_ interaction: UIContextMenuInteraction, willEndFor configuration: UIContextMenuConfiguration, animator: UIContextMenuInteractionAnimating?) {
        super.contextMenuInteraction(interaction, willEndFor: configuration, animator: animator)
        expanded?(false)
    }
}

final class FolioReleaseMirrorMenu: ExpoView {
    let onExpandedChange = EventDispatcher()
    let onSelectionChange = EventDispatcher()
    private let button = FolioReleaseMenuButton(type: .system)
    var items: [FolioReleaseMirrorItem] = [] { didSet { refresh() } }
    var selectedId = "direct" { didSet { refresh() } }
    var disabled = false { didSet { button.isEnabled = !disabled; if disabled { button.contextMenuInteraction?.dismissMenu() } } }
    var label = "" { didSet { button.accessibilityLabel = label } }
    var color: UIColor = .secondaryLabel { didSet { button.tintColor = color } }
    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        button.setImage(UIImage(systemName: "chevron.down"), for: .normal)
        button.showsMenuAsPrimaryAction = true
        button.expanded = { [weak self] value in self?.onExpandedChange(["expanded": value]) }
        addSubview(button)
    }
    override func layoutSubviews() { super.layoutSubviews(); button.frame = bounds }
    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil { button.contextMenuInteraction?.dismissMenu(); onExpandedChange(["expanded": false]) }
    }
    private func refresh() {
        let menu = UIMenu(children: items.map { item in
            UIAction(title: item.label, state: item.id == selectedId ? .on : .off) { [weak self] _ in
                guard let self, !self.disabled else { return }
                self.onSelectionChange(["id": item.id])
            }
        })
        button.menu = menu
        button.contextMenuInteraction?.updateVisibleMenu { _ in menu }
    }
}
