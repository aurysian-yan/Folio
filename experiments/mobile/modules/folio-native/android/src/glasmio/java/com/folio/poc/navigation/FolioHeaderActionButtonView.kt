package com.folio.poc.navigation

import android.content.Context
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import io.github.neoruaa.glasmio.core.GlasmioTheme
import io.github.neoruaa.glasmio.glass.GlasmioToolbarActionGroup
import io.github.neoruaa.glasmio.glass.GlassSurfaceStyle
import io.github.neoruaa.glasmio.icons.SfIcon
import io.github.neoruaa.glasmio.ui.GlasmioIconButton

class FolioHeaderActionButtonView(context: Context, appContext: AppContext) : FolioGlassView(context, appContext) {
    var label by mutableStateOf("")
    var systemImage by mutableStateOf("")
    var busy by mutableStateOf(false)
    var controlSelected by mutableStateOf(false)
    var primary by mutableStateOf(false)
    private val onPress by EventDispatcher()

    @Composable override fun MaterialContent() {
        val colors = androidx.compose.material3.MaterialTheme.colorScheme
        val foreground = if (primary) colors.onPrimary else if (controlSelected) colors.onSecondaryContainer else colors.onSurfaceVariant
        androidx.compose.material3.FilledTonalIconButton(onClick = { if (controlEnabled && !busy) onPress(payload()) },
            colors = androidx.compose.material3.IconButtonDefaults.filledTonalIconButtonColors(
                containerColor = if (primary) colors.primary else if (controlSelected) colors.secondaryContainer else colors.surfaceContainerHigh,
                contentColor = foreground),
            enabled = controlEnabled && !busy, modifier = Modifier.semantics {
                contentDescription = label; selected = controlSelected
            }) {
            if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = foreground) else FolioMaterialIcon(systemImage)
        }
    }

    @Composable override fun GlassContent() {
        GlasmioToolbarActionGroup(frostRadius = FolioHeaderFrostRadius) {
            GlasmioIconButton({ if (controlEnabled && !busy) onPress(emptyMap<String, Any>()) },
                enabled = controlEnabled && !busy, style = GlassSurfaceStyle.Navigation, frostRadius = FolioHeaderFrostRadius,
                modifier = Modifier.semantics { contentDescription = label; selected = this@FolioHeaderActionButtonView.controlSelected }) {
                if (busy) CircularProgressIndicator(Modifier.size(20.dp))
                else SfIcon(systemImage, null, tint = if (controlSelected || primary) GlasmioTheme.colors.accent else GlasmioTheme.colors.content)
            }
        }
    }
}
