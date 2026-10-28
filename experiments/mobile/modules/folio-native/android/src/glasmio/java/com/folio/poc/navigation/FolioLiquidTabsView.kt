package com.folio.poc.navigation

import android.content.Context
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import io.github.neoruaa.glasmio.core.GlasmioMotion
import io.github.neoruaa.glasmio.glass.GlassSurfaceStyle
import io.github.neoruaa.glasmio.icons.SfSymbol
import io.github.neoruaa.glasmio.icons.SfIcon
import io.github.neoruaa.glasmio.ui.NavigationBarSurfaceHeight
import io.github.neoruaa.glasmio.ui.CompactBottomControlSize
import androidx.compose.ui.unit.lerp
import io.github.neoruaa.glasmio.ui.GlasmioIconButton
import io.github.neoruaa.glasmio.ui.GlasmioNavigationBar
import io.github.neoruaa.glasmio.ui.GlasmioSegmentedControl
import io.github.neoruaa.glasmio.ui.GlasmioTabItem

class FolioLiquidTabsView(context: Context, appContext: AppContext) : FolioGlassView(context, appContext) {
    private var destination by mutableStateOf("local")
    var selectedId: String
        get() = destination
        set(value) {
            destination = value
            if (value != "search") primaryId = value
        }
    var items by mutableStateOf(emptyList<FolioNavigationItem>())
    var iconOnly by mutableStateOf(false)
    var borderColor = ""
    var segmented by mutableStateOf(false)
    var collapsed by mutableStateOf(false)
    var collapsible by mutableStateOf(false)
    var expandHint = ""
    var labelColor = ""
    private var primaryId by mutableStateOf("local")
    private val onSelectionChange by EventDispatcher()
    private val onExpand by EventDispatcher()
    private val onCollapse by EventDispatcher()

    private fun select(id: String) {
        if (!controlEnabled || items.none { it.id == id && !it.disabled }) return
        if (id == selectedId) {
            if (collapsible && !collapsed) onCollapse(emptyMap<String, Any>())
            return
        }
        selectedId = id
        if (id != "search") primaryId = id
        onSelectionChange(mapOf("id" to id))
    }

    @Composable override fun GlassContent() {
        if (items.isEmpty()) return
        if (segmented) {
            val segments = items.map { it.id to it.label }
            if (iconOnly) {
                // 图标与标签共用玻璃采样层，文字仍作为读屏名称。
                GlasmioSegmentedControl(
                    items = segments,
                    selected = selectedId,
                    onSelected = ::select,
                    modifier = Modifier.fillMaxWidth(),
                    height = 50.dp,
                    enabled = controlEnabled,
                    itemContent = { id, _ ->
                        val symbol = when (items.firstOrNull { it.id == id }?.icon) {
                            "bookmark" -> "star"
                            "download" -> "arrow.down.circle"
                            "cloud" -> "icloud"
                            else -> items.firstOrNull { it.id == id }?.icon.orEmpty().ifBlank { "circle" }
                        }
                        SfIcon(symbol, null, Modifier.size(22.dp))
                    },
                )
            } else {
                GlasmioSegmentedControl(
                    items = segments,
                    selected = selectedId,
                    onSelected = ::select,
                    modifier = Modifier.fillMaxWidth(),
                    height = 50.dp,
                    enabled = controlEnabled,
                )
            }
            return
        }
        val compact = animateFloatAsState(if (collapsed) 1f else 0f, GlasmioMotion.spring(), label = "navigationCompact")
        val search = items.find { it.id == "search" }
        val destinations = items.filter { it.id != "search" }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            GlasmioNavigationBar(destinations.map { GlasmioTabItem(it.id, it.label, it.symbol()) },
                selectedId.takeIf { it != "search" } ?: primaryId,
                ::select, { if (controlEnabled) onExpand(emptyMap<String, Any>()) }, compact,
                CompactBottomControlSize, Modifier.weight(1f))
            if (search != null) GlasmioIconButton({ select(search.id) }, enabled = controlEnabled,
                style = GlassSurfaceStyle.Navigation, size = lerp(NavigationBarSurfaceHeight, CompactBottomControlSize, compact.value),
                modifier = Modifier.semantics { contentDescription = search.label }) { SfIcon(SfSymbol.Search, null) }
        }
    }
}

private fun FolioNavigationItem.symbol(): SfSymbol = when (id) {
    "local" -> SfSymbol.House
    "online" -> SfSymbol.Safari
    "cloud" -> SfSymbol.Cloud
    "settings" -> SfSymbol.Settings
    "bookmarks" -> SfSymbol.Star
    "history" -> SfSymbol.Clock
    "downloads" -> SfSymbol.Download
    else -> SfSymbol.House
}
