package com.folio.poc.navigation

import android.content.Context
import com.facebook.react.uimanager.PointerEvents
import com.facebook.react.uimanager.ReactPointerEventsView
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.getValue
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.GraphicsLayerScope
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp as lerpColor
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.lerp as lerpDp
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.shadow.Shadow
import com.kyant.capsule.ContinuousCapsule
import com.folio.poc.navigation.edgelight.EdgeLight
import com.folio.poc.navigation.edgelight.edgeLight
import com.folio.poc.navigation.liquidglass.InteractiveHighlight
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs
import kotlin.math.tanh

// 原生导航自持动画，React 只接收已提交的目的地。
class FolioLiquidTabsView(context: Context, appContext: AppContext) : ExpoView(context, appContext), ReactPointerEventsView {
    // Compose 自行接收手势，透明区域不截断下方 React 控件的点击。
    override val pointerEvents: PointerEvents get() = PointerEvents.NONE
    override val shouldUseAndroidLayout = true
    var sourceId by mutableStateOf("")
    private var destination by mutableStateOf("local")
    private var primaryId by mutableStateOf("local")
    var selectedId: String
        get() = destination
        set(value) {
            destination = value
            if (value != "search") primaryId = value
        }
    var dark by mutableStateOf(false)
    var accentColor by mutableStateOf("")
    var items by mutableStateOf(emptyList<FolioNavigationItem>())
    var segmented by mutableStateOf(false)
    var controlEnabled by mutableStateOf(true)
    var collapsed by mutableStateOf(false)
    var collapsible by mutableStateOf(false)
    var expandHint by mutableStateOf("")
    var labelColor by mutableStateOf("")
    var surfaceColor by mutableStateOf("")
    private val onSelectionChange by EventDispatcher()
    private val onExpand by EventDispatcher()
    private val onCollapse by EventDispatcher()
    private val compose = ComposeView(context)

    init {
        clipChildren = false
        clipToPadding = false
        compose.setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool)
        addView(compose, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        compose.setContent {
            val backdrop = if (segmented) EmptyNavigationBackdrop
                else FolioBackdropSources.sources[FolioBackdropSources.key(appContext, sourceId)] ?: EmptyNavigationBackdrop
            fun select(item: FolioNavigationItem) {
                if (!controlEnabled) return
                if (item.id == selectedId) {
                    if (collapsible && !collapsed) onCollapse(mapOf<String, Any>())
                    return
                }
                selectedId = item.id
                onSelectionChange(mapOf("id" to item.id))
            }
            val tabItems = if (segmented) items else items.filter { it.id != "search" }
            val searchItem = if (segmented) null else items.firstOrNull { it.id == "search" }
            val selectedPrimary = tabItems.firstOrNull { it.id == primaryId } ?: tabItems.firstOrNull()
            val compactProgress by animateFloatAsState(
                targetValue = if (collapsed && !segmented) 1f else 0f,
                animationSpec = spring(stiffness = Spring.StiffnessMediumLow),
                label = "FolioBottomTabCollapse",
            )
            BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterStart) {
                if (tabItems.isNotEmpty() && accentColor.isNotEmpty()) {
                    val accent = Color(android.graphics.Color.parseColor(accentColor))
                    val contentColor = (if (dark) Color.White else Color.Black).copy(alpha = 0.8f)
                    val selectionActive = segmented || selectedId != searchItem?.id
                    val tabsWidth = if (searchItem == null) maxWidth else (maxWidth - 72.dp).coerceAtLeast(48.dp)
                    LiquidBottomTabs(
                        selectedTabIndex = { tabItems.indexOfFirst { it.id == selectedPrimary?.id }.coerceAtLeast(0) },
                        onTabSelected = { index ->
                            tabItems.getOrNull(index)?.let { item -> select(item) }
                        },
                        backdrop = backdrop,
                        tabsCount = tabItems.size,
                        dark = dark,
                        accentColor = accent,
                        enabled = controlEnabled,
                        preserveCapsuleOnPress = segmented,
                        compactProgress = compactProgress,
                        selectionActive = selectionActive,
                        compactLabel = selectedPrimary?.label ?: "",
                        compactHint = expandHint,
                        onExpand = {
                            if (collapsible && collapsed) onExpand(mapOf<String, Any>())
                        },
                        containerTint = if (segmented && surfaceColor.isNotEmpty()) Color(android.graphics.Color.parseColor(surfaceColor)) else null,
                        containerHeight = if (segmented) 48.dp else 64.dp,
                        highlightHeight = if (segmented) 44.dp else 64.dp,
                        selectorHeight = if (segmented) 40.dp else 56.dp,
                        modifier = Modifier.width(tabsWidth).height(if (segmented) 48.dp else 64.dp).drawWithContent {
                            backdrop.contentVersion
                            drawContent()
                        }
                    ) {
                        tabItems.forEachIndexed { index, item ->
                            val selected = selectedPrimary?.id == item.id
                            LiquidBottomTab(selected = selected,
                                label = item.label, enabled = controlEnabled, selectionActive = selectionActive, index = index,
                                onClick = { select(item) }) {
                                if (segmented && labelColor.isNotEmpty()) BasicText(item.label, maxLines = 1,
                                    style = TextStyle(color = Color(android.graphics.Color.parseColor(labelColor)),
                                        fontSize = 16.sp, fontWeight = FontWeight.Medium))
                                else FolioTabContent(item.icon, item.label,
                                    if (selected && selectionActive) lerpColor(accent, contentColor, compactProgress) else contentColor)
                            }
                        }
                    }
                    if (searchItem != null) {
                        BottomSearchControl(
                            item = searchItem, backdrop = backdrop, dark = dark,
                            tint = if (selectedId == searchItem.id) accent else contentColor,
                            selected = selectedId == searchItem.id, enabled = controlEnabled,
                            compactProgress = compactProgress, modifier = Modifier.align(Alignment.CenterEnd),
                            onClick = { select(searchItem) },
                        )
                    }
                }
            }
        }
    }

    // Expo 的延迟测量可能晚于卸载；离窗时不重建 Compose composition。
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

// 搜索独立采样页面背景，与导航共用折叠进度和拖动回弹。
@Composable
private fun BottomSearchControl(
    item: FolioNavigationItem,
    backdrop: Backdrop,
    dark: Boolean,
    tint: Color,
    selected: Boolean,
    enabled: Boolean,
    compactProgress: Float,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val interaction = remember(scope) { InteractiveHighlight(scope, consumeDrag = true) }
    val motionEnabled = (scope.coroutineContext[MotionDurationScale]?.scaleFactor ?: 1f) > 0f
    val shape = remember { ContinuousCapsule() }
    Box(
        modifier.size(lerpDp(64.dp, 48.dp, compactProgress))
            .graphicsLayer {
                if (enabled && motionEnabled) {
                    val offset = interaction.offset
                    val press = interaction.pressProgress
                    scaleX = 1f + 0.12f * press + 0.08f * (abs(offset.x) / size.width).coerceAtMost(1f)
                    scaleY = 1f + 0.12f * press + 0.08f * (abs(offset.y) / size.height).coerceAtMost(1f)
                    translationX = size.width * tanh(0.05f * offset.x / size.width)
                    translationY = size.height * tanh(0.05f * offset.y / size.height)
                }
            }
            .drawWithContent { backdrop.contentVersion; drawContent() }
            .navigationGlass(backdrop = backdrop, dark = dark)
            .then(if (enabled) interaction.gestureModifier else Modifier)
            .clickable(enabled = enabled, interactionSource = remember { MutableInteractionSource() }, indication = null,
                role = Role.Tab, onClick = onClick)
            .semantics {
                contentDescription = item.label
                this.selected = selected
            },
        contentAlignment = Alignment.Center,
    ) {
        FolioTabIcon(item.icon, tint, Modifier.size(lerpDp(24.dp, 19.dp, compactProgress)))
    }
}

internal object EmptyNavigationBackdrop : Backdrop {
    override val isCoordinatesDependent = false
    override fun DrawScope.drawBackdrop(density: Density, coordinates: LayoutCoordinates?, layerBlock: (GraphicsLayerScope.() -> Unit)?) = Unit
}
