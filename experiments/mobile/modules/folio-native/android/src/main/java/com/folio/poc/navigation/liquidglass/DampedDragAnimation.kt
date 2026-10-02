package com.folio.poc.navigation.liquidglass

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.android.awaitFrame
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlin.math.abs
import android.os.SystemClock

class DampedDragAnimation(
    private val animationScope: CoroutineScope,
    val initialValue: Float,
    val valueRange: ClosedRange<Float>,
    val visibilityThreshold: Float,
    val initialScale: Float,
    val pressedScale: Float,
) {

    private val valueAnimationSpec =
        spring(1f, 1000f, visibilityThreshold)
    private val velocityAnimationSpec =
        spring(0.5f, 300f, visibilityThreshold * 10f)
    private val pressProgressAnimationSpec =
        spring(1f, 1000f, 0.001f)
    private val scaleXAnimationSpec =
        spring(0.6f, 250f, 0.001f)
    private val scaleYAnimationSpec =
        spring(0.7f, 250f, 0.001f)

    private val valueAnimation =
        Animatable(initialValue, visibilityThreshold)
    private val velocityAnimation =
        Animatable(0f, visibilityThreshold * 10f)
    private val pressProgressAnimation =
        Animatable(0f, 0.001f)
    private val scaleXAnimation =
        Animatable(initialScale, 0.001f)
    private val scaleYAnimation =
        Animatable(initialScale, 0.001f)

    private var pointerValue = initialValue
    private var pointerTimeMillis = 0L
    private var dragValue by mutableStateOf<Float?>(null)

    val value: Float get() = dragValue ?: valueAnimation.value
    val progress: Float get() = (value - valueRange.start) / (valueRange.endInclusive - valueRange.start)
    var targetValue: Float = initialValue
        private set
    val pressProgress: Float get() = pressProgressAnimation.value
    val scaleX: Float get() = scaleXAnimation.value
    val scaleY: Float get() = scaleYAnimation.value
    val velocity: Float get() = velocityAnimation.value
    val dragStretch: Float get() = (abs(velocity) / 4f).coerceIn(0f, 1f)

    private var valueJob: Job? = null
    private var releaseJob: Job? = null
    private var velocityJob: Job? = null

    fun press(timeMillis: Long = SystemClock.uptimeMillis()) {
        val currentValue = value
        releaseJob?.cancel()
        valueJob?.cancel()
        dragValue = currentValue
        targetValue = currentValue
        pointerValue = currentValue
        pointerTimeMillis = timeMillis
        settleVelocity()
        animationScope.launch {
            launch { pressProgressAnimation.animateTo(1f, pressProgressAnimationSpec) }
            launch { scaleXAnimation.animateTo(pressedScale, scaleXAnimationSpec) }
            launch { scaleYAnimation.animateTo(pressedScale, scaleYAnimationSpec) }
        }
    }

    fun release() {
        releaseJob?.cancel()
        releaseJob = animationScope.launch {
            awaitFrame()
            if (value != targetValue) {
                val threshold = (valueRange.endInclusive - valueRange.start) * 0.025f
                snapshotFlow { value }
                    .filter { abs(it - targetValue) < threshold }
                    .first()
            }
            launch { pressProgressAnimation.animateTo(0f, pressProgressAnimationSpec) }
            launch { scaleXAnimation.animateTo(initialScale, scaleXAnimationSpec) }
            launch { scaleYAnimation.animateTo(initialScale, scaleYAnimationSpec) }
        }
    }

    fun updateValue(value: Float, timeMillis: Long = SystemClock.uptimeMillis()) {
        val target = value.coerceIn(valueRange)
        valueJob?.cancel()
        valueJob = null
        // 拖动位置同步更新，弹簧只负责点击和松手后的吸附。
        dragValue = target
        targetValue = target
        updateVelocity(value, timeMillis)
    }

    fun animateToValue(value: Float) {
        animateToValueKeepingPress(value)
        release()
    }

    fun animateToValueKeepingPress(value: Float) {
        val target = value.coerceIn(valueRange)
        val startValue = this.value
        val initialVelocity = if (dragValue == null) valueAnimation.velocity else 0f
        press()
        targetValue = target
        valueJob = animationScope.launch {
            valueAnimation.snapTo(startValue)
            dragValue = null
            valueAnimation.animateTo(target, valueAnimationSpec, initialVelocity)
        }
    }

    private fun updateVelocity(nextPointerValue: Float, timeMillis: Long) {
        // 原始位移按触摸时间采样，合并事件和端点外拖动仍保留形变反馈。
        val elapsedMillis = (timeMillis - pointerTimeMillis).coerceAtLeast(1L)
        val targetVelocity = (nextPointerValue - pointerValue) * 1000f / elapsedMillis / (valueRange.endInclusive - valueRange.start)
        pointerValue = nextPointerValue
        pointerTimeMillis = timeMillis
        val filteredVelocity = velocity + (targetVelocity.coerceIn(-8f, 8f) - velocity) * 0.4f
        velocityJob?.cancel()
        velocityJob = animationScope.launch {
            // 手势速度同步滤波，停止输入后由弹簧恢复。
            velocityAnimation.snapTo(filteredVelocity)
            delay(64)
            velocityAnimation.animateTo(0f, velocityAnimationSpec)
        }
    }

    private fun settleVelocity() {
        velocityJob?.cancel()
        velocityJob = animationScope.launch { velocityAnimation.animateTo(0f, velocityAnimationSpec) }
    }
}
