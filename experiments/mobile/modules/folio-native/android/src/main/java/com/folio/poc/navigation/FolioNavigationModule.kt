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
            Prop("importBlocked") { view: FolioHeaderControlsView, value: Boolean -> view.importBlocked = value }
            Prop("searchOpen") { view: FolioHeaderControlsView, value: Boolean -> view.searchOpen = value }
            Prop("searchText") { view: FolioHeaderControlsView, value: String -> view.searchText = value }
            Prop("filterCount") { view: FolioHeaderControlsView, value: Int -> view.filterCount = value.coerceAtLeast(0) }
            Prop("shadowProgress") { view: FolioHeaderControlsView, value: Float -> view.shadowProgress = value.coerceIn(0f, 1f) }
            Prop("colors") { view: FolioHeaderControlsView, value: FolioViewMenuColors -> view.colors = value }
            Prop("labels") { view: FolioHeaderControlsView, value: FolioHeaderLabels -> view.labels = value }
        }

        View(FolioPresetMenuView::class) {
            Events("onSelectionChange", "onExpandedChange")
            Prop("sourceId") { view: FolioPresetMenuView, value: String -> view.sourceId = value }
            Prop("selectedId") { view: FolioPresetMenuView, value: String -> view.selectedId = value }
            Prop("disabled") { view: FolioPresetMenuView, value: Boolean -> view.disabled = value }
            Prop("dark") { view: FolioPresetMenuView, value: Boolean -> view.dark = value }
            Prop("colors") { view: FolioPresetMenuView, value: FolioViewMenuColors -> view.colors = value }
            Prop("labels") { view: FolioPresetMenuView, value: FolioPresetMenuLabels -> view.labels = value }
            Prop("items") { view: FolioPresetMenuView, value: List<FolioNavigationItem> -> view.items = value }
        }

        View(FolioGlassSwitchView::class) {
            Events("onValueChange")
            Prop("label") { view: FolioGlassSwitchView, value: String -> view.label = value }
            Prop("checked") { view: FolioGlassSwitchView, value: Boolean -> view.checked = value }
            Prop("enabled") { view: FolioGlassSwitchView, value: Boolean -> view.controlEnabled = value }
            Prop("dark") { view: FolioGlassSwitchView, value: Boolean -> view.dark = value }
            Prop("accentColor") { view: FolioGlassSwitchView, value: String -> view.accentColor = value }
            Prop("trackColor") { view: FolioGlassSwitchView, value: String -> view.trackColor = value }
            Prop("thumbColor") { view: FolioGlassSwitchView, value: String -> view.thumbColor = value }
            Prop("surfaceColor") { view: FolioGlassSwitchView, value: String -> view.surfaceColor = value }
        }

        View(FolioLiquidTabsView::class) {
            Events("onSelectionChange")
            Prop("sourceId") { view: FolioLiquidTabsView, value: String -> view.sourceId = value }
            Prop("selectedId") { view: FolioLiquidTabsView, value: String -> view.selectedId = value }
            Prop("dark") { view: FolioLiquidTabsView, value: Boolean -> view.dark = value }
            Prop("accentColor") { view: FolioLiquidTabsView, value: String -> view.accentColor = value }
            Prop("segmented") { view: FolioLiquidTabsView, value: Boolean -> view.segmented = value }
            Prop("enabled") { view: FolioLiquidTabsView, value: Boolean -> view.controlEnabled = value }
            Prop("labelColor") { view: FolioLiquidTabsView, value: String -> view.labelColor = value }
            Prop("surfaceColor") { view: FolioLiquidTabsView, value: String -> view.surfaceColor = value }
            Prop("items") { view: FolioLiquidTabsView, value: List<FolioNavigationItem> ->
                val ids = value.map { it.id }.toSet()
                if ((value.size == 4 && ids == setOf("local", "search", "cloud", "settings"))
                    || (value.size == 2 && ids == setOf("fonts", "deleted"))) {
                    view.items = value
                }
            }
        }
    }
}
