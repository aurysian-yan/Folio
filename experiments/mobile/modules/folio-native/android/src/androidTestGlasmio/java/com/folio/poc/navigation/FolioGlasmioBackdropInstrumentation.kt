package com.folio.poc.navigation

import android.app.Instrumentation
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.PixelCopy
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.view.View
import android.widget.FrameLayout
import android.widget.FrameLayout.LayoutParams
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.platform.ComposeView
import com.facebook.react.bridge.BridgeReactContext
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.ModulesProvider
import expo.modules.kotlin.modules.Module
import java.lang.ref.WeakReference
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// 独立测试页面不读取应用配置；原始取样与完整玻璃材质分别验证。
class FolioGlasmioBackdropTestActivity : ComponentActivity() {
    lateinit var source: FolioBackdropSourceView
    lateinit var panel: FolioPanelBackdropView
    lateinit var raw: ComposeView
    lateinit var stage: FrameLayout
    lateinit var content: View
    lateinit var embedded: FolioHeaderActionButtonView
    lateinit var web: WebView
    var webFinished = false
    var webFailed = false
    var transformed by mutableStateOf(false)
    private lateinit var app: AppContext
    private lateinit var react: BridgeReactContext
    var frame by mutableStateOf(0)
    var withoutCoordinates by mutableStateOf(false)
    var striped = false

    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        react = BridgeReactContext(this)
        app = AppContext(object : ModulesProvider {
            override fun getModulesMap(): Map<Class<out Module>, String?> = emptyMap()
        }, expo.modules.core.ModuleRegistry(emptyList(), emptyList()), WeakReference(react))
        source = FolioBackdropSourceView(this, app).apply {
            sourceId = "test-page"
            setBackgroundColor(AndroidColor.TRANSPARENT)
            setPageBackground("#F0F0F5")
        }
        content = object : View(this) {
            private val paint = android.graphics.Paint()
            override fun onDraw(canvas: android.graphics.Canvas) {
                canvas.drawColor(AndroidColor.GREEN)
                if (striped) {
                    paint.color = AndroidColor.BLUE
                    canvas.drawRect(0f, 180f, width.toFloat(), height.toFloat(), paint)
                }
            }
        }
        source.addView(content)
        web = WebView(this).apply { visibility = View.GONE }
        source.addView(web)
        embedded = FolioHeaderActionButtonView(this, app).apply {
            sourceId = "test-page"; pageBackgroundColor = "#F0F0F5"; systemImage = "chevron.left"
        }
        source.addView(embedded)
        panel = FolioPanelBackdropView(this, app).apply {
            sourceId = "test-page"; cornerRadius = 24f; pageBackgroundColor = "#F0F0F5"
        }
        val consumer = source.backdrop.consumer()
        raw = ComposeView(this).apply {
            setContent {
                var coordinates: LayoutCoordinates? by mutableStateOf(null)
                Box(Modifier.fillMaxSize().graphicsLayer {
                    scaleX = if (transformed) 0.8f else 1f
                    scaleY = if (transformed) 0.8f else 1f
                    translationY = if (transformed) 40f else 0f
                }.onGloballyPositioned { coordinates = it }.drawBehind {
                    frame
                    with(consumer) { drawBackdrop(this@drawBehind, coordinates.takeUnless { withoutCoordinates }, null) }
                })
            }
        }
        stage = object : FrameLayout(this) {
            override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
                source.layout(0, 0, width, 400)
                content.layout(0, 0, width, 400)
                web.layout(0, 0, width, 400)
                embedded.measure(View.MeasureSpec.makeMeasureSpec(160, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(160, View.MeasureSpec.EXACTLY))
                embedded.layout(40, 240, 200, 400)
                raw.layout(40, 80, 200, 240)
                panel.layout(240, 80, width - 40, 240)
            }
        }.apply {
            setBackgroundColor(AndroidColor.MAGENTA)
            addView(source, LayoutParams(-1, 400))
            addView(raw, LayoutParams(160, 160))
            addView(panel, LayoutParams(-1, 160))
        }
        setContentView(stage)
    }

    override fun onDestroy() {
        web.destroy()
        app.javaClass.declaredMethods.first { it.name.startsWith("onDestroy") }.apply { isAccessible = true }.invoke(app)
        super.onDestroy()
    }
}

class FolioGlasmioBackdropInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
    override fun onStart() {
        val result = Bundle()
        var activity: FolioGlasmioBackdropTestActivity? = null
        try {
            val page = startActivitySync(Intent(context, FolioGlasmioBackdropTestActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as FolioGlasmioBackdropTestActivity
            activity = page
            waitForIdleSync()
            SystemClock.sleep(700)
            fun sample(view: View): Int {
                val bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
                val completed = CountDownLatch(1)
                var status = PixelCopy.ERROR_UNKNOWN
                runOnMainSync {
                    val location = IntArray(2).also { view.getLocationInWindow(it) }
                    if (view === page.raw && page.transformed) location[1] += 40
                    PixelCopy.request(page.window, Rect(location[0] + view.width / 2 - 4, location[1] + view.height / 2 - 4,
                        location[0] + view.width / 2 + 4, location[1] + view.height / 2 + 4), bitmap,
                        { status = it; completed.countDown() }, Handler(Looper.getMainLooper()))
                }
                check(completed.await(10, TimeUnit.SECONDS) && status == PixelCopy.SUCCESS)
                return bitmap.getPixel(4, 4).also { bitmap.recycle() }
            }
            fun capture(name: String, change: () -> Unit): Pair<Int, Int> {
                runOnMainSync { change(); page.frame++ }
                SystemClock.sleep(300)
                return (sample(page.raw) to sample(page.panel)).also {
                    result.putString(name, "raw=%08x glass=%08x".format(it.first, it.second))
                }
            }
            fun rawEquals(name: String, expected: Int, change: () -> Unit): Pair<Int, Int> = capture(name, change).also {
                check(it.first == expected) { "$name 取样错误：${it.first.toUInt().toString(16)}" }
            }
            val fallback = AndroidColor.rgb(240, 240, 245)
            rawEquals("recorded", AndroidColor.GREEN) {}
            val blankGlass = rawEquals("opaqueBackground", fallback) { page.content.visibility = View.GONE }.second
            rawEquals("contentResumed", AndroidColor.GREEN) { page.content.visibility = View.VISIBLE }
            val outside = rawEquals("outOfBounds", fallback) { page.raw.translationY = 440f; page.panel.translationY = 440f }.second
            check(outside == blankGlass) { "越界材质与真实底色材质不同：$outside / $blankGlass" }
            val released = rawEquals("released", fallback) { page.source.active = false }.second
            check(released == blankGlass && !page.source.backdrop.hasRecording) { "释放后保底或资源回收错误" }
            rawEquals("restored", AndroidColor.GREEN) { page.raw.translationY = 0f; page.panel.translationY = 0f; page.source.active = true }
            check(page.source.backdrop.hasRecording)
            rawEquals("noCoordinates", fallback) { page.raw.translationY = 440f; page.withoutCoordinates = true }
            val missing = capture("sourceMissing") { page.panel.sourceId = "unmounted-page"; page.source.visibility = View.GONE }.second
            check(missing == blankGlass && !page.source.backdrop.hasRecording)
            capture("sourceRemounted") { page.panel.sourceId = "test-page"; page.source.visibility = View.VISIBLE; page.withoutCoordinates = false; page.raw.translationY = 0f }
            rawEquals("beforeLayerTransform", AndroidColor.GREEN) { page.striped = true; page.content.invalidate() }
            rawEquals("layerTransform", AndroidColor.BLUE) { page.transformed = true }
            rawEquals("layerTransformRestored", AndroidColor.GREEN) { page.transformed = false; page.striped = false; page.content.invalidate() }
            val palette = listOf("#191C20", "#F1F4FB", "#101C2C", "#F0F0F5")
            for (color in palette) {
                rawEquals("theme$color", AndroidColor.parseColor(color)) {
                    page.source.active = false
                    page.source.setPageBackground(color)
                    page.panel.pageBackgroundColor = color
                    page.panel.dark = color == "#191C20" || color == "#101C2C"
                    page.raw.translationY = 440f
                }
            }
            rawEquals("themeRestored", AndroidColor.GREEN) {
                page.source.active = true; page.raw.translationY = 0f; page.panel.translationY = 0f; page.panel.dark = false
            }
            repeat(8) { index ->
                rawEquals("leave$index", fallback) { page.source.active = false; page.raw.translationY = 440f }
                rawEquals("return$index", AndroidColor.GREEN) { page.source.active = true; page.raw.translationY = 0f }
                runOnMainSync { page.source.removeView(page.embedded); page.source.addView(page.embedded); page.stage.requestLayout() }
            }
            // 同一页面原地切换主题，验证实体宿主、采样释放与玻璃恢复。
            val embedded = page.embedded
            val children = page.source.childCount
            repeat(4) { index ->
                val surface = if (index % 2 == 0) "#ECE6F0" else "#211F26"
                runOnMainSync {
                    page.source.samplingEnabled = false
                    val theme = mapOf("style" to "material3-expressive", "revision" to "material$index",
                        "dark" to (index % 2 != 0).toString(), "primary" to "#6750A4", "surfaceContainer" to surface)
                    page.panel.applyUiTheme(theme)
                    page.embedded.applyUiTheme(theme)
                }
                waitForIdleSync()
                SystemClock.sleep(300)
                check(!page.source.backdrop.hasRecording) { "M3E 仍保留背景录制" }
                check(page.source.childCount == children && page.embedded === embedded) { "切换主题重建了业务页面" }
                check(page.embedded.childCount == 1) { "M3E 控件没有回到本地宿主" }
                check(sample(page.panel) == AndroidColor.parseColor(surface)) { "实体面板未应用快照色板" }
                runOnMainSync {
                    page.panel.applyUiTheme(mapOf("style" to "glasmio", "revision" to "glass$index"))
                    page.embedded.applyUiTheme(mapOf("style" to "glasmio", "revision" to "glass$index"))
                    page.source.samplingEnabled = true
                }
                rawEquals("materialReturn$index", AndroidColor.GREEN) {}
                check(page.embedded.childCount == 0) { "Glasmio 控件没有恢复到覆盖层" }
            }
            sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_HOME)
            val hiddenDeadline = SystemClock.uptimeMillis() + 5000
            while (page.source.windowVisibility == View.VISIBLE && SystemClock.uptimeMillis() < hiddenDeadline) SystemClock.sleep(50)
            check(page.source.windowVisibility != View.VISIBLE) { "测试页面未进入后台" }
            SystemClock.sleep(100)
            check(!page.source.backdrop.hasRecording) { "后台仍持有背景录制" }
            context.startActivity(Intent(context, FolioGlasmioBackdropTestActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
            SystemClock.sleep(600)
            rawEquals("windowRestored", AndroidColor.GREEN) {}
            runOnMainSync {
                page.webFinished = false; page.webFailed = false
                page.web.webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView, url: String?) { page.webFinished = true }
                    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                        if (request.isForMainFrame) page.webFailed = true
                    }
                }
                page.web.visibility = View.VISIBLE
                page.web.loadDataWithBaseURL("https://folio.test/", "<html><body style='margin:0;background:#00ff00;height:100vh'></body></html>", "text/html", "UTF-8", null)
            }
            fun awaitWeb(condition: () -> Boolean) {
                val deadline = SystemClock.uptimeMillis() + 10000
                while (SystemClock.uptimeMillis() < deadline) {
                    var complete = false
                    runOnMainSync { complete = condition() }
                    if (complete) return
                    SystemClock.sleep(50)
                }
                error("网页回调超时")
            }
            awaitWeb { page.webFinished }
            rawEquals("webLoaded", AndroidColor.GREEN) {}
            runOnMainSync { page.web.loadUrl("http://127.0.0.1:1/unavailable") }
            awaitWeb { page.webFailed }
            rawEquals("webFailed", fallback) { page.web.visibility = View.GONE; page.content.visibility = View.GONE }
            result.putString("checks", "36 个取样与生命周期场景通过；网页成功与失败分别确认")
            finish(android.app.Activity.RESULT_OK, result)
        } catch (error: Throwable) {
            result.putString("error", error.stackTraceToString())
            finish(android.app.Activity.RESULT_CANCELED, result)
        } finally { activity?.let { runOnMainSync { it.finish() } } }
    }
}
