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
    @Field var disabled: Boolean = false
}

class FolioNavigationModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("FolioNavigation")
        Constant("androidVariant") { "glasmio" }

        View(FolioHeaderActionButtonView::class) {
            Prop("pageBackgroundColor") { view: FolioHeaderActionButtonView, value: String -> view.pageBackgroundColor = value }
            Events("onPress")
            Prop("sourceId") { view: FolioHeaderActionButtonView, value: String -> view.sourceId = value }
            Prop("controlId") { view: FolioHeaderActionButtonView, value: String -> view.controlId = value }
            Prop("label") { view: FolioHeaderActionButtonView, value: String -> view.label = value }
            Prop("systemImage") { view: FolioHeaderActionButtonView, value: String -> view.systemImage = value }
            Prop("enabled") { view: FolioHeaderActionButtonView, value: Boolean -> view.controlEnabled = value }
            Prop("busy") { view: FolioHeaderActionButtonView, value: Boolean -> view.busy = value }
            Prop("selected") { view: FolioHeaderActionButtonView, value: Boolean -> view.controlSelected = value }
            Prop("primary") { view: FolioHeaderActionButtonView, value: Boolean -> view.primary = value }
            Prop("dark") { view: FolioHeaderActionButtonView, value: Boolean -> view.dark = value }
            Prop("accentColor") { view: FolioHeaderActionButtonView, value: String -> view.accentColor = value }
        }

        View(FolioFontStackView::class) {
            Events("onDismissed")
            Prop("visible") { view: FolioFontStackView, value: Boolean -> view.visible = value }
            Prop("dimAmount") { view: FolioFontStackView, value: Float -> view.dimAmount = value }
        }

        View(FolioBackdropSourceView::class) {
            Prop("pageBackgroundColor") { view: FolioBackdropSourceView, value: String -> view.setPageBackground(value) }
            Prop("sourceId") { view: FolioBackdropSourceView, value: String -> view.sourceId = value }
            Prop("active") { view: FolioBackdropSourceView, value: Boolean -> view.active = value }
            Prop("compositingLayer") { view: FolioBackdropSourceView, value: Boolean -> view.compositingLayer = value }
        }

        View(FolioHeaderBackdropView::class) {
            Prop("pageBackgroundColor") { view: FolioHeaderBackdropView, value: String -> view.pageBackgroundColor = value }
            Prop("sourceId") { view: FolioHeaderBackdropView, value: String -> view.sourceId = value }
            Prop("active") { view: FolioHeaderBackdropView, value: Boolean -> view.active = value }
            Prop("tintColor") { view: FolioHeaderBackdropView, value: String -> view.tintColor = value }
        }

        View(FolioPanelBackdropView::class) {
            Prop("blurRadius") { view: FolioPanelBackdropView, value: Float -> view.blurRadius = value }
            Prop("liquid") { view: FolioPanelBackdropView, value: Boolean -> view.liquid = value }
            Prop("continuousCapsule") { view: FolioPanelBackdropView, value: Boolean -> view.continuousCapsule = value }
            Prop("pageBackgroundColor") { view: FolioPanelBackdropView, value: String -> view.pageBackgroundColor = value }
            Prop("navigationGlass") { view: FolioPanelBackdropView, value: Boolean -> view.navigationGlass = value }
            Prop("dark") { view: FolioPanelBackdropView, value: Boolean -> view.dark = value }
            Prop("sourceId") { view: FolioPanelBackdropView, value: String -> view.sourceId = value }
            Prop("active") { view: FolioPanelBackdropView, value: Boolean -> view.active = value }
            Prop("tintColor") { view: FolioPanelBackdropView, value: String -> view.tintColor = value }
            Prop("borderColor") { view: FolioPanelBackdropView, value: String -> view.borderColor = value }
            Prop("cornerRadius") { view: FolioPanelBackdropView, value: Float -> view.cornerRadius = value }
        }

        View(FolioHeaderControlsView::class) {
            Prop("pageBackgroundColor") { view: FolioHeaderControlsView, value: String -> view.pageBackgroundColor = value }
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
            Prop("autoFocusSearch") { view: FolioHeaderControlsView, value: Boolean -> view.autoFocusSearch = value }
            Prop("searchText") { view: FolioHeaderControlsView, value: String -> view.searchText = value }
            Prop("filterCount") { view: FolioHeaderControlsView, value: Int -> view.filterCount = value.coerceAtLeast(0) }
            Prop("shadowProgress") { view: FolioHeaderControlsView, value: Float -> view.shadowProgress = value.coerceIn(0f, 1f) }
            Prop("colors") { view: FolioHeaderControlsView, value: FolioViewMenuColors -> view.colors = value; view.accentColor = value.accent; view.surfaceColor = value.raised }
            Prop("labels") { view: FolioHeaderControlsView, value: FolioHeaderLabels -> view.labels = value }
        }

        View(FolioPresetMenuView::class) {
            Prop("pageBackgroundColor") { view: FolioPresetMenuView, value: String -> view.pageBackgroundColor = value }
            Events("onSelectionChange", "onExpandedChange")
            Prop("sourceId") { view: FolioPresetMenuView, value: String -> view.sourceId = value }
            Prop("selectedId") { view: FolioPresetMenuView, value: String -> view.selectedId = value }
            Prop("disabled") { view: FolioPresetMenuView, value: Boolean -> view.disabled = value }
            Prop("dark") { view: FolioPresetMenuView, value: Boolean -> view.dark = value }
            Prop("triggerIcon") { view: FolioPresetMenuView, value: String -> view.triggerIcon = value }
            Prop("triggerSurface") { view: FolioPresetMenuView, value: Boolean -> view.triggerSurface = value }
            Prop("triggerTrailing") { view: FolioPresetMenuView, value: Boolean -> view.triggerTrailing = value }
            Prop("triggerFeedback") { view: FolioPresetMenuView, value: Boolean -> view.triggerFeedback = value }
            Prop("shadowProgress") { view: FolioPresetMenuView, value: Float -> view.shadowProgress = value.coerceIn(0f, 1f) }
            Prop("colors") { view: FolioPresetMenuView, value: FolioViewMenuColors -> view.colors = value; view.accentColor = value.accent; view.surfaceColor = value.raised }
            Prop("labels") { view: FolioPresetMenuView, value: FolioPresetMenuLabels -> view.labels = value }
            Prop("items") { view: FolioPresetMenuView, value: List<FolioNavigationItem> -> view.items = value }
        }

        View(FolioAppearanceControlView::class) {
            Events("onSelectionChange")
            Prop("pageBackgroundColor") { view: FolioAppearanceControlView, value: String -> view.pageBackgroundColor = value }
            Prop("sourceId") { view: FolioAppearanceControlView, value: String -> view.sourceId = value }
            Prop("controlId") { view: FolioAppearanceControlView, value: String -> view.controlId = value }
            Prop("reduceMotion") { view: FolioAppearanceControlView, value: Boolean -> view.reduceMotion = value }
            Prop("kind") { view: FolioAppearanceControlView, value: String -> view.kind = value }
            Prop("label") { view: FolioAppearanceControlView, value: String -> view.label = value }
            Prop("selectedId") { view: FolioAppearanceControlView, value: String -> view.incomingSelectedId = value }
            Prop("items") { view: FolioAppearanceControlView, value: List<FolioNavigationItem> -> view.items = value }
            Prop("enabled") { view: FolioAppearanceControlView, value: Boolean -> view.controlEnabled = value }
            Prop("dark") { view: FolioAppearanceControlView, value: Boolean -> view.dark = value }
            Prop("accentColor") { view: FolioAppearanceControlView, value: String -> view.accentColor = value }
            Prop("surfaceColor") { view: FolioAppearanceControlView, value: String -> view.surfaceColor = value }
            Prop("mostRecentEventCount") { view: FolioAppearanceControlView, value: Int -> view.mostRecentEventCount = value }
            OnViewDidUpdateProps { view: FolioAppearanceControlView -> view.applyProps() }
        }

        View(FolioGlassSliderView::class) {
            Prop("pageBackgroundColor") { view: FolioGlassSliderView, value: String -> view.pageBackgroundColor = value }
            Prop("sourceId") { view: FolioGlassSliderView, value: String -> view.sourceId = value }
            Prop("controlId") { view: FolioGlassSliderView, value: String -> view.controlId = value }
            Events("onValueChange", "onEditingChanged")
            Prop("label") { view: FolioGlassSliderView, value: String -> view.label = value }
            Prop("valueText") { view: FolioGlassSliderView, value: String -> view.valueText = value }
            Prop("value") { view: FolioGlassSliderView, value: Double -> view.incomingValue = value }
            Prop("minimum") { view: FolioGlassSliderView, value: Double -> view.minimum = value }
            Prop("maximum") { view: FolioGlassSliderView, value: Double -> view.maximum = value }
            Prop("step") { view: FolioGlassSliderView, value: Double -> view.step = value }
            Prop("enabled") { view: FolioGlassSliderView, value: Boolean -> view.controlEnabled = value }
            Prop("dark") { view: FolioGlassSliderView, value: Boolean -> view.dark = value }
            Prop("accentColor") { view: FolioGlassSliderView, value: String -> view.accentColor = value }
            Prop("trackColor") { view: FolioGlassSliderView, value: String -> view.trackColor = value }
            Prop("thumbColor") { view: FolioGlassSliderView, value: String -> view.thumbColor = value }
            Prop("surfaceColor") { view: FolioGlassSliderView, value: String -> view.surfaceColor = value }
            Prop("mostRecentEventCount") { view: FolioGlassSliderView, value: Int -> view.mostRecentEventCount = value }
            OnViewDidUpdateProps { view: FolioGlassSliderView -> view.applyProps() }
        }

        View(FolioGlassSwitchView::class) {
            Prop("pageBackgroundColor") { view: FolioGlassSwitchView, value: String -> view.pageBackgroundColor = value }
            Prop("sourceId") { view: FolioGlassSwitchView, value: String -> view.sourceId = value }
            Prop("controlId") { view: FolioGlassSwitchView, value: String -> view.controlId = value }
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
            Prop("pageBackgroundColor") { view: FolioLiquidTabsView, value: String -> view.pageBackgroundColor = value }
            Events("onSelectionChange", "onExpand", "onCollapse")
            Prop("sourceId") { view: FolioLiquidTabsView, value: String -> view.sourceId = value }
            Prop("selectedId") { view: FolioLiquidTabsView, value: String -> view.selectedId = value }
            Prop("dark") { view: FolioLiquidTabsView, value: Boolean -> view.dark = value }
            Prop("accentColor") { view: FolioLiquidTabsView, value: String -> view.accentColor = value }
            Prop("iconOnly") { view: FolioLiquidTabsView, value: Boolean -> view.iconOnly = value }
            Prop("borderColor") { view: FolioLiquidTabsView, value: String -> view.borderColor = value }
            Prop("segmented") { view: FolioLiquidTabsView, value: Boolean -> view.segmented = value }
            Prop("enabled") { view: FolioLiquidTabsView, value: Boolean -> view.controlEnabled = value }
            Prop("collapsed") { view: FolioLiquidTabsView, value: Boolean -> view.collapsed = value }
            Prop("collapsible") { view: FolioLiquidTabsView, value: Boolean -> view.collapsible = value }
            Prop("expandHint") { view: FolioLiquidTabsView, value: String -> view.expandHint = value }
            Prop("labelColor") { view: FolioLiquidTabsView, value: String -> view.labelColor = value }
            Prop("surfaceColor") { view: FolioLiquidTabsView, value: String -> view.surfaceColor = value }
            Prop("items") { view: FolioLiquidTabsView, value: List<FolioNavigationItem> ->
                val ids = value.map { it.id }.toSet()
                if ((value.size == 5 && ids == setOf("local", "search", "online", "cloud", "settings"))
                    || (value.size == 3 && ids == setOf("bookmarks", "history", "downloads"))
                    || (value.size == 2 && ids.size == 2 && ids.none { it.isBlank() })) {
                    view.items = value
                }
            }
        }
    }
}
