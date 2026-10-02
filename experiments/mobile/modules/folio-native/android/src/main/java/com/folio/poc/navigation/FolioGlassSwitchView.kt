package com.folio.poc.navigation

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
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
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.highlight.Highlight
import com.kyant.backdrop.internal.clipOutline
import com.kyant.backdrop.shadow.Shadow
import com.kyant.backdrop.shadow.InnerShadow
import com.kyant.capsule.ContinuousCapsule
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs

// iOS 风格玻璃开关自持拖动状态，提交值仍通过 React 偏好持久化。
class FolioGlassSwitchView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    var label by mutableStateOf("")
    var checked by mutableStateOf(false)
    var controlEnabled by mutableStateOf(true)
    var dark by mutableStateOf(false)
    var accentColor by mutableStateOf("")
    var trackColor by mutableStateOf("")
    var thumbColor by mutableStateOf("")
    var surfaceColor by mutableStateOf("")
    private val onValueChange by EventDispatcher()
    private val compose = ComposeView(context)

    init {
        clipChildren = false
        clipToPadding = false
        compose.setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool)
        addView(compose, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        compose.setContent {
            if (listOf(accentColor, trackColor, thumbColor, surfaceColor).any { it.isEmpty() }) return@setContent
            GlassToggle(label, checked, controlEnabled, dark, accentColor.switchColor(), trackColor.switchColor(),
                thumbColor.switchColor(), surfaceColor.switchColor()) { next ->
                if (controlEnabled && checked != next) {
                    checked = next
                    onValueChange(mapOf("value" to next))
                }
            }
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

private fun String.switchColor() = Color(android.graphics.Color.parseColor(this))

@Composable
private fun GlassToggle(label: String, checked: Boolean, enabled: Boolean, dark: Boolean,
    accent: Color, track: Color, thumb: Color, surface: Color, onChange: (Boolean) -> Unit) {
    val scope = rememberCoroutineScope()
    val motionEnabled = (scope.coroutineContext[MotionDurationScale]?.scaleFactor ?: 1f) > 0f
    val animation = remember(scope) {
        DampedDragAnimation(scope, if (checked) 1f else 0f, 0f..1f, 0.001f, 1f, 1f)
    }
    var gestureActive by remember { mutableStateOf(false) }
    val latestChecked by rememberUpdatedState(checked)
    val latestOnChange by rememberUpdatedState(onChange)
    LaunchedEffect(checked, gestureActive) {
        val target = if (checked) 1f else 0f
        if (!gestureActive && animation.targetValue != target) animation.animateToValue(target)
    }
    val backdrop = rememberLayerBackdrop()
    val shape = ContinuousCapsule()
    val sampleClipPath = remember { Path() }
    val density = LocalDensity.current
    val travel = with(density) { 20.dp.toPx() }
    val press = if (motionEnabled) animation.pressProgress.coerceIn(0f, 1f) else 0f
    val dragStretch = if (motionEnabled) animation.dragStretch * press else 0f
    val isLtr = LocalLayoutDirection.current == LayoutDirection.Ltr
    val touchSlop = LocalViewConfiguration.current.touchSlop

    Box(Modifier.fillMaxSize().toggleable(checked, remember { MutableInteractionSource() }, indication = null,
        enabled = enabled, role = Role.Switch, onValueChange = onChange).clearAndSetSemantics {
            role = Role.Switch
            toggleableState = if (checked) ToggleableState.On else ToggleableState.Off
            contentDescription = label
            if (enabled) onClick { onChange(!checked); true } else disabled()
        },
        contentAlignment = Alignment.Center) {
        // 玻璃只采样底色和轨道，避免将拨片自身重复折射。
        Box(Modifier.fillMaxSize().layerBackdrop(backdrop).background(surface), contentAlignment = Alignment.Center) {
            Box(Modifier.size(56.dp, 26.dp)
                .background(lerp(track, accent, animation.value.coerceIn(0f, 1f)), shape))
        }
        Box(Modifier.size(56.dp, 26.dp).clearAndSetSemantics {}, contentAlignment = Alignment.Center) {
            // 白色长拨片按住后扩展成玻璃，轮廓始终按实际宽高生成。
            Box(Modifier.requiredSize(32.dp + 20.dp * press + 8.dp * dragStretch,
                22.dp + 14.dp * press - 3.dp * dragStretch).graphicsLayer {
                val fraction = animation.value.coerceIn(0f, 1f)
                translationX = travel * ((if (isLtr) fraction else 1f - fraction) - 0.5f)
            }.drawBackdrop(backdrop, shape = { shape }, downsampleScale = 1f, effects = {
                blur(0.5.dp.toPx() * press)
                // 反向折射将轨道压入透镜中央，上下保留透明玻璃的底色。
                lens(18.dp.toPx() * press, 14.dp.toPx() * press, depthEffect = true, inverseRefraction = true)
            }, highlight = { Highlight.Default.copy(alpha = 0.65f * press) },
                shadow = { Shadow(radius = 2.dp + 6.dp * press, color = Color.Black.copy(alpha = if (dark) 0.36f else 0.16f)) },
                innerShadow = { InnerShadow(radius = 2.dp, offset = DpOffset(0.dp, 1.dp),
                    color = Color.Black.copy(alpha = if (dark) 0.18f else 0.1f), alpha = press) },
                onDrawBackdrop = { drawBackdrop ->
                    // 只折射拨片附近的轨道，关闭态的透镜端部保持完整。
                    drawRect(surface)
                    val sampleSize = Size(44.dp.toPx(), 26.dp.toPx())
                    val insetX = (size.width - sampleSize.width) / 2f
                    val insetY = (size.height - sampleSize.height) / 2f
                    val canvas = drawContext.canvas
                    canvas.save()
                    canvas.translate(insetX, insetY)
                    canvas.clipOutline(shape.createOutline(sampleSize, layoutDirection, this), sampleClipPath)
                    canvas.translate(-insetX, -insetY)
                    drawBackdrop()
                    canvas.restore()
                },
                onDrawSurface = { drawRect(thumb.copy(alpha = 1f - press)) }))
        }
        Box(Modifier.fillMaxSize().clearAndSetSemantics {}
            .pointerInput(enabled, travel, isLtr) {
                if (!enabled || travel <= 0f) return@pointerInput
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    gestureActive = true
                    val initial = animation.value.coerceIn(0f, 1f)
                    var dragged = false
                    var committed = false
                    if (motionEnabled) animation.press(down.uptimeMillis)
                    try {
                        while (true) {
                            val event = awaitPointerEvent(PointerEventPass.Main)
                            val change = event.changes.firstOrNull { it.id == down.id } ?: break
                            val distance = change.position.x - down.position.x
                            if (abs(distance) > touchSlop) dragged = true
                            val pointerValue = initial + distance / travel * if (isLtr) 1f else -1f
                            val next = pointerValue.coerceIn(0f, 1f)
                            if (!change.pressed) {
                                val value = if (dragged) next >= 0.5f else !latestChecked
                                committed = true
                                animation.animateToValue(if (value) 1f else 0f)
                                latestOnChange(value)
                                change.consume()
                                break
                            }
                            if (dragged) animation.updateValue(pointerValue, change.uptimeMillis)
                            change.consume()
                        }
                    } finally {
                        gestureActive = false
                        if (!committed) animation.animateToValue(if (latestChecked) 1f else 0f)
                    }
                }
            })
    }
}
