package com.folio.poc.navigation

import android.content.Context
import android.content.res.ColorStateList
import android.os.Build
import android.widget.ProgressBar
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.util.lerp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.drawPlainBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.shadow.Shadow
import com.kyant.capsule.ContinuousCapsule
import com.kyant.capsule.ContinuousRoundedRectangle
import com.folio.poc.navigation.liquidglass.InteractiveHighlight
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlin.math.max
import kotlin.math.abs
import kotlin.math.tanh

private val HeaderButtonHeight = 44.dp

// 顶栏颜色沿用 RN 语义主题。
class FolioViewMenuColors : Record {
    @Field var label: String = ""
    @Field var secondary: String = ""
    @Field var muted: String = ""
    @Field var accent: String = ""
    @Field var tab: String = ""
    @Field var border: String = ""
    @Field var raised: String = ""
    @Field var shadow: String = "#000000"
    @Field var buttonPressed: String = "#FFFFFF"
    @Field var buttonPressedLabel: String = "#1A1A1A"
}

// 顶栏文案由共享语言目录提供。
class FolioHeaderLabels : Record {
    @Field var search: String = ""
    @Field var searchPlaceholder: String = ""
    @Field var clearSearch: String = ""
    @Field var filter: String = ""
    @Field var importFonts: String = ""
    @Field var loadingImport: String = ""
    @Field var viewOptions: String = ""
    @Field var viewMode: String = ""
    @Field var gridView: String = ""
    @Field var listView: String = ""
    @Field var expanded: String = ""
    @Field var collapsed: String = ""
}

// 安卓顶部操作区复用现有描边与背景采样。
class FolioHeaderControlsView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    var sourceId by mutableStateOf("")
    var mode by mutableStateOf("grid")
    var active by mutableStateOf(true)
    var dark by mutableStateOf(false)
    var ready by mutableStateOf(false)
    var importing by mutableStateOf(false)
    var importBlocked by mutableStateOf(false)
    var searchOpen by mutableStateOf(false)
    var searchText by mutableStateOf("")
    var filterCount by mutableStateOf(0)
    var shadowProgress by mutableStateOf(0f)
    var colors by mutableStateOf<FolioViewMenuColors?>(null)
    var labels by mutableStateOf<FolioHeaderLabels?>(null)
    private var expanded by mutableStateOf(false)
    private val onModeChange by EventDispatcher()
    private val onExpandedChange by EventDispatcher()
    private val onImport by EventDispatcher()
    private val onFilter by EventDispatcher()
    private val onSearchTextChange by EventDispatcher()
    private val compose = ComposeView(context)

    init {
        clipChildren = false
        clipToPadding = false
        compose.setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool)
        addView(compose, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        compose.setContent {
            val palette = colors ?: return@setContent
            val text = labels ?: return@setContent
            val backdrop = FolioBackdropSources.sources[FolioBackdropSources.key(appContext, sourceId)] ?: EmptyNavigationBackdrop
            LaunchedEffect(active, importing, searchOpen) {
                if (!active || importing || searchOpen) updateExpanded(false)
            }
            FolioAndroidHeader(mode, expanded, active, dark, ready, importing, importBlocked, searchOpen, searchText, filterCount, shadowProgress, palette, text, backdrop,
                onExpandedChange = ::updateExpanded,
                onFilter = { if (ready) onFilter(emptyMap<String, Any>()) },
                onImport = { if (ready && !importing && !importBlocked) onImport(emptyMap<String, Any>()) },
                onSearchTextChange = { text ->
                    searchText = text
                    onSearchTextChange(mapOf("text" to text))
                },
                onSelect = { value ->
                    if (active && expanded) {
                        if (mode != value) {
                            mode = value
                            onModeChange(mapOf("mode" to value))
                        }
                        updateExpanded(false)
                    }
                })
        }
    }

    private fun updateExpanded(value: Boolean) {
        if (expanded == value || (value && !active)) return
        expanded = value
        onExpandedChange(mapOf("expanded" to value))
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

    override fun onDetachedFromWindow() {
        expanded = false
        super.onDetachedFromWindow()
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility != VISIBLE) updateExpanded(false)
    }
}

private fun String.menuColor() = Color(android.graphics.Color.parseColor(this))

// 操作按钮、搜索框和菜单使用一致的淡描边。
private fun Modifier.glassOutline(shape: Shape, colors: FolioViewMenuColors) =
    border(0.6.dp, colors.border.menuColor(), shape).clip(shape)

private fun Modifier.headerSurface(colors: FolioViewMenuColors): Modifier {
    val shape = ContinuousCapsule()
    return background(colors.tab.menuColor(), shape).glassOutline(shape, colors)
}

// 按钮沿用菜单的背景模糊与拖动回弹，拖动期间不提交点击。
@Composable
private fun Modifier.headerButtonSurface(enabled: Boolean, dark: Boolean, colors: FolioViewMenuColors,
    backdrop: Backdrop, shadowProgress: Float = 0f, onPressedChange: (Boolean) -> Unit = {},
    showSurface: Boolean = true, onClick: () -> Unit): Modifier {
    val animationScope = rememberCoroutineScope()
    val drag = remember(animationScope) {
        InteractiveHighlight(animationScope, consumeDrag = true, pressDampingRatio = 0.36f, pressStiffness = 360f)
    }
    val interactionSource = remember { MutableInteractionSource() }
    val touchPressed by interactionSource.collectIsPressedAsState()
    // 点击与拖动共用按压反馈，手势接管后仍保持高亮与阴影。
    val pressed = enabled && (touchPressed || drag.isPressed)
    val motionEnabled = (animationScope.coroutineContext[MotionDurationScale]?.scaleFactor ?: 1f) > 0f
    LaunchedEffect(pressed) { onPressedChange(pressed) }
    val shape = ContinuousCapsule()
    return drawWithContent { backdrop.contentVersion; drawContent() }
        .drawBackdrop(backdrop = backdrop, shape = { shape }, highlight = null,
            shadow = {
                if (pressed || shadowProgress > 0f) Shadow(radius = 32.dp,
                    color = colors.shadow.menuColor().copy(alpha = ((if (dark) 0.6f else 0.2f) * (if (pressed) 2f else 1f)).coerceAtMost(1f)),
                    alpha = if (pressed) 1f else shadowProgress)
                else null
            },
            effects = {
                vibrancy()
                blur(if (dark) 12.dp.toPx() else 16.dp.toPx())
            },
            onDrawBehind = { if (showSurface) drawRect(colors.tab.menuColor()) },
            layerBlock = {
                val offset = if (motionEnabled && enabled) drag.offset else Offset.Zero
                val pressed = if (motionEnabled && enabled) drag.pressProgress.coerceIn(-0.35f, 1.35f) else 0f
                val width = size.width.coerceAtLeast(1f)
                val height = size.height.coerceAtLeast(1f)
                val stretch = 4.dp.toPx() / height
                val pressScale = 1f + 0.12f * pressed
                scaleX = pressScale + stretch * (abs(offset.x) / width).coerceAtMost(1f)
                scaleY = pressScale + stretch * (abs(offset.y) / height).coerceAtMost(1f)
                val limit = size.minDimension.coerceAtLeast(1f)
                translationX = limit * tanh(0.05f * offset.x / limit)
                translationY = limit * tanh(0.05f * offset.y / limit)
            },
            onDrawSurface = {
                if (showSurface) {
                    if (pressed) drawRect(colors.buttonPressed.menuColor())
                    else drawRect(colors.tab.menuColor().copy(alpha = if (Build.VERSION.SDK_INT >= 31) 0.70f else 0.96f))
                }
            })
        .then(if (showSurface) Modifier.glassOutline(shape, colors) else Modifier.clip(shape))
        .then(if (enabled) drag.gestureModifier else Modifier)
        .clickable(enabled = enabled, interactionSource = interactionSource,
            indication = null, role = Role.Button, onClick = onClick)
}

@Composable
private fun FolioAndroidHeader(mode: String, expanded: Boolean, active: Boolean, dark: Boolean,
    ready: Boolean, importing: Boolean, importBlocked: Boolean, searchOpen: Boolean, searchText: String, filterCount: Int, shadowProgress: Float,
    colors: FolioViewMenuColors, labels: FolioHeaderLabels, backdrop: Backdrop, onExpandedChange: (Boolean) -> Unit,
    onSelect: (String) -> Unit, onImport: () -> Unit, onFilter: () -> Unit, onSearchTextChange: (String) -> Unit) {
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(searchOpen, active, ready) {
        if (searchOpen && active && ready) { focus.requestFocus(); keyboard?.show() }
        else if (searchOpen) keyboard?.hide()
    }
    BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterEnd) {
        val availableWidth = maxWidth
        if (searchOpen) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                val fieldWidth = (availableWidth - HeaderButtonHeight - 10.dp).coerceAtLeast(HeaderButtonHeight)
                Row(Modifier.size(fieldWidth, HeaderButtonHeight).headerSurface(colors).padding(horizontal = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    ViewMenuIcon("search", colors.secondary.menuColor(), 20.dp)
                    CompositionLocalProvider(LocalTextSelectionColors provides TextSelectionColors(
                        handleColor = colors.accent.menuColor(),
                        backgroundColor = colors.accent.menuColor().copy(alpha = if (dark) 0.25f else 0.2f)
                    )) {
                        BasicTextField(searchText, onSearchTextChange, Modifier.weight(1f).focusRequester(focus)
                            .semantics { contentDescription = labels.search },
                            enabled = active && ready, singleLine = true,
                            textStyle = TextStyle(color = colors.label.menuColor(), fontSize = 15.sp),
                            cursorBrush = SolidColor(colors.accent.menuColor()),
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None,
                                autoCorrectEnabled = false, imeAction = ImeAction.Search),
                            keyboardActions = KeyboardActions(onSearch = { keyboard?.hide() }),
                            decorationBox = { input ->
                                Box {
                                    if (searchText.isEmpty()) BasicText(labels.searchPlaceholder, maxLines = 1,
                                        style = TextStyle(color = colors.muted.menuColor(), fontSize = 15.sp))
                                    input()
                                }
                            })
                    }
                    if (searchText.isNotEmpty()) HeaderAction("close", labels.clearSearch,
                        active && ready, false, dark, colors, backdrop,
                        { onSearchTextChange(""); focus.requestFocus() }, shadowProgress, diameter = 20.dp, iconSize = 18.dp)
                }
                HeaderAction("filter", labels.filter,
                    active && ready, false, dark, colors, backdrop, onFilter, shadowProgress, selected = filterCount > 0)
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                FolioViewModeMenu(mode, expanded, active && !importing, dark, colors, labels, backdrop,
                    onExpandedChange, onSelect, shadowProgress, Modifier.size(if (availableWidth < HeaderButtonHeight * 7) HeaderButtonHeight else 64.dp, HeaderButtonHeight))
                HeaderAction("filter", labels.filter, active && ready, false, dark, colors, backdrop, onFilter, shadowProgress, selected = filterCount > 0)
                HeaderAction("plus", if (importing) labels.loadingImport else labels.importFonts,
                    active && ready && !importing && !importBlocked, importing, dark, colors, backdrop, onImport, shadowProgress)
            }
        }
    }
}

@Composable
private fun HeaderAction(icon: String, label: String, enabled: Boolean, loading: Boolean,
    dark: Boolean, colors: FolioViewMenuColors, backdrop: Backdrop, onClick: () -> Unit, shadowProgress: Float,
    selected: Boolean = false, diameter: Dp = HeaderButtonHeight, iconSize: Dp = 20.dp) {
    var pressed by remember { mutableStateOf(false) }
    Box(Modifier.size(diameter).headerButtonSurface(enabled, dark, colors, backdrop, shadowProgress,
        onPressedChange = { pressed = it }, onClick = onClick)
        .semantics { contentDescription = label; if (loading) stateDescription = "正在导入" },
        contentAlignment = Alignment.Center) {
        val tint = (if (pressed) colors.buttonPressedLabel else if (selected) colors.accent else colors.label).menuColor()
            .copy(alpha = if (enabled || loading) 1f else 0.4f)
        if (loading) AndroidView(factory = { context -> ProgressBar(context, null, android.R.attr.progressBarStyleSmall) },
            modifier = Modifier.size(iconSize), update = { it.indeterminateTintList = ColorStateList.valueOf(tint.toArgb()) })
        else ViewMenuIcon(icon, tint, iconSize)
    }
}

@Composable
private fun FolioViewModeMenu(mode: String, expanded: Boolean, active: Boolean, dark: Boolean,
    colors: FolioViewMenuColors, labels: FolioHeaderLabels, backdrop: Backdrop,
    onExpandedChange: (Boolean) -> Unit, onSelect: (String) -> Unit, shadowProgress: Float, modifier: Modifier) {
    var pressed by remember { mutableStateOf(false) }
    val options = remember(labels.gridView, labels.listView) {
        listOf(FolioNavigationItem().apply { id = "grid"; label = labels.gridView; icon = "grid" },
            FolioNavigationItem().apply { id = "list"; label = labels.listView; icon = "list" })
    }
    FolioGlassMenu(mode, expanded, active, dark, colors, backdrop, options, labels.viewOptions,
        labels.viewMode, labels.expanded, labels.collapsed, onExpandedChange, onSelect, modifier,
        shadowProgress = shadowProgress, onPressedChange = { pressed = it }) { progress ->
        ViewMenuIcon(mode, (if (pressed) colors.buttonPressedLabel else colors.label).menuColor(), 20.dp)
        ViewMenuIcon("caret", (if (pressed) colors.buttonPressedLabel else colors.secondary).menuColor(), 10.dp,
            Modifier.graphicsLayer { rotationZ = 180f * progress })
    }
}

// 地址预设与主页视图菜单共用材质、弹簧、定位和拖动回弹。
@Composable
internal fun FolioGlassMenu(
    selectedValue: String,
    expanded: Boolean,
    active: Boolean,
    dark: Boolean,
    colors: FolioViewMenuColors,
    backdrop: Backdrop,
    options: List<FolioNavigationItem>,
    label: String,
    title: String,
    expandedLabel: String,
    collapsedLabel: String,
    onExpandedChange: (Boolean) -> Unit,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    triggerBackdrop: Backdrop = backdrop,
    shadowProgress: Float = 0f,
    onPressedChange: (Boolean) -> Unit = {},
    showTriggerSurface: Boolean = true,
    triggerContent: @Composable (Float) -> Unit,
) {
    val progress = remember { Animatable(0f) }
    val opacity = remember { Animatable(0f) }
    var popupAlive by remember { mutableStateOf(false) }
    var opensAbove by remember { mutableStateOf(false) }
    val anchorView = LocalView.current

    // 弹层加入后刷新原生布局，确保锚点坐标完成分发。
    LaunchedEffect(popupAlive) {
        if (popupAlive) {
            anchorView.requestLayout()
            anchorView.invalidate()
        }
    }

    // 同一弹层完成展开与收起，关闭期间停止选择，弹簧允许原地反向。
    LaunchedEffect(expanded) {
        if (expanded) popupAlive = true
        coroutineScope {
            launch {
                progress.animateTo(if (expanded) 1f else 0f,
                    spring(dampingRatio = 0.78f, stiffness = if (expanded) 240f else 400f, visibilityThreshold = 0.0001f))
            }
            launch { opacity.animateTo(if (expanded) 1f else 0f, tween(if (expanded) 120 else 400)) }
        }
        if (!expanded) popupAlive = false
    }

    Box(modifier) {
        Row(Modifier.fillMaxSize().graphicsLayer { alpha = 1f - opacity.value.coerceIn(0f, 1f) }
            .headerButtonSurface(active, dark, colors, triggerBackdrop, shadowProgress, onPressedChange,
                showSurface = showTriggerSurface) { onExpandedChange(!expanded) }
            .semantics {
                contentDescription = label
                stateDescription = if (expanded) expandedLabel else collapsedLabel
            },
            horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically) {
            triggerContent(progress.value.coerceIn(0f, 1f))
        }

        if (popupAlive) {
            val density = LocalDensity.current
            val menuWidth = minOf(220.dp, (LocalConfiguration.current.screenWidthDp.dp - 32.dp).coerceAtLeast(64.dp))
            val margin = 32.dp
            val provider = remember(density, menuWidth) {
                ViewMenuPositionProvider(
                    with(density) { menuWidth.roundToPx() },
                    with(density) { margin.roundToPx() },
                    with(density) { 16.dp.roundToPx() },
                ) { opensAbove = it }
            }
            Popup(popupPositionProvider = provider, onDismissRequest = { onExpandedChange(false) },
                properties = PopupProperties(focusable = expanded, dismissOnBackPress = expanded,
                    dismissOnClickOutside = expanded, clippingEnabled = false)) {
                val animationScope = rememberCoroutineScope()
                val drag = remember(animationScope) { InteractiveHighlight(animationScope) }
                val motionEnabled = (animationScope.coroutineContext[MotionDurationScale]?.scaleFactor ?: 1f) > 0f
                val touchSlop = LocalViewConfiguration.current.touchSlop
                // 外壳为弹簧回弹和玻璃边缘留白，留白点击也能关闭菜单。
                Box(Modifier.width(menuWidth + margin * 2)
                    .clickable(enabled = expanded, interactionSource = remember { MutableInteractionSource() }, indication = null) {
                        if (!motionEnabled || drag.offset.getDistance() <= touchSlop) onExpandedChange(false)
                    }
                    .padding(margin)) {
                    val fraction = progress.value.coerceIn(0f, 1f)
                    val shape = ContinuousRoundedRectangle(HeaderButtonHeight / 2)
                    Column(Modifier.width(menuWidth)
                        .drawWithContent { backdrop.contentVersion; drawContent() }
                        .drawBackdrop(backdrop = backdrop, shape = { shape },
                            effects = {
                                vibrancy()
                                blur(if (dark) 12.dp.toPx() else 16.dp.toPx())
                                lens(12.dp.toPx() * fraction, 24.dp.toPx() * fraction)
                            },
                            highlight = null,
                            shadow = { Shadow.Default.copy(alpha = fraction) },
                            onDrawBehind = { drawRect(colors.raised.menuColor()) },
                            layerBlock = {
                                val corner = if (opensAbove) 1f else 0f
                                transformOrigin = TransformOrigin(lerp(1f, 0.5f, fraction), lerp(corner, 0.5f, fraction))
                                // 拖动只改变形状与位移，背景采样共用完整变换。
                                val offset = if (motionEnabled) drag.offset else Offset.Zero
                                val pressed = if (motionEnabled) drag.pressProgress.coerceIn(0f, 1f) else 0f
                                val height = size.height.coerceAtLeast(1f)
                                val width = size.width.coerceAtLeast(1f)
                                val stretch = 4.dp.toPx() / height
                                val pressScale = 1f + stretch * pressed
                                val transitionScale = 0.24f + 0.76f * progress.value
                                scaleX = transitionScale * (pressScale + stretch * (abs(offset.x) / width).coerceAtMost(1f))
                                scaleY = transitionScale * (pressScale + stretch * (abs(offset.y) / height).coerceAtMost(1f))
                                val limit = size.minDimension.coerceAtLeast(1f)
                                translationX = transitionScale * limit * tanh(0.05f * offset.x / limit)
                                translationY = transitionScale * limit * tanh(0.05f * offset.y / limit)
                                alpha = opacity.value.coerceIn(0f, 1f)
                            },
                            onDrawSurface = {
                                drawRect(colors.raised.menuColor().copy(alpha = if (Build.VERSION.SDK_INT >= 31) 0.70f else 0.96f))
                            })
                        .then(if (expanded && motionEnabled) drag.gestureModifier else Modifier)
                        .glassOutline(shape, colors)
                        .selectableGroup()
                        .semantics { paneTitle = title }
                        .then(if (expanded) Modifier else Modifier.clearAndSetSemantics {})
                        .padding(vertical = 6.dp)) {
                        BasicText(title, Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                            style = TextStyle(color = colors.secondary.menuColor(), fontSize = 12.sp))
                        options.forEach { option ->
                            ViewMenuRow(option.icon, option.label, selectedValue == option.id, expanded, colors) {
                                if (!motionEnabled || drag.offset.getDistance() <= touchSlop) onSelect(option.id)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ViewMenuRow(value: String, label: String, selected: Boolean, enabled: Boolean,
    colors: FolioViewMenuColors, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp)
        .selectable(selected, interactionSource = remember { MutableInteractionSource() }, indication = null, enabled = enabled, role = Role.RadioButton, onClick = onClick)
        .padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        if (value.isNotEmpty()) ViewMenuIcon(value, colors.label.menuColor(), 20.dp)
        BasicText(label, Modifier.weight(1f), style = TextStyle(color = colors.label.menuColor(), fontSize = 16.sp))
        if (selected) ViewMenuIcon("check", colors.accent.menuColor(), 18.dp)
    }
}

// 定位依赖实际按钮边界，并在可用窗口内选择向上或向下展开。
private class ViewMenuPositionProvider(
    private val menuWidth: Int,
    private val margin: Int,
    private val inset: Int,
    private val onPositioned: (Boolean) -> Unit,
) : PopupPositionProvider {
    override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize,
        layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
        val resolvedHeight = (popupContentSize.height - margin * 2).coerceAtLeast(0)
        val above = anchorBounds.top + resolvedHeight > windowSize.height - inset &&
            anchorBounds.bottom - resolvedHeight >= inset
        onPositioned(above)
        val left = if (layoutDirection == LayoutDirection.Ltr) anchorBounds.right - menuWidth else anchorBounds.left
        val top = if (above) anchorBounds.bottom - resolvedHeight else anchorBounds.top
        return IntOffset(left.coerceIn(inset, max(inset, windowSize.width - inset - menuWidth)) - margin,
            top.coerceIn(inset, max(inset, windowSize.height - inset - resolvedHeight)) - margin)
    }
}

// 菜单图标沿用 Phosphor 常规字重。
@Composable
internal fun ViewMenuIcon(name: String, tint: Color, size: Dp, modifier: Modifier = Modifier) {
    val vector = remember(name) {
        val path = when (name) {
            "grid" -> "M104 40H56a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16m0 64H56V56h48zm96-64h-48a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16m0 64h-48V56h48zm-96 32H56a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16v-48a16 16 0 0 0-16-16m0 64H56v-48h48zm96-64h-48a16 16 0 0 0-16 16v48a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16v-48a16 16 0 0 0-16-16m0 64h-48v-48h48z"
            "list" -> "M224 128a8 8 0 0 1-8 8H40a8 8 0 0 1 0-16h176a8 8 0 0 1 8 8M40 72h176a8 8 0 0 0 0-16H40a8 8 0 0 0 0 16m176 112H40a8 8 0 0 0 0 16h176a8 8 0 0 0 0-16"
            "caret" -> "m213.66 101.66-80 80a8 8 0 0 1-11.32 0l-80-80a8 8 0 0 1 11.32-11.32L128 164.69l74.34-74.35a8 8 0 0 1 11.32 11.32"
            "search" -> "M229.66 218.34 179.6 168.28a88.12 88.12 0 1 0-11.32 11.32l50.06 50.06a8 8 0 0 0 11.32-11.32ZM40 112a72 72 0 1 1 72 72 72.08 72.08 0 0 1-72-72"
            "filter" -> "M200 136a8 8 0 0 1-8 8H64a8 8 0 0 1 0-16h128a8 8 0 0 1 8 8m32-56H24a8 8 0 0 0 0 16h208a8 8 0 0 0 0-16m-80 96h-48a8 8 0 0 0 0 16h48a8 8 0 0 0 0-16"
            "plus" -> "M224 128a8 8 0 0 1-8 8h-80v80a8 8 0 0 1-16 0v-80H40a8 8 0 0 1 0-16h80V40a8 8 0 0 1 16 0v80h80a8 8 0 0 1 8 8"
            "dots" -> "M140 128a12 12 0 1 1-12-12 12 12 0 0 1 12 12m56-12a12 12 0 1 0 12 12 12 12 0 0 0-12-12m-136 0a12 12 0 1 0 12 12 12 12 0 0 0-12-12"
            "star" -> "M239.18 97.26A16.38 16.38 0 0 0 224.92 86l-59-4.76-22.78-55.09a16.36 16.36 0 0 0-30.27 0L90.11 81.23 31.08 86a16.46 16.46 0 0 0-9.37 28.86l45 38.83L53 211.75a16.38 16.38 0 0 0 24.5 17.82l50.5-31.08 50.53 31.08A16.4 16.4 0 0 0 203 211.75l-13.76-58.07 45-38.83a16.43 16.43 0 0 0 4.94-17.59m-15.34 5.47-48.7 42a8 8 0 0 0-2.56 7.91l14.88 62.8a.37.37 0 0 1-.17.48c-.18.14-.23.11-.38 0l-54.72-33.65a8 8 0 0 0-8.38 0l-54.72 33.67c-.15.09-.19.12-.38 0a.37.37 0 0 1-.17-.48l14.88-62.8a8 8 0 0 0-2.56-7.91l-48.7-42c-.12-.1-.23-.19-.13-.5s.18-.27.33-.29l63.92-5.16a8 8 0 0 0 6.72-4.94l24.62-59.61c.08-.17.11-.25.35-.25s.27.08.35.25L153 91.86a8 8 0 0 0 6.75 4.92l63.92 5.16c.15 0 .24 0 .33.29s0 .4-.16.5"
            "star-fill" -> "m234.29 114.85-45 38.83L203 211.75a16.4 16.4 0 0 1-24.5 17.82L128 198.49l-50.53 31.08A16.4 16.4 0 0 1 53 211.75l13.76-58.07-45-38.83A16.46 16.46 0 0 1 31.08 86l59-4.76 22.76-55.08a16.36 16.36 0 0 1 30.27 0l22.75 55.08 59 4.76a16.46 16.46 0 0 1 9.37 28.86Z"
            "folder-plus" -> "M216 72h-84.69L104 44.69A15.86 15.86 0 0 0 92.69 40H40a16 16 0 0 0-16 16v144.62A15.4 15.4 0 0 0 39.38 216h177.51A15.13 15.13 0 0 0 232 200.89V88a16 16 0 0 0-16-16M92.69 56l16 16H40V56ZM216 200H40V88h176Zm-88-88a8 8 0 0 1 8 8v16h16a8 8 0 0 1 0 16h-16v16a8 8 0 0 1-16 0v-16h-16a8 8 0 0 1 0-16h16v-16a8 8 0 0 1 8-8"
            "close" -> "m205.66 194.34-66.35-66.34 66.35-66.34a8 8 0 0 0-11.32-11.32L128 116.69 61.66 50.34a8 8 0 0 0-11.32 11.32L116.69 128l-66.35 66.34a8 8 0 0 0 11.32 11.32L128 139.31l66.34 66.35a8 8 0 0 0 11.32-11.32"
            else -> "m229.66 77.66-128 128a8 8 0 0 1-11.32 0l-56-56a8 8 0 0 1 11.32-11.32L96 188.69 218.34 66.34a8 8 0 0 1 11.32 11.32"
        }
        ImageVector.Builder(name, 24.dp, 24.dp, 256f, 256f).apply {
            addPath(addPathNodes(path), fill = SolidColor(Color.Black))
        }.build()
    }
    Image(vector, contentDescription = null, modifier = modifier.size(size), colorFilter = ColorFilter.tint(tint))
}
