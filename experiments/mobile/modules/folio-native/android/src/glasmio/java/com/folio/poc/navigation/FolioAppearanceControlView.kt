package com.folio.poc.navigation

import android.content.Context
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import io.github.neoruaa.glasmio.icons.SfIcon
import io.github.neoruaa.glasmio.ui.GlasmioAdaptiveSlider
import io.github.neoruaa.glasmio.ui.GlasmioSegmentedControl

// 外观控件保留上游材质与手势，字号连续取值，视图保留枚举选项。
class FolioAppearanceControlView(context: Context, appContext: AppContext) : FolioGlassView(context, appContext) {
    var kind by mutableStateOf("")
    var label by mutableStateOf("")
    var reduceMotion by mutableStateOf(true)
    var items by mutableStateOf(emptyList<FolioNavigationItem>())
    var incomingSelectedId = ""
    var mostRecentEventCount = 0
    private var selectedId by mutableStateOf("")
    private var eventCount = 0
    private val onSelectionChange by EventDispatcher()

    fun applyProps() {
        if (mostRecentEventCount >= eventCount) selectedId = incomingSelectedId
    }

    private fun select(id: String) {
        if (!controlEnabled || id == selectedId) return
        if (kind == "size") {
            val value = id.toFloatOrNull() ?: return
            val lower = items.firstOrNull()?.id?.toFloatOrNull() ?: return
            val upper = items.lastOrNull()?.id?.toFloatOrNull() ?: return
            if (!value.isFinite() || value !in lower..upper) return
        } else if (items.none { it.id == id && !it.disabled }) return
        selectedId = id
        eventCount++
        onSelectionChange(mapOf("id" to id, "eventCount" to eventCount))
    }

    @Composable override fun GlassContent() {
        val modifier = Modifier.fillMaxWidth().semantics {
            contentDescription = label
            stateDescription = items.firstOrNull { it.id == selectedId }?.label ?: selectedId
        }
        if (kind == "size" && items.size == 3) {
            val lower = items.first().id.toFloatOrNull() ?: return
            val upper = items.last().id.toFloatOrNull() ?: return
            val value = selectedId.toFloatOrNull() ?: return
            if (!value.isFinite() || !lower.isFinite() || !upper.isFinite() || upper <= lower) return
            GlasmioAdaptiveSlider(
                value = ((value - lower) / (upper - lower)).coerceIn(0f, 1f),
                onValueChange = { fraction ->
                    if (fraction.isFinite()) select((lower + fraction.coerceIn(0f, 1f) * (upper - lower)).toString())
                },
                modifier = modifier, enabled = controlEnabled, discrete = false,
                showLabels = false, labels = items.map { it.label }, motionEnabled = !reduceMotion,
            )
        } else if (kind == "view" && items.size == 2) {
            GlasmioSegmentedControl(
                items = items.map { it.id to it.label }, selected = selectedId, onSelected = ::select,
                modifier = modifier, height = 56.dp, enabled = controlEnabled, motionEnabled = !reduceMotion,
                itemContent = { id, _ -> SfIcon(items.first { it.id == id }.icon, null, size = 26.dp) },
            )
        }
    }
}
