package com.folio.poc.navigation

import android.content.Context
import android.graphics.Canvas
import android.view.View
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.folio.poc.navigation.liquidglass.DampedDragAnimation
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.highlight.Highlight
import com.kyant.backdrop.shadow.InnerShadow
import com.kyant.backdrop.shadow.Shadow
import com.kyant.capsule.ContinuousCapsule
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs
import kotlin.math.ceil

// 原生滑块同步绘制拖动，受控回传通过事件序号排除过期值。
class FolioGlassSliderView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    var label by mutableStateOf("")
    var valueText by mutableStateOf("")
    var minimum by mutableStateOf(0.0)
    var maximum by mutableStateOf(1.0)
    var step by mutableStateOf(0.0)
    var controlEnabled by mutableStateOf(true)
    var dark by mutableStateOf(false)
    var accentColor by mutableStateOf("")
    var trackColor by mutableStateOf("")
    var thumbColor by mutableStateOf("")
    var surfaceColor by mutableStateOf("")
    var incomingValue = 0.0
    var mostRecentEventCount = 0
    private var eventCount = 0
    private var currentValue by mutableStateOf(0.0)
    private val onValueChange by EventDispatcher()
    private val onEditingChanged by EventDispatcher()
    private val compose = ComposeView(context)

    init {
        clipChildren = false
        clipToPadding = false
        compose.clipChildren = false
        compose.clipToPadding = false
        compose.setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool)
        addView(compose, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        compose.setContent {
            if (listOf(accentColor, trackColor, thumbColor, surfaceColor).any { it.isEmpty() }) return@setContent
            GlassSlider(label, valueText, currentValue, minimum, maximum, step, controlEnabled, dark,
                Color(android.graphics.Color.parseColor(accentColor)), Color(android.graphics.Color.parseColor(trackColor)),
                Color(android.graphics.Color.parseColor(thumbColor)), Color(android.graphics.Color.parseColor(surfaceColor)),
                drawSurface = ::drawAncestorBackgrounds,
                lockScroll = { parent?.requestDisallowInterceptTouchEvent(it) }, onChange = ::commitValue,
                onEditingChanged = { onEditingChanged(mapOf("isEditing" to it)) })
        }
    }

    fun applyProps() {
        val next = if (mostRecentEventCount >= eventCount) incomingValue else currentValue
        currentValue = snapSliderValue(next, minimum, maximum, 0.0)
    }

    private fun commitValue(value: Double) {
        if (!controlEnabled) return
        val next = snapSliderValue(value, minimum, maximum, step)
        if (next == currentValue) return
        currentValue = next
        eventCount++
        onValueChange(mapOf("value" to next, "eventCount" to eventCount))
    }

    // 只记录祖先背景与本地轨道，不捕获拨片或页面前景。
    private fun drawAncestorBackgrounds(canvas: Canvas) {
        val origin = IntArray(2)
        compose.getLocationInWindow(origin)
        val ancestors = generateSequence(parent as? View) { it.parent as? View }.toList()
        val location = IntArray(2)
        for (ancestor in ancestors.asReversed()) {
            val background = ancestor.background ?: continue
            ancestor.getLocationInWindow(location)
            val saved = canvas.save()
            canvas.translate((location[0] - origin[0]).toFloat(), (location[1] - origin[1]).toFloat())
            background.draw(canvas)
            canvas.restoreToCount(saved)
        }
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        if (!isAttachedToWindow) {
            setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
            return
        }
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        if (isAttachedToWindow) super.onLayout(changed, left, top, right, bottom)
    }

    override fun onAttachedToWindow() {
        val activity = appContext.currentActivity
        (activity as? LifecycleOwner)?.let { setViewTreeLifecycleOwner(it) }
        (activity as? SavedStateRegistryOwner)?.let { setViewTreeSavedStateRegistryOwner(it) }
        super.onAttachedToWindow()
        requestLayout()
    }
}

@Composable
private fun GlassSlider(label: String, valueText: String, value: Double, minimum: Double, maximum: Double,
    step: Double, controlEnabled: Boolean, dark: Boolean, accent: Color, track: Color, thumb: Color,
    surface: Color, drawSurface: (Canvas) -> Unit, lockScroll: (Boolean) -> Unit, onChange: (Double) -> Unit, onEditingChanged: (Boolean) -> Unit) {
    val enabled = controlEnabled && minimum.isFinite() && maximum.isFinite() && maximum > minimum
    val fraction = if (enabled) ((value - minimum) / (maximum - minimum)).toFloat().coerceIn(0f, 1f) else 0f
    val scope = rememberCoroutineScope()
    val motionEnabled = (scope.coroutineContext[MotionDurationScale]?.scaleFactor ?: 1f) > 0f
    val animation = remember(scope) { DampedDragAnimation(scope, fraction, 0f..1f, 0.001f, 1f, 1f) }
    val press = if (enabled && motionEnabled) animation.pressProgress.coerceIn(0f, 1f) else 0f
    val stretch = if (enabled && motionEnabled) animation.dragStretch * press else 0f
    val density = LocalDensity.current
    val inset = with(density) { 16.dp.toPx() }
    val touchSlop = LocalViewConfiguration.current.touchSlop
    val isLtr = LocalLayoutDirection.current == LayoutDirection.Ltr
    val shape = remember { ContinuousCapsule() }
    var width by remember { mutableStateOf(0f) }
    val travel = (width - inset * 2f).coerceAtLeast(0f)
    val center = inset + travel * if (isLtr) fraction else 1f - fraction
    val latestFraction by rememberUpdatedState(fraction)
    val latestOnChange by rememberUpdatedState(onChange)
    val latestOnEditingChanged by rememberUpdatedState(onEditingChanged)
    val latestDrawSurface by rememberUpdatedState(drawSurface)
    val latestLockScroll by rememberUpdatedState(lockScroll)
    val backdrop = rememberLayerBackdrop(onDraw = {
        drawRect(surface)
        latestDrawSurface(drawContext.canvas.nativeCanvas)
        drawContent()
    })

    Box(Modifier.fillMaxSize().onSizeChanged { width = it.width.toFloat() }.clearAndSetSemantics {
        contentDescription = label
        stateDescription = valueText
        val steps = if (step > 0.0) (ceil((maximum - minimum) / step) - 1).coerceIn(0.0, Int.MAX_VALUE.toDouble()).toInt() else 0
        progressBarRangeInfo = ProgressBarRangeInfo(value.toFloat(), minimum.toFloat()..maximum.toFloat(), steps)
        if (enabled) setProgress { next -> latestOnChange(next.toDouble()); true } else disabled()
    }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize().layerBackdrop(backdrop)) {
            val height = 12.dp.toPx()
            val top = (size.height - height) / 2f
            drawRoundRect(track, Offset(0f, top), Size(size.width, height), CornerRadius(height / 2f))
            val fillWidth = inset + travel * fraction
            if (fillWidth > 0f) drawRoundRect(accent,
                Offset(if (isLtr) 0f else size.width - fillWidth, top), Size(fillWidth, height),
                CornerRadius(minOf(height / 2f, fillWidth / 2f)))
        }
        Box(Modifier.requiredSize(32.dp + 20.dp * press + 8.dp * stretch, 22.dp + 18.dp * press - 3.dp * stretch)
            .graphicsLayer { translationX = center - width / 2f }
            .drawBackdrop(backdrop, shape = { shape }, downsampleScale = 1f, effects = {
                blur(0.35.dp.toPx() * press)
                sliderRefraction(press)
            }, highlight = { Highlight.Default.copy(alpha = 0.35f * press) },
                shadow = { Shadow(radius = 2.dp + 2.dp * press,
                    color = Color.Black.copy(alpha = if (dark) 0.36f - 0.08f * press else 0.16f - 0.04f * press)) },
                innerShadow = { InnerShadow(radius = 1.dp, offset = DpOffset(0.dp, 0.5.dp),
                    color = Color.Black.copy(alpha = if (dark) 0.1f else 0.06f), alpha = press) },
                onDrawSurface = { drawRect(thumb.copy(alpha = 1f - press)) }))
        Box(Modifier.fillMaxSize().clearAndSetSemantics {}.pointerInput(enabled, travel, isLtr, motionEnabled, minimum, maximum, step) {
            if (!enabled || travel <= 0f) return@pointerInput
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                val initial = latestFraction
                val thumbCenter = inset + travel * if (isLtr) initial else 1f - initial
                val onThumb = abs(down.position.x - thumbCenter) <= with(density) { 26.dp.toPx() }
                var dragging = false
                if (motionEnabled) { animation.updateValue(initial, down.uptimeMillis); animation.press(down.uptimeMillis) }
                latestOnEditingChanged(true)
                try {
                    while (true) {
                        val event = awaitPointerEvent(PointerEventPass.Main)
                        val change = event.changes.firstOrNull { it.id == down.id } ?: break
                        if (change.isConsumed) break
                        val delta = change.position - down.position
                        if (!dragging && abs(delta.y) > touchSlop && abs(delta.y) >= abs(delta.x)) break
                        if (!dragging && abs(delta.x) > touchSlop) {
                            dragging = true
                            latestLockScroll(true)
                        }
                        val physical = (change.position.x - inset) / travel
                        val rawFraction = if (onThumb) initial + delta.x / travel * if (isLtr) 1f else -1f
                            else if (isLtr) physical else 1f - physical
                        if (dragging || !change.pressed) {
                            val next = rawFraction.coerceIn(0f, 1f)
                            latestOnChange(minimum + next * (maximum - minimum))
                            if (motionEnabled) animation.updateValue(rawFraction, change.uptimeMillis)
                            change.consume()
                        }
                        if (!change.pressed) break
                    }
                } finally {
                    latestOnEditingChanged(false)
                    latestLockScroll(false)
                    if (motionEnabled) animation.release()
                }
            }
        })
    }
}
