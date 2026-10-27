package com.folio.poc.navigation

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import io.github.neoruaa.glasmio.ui.GlasmioSwitch

class FolioGlassSwitchView(context: Context, appContext: AppContext) : FolioGlassView(context, appContext) {
    var label by mutableStateOf("")
    var checked by mutableStateOf(false)
    var trackColor = ""
    var thumbColor = ""
    private val onValueChange by EventDispatcher()

    @Composable override fun GlassContent() {
        GlasmioSwitch(checked, { value ->
            if (controlEnabled) {
                checked = value
                onValueChange(mapOf("value" to value))
            }
        }, enabled = controlEnabled, modifier = Modifier.semantics { contentDescription = label })
    }
}
