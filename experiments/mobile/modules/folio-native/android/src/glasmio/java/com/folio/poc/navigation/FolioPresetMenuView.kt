package com.folio.poc.navigation

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import io.github.neoruaa.glasmio.core.GlasmioTheme
import io.github.neoruaa.glasmio.glass.GlasmioToolbarActionGroup
import io.github.neoruaa.glasmio.glass.GlassSurfaceStyle
import io.github.neoruaa.glasmio.ui.GlasmioIconButton
import io.github.neoruaa.glasmio.ui.GlasmioMenu
import io.github.neoruaa.glasmio.ui.GlasmioMenuItem

// 菜单触发器前景与弹层由同一 Compose 树记录和转移。
class FolioPresetMenuView(context: Context, appContext: AppContext) : FolioGlassView(context, appContext) {
    var selectedId by mutableStateOf("")
    var disabled by mutableStateOf(false)
    var triggerIcon by mutableStateOf("caret")
    var triggerSurface by mutableStateOf(false)
    var triggerTrailing by mutableStateOf(false)
    var triggerFeedback = true
    var shadowProgress = 0f
    var colors by mutableStateOf<FolioViewMenuColors?>(null)
    var labels by mutableStateOf<FolioPresetMenuLabels?>(null)
    var items by mutableStateOf(emptyList<FolioNavigationItem>())
    private var expanded by mutableStateOf(false)
    private val onSelectionChange by EventDispatcher()
    private val onExpandedChange by EventDispatcher()

    override fun onUiStyleChanged() { updateExpanded(false) }

    private fun updateExpanded(value: Boolean) {
        if (expanded == value) return
        expanded = value
        onExpandedChange(payload("expanded" to value))
    }

    @Composable override fun MaterialContent() {
        val text = labels ?: return
        LaunchedEffect(disabled) { if (disabled) updateExpanded(false) }
        androidx.compose.foundation.layout.Box {
            if (triggerTrailing) {
                Row(Modifier.fillMaxSize().clickable(enabled = !disabled) { updateExpanded(true) }.padding(horizontal = 16.dp)
                    .semantics { contentDescription = listOf(text.title, text.value).filter { it.isNotBlank() }.joinToString(" · ") },
                    horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(text.title, Modifier.weight(1f), maxLines = 1)
                    Text(text.value, color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                    FolioMaterialIcon("caret")
                }
            } else androidx.compose.material3.IconButton(onClick = { updateExpanded(true) }, enabled = !disabled,
                modifier = Modifier.semantics { contentDescription = text.title }) { FolioMaterialIcon(triggerIcon) }
            androidx.compose.material3.DropdownMenu(expanded = expanded && !disabled, onDismissRequest = { updateExpanded(false) }) {
                items.forEach { item ->
                    androidx.compose.material3.DropdownMenuItem(text = { Text(item.label) }, enabled = !item.disabled,
                        onClick = { if (expanded && !disabled && !item.disabled) { updateExpanded(false); onSelectionChange(payload("id" to item.id)) } },
                        leadingIcon = item.icon.takeIf { it.isNotBlank() }?.let { { FolioMaterialIcon(it) } },
                        trailingIcon = if (item.id == selectedId) ({ FolioMaterialIcon("check") }) else null)
                }
            }
        }
    }

    @Composable override fun GlassContent() {
        val text = labels ?: return
        LaunchedEffect(disabled) { if (disabled) updateExpanded(false) }
        GlasmioToolbarActionGroup(frostRadius = if (triggerSurface) FolioHeaderFrostRadius else 2.dp) {
            GlasmioMenu(expanded, ::updateExpanded, items.size, anchor = { open ->
                if (triggerTrailing) {
                    Row(Modifier.fillMaxSize().clickable(enabled = !disabled, onClick = open).padding(horizontal = 16.dp)
                        .semantics { contentDescription = listOf(text.title, text.value).filter { it.isNotBlank() }.joinToString(" · ") },
                        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(text.title, modifier = Modifier.weight(1f), color = GlasmioTheme.colors.content, maxLines = 1)
                        Text(text.value, color = GlasmioTheme.colors.secondaryContent, maxLines = 1)
                        ViewMenuIcon("caret", GlasmioTheme.colors.secondaryContent, 18.dp)
                    }
                } else GlasmioIconButton(open, enabled = !disabled,
                    style = GlassSurfaceStyle.Navigation,
                    frostRadius = if (triggerSurface) FolioHeaderFrostRadius else null,
                    modifier = Modifier.semantics { contentDescription = text.title }) {
                    ViewMenuIcon(if (triggerIcon == "more") "dots" else "caret", GlasmioTheme.colors.content, 20.dp)
                }
            }) { backdrop, close ->
                items.forEach { item ->
                    GlasmioMenuItem(item.label, {
                        if (!disabled && !item.disabled) {
                            onSelectionChange(payload("id" to item.id))
                            close()
                        }
                    }, enabled = !item.disabled, backdrop = backdrop,
                        systemName = item.icon.takeIf { it.isNotBlank() },
                        trailing = if (item.id == selectedId) ({ ViewMenuIcon("check", GlasmioTheme.colors.content, 18.dp) }) else null)
                }
            }
        }
    }

    override fun onDetachedFromWindow() { updateExpanded(false); super.onDetachedFromWindow() }
    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility != VISIBLE) updateExpanded(false)
    }
}
