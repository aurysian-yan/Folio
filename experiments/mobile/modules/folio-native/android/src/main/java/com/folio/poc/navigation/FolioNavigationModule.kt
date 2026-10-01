package com.folio.poc.navigation

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// 安卓玻璃导航与背景源桥接。
class FolioNavigationItem : Record {
    @Field var id: String = ""
    @Field var label: String = ""
    @Field var icon: String = ""
}

class FolioNavigationModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("FolioNavigation")

        View(FolioFontStackView::class) {
            Events("onDismissed")
            Prop("visible") { view: FolioFontStackView, value: Boolean -> view.visible = value }
        }

        View(FolioBackdropSourceView::class) {
            Prop("sourceId") { view: FolioBackdropSourceView, value: String -> view.sourceId = value }
            Prop("active") { view: FolioBackdropSourceView, value: Boolean -> view.active = value }
        }

        View(FolioLiquidTabsView::class) {
            Events("onSelectionChange")
            Prop("sourceId") { view: FolioLiquidTabsView, value: String -> view.sourceId = value }
            Prop("selectedId") { view: FolioLiquidTabsView, value: String -> view.selectedId = value }
            Prop("dark") { view: FolioLiquidTabsView, value: Boolean -> view.dark = value }
            Prop("items") { view: FolioLiquidTabsView, value: List<FolioNavigationItem> ->
                if (value.size == 4 && value.map { it.id }.toSet() == setOf("local", "recent", "cloud", "settings")) {
                    view.items = value
                }
            }
        }
    }
}
