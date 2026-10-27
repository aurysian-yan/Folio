package com.folio.poc.navigation

import android.content.Context
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import io.github.neoruaa.glasmio.ui.GlasmioSlider

// 数值与步长由桥接层约束，手势和全部材质动画由 Glasmio 执行。
class FolioGlassSliderView(context: Context, appContext: AppContext) : FolioGlassView(context, appContext) {
    var label by mutableStateOf("")
    var valueText by mutableStateOf("")
    var minimum by mutableStateOf(0.0)
    var maximum by mutableStateOf(1.0)
    var step by mutableStateOf(0.0)
    var trackColor = ""
    var thumbColor = ""
    var incomingValue = 0.0
    var mostRecentEventCount = 0
    private var eventCount = 0
    private var currentValue by mutableStateOf(0.0)
    private var editing = false
    private val onValueChange by EventDispatcher()
    private val onEditingChanged by EventDispatcher()

    fun applyProps() {
        currentValue = snapSliderValue(if (mostRecentEventCount >= eventCount) incomingValue else currentValue,
            minimum, maximum, 0.0)
    }

    private fun commit(value: Double, final: Boolean = false) {
        val next = snapSliderValue(value, minimum, maximum, step)
        if (!final && next == currentValue) return
        currentValue = next
        eventCount++
        onValueChange(mapOf("value" to next, "eventCount" to eventCount))
    }

    private fun finishEditing() {
        if (!editing) return
        commit(currentValue, final = true)
        editing = false
        onEditingChanged(mapOf("isEditing" to false))
    }

    @Composable override fun GlassContent() {
        val valid = minimum.isFinite() && maximum.isFinite() && maximum > minimum && (maximum - minimum).isFinite()
        val enabled = controlEnabled && valid
        // 使用归一化区间避免极小字体轴范围转换为 Float 后重合。
        val fraction = if (valid) ((currentValue - minimum) / (maximum - minimum)).toFloat().coerceIn(0f, 1f) else 0f
        GlasmioSlider(fraction, { value ->
            if (enabled) commit(minimum + value * (maximum - minimum))
        }, enabled = enabled, onValueChangeFinished = ::finishEditing,
            modifier = Modifier.fillMaxWidth().semantics {
                contentDescription = label
                stateDescription = valueText
            }.pointerInput(enabled) {
                if (!enabled) return@pointerInput
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                    editing = true
                    onEditingChanged(mapOf("isEditing" to true))
                    try {
                        do { val event = awaitPointerEvent(PointerEventPass.Final) }
                        while (event.changes.any { it.pressed })
                    } finally { finishEditing() }
                }
            })
    }

    override fun onDetachedFromWindow() { finishEditing(); super.onDetachedFromWindow() }
}
