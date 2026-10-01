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

        View(FolioHeaderBackdropView::class) {
            Prop("sourceId") { view: FolioHeaderBackdropView, value: String -> view.sourceId = value }
            Prop("active") { view: FolioHeaderBackdropView, value: Boolean -> view.active = value }
            Prop("tintColor") { view: FolioHeaderBackdropView, value: String -> view.tintColor = value }
        }

        View(FolioHeaderControlsView::class) {
            Events("onModeChange", "onExpandedChange", "onImport", "onSearchTextChange", "onFilter")
            Prop("sourceId") { view: FolioHeaderControlsView, value: String -> view.sourceId = value }
            Prop("mode") { view: FolioHeaderControlsView, value: String ->
                if (value == "grid" || value == "list") view.mode = value
            }
            Prop("active") { view: FolioHeaderControlsView, value: Boolean -> view.active = value }
            Prop("dark") { view: FolioHeaderControlsView, value: Boolean -> view.dark = value }
            Prop("ready") { view: FolioHeaderControlsView, value: Boolean -> view.ready = value }
            Prop("importing") { view: FolioHeaderControlsView, value: Boolean -> view.importing = value }
            Prop("searchOpen") { view: FolioHeaderControlsView, value: Boolean -> view.searchOpen = value }
            Prop("searchText") { view: FolioHeaderControlsView, value: String -> view.searchText = value }
            Prop("filterCount") { view: FolioHeaderControlsView, value: Int -> view.filterCount = value.coerceAtLeast(0) }
            Prop("colors") { view: FolioHeaderControlsView, value: FolioViewMenuColors -> view.colors = value }
            Prop("labels") { view: FolioHeaderControlsView, value: FolioHeaderLabels -> view.labels = value }
        }

        View(FolioLiquidTabsView::class) {
            Events("onSelectionChange")
            Prop("sourceId") { view: FolioLiquidTabsView, value: String -> view.sourceId = value }
            Prop("selectedId") { view: FolioLiquidTabsView, value: String -> view.selectedId = value }
            Prop("dark") { view: FolioLiquidTabsView, value: Boolean -> view.dark = value }
            Prop("accentColor") { view: FolioLiquidTabsView, value: String -> view.accentColor = value }
            Prop("items") { view: FolioLiquidTabsView, value: List<FolioNavigationItem> ->
                if (value.size == 4 && value.map { it.id }.toSet() == setOf("local", "search", "cloud", "settings")) {
                    view.items = value
                }
            }
        }
    }
}
