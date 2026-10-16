package com.folio.poc

import android.app.Instrumentation
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.PixelCopy
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.CatalystInstance
import com.folio.poc.navigation.FolioGlassSliderView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.ModulesProvider
import expo.modules.kotlin.modules.Module
import java.io.File
import java.lang.ref.WeakReference
import java.lang.reflect.Proxy
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// 挂载真实 Expo 控件，验证原生触摸、受控回传与玻璃取样。
class FolioSliderTestActivity : ComponentActivity() {
    lateinit var slider: FolioGlassSliderView
    lateinit var stage: FrameLayout
    private lateinit var app: AppContext

    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val bridge = Proxy.newProxyInstance(CatalystInstance::class.java.classLoader, arrayOf(CatalystInstance::class.java)) { _, method, _ ->
            when (method.returnType) {
                java.lang.Boolean.TYPE -> false
                java.lang.Integer.TYPE -> 0
                else -> null
            }
        } as CatalystInstance
        val react = object : BridgeReactContext(this) {
            override fun getCatalystInstance(): CatalystInstance = bridge
        }
        app = AppContext(object : ModulesProvider {
            override fun getModulesMap(): Map<Class<out Module>, String?> = emptyMap()
        }, expo.modules.core.ModuleRegistry(emptyList(), emptyList()), WeakReference(react))
        slider = FolioGlassSliderView(react, app).apply {
            label = "字号"; valueText = "0"; minimum = -2.0; maximum = 2.0; step = 0.25
            accentColor = "#3884FF"; trackColor = "#555555"; thumbColor = "#FFFFFF"; surfaceColor = "#242424"
            dark = true; applyProps()
        }
        val density = resources.displayMetrics.density
        stage = object : FrameLayout(this) {
            override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
                slider.layout((24 * density).toInt(), (100 * density).toInt(), width - (24 * density).toInt(), (148 * density).toInt())
            }
        }
        stage.setBackgroundColor(Color.rgb(36, 36, 36))
        stage.addView(slider, FrameLayout.LayoutParams(-1, (48 * density).toInt()))
        setContentView(stage)
    }

    override fun onDestroy() {
        super.onDestroy()
        app.javaClass.declaredMethods.first { it.name.startsWith("onDestroy") }.apply { isAccessible = true }.invoke(app)
    }
}

internal object FolioSliderInteractionSmoke {
    fun run(test: Instrumentation) {
        val activity = test.startActivitySync(Intent(test.context, FolioSliderTestActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as FolioSliderTestActivity
        try {
            test.waitForIdleSync()
            SystemClock.sleep(250)
            val slider = activity.slider
            val location = IntArray(2)
            test.runOnMainSync { slider.getLocationOnScreen(location) }
            val density = activity.resources.displayMetrics.density
            val inset = 16 * density
            val travel = slider.width - inset * 2
            val y = location[1] + slider.height / 2f
            fun x(fraction: Float) = location[0] + inset + travel * fraction
            fun value(): Double {
                var result = 0.0
                test.runOnMainSync {
                    result = slider.javaClass.getDeclaredMethod("getCurrentValue").apply { isAccessible = true }.invoke(slider) as Double
                }
                return result
            }
            fun reset(next: Double = 0.0) {
                test.runOnMainSync {
                    slider.incomingValue = next
                    slider.mostRecentEventCount = Int.MAX_VALUE
                    slider.applyProps()
                    slider.mostRecentEventCount = 0
                }
                test.waitForIdleSync()
            }
            fun send(down: Long, action: Int, px: Float, py: Float = y) {
                val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, px, py, 0)
                try { test.sendPointerSync(event) } finally { event.recycle() }
                test.waitForIdleSync()
            }
            fun gesture(start: Float, end: Float, action: Int = MotionEvent.ACTION_UP) {
                val down = SystemClock.uptimeMillis()
                send(down, MotionEvent.ACTION_DOWN, x(start))
                if (start != end) for (i in 1..8) send(down, MotionEvent.ACTION_MOVE, x(start + (end - start) * i / 8f))
                send(down, action, x(end))
            }
            gesture(0.75f, 0.75f)
            check(value() == 1.0) { "Track tap did not update value: ${value()}" }
            gesture(0.75f, 0.25f)
            check(value() == -1.0) { "Thumb drag did not follow pointer: ${value()}" }
            gesture(0.25f, -0.25f)
            check(value() == -2.0) { "Minimum overscroll escaped range" }
            gesture(0f, 1.25f)
            check(value() == 2.0) { "Maximum overscroll escaped range" }
            test.runOnMainSync { slider.incomingValue = -2.0; slider.applyProps() }
            check(value() == 2.0) { "Stale controlled value moved thumb" }
            reset()
            val vertical = SystemClock.uptimeMillis()
            send(vertical, MotionEvent.ACTION_DOWN, x(0.5f))
            send(vertical, MotionEvent.ACTION_MOVE, x(0.5f), y + 40 * density)
            send(vertical, MotionEvent.ACTION_UP, x(0.5f), y + 40 * density)
            check(value() == 0.0) { "Vertical gesture changed value" }
            gesture(0.5f, 0.75f, MotionEvent.ACTION_CANCEL)
            check(value() == 1.0) { "Cancellation lost last committed value" }
            reset()
            for (dark in listOf(true, false)) {
                test.runOnMainSync {
                    slider.dark = dark
                    slider.surfaceColor = if (dark) "#242424" else "#FFFFFF"
                    activity.stage.setBackgroundColor(if (dark) Color.rgb(36, 36, 36) else Color.WHITE)
                }
                val down = SystemClock.uptimeMillis()
                send(down, MotionEvent.ACTION_DOWN, x(0.5f))
                SystemClock.sleep(250)
                val copied = CountDownLatch(1)
                var status = PixelCopy.ERROR_UNKNOWN
                val bounds = IntArray(2)
                test.runOnMainSync { slider.getLocationInWindow(bounds) }
                val margin = (8 * density).toInt()
                val bitmap = Bitmap.createBitmap(slider.width, slider.height + margin * 2, Bitmap.Config.ARGB_8888)
                test.runOnMainSync {
                    PixelCopy.request(activity.window, Rect(bounds[0], bounds[1] - margin, bounds[0] + slider.width, bounds[1] + slider.height + margin),
                        bitmap, { status = it; copied.countDown() }, Handler(Looper.getMainLooper()))
                }
                check(copied.await(5, TimeUnit.SECONDS) && status == PixelCopy.SUCCESS)
                File(test.context.getExternalFilesDir(null), if (dark) "slider-control-dark.png" else "slider-control-light.png")
                    .outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                bitmap.recycle()
                send(down, MotionEvent.ACTION_UP, x(0.5f))
            }
            test.runOnMainSync { slider.controlEnabled = false }
            gesture(0.9f, 0.9f)
            check(value() == 0.0) { "Disabled slider accepted touch" }
        } finally { test.runOnMainSync { activity.finish() } }
    }
}
