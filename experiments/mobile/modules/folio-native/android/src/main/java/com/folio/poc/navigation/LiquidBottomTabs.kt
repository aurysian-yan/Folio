// 液态底栏的材质及分层绘制沿用锁定的 Nexio 源码。
package com.folio.poc.navigation

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseOut
import androidx.compose.animation.core.spring
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.util.fastCoerceIn
import androidx.compose.ui.util.fastRoundToInt
import androidx.compose.ui.util.lerp
import com.folio.poc.navigation.edgelight.edgeLight
import com.folio.poc.navigation.liquidglass.DampedDragAnimation
import com.folio.poc.navigation.liquidglass.InteractiveHighlight
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberCombinedBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.highlight.Highlight
import com.kyant.backdrop.shadow.InnerShadow
import com.kyant.backdrop.shadow.Shadow
import com.kyant.capsule.ContinuousCapsule
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.sign

internal val LocalLiquidBottomTabScale =
    staticCompositionLocalOf { { 1f } }

@Composable
fun RowScope.LiquidBottomTab(
    selected: Boolean,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit
) {
    val scale = LocalLiquidBottomTabScale.current
    Column(
        modifier
            .clip(ContinuousCapsule())
            .selectable(selected, remember { MutableInteractionSource() }, null, role = Role.Tab, onClick = onClick)
            .clearAndSetSemantics {
                role = Role.Tab
                this.selected = selected
                contentDescription = label
                onClick { onClick(); true }
            }
            .fillMaxHeight()
            .weight(1f)
            .graphicsLayer {
                val s = scale()
                scaleX = s
                scaleY = s
            },
        verticalArrangement = Arrangement.spacedBy(2f.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
        content = content
    )
}

@Composable
fun LiquidBottomTabs(
    selectedTabIndex: () -> Int,
    onTabSelected: (index: Int) -> Unit,
    backdrop: Backdrop,
    tabsCount: Int,
    dark: Boolean,
    modifier: Modifier = Modifier,
    containerHeight: Dp = 56.dp,
    highlightHeight: Dp = 48.dp,
    selectorHeight: Dp = 48.dp,
    content: @Composable RowScope.() -> Unit
) {
    val isLightTheme = !dark
    val accentColor =
        if (isLightTheme) Color.Black
        else Color.White
    val containerColor =
        if (isLightTheme) Color(0xFFFFFFFF).copy(0.6f)
        else Color(0xFF121212).copy(0.54f)
    val defaultEdgeLight = remember(dark) {
        com.folio.poc.navigation.edgelight.EdgeLight.Uniform(
            color = Color.White.copy(alpha = if (dark) 0.4f else 0.7f)
        )
    }

    val tabsBackdrop = rememberLayerBackdrop()

    BoxWithConstraints(
        modifier,
        contentAlignment = Alignment.CenterStart
    ) {
        val density = LocalDensity.current
        val viewConfiguration = LocalViewConfiguration.current
        val padPx = with(density) { 4f.dp.toPx() }
        val tabWidth = (constraints.maxWidth.toFloat() - padPx * 2f) / tabsCount
        val maxIndex = (tabsCount - 1).toFloat()

        val offsetAnimation = remember { Animatable(0f) }
        val panelOffset by remember(density, constraints.maxWidth) {
            derivedStateOf {
                val fraction = (offsetAnimation.value / constraints.maxWidth).fastCoerceIn(-1f, 1f)
                with(density) {
                    4f.dp.toPx() * fraction.sign * EaseOut.transform(abs(fraction))
                }
            }
        }

        val isLtr = LocalLayoutDirection.current == LayoutDirection.Ltr
        val ltrSign = if (isLtr) 1f else -1f
        val animationScope = rememberCoroutineScope()
        val motionEnabled = (animationScope.coroutineContext[MotionDurationScale]?.scaleFactor ?: 1f) > 0f

        var currentIndex by remember { mutableIntStateOf(selectedTabIndex()) }
        val dampedDragAnimation = remember(animationScope) {
            DampedDragAnimation(
                animationScope = animationScope,
                initialValue = selectedTabIndex().toFloat(),
                valueRange = 0f..maxIndex,
                visibilityThreshold = 0.001f,
                initialScale = 1f,
                pressedScale = 78f / 56f,
            )
        }
        val latestSelectedTabIndex by rememberUpdatedState(selectedTabIndex)
        val latestOnTabSelected by rememberUpdatedState(onTabSelected)
        var gestureActive by remember { androidx.compose.runtime.mutableStateOf(false) }
        LaunchedEffect(selectedTabIndex(), gestureActive) {
            val index = latestSelectedTabIndex().fastCoerceIn(0, tabsCount - 1)
            if (!gestureActive && index != currentIndex) {
                currentIndex = index
                dampedDragAnimation.animateToValue(index.toFloat())
            }
        }

        val latestTabWidth by rememberUpdatedState(tabWidth)
        val latestPanelOffset by rememberUpdatedState(panelOffset)
        val latestIsLtr by rememberUpdatedState(isLtr)
        val interactiveHighlight = remember(animationScope) {
            InteractiveHighlight(
                animationScope = animationScope,
                position = { size, _ ->
                    Offset(
                        if (latestIsLtr) (dampedDragAnimation.value + 0.5f) * latestTabWidth + latestPanelOffset
                        else size.width - (dampedDragAnimation.value + 0.5f) * latestTabWidth + latestPanelOffset,
                        size.height / 2f
                    )
                }
            )
        }

        val panelEffects: com.kyant.backdrop.BackdropEffectScope.() -> Unit = remember {
            {
                vibrancy()
                blur(8f.dp.toPx())

            }
        }
        val panelSurface: androidx.compose.ui.graphics.drawscope.DrawScope.() -> Unit =
            remember(containerColor) { { drawRect(containerColor) } }
        Row(
            Modifier
                .graphicsLayer { translationX = panelOffset }
                .drawBackdrop(
                    backdrop = backdrop,
                    shape = { ContinuousCapsule() },
                    effects = panelEffects,
                    highlight = null,
                    layerBlock = {
                        val progress = if (motionEnabled) dampedDragAnimation.pressProgress else 0f
                        val scale = lerp(1f, 1f + 16f.dp.toPx() / size.width, progress)
                        scaleX = scale
                        scaleY = scale
                    },
                    onDrawSurface = panelSurface
                )
                .edgeLight(shape = ContinuousCapsule(), edgeLight = defaultEdgeLight)
                .then(if (motionEnabled) interactiveHighlight.modifier else Modifier)
                .height(containerHeight)
                .fillMaxWidth()
                .padding(4f.dp),
            verticalAlignment = Alignment.CenterVertically,
            content = content
        )

        CompositionLocalProvider(
            LocalLiquidBottomTabScale provides {
                lerp(1f, 1.2f, if (motionEnabled) dampedDragAnimation.pressProgress else 0f)
            }
        ) {
            Row(
                Modifier
                    .clearAndSetSemantics {}
                    .alpha(0f)
                    .layerBackdrop(tabsBackdrop)
                    .graphicsLayer { translationX = panelOffset }
                    .drawBackdrop(
                        backdrop = backdrop,
                        shape = { ContinuousCapsule() },
                        effects = {
                            val progress = if (motionEnabled) dampedDragAnimation.pressProgress else 0f
                            vibrancy()
                            blur(8f.dp.toPx())
                            lens(
                                24f.dp.toPx() * progress,
                                24f.dp.toPx() * progress
                            )
                        },
                        highlight = {
                            val progress = if (motionEnabled) dampedDragAnimation.pressProgress else 0f
                            Highlight.Default.copy(alpha = progress)
                        },
                        onDrawSurface = { drawRect(containerColor) }
                    )
                    .then(if (motionEnabled) interactiveHighlight.modifier else Modifier)
                    .height(highlightHeight)
                    .fillMaxWidth()
                    .padding(horizontal = 4f.dp)
                    .graphicsLayer(colorFilter = ColorFilter.tint(accentColor)),
                verticalAlignment = Alignment.CenterVertically,
                content = content
            )
        }

        Box(
            Modifier
                .padding(horizontal = 4f.dp)
                .graphicsLayer {
                    translationX =
                        if (isLtr) dampedDragAnimation.value * tabWidth + panelOffset
                        else size.width - (dampedDragAnimation.value + 1f) * tabWidth + panelOffset
                }
                .drawBackdrop(
                    backdrop = rememberCombinedBackdrop(backdrop, tabsBackdrop),
                    shape = { ContinuousCapsule() },
                    downsampleScale = 1f,
                    effects = {
                        val progress = if (motionEnabled) dampedDragAnimation.pressProgress else 0f
                        lens(
                            10f.dp.toPx() * progress,
                            14f.dp.toPx() * progress,
                            chromaticAberration = true
                        )
                    },
                    highlight = {
                        val progress = if (motionEnabled) dampedDragAnimation.pressProgress else 0f
                        Highlight.Default.copy(alpha = progress)
                    },
                    shadow = {
                        val progress = if (motionEnabled) dampedDragAnimation.pressProgress else 0f
                        Shadow(alpha = progress)
                    },
                    innerShadow = {
                        val progress = if (motionEnabled) dampedDragAnimation.pressProgress else 0f
                        InnerShadow(
                            radius = 8f.dp * progress,
                            alpha = progress
                        )
                    },
                    layerBlock = {
                        scaleX = if (motionEnabled) dampedDragAnimation.scaleX else 1f
                        scaleY = if (motionEnabled) dampedDragAnimation.scaleY else 1f
                        val velocity = if (motionEnabled) dampedDragAnimation.velocity / 10f else 0f
                        scaleX /= 1f - (velocity * 0.75f).fastCoerceIn(-0.2f, 0.2f)
                        scaleY *= 1f - (velocity * 0.25f).fastCoerceIn(-0.2f, 0.2f)
                    },
                    onDrawSurface = {
                        val progress = if (motionEnabled) dampedDragAnimation.pressProgress else 0f
                        drawRect(
                            if (isLightTheme) Color.Black.copy(0.08f)
                            else Color.White.copy(0.1f),
                            alpha = 1f - progress
                        )
                        drawRect(Color.Black.copy(alpha = 0.03f * progress))
                    }
                )
                .then(if (motionEnabled) interactiveHighlight.gestureModifier else Modifier)
                .height(selectorHeight)
                .fillMaxWidth(1f / tabsCount)
        )

        Box(
            Modifier
                .fillMaxSize()
                .clearAndSetSemantics {}
                .pointerInput(tabsCount, tabWidth, isLtr, padPx) {
                    if (tabWidth <= 0f) return@pointerInput
                    val touchSlop = viewConfiguration.touchSlop
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        gestureActive = true
                        var committed = false
                        val downX = down.position.x
                        val capsuleCenterX = if (isLtr) {
                            padPx + (dampedDragAnimation.value + 0.5f) * tabWidth
                        } else {
                            size.width - padPx - (dampedDragAnimation.value + 0.5f) * tabWidth
                        }
                        var dragging = abs(downX - capsuleCenterX) <= tabWidth * 0.55f
                        val pressedTab = if (isLtr) {
                            floor((downX - padPx) / tabWidth).toInt()
                        } else {
                            floor((size.width - padPx - downX) / tabWidth).toInt()
                        }.fastCoerceIn(0, tabsCount - 1)
                        // 手势位移独立于弹簧状态，避免连续事件丢失距离。
                        val dragStartValue = if (dragging) dampedDragAnimation.value.fastCoerceIn(0f, maxIndex)
                            else pressedTab.toFloat()
                        var dragValue = dragStartValue
                        if (dragging) dampedDragAnimation.press()
                        else dampedDragAnimation.animateToValueKeepingPress(pressedTab.toFloat())
                        var lastX = downX
                        try {
                            while (true) {
                                val event = awaitPointerEvent(PointerEventPass.Main)
                                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                                val displacement = change.position.x - downX
                                if (!dragging && abs(displacement) > touchSlop) dragging = true
                                if (dragging) {
                                    dragValue = (dragStartValue + displacement / tabWidth * ltrSign)
                                        .fastCoerceIn(0f, maxIndex)
                                }
                                if (!change.pressed) {
                                    val target = if (dragging) dragValue
                                        .fastRoundToInt().fastCoerceIn(0, tabsCount - 1) else pressedTab
                                    currentIndex = target
                                    committed = true
                                    dampedDragAnimation.animateToValue(target.toFloat())
                                    latestOnTabSelected(target)
                                    break
                                }
                                val dx = change.position.x - lastX
                                if (dragging && abs(dx) > 0.01f) {
                                    dampedDragAnimation.updateValue(dragValue)
                                    animationScope.launch { offsetAnimation.snapTo(displacement) }
                                }
                                lastX = change.position.x
                                change.consume()
                            }
                        } finally {
                            gestureActive = false
                            if (!committed) dampedDragAnimation.animateToValue(latestSelectedTabIndex().toFloat())
                            animationScope.launch { offsetAnimation.animateTo(0f, spring(1f, 300f, 0.5f)) }
                        }
                    }
                }
        )
    }
}
