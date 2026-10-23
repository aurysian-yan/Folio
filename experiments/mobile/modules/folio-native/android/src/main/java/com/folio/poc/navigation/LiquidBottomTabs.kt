// 液态底栏的材质及分层绘制沿用锁定的 Nexio 源码。
package com.folio.poc.navigation

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseOut
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.spring
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.lerp as lerpDp
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
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.sign
import kotlin.math.sin
import kotlin.math.tanh

internal val LocalLiquidBottomTabScale =
    staticCompositionLocalOf { { 1f } }

internal val LocalLiquidTabCompactProgress =
    staticCompositionLocalOf { 0f }

internal data class LiquidTabCollapseGeometry(
    val progress: Float,
    val fullWidthPx: Float,
    val currentWidthPx: Float,
    val compactWidthPx: Float,
    val insetPx: Float,
    val count: Int,
)

internal val LocalLiquidTabCollapse =
    staticCompositionLocalOf { LiquidTabCollapseGeometry(0f, 1f, 1f, 1f, 0f, 1) }

// 选中图标在胶囊收成圆形后才缩到紧凑尺寸。
internal fun compactIconLateProgress(progress: Float): Float {
    if (progress <= 0.74f) return 0f
    val morph = ((progress - 0.74f) / 0.26f).coerceIn(0f, 1f)
    return FastOutSlowInEasing.transform(morph)
}

@Composable
fun RowScope.LiquidBottomTab(
    selected: Boolean,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    selectionActive: Boolean = true,
    index: Int = 0,
    content: @Composable ColumnScope.() -> Unit
) {
    val scale = LocalLiquidBottomTabScale.current
    val collapse = LocalLiquidTabCollapse.current
    val density = LocalDensity.current
    val progress = collapse.progress
    val contentWidth = (collapse.currentWidthPx - collapse.insetPx * 2f).coerceAtLeast(1f)
    val expandedWidth = (collapse.fullWidthPx - collapse.insetPx * 2f) / collapse.count.coerceAtLeast(1)
    // 紧凑圆的内宽等于收起后的整个内容宽度。
    val selectedWidth = lerp(expandedWidth, (collapse.compactWidthPx - collapse.insetPx * 2f).coerceAtLeast(1f), progress)
    val slotWidth = contentWidth / collapse.count.coerceAtLeast(1)
    val isLtr = LocalLayoutDirection.current == LayoutDirection.Ltr
    val slotCenter = collapse.insetPx + (index + 0.5f) * slotWidth
    val expandedCenter = collapse.insetPx + (index + 0.5f) * expandedWidth
    val translation = (lerp(expandedCenter, collapse.compactWidthPx / 2f, progress) - slotCenter) * if (isLtr) 1f else -1f
    val alpha = if (selected) 1f else (1f - progress * 1.35f).coerceIn(0f, 1f)
    val lateScale = compactIconLateProgress(progress)
    val width = if (selected) with(density) { selectedWidth.toDp() } else null

    Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) {
        Column(
            modifier
                .then(width?.let { Modifier.requiredWidth(it) } ?: Modifier.fillMaxWidth())
                .fillMaxHeight()
                .graphicsLayer {
                    translationX = if (selected) translation else 0f
                    this.alpha = alpha
                    val s = scale() * lerp(1f, (22f / 28f) / 0.82f, lateScale)
                    scaleX = s
                    scaleY = s
                }
                .clip(ContinuousCapsule())
                .selectable(selected && selectionActive, remember { MutableInteractionSource() }, null,
                    enabled = enabled && progress < 0.74f, role = Role.Tab, onClick = onClick)
                .clearAndSetSemantics {
                    role = Role.Tab
                    this.selected = selected && selectionActive
                    contentDescription = label
                    if (enabled && progress < 0.74f) onClick { onClick(); true } else disabled()
                },
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
            content = content
        )
    }
}

@Composable
fun LiquidBottomTabs(
    selectedTabIndex: () -> Int,
    onTabSelected: (index: Int) -> Unit,
    backdrop: Backdrop,
    tabsCount: Int,
    dark: Boolean,
    accentColor: Color,
    modifier: Modifier = Modifier,
    containerHeight: Dp = 56.dp,
    highlightHeight: Dp = 48.dp,
    selectorHeight: Dp = 48.dp,
    enabled: Boolean = true,
    containerTint: Color? = null,
    preserveCapsuleOnPress: Boolean = false,
    compactProgress: Float = 0f,
    selectionActive: Boolean = true,
    compactLabel: String = "",
    compactHint: String = "",
    onExpand: () -> Unit = {},
    compactSize: Dp = 48.dp,
    content: @Composable RowScope.() -> Unit
) {
    val isLightTheme = !dark
    val containerColor =
        containerTint ?: if (isLightTheme) Color(0xFFFFFFFF).copy(0.6f)
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
        val trackInset = if (preserveCapsuleOnPress) 2.dp else 4.dp
        val padPx = with(density) { trackInset.toPx() }
        val tabWidth = (constraints.maxWidth.toFloat() - padPx * 2f) / tabsCount
        val maxIndex = (tabsCount - 1).toFloat()
        val compactWidthPx = with(density) { compactSize.toPx() }
        val currentWidthPx = lerp(constraints.maxWidth.toFloat(), compactWidthPx, compactProgress)
        val currentWidth = with(density) { currentWidthPx.toDp() }
        val currentHeight = lerpDp(containerHeight, compactSize, compactProgress)
        val collapseGeometry = LiquidTabCollapseGeometry(
            progress = compactProgress,
            fullWidthPx = constraints.maxWidth.toFloat(),
            currentWidthPx = currentWidthPx,
            compactWidthPx = compactWidthPx,
            insetPx = padPx,
            count = tabsCount,
        )

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
        val compactInteraction = remember(animationScope) { InteractiveHighlight(animationScope, consumeDrag = true) }
        val compactMode = compactProgress >= 0.74f
        val innerGlassVisibility = if (compactProgress <= 0.74f) 1f else {
            1f - FastOutSlowInEasing.transform(((compactProgress - 0.74f) / 0.24f).coerceIn(0f, 1f))
        }
        val opticalVisibility = (1f - compactProgress * 1.5f).coerceIn(0f, 1f)

        var currentIndex by remember { mutableIntStateOf(selectedTabIndex()) }
        val dampedDragAnimation = remember(animationScope, tabsCount, preserveCapsuleOnPress) {
            DampedDragAnimation(
                animationScope = animationScope,
                initialValue = selectedTabIndex().toFloat(),
                valueRange = 0f..maxIndex,
                visibilityThreshold = 0.001f,
                initialScale = 1f,
                pressedScale = if (preserveCapsuleOnPress) 1.22f else 78f / 56f,
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
                .graphicsLayer {
                    translationX = panelOffset
                    scaleY = 1f + 0.045f * sin(PI.toFloat() * compactProgress)
                    transformOrigin = androidx.compose.ui.graphics.TransformOrigin(if (isLtr) 0f else 1f, 0.5f)
                    if (motionEnabled && compactMode) {
                        val offset = compactInteraction.offset
                        val press = compactInteraction.pressProgress
                        scaleX = 1f + 0.12f * press + 0.08f * (abs(offset.x) / size.width).coerceAtMost(1f)
                        scaleY = 1f + 0.12f * press + 0.08f * (abs(offset.y) / size.height).coerceAtMost(1f)
                        translationX += size.width * tanh(0.05f * offset.x / size.width)
                        translationY = size.height * tanh(0.05f * offset.y / size.height)
                    }
                }
                .then(if (preserveCapsuleOnPress) {
                    Modifier.drawBackdrop(
                        backdrop = backdrop, shape = { ContinuousCapsule() }, effects = panelEffects,
                        highlight = null, shadow = null, onDrawSurface = panelSurface,
                    ).edgeLight(shape = ContinuousCapsule(), edgeLight = defaultEdgeLight)
                } else {
                    Modifier.navigationGlass(backdrop = backdrop, dark = dark,
                        layerBlock = {
                            val progress = if (motionEnabled && !compactMode) dampedDragAnimation.pressProgress else 0f
                            val scale = lerp(1f, 1f + 16.dp.toPx() / size.width, progress)
                            scaleX = scale
                            scaleY = scale
                        },
                        onDrawSurface = panelSurface,
                    )
                })
                .then(if (motionEnabled) interactiveHighlight.modifier else Modifier)
                .then(if (compactMode) Modifier.clearAndSetSemantics {} else Modifier)
                .width(currentWidth)
                .height(currentHeight)
                .padding(trackInset),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CompositionLocalProvider(
                LocalLiquidTabCollapse provides collapseGeometry,
                LocalLiquidTabCompactProgress provides compactProgress,
                LocalLiquidBottomTabScale provides {
                    if (preserveCapsuleOnPress) lerp(1f, 1.2f, if (motionEnabled) dampedDragAnimation.pressProgress else 0f)
                    else (1f - compactProgress).coerceAtLeast(0.82f)
                },
            ) { content() }
        }

        CompositionLocalProvider(
            LocalLiquidBottomTabScale provides {
                lerp(1f, 1.2f, if (motionEnabled) dampedDragAnimation.pressProgress else 0f) *
                    if (preserveCapsuleOnPress) 1f else (1f - compactProgress).coerceAtLeast(0.82f)
            },
            LocalLiquidTabCollapse provides collapseGeometry,
            LocalLiquidTabCompactProgress provides compactProgress,
        ) {
            Row(
                Modifier
                    .clearAndSetSemantics {}
                    .alpha(0f)
                    .layerBackdrop(tabsBackdrop)
                    .graphicsLayer {
                        translationX = panelOffset
                        scaleY = 1f + 0.045f * sin(PI.toFloat() * compactProgress)
                        transformOrigin = androidx.compose.ui.graphics.TransformOrigin(if (isLtr) 0f else 1f, 0.5f)
                    }
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
                    .width(currentWidth)
                    .height(lerpDp(highlightHeight, compactSize, compactProgress))
                    .padding(horizontal = trackInset)
                    .graphicsLayer(colorFilter = ColorFilter.tint(accentColor)),
                verticalAlignment = Alignment.CenterVertically,
                content = content
            )
        }

        val selectorPress = if (preserveCapsuleOnPress && motionEnabled) dampedDragAnimation.pressProgress.coerceIn(0f, 1f) else 0f
        val selectorStretch = if (preserveCapsuleOnPress && motionEnabled) dampedDragAnimation.dragStretch * selectorPress else 0f
        val idleSelectorInset = if (preserveCapsuleOnPress) 2.dp * (1f - selectorPress) else 0.dp
        val selectorWidth = with(density) { tabWidth.toDp() } - idleSelectorInset * 2 + 26.dp * selectorPress + 24.dp * selectorStretch
        val compactSelectorWidth = with(density) { (compactWidthPx - padPx * 2f).toDp() }
        val compactSelectorHeight = compactSize - 8.dp
        val animatedSelectorWidth = if (preserveCapsuleOnPress) selectorWidth
            else lerpDp(with(density) { tabWidth.toDp() }, compactSelectorWidth, compactProgress)
        val animatedSelectorHeight = if (preserveCapsuleOnPress) selectorHeight + 18.dp * selectorPress - 4.dp * selectorStretch
            else lerpDp(selectorHeight, compactSelectorHeight, compactProgress)
        Box(
            Modifier.width(animatedSelectorWidth).requiredHeight(animatedSelectorHeight)
                .graphicsLayer {
                    val currentTabWidth = (currentWidthPx - padPx * 2f) / tabsCount
                    val tabCenter = if (isLtr) padPx + (dampedDragAnimation.value + 0.5f) * currentTabWidth
                        else currentWidthPx - padPx - (dampedDragAnimation.value + 0.5f) * currentTabWidth
                    val compactCenter = if (isLtr) compactWidthPx / 2f else currentWidthPx - compactWidthPx / 2f
                    val indicatorLeft = (lerp(tabCenter, compactCenter, compactProgress) - size.width / 2f)
                        .coerceIn(padPx, (currentWidthPx - padPx - size.width).coerceAtLeast(padPx))
                    // 端点拉伸向轨道内展开，避免胶囊端部超出屏幕。
                    val overhang = 13.dp.toPx() - padPx
                    translationX = if (preserveCapsuleOnPress) {
                        val position = if (isLtr) dampedDragAnimation.value * tabWidth + panelOffset
                            else size.width - (dampedDragAnimation.value + 1f) * tabWidth + panelOffset
                        position.coerceIn(-overhang, constraints.maxWidth - size.width + overhang)
                    } else indicatorLeft + (if (isLtr) 0f else size.width - currentWidthPx) + panelOffset
                    if (!preserveCapsuleOnPress) scaleY = 1f + 0.045f * sin(PI.toFloat() * compactProgress)
                }
                .drawBackdrop(
                    backdrop = rememberCombinedBackdrop(backdrop, tabsBackdrop),
                    shape = { ContinuousCapsule() },
                    downsampleScale = 1f,
                    effects = {
                        val progress = if (motionEnabled) dampedDragAnimation.pressProgress * opticalVisibility else 0f
                        lens(
                            10f.dp.toPx() * progress,
                            14f.dp.toPx() * progress,
                            chromaticAberration = true
                        )
                    },
                    highlight = {
                        val progress = if (motionEnabled) dampedDragAnimation.pressProgress * opticalVisibility else 0f
                        Highlight.Default.copy(alpha = progress)
                    },
                    shadow = {
                        val progress = if (motionEnabled) dampedDragAnimation.pressProgress * opticalVisibility else 0f
                        Shadow(alpha = progress)
                    },
                    innerShadow = {
                        val progress = if (motionEnabled) dampedDragAnimation.pressProgress * opticalVisibility else 0f
                        InnerShadow(
                            radius = 8f.dp * progress,
                            alpha = progress
                        )
                    },
                    layerBlock = {
                        alpha = if (selectionActive) innerGlassVisibility else 0f
                        // 长胶囊以实际尺寸生成轮廓，端部不参与非等比缩放。
                        scaleX = if (motionEnabled && !preserveCapsuleOnPress) dampedDragAnimation.scaleX else 1f
                        scaleY = if (motionEnabled && !preserveCapsuleOnPress) dampedDragAnimation.scaleY else 1f
                        val velocity = if (motionEnabled) dampedDragAnimation.velocity / 10f else 0f
                        if (!preserveCapsuleOnPress) {
                            scaleX /= 1f - (velocity * 0.75f).fastCoerceIn(-0.2f, 0.2f)
                            scaleY *= 1f - (velocity * 0.25f).fastCoerceIn(-0.2f, 0.2f)
                        }
                    },
                    onDrawSurface = {
                        val progress = if (motionEnabled) dampedDragAnimation.pressProgress else 0f
                        drawRect(
                            if (isLightTheme) Color.Black.copy(0.08f)
                            else Color.White.copy(0.1f),
                            alpha = (1f - progress) * (1f - compactProgress)
                        )
                        drawRect(Color.Black.copy(alpha = 0.03f * progress))
                    }
                )
                .then(if (motionEnabled) interactiveHighlight.gestureModifier else Modifier)
        )

        if (compactProgress < 0.74f) Box(
            Modifier
                .fillMaxSize()
                .clearAndSetSemantics {}
                .pointerInput(tabsCount, tabWidth, isLtr, padPx, enabled) {
                    if (!enabled || tabWidth <= 0f) return@pointerInput
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
                        if (dragging) dampedDragAnimation.press(down.uptimeMillis)
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
                                    dampedDragAnimation.updateValue(dragStartValue + displacement / tabWidth * ltrSign, change.uptimeMillis)
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
        if (compactMode) {
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .width(with(density) { compactWidthPx.toDp() })
                    .height(containerHeight)
                    .then(if (enabled) compactInteraction.gestureModifier else Modifier)
                    .clickable(enabled = enabled, interactionSource = remember { MutableInteractionSource() }, indication = null,
                        role = Role.Tab, onClick = onExpand)
                    .clearAndSetSemantics {
                        role = Role.Tab
                        contentDescription = if (compactHint.isEmpty()) compactLabel else "$compactLabel，$compactHint"
                        this.selected = selectionActive
                        if (enabled) onClick { onExpand(); true } else disabled()
                    }
            )
        }
    }
}
