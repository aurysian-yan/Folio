package com.folio.poc.navigation

import android.content.Context
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Spacer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import io.github.neoruaa.glasmio.core.GlasmioMotion
import io.github.neoruaa.glasmio.glass.BottomNavigationContact
import io.github.neoruaa.glasmio.glass.LocalGlassBackdrop
import io.github.neoruaa.glasmio.glass.GlassSurface
import io.github.neoruaa.glasmio.glass.GlassSurfaceStyle
import io.github.neoruaa.glasmio.icons.SfSymbol
import io.github.neoruaa.glasmio.icons.SfIcon
import io.github.neoruaa.glasmio.ui.NavigationBarSurfaceHeight
import io.github.neoruaa.glasmio.ui.CompactBottomControlSize
import androidx.compose.ui.unit.lerp
import com.kyant.shapes.Capsule
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
            GlasmioSegmentedControl(items.map { it.id to it.label }, selectedId,
                { if (controlEnabled) select(it) }, Modifier.fillMaxWidth())
            return
        }
        val compact = animateFloatAsState(if (collapsed) 1f else 0f, GlasmioMotion.spring(), label = "navigationCompact")
        val search = items.find { it.id == "search" }
        val destinations = items.filter { it.id != "search" }
        BottomNavigationContact(LocalGlassBackdrop.current, Modifier.fillMaxWidth()) {
            GlasmioNavigationBar(destinations.map { GlasmioTabItem(it.id, it.label, it.symbol()) },
                selectedId.takeIf { it != "search" } ?: primaryId,
                ::select, { if (controlEnabled) onExpand(emptyMap<String, Any>()) }, compact,
                CompactBottomControlSize, Modifier.weight(1f))
            Spacer(Modifier.width(8.dp))
            if (search != null) GlassSurface(onClick = { select(search.id) }, enabled = controlEnabled,
                style = GlassSurfaceStyle.Navigation, shape = Capsule(),
                modifier = Modifier.size(lerp(NavigationBarSurfaceHeight, CompactBottomControlSize, compact.value))
                    .semantics { contentDescription = search.label }) { SfIcon(SfSymbol.Search, null) }
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
