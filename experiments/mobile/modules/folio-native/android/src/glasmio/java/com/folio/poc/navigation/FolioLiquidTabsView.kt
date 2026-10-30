package com.folio.poc.navigation

import android.content.Context
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import io.github.neoruaa.glasmio.core.GlasmioMotion
import io.github.neoruaa.glasmio.core.GlasmioTheme
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
        onSelectionChange(payload("id" to id))
    }

    @Composable override fun MaterialContent() {
        if (items.isEmpty()) return
        if (segmented) {
            androidx.compose.material3.SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                items.forEachIndexed { index, item ->
                    androidx.compose.material3.SegmentedButton(selected = item.id == selectedId, onClick = { select(item.id) },
                        enabled = controlEnabled && !item.disabled,
                        shape = androidx.compose.material3.SegmentedButtonDefaults.itemShape(index, items.size)) {
                        if (iconOnly) FolioMaterialIcon(item.icon) else Text(item.label, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        } else androidx.compose.material3.NavigationBar(Modifier.fillMaxWidth(), windowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0)) {
            items.forEach { item ->
                androidx.compose.material3.NavigationBarItem(selected = item.id == selectedId, onClick = { select(item.id) },
                    enabled = controlEnabled && !item.disabled, icon = { FolioMaterialIcon(item.icon) },
                    label = { Text(item.label, maxLines = 1, overflow = TextOverflow.Ellipsis) })
            }
        }
    }

    @Composable override fun GlassContent() {
        if (items.isEmpty()) return
        if (segmented) {
            GlasmioSegmentedControl(items.map { it.id to it.label }, selectedId,
                ::select, Modifier.fillMaxWidth(), height = if (iconOnly) 44.dp else 48.dp, enabled = controlEnabled,
                glassTrack = iconOnly,
                itemContent = { id, selected ->
                    val item = items.first { it.id == id }
                    if (iconOnly) {
                        SfIcon(if (item.icon == "download") "arrow.down.circle" else item.icon, null, size = 20.dp)
                    } else {
                        Text(item.label, style = GlasmioTheme.textStyles.callout,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                })
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
