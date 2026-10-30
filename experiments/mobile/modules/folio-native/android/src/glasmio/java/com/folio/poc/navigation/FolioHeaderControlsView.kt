package com.folio.poc.navigation

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import io.github.neoruaa.glasmio.core.GlasmioTheme
import io.github.neoruaa.glasmio.glass.GlasmioToolbarActionGroup
import io.github.neoruaa.glasmio.glass.GlassSurfaceStyle
import io.github.neoruaa.glasmio.ui.GlasmioIconButton
import io.github.neoruaa.glasmio.ui.GlasmioMenu
import io.github.neoruaa.glasmio.ui.GlasmioMenuItem
import io.github.neoruaa.glasmio.ui.GlasmioSearchBar

class FolioHeaderControlsView(context: Context, appContext: AppContext) : FolioGlassView(context, appContext) {
    var mode by mutableStateOf("grid")
    var ready by mutableStateOf(false)
    var importing by mutableStateOf(false)
    var importBlocked by mutableStateOf(false)
    var searchOpen by mutableStateOf(false)
    var autoFocusSearch by mutableStateOf(false)
    var searchText by mutableStateOf("")
    var filterCount by mutableStateOf(0)
    var shadowProgress = 0f
    var colors by mutableStateOf<FolioViewMenuColors?>(null)
    var labels by mutableStateOf<FolioHeaderLabels?>(null)
    private var expanded by mutableStateOf(false)
    private val onModeChange by EventDispatcher()
    private val onExpandedChange by EventDispatcher()
    private val onImport by EventDispatcher()
    private val onSearchTextChange by EventDispatcher()
    private val onFilter by EventDispatcher()

    override fun onUiStyleChanged() { expanded = false; onExpandedChange(payload("expanded" to false)) }

    @Composable override fun MaterialContent() {
        val text = labels ?: return
        val focus = remember { FocusRequester() }
        LaunchedEffect(searchOpen, autoFocusSearch) { if (searchOpen && autoFocusSearch) focus.requestFocus() }
        if (searchOpen) {
            androidx.compose.material3.TextField(value = searchText, onValueChange = { onSearchTextChange(payload("text" to it)) },
                enabled = ready, singleLine = true, placeholder = { androidx.compose.material3.Text(text.searchPlaceholder) },
                leadingIcon = { FolioMaterialIcon("search") },
                trailingIcon = { androidx.compose.material3.IconButton(onClick = { onSearchTextChange(payload("text" to "")) },
                    modifier = Modifier.semantics { contentDescription = text.clearSearch }) { FolioMaterialIcon("xmark") } },
                modifier = Modifier.fillMaxWidth().focusRequester(focus).semantics { contentDescription = text.search })
            return
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            androidx.compose.foundation.layout.Box {
                MaterialHeaderButton(text.viewOptions, mode, ready) { expanded = true; onExpandedChange(payload("expanded" to true)) }
                androidx.compose.material3.DropdownMenu(expanded, { expanded = false; onExpandedChange(payload("expanded" to false)) }) {
                    listOf("grid" to text.gridView, "list" to text.listView).forEach { (value, title) ->
                        androidx.compose.material3.DropdownMenuItem(text = { androidx.compose.material3.Text(title) },
                            leadingIcon = { FolioMaterialIcon(value) },
                            trailingIcon = if (mode == value) ({ FolioMaterialIcon("check") }) else null,
                            onClick = { expanded = false; onExpandedChange(payload("expanded" to false)); onModeChange(payload("mode" to value)) })
                    }
                }
            }
            MaterialHeaderButton(text.filter, "filter", ready) { onFilter(payload()) }
            androidx.compose.material3.IconButton(onClick = { onImport(payload()) }, enabled = ready && !importing && !importBlocked,
                modifier = Modifier.semantics { contentDescription = text.importFonts }) {
                if (importing) CircularProgressIndicator() else FolioMaterialIcon("plus")
            }
        }
    }

    @Composable private fun MaterialHeaderButton(label: String, icon: String, enabled: Boolean, click: () -> Unit) {
        androidx.compose.material3.IconButton(onClick = click, enabled = enabled,
            modifier = Modifier.semantics { contentDescription = label }) { FolioMaterialIcon(icon) }
    }

    @Composable override fun GlassContent() {
        val text = labels ?: return
        val focus = remember { FocusRequester() }
        var query by remember { mutableStateOf(TextFieldValue(searchText)) }
        LaunchedEffect(searchText) { if (query.text != searchText) query = TextFieldValue(searchText) }
        LaunchedEffect(searchOpen, autoFocusSearch) { if (searchOpen && autoFocusSearch) focus.requestFocus() }
        if (searchOpen) {
            GlasmioSearchBar(query, { query = it; onSearchTextChange(payload("text" to it.text)) },
                true, {}, {}, text.searchPlaceholder, text.clearSearch, Modifier.fillMaxWidth(), focusRequester = focus)
            return
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            GlasmioToolbarActionGroup(frostRadius = FolioHeaderFrostRadius) {
                GlasmioMenu(expanded, { expanded = it; onExpandedChange(payload("expanded" to it)) }, 2,
                    anchor = { open ->
                        HeaderButton(text.viewOptions, mode, true, open)
                    }) { backdrop, close ->
                    listOf("grid" to text.gridView, "list" to text.listView).forEach { (value, title) ->
                        GlasmioMenuItem(title, { mode = value; onModeChange(payload("mode" to value)); close() }, backdrop = backdrop,
                            trailing = if (mode == value) ({ ViewMenuIcon("check", GlasmioTheme.colors.content, 18.dp) }) else null)
                    }
                }
                HeaderButton(text.filter, "filter", ready) { onFilter(emptyMap<String, Any>()) }
                GlasmioIconButton({ onImport(emptyMap<String, Any>()) }, enabled = ready && !importing && !importBlocked,
                    style = GlassSurfaceStyle.Navigation, frostRadius = FolioHeaderFrostRadius, modifier = Modifier.semantics { contentDescription = text.importFonts }) {
                    if (importing) CircularProgressIndicator() else ViewMenuIcon("plus", GlasmioTheme.colors.content, 24.dp)
                }
            }
        }
    }

    @Composable private fun HeaderButton(label: String, icon: String, enabled: Boolean, click: () -> Unit) {
        GlasmioIconButton(click, enabled = enabled, style = GlassSurfaceStyle.Navigation, frostRadius = FolioHeaderFrostRadius,
            modifier = Modifier.semantics { contentDescription = label }) { ViewMenuIcon(icon, GlasmioTheme.colors.content, 24.dp) }
    }
}
