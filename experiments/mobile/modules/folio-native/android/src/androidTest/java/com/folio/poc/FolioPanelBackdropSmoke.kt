package com.folio.poc

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.app.Instrumentation
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.PixelCopy
import android.view.View
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import com.facebook.react.bridge.BridgeReactContext
import com.folio.poc.navigation.FolioBackdropSourceView
import com.folio.poc.navigation.FolioPanelBackdropView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.ModulesProvider
import expo.modules.kotlin.modules.Module
import java.lang.ref.WeakReference
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// 使用静止条纹背景验证父视图位移动画中的实时取样。
class FolioBackdropTestActivity : ComponentActivity() {
    lateinit var panel: FolioPanelBackdropView
    private lateinit var app: AppContext
    private lateinit var react: BridgeReactContext

    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        react = BridgeReactContext(this)
        app = AppContext(object : ModulesProvider {
            override fun getModulesMap(): Map<Class<out Module>, String?> = emptyMap()
        }, expo.modules.core.ModuleRegistry(emptyList(), emptyList()), WeakReference(react))
        val source = FolioBackdropSourceView(this, app).apply { sourceId = "preview-material" }
        val stripes = object : View(this) {
            private val paint = Paint()
            override fun onDraw(canvas: Canvas) {
                for (y in 0 until height step 240) {
                    paint.color = if (y / 240 % 2 == 0) Color.WHITE else Color.BLACK
                    canvas.drawRect(0f, y.toFloat(), width.toFloat(), (y + 240).toFloat(), paint)
                }
            }
        }
        source.addView(stripes)
        panel = FolioPanelBackdropView(this, app).apply {
            sourceId = "preview-material"; tintColor = "#000000"; borderColor = "#808080"
        }
        val stage = object : FrameLayout(this) {
            override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
                source.layout(0, 0, width, height)
                stripes.layout(0, 0, width, height)
                panel.layout(40, 40, 360, 200)
            }
        }
        stage.addView(source, FrameLayout.LayoutParams(-1, -1))
        stage.addView(panel, FrameLayout.LayoutParams(320, 160))
        setContentView(stage)
    }

    override fun onDestroy() {
        super.onDestroy()
        app.javaClass.declaredMethods.first { it.name.startsWith("onDestroy") }.apply { isAccessible = true }.invoke(app)
    }
}

internal object FolioPanelBackdropSmoke {
    fun run(instrumentation: Instrumentation) {
        val activity = instrumentation.startActivitySync(Intent(instrumentation.context, FolioBackdropTestActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as FolioBackdropTestActivity
        val handler = Handler(Looper.getMainLooper())
        try {
            instrumentation.waitForIdleSync()
            SystemClock.sleep(200)
            fun sample(offset: Float): Int {
                instrumentation.runOnMainSync { activity.panel.translationY = offset }
                SystemClock.sleep(80)
                val bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
                val copied = CountDownLatch(1)
                var status = PixelCopy.ERROR_UNKNOWN
                instrumentation.runOnMainSync {
                    val location = IntArray(2)
                    activity.panel.getLocationInWindow(location)
                    PixelCopy.request(activity.window, Rect(location[0] + 156, location[1] + 76, location[0] + 164, location[1] + 84),
                        bitmap, { status = it; copied.countDown() }, handler)
                }
                check(copied.await(10, TimeUnit.SECONDS) && status == PixelCopy.SUCCESS)
                val red = Color.red(bitmap.getPixel(4, 4))
                bitmap.recycle()
                return red
            }
            val samples = listOf(0f, 240f, 480f, 720f, 0f).map(::sample)
            check(samples[0] - samples[1] > 20 && samples[2] - samples[3] > 20 && samples[4] - samples[3] > 20) {
                "抽屉移动后未实时重新取样：$samples"
            }
            val finished = CountDownLatch(1)
            var frames = 0
            var firstVersion = 0
            var finalVersion = 0
            val getter = activity.panel.javaClass.getDeclaredMethod("getSampleVersion").apply { isAccessible = true }
            instrumentation.runOnMainSync {
                firstVersion = getter.invoke(activity.panel) as Int
                ValueAnimator.ofFloat(0f, 720f, 0f).apply {
                    duration = 800
                    interpolator = LinearInterpolator()
                    addUpdateListener { frames++; activity.panel.translationY = it.animatedValue as Float }
                    addListener(object : AnimatorListenerAdapter() {
                        override fun onAnimationEnd(animation: Animator) { handler.postDelayed({ finalVersion = getter.invoke(activity.panel) as Int; finished.countDown() }, 50) }
                    })
                    start()
                }
            }
            check(finished.await(10, TimeUnit.SECONDS))
            check(frames >= 10 && finalVersion - firstVersion >= frames - 3) {
                "拖动与回弹期间存在取样停顿：$frames 帧，${finalVersion - firstVersion} 次刷新"
            }
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
}
