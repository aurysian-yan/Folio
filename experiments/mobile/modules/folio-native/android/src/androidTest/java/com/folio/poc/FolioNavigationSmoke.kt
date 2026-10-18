package com.folio.poc

import android.animation.ValueAnimator
import android.app.Instrumentation
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.widget.FrameLayout
import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.CatalystInstance
import com.folio.poc.navigation.FolioFontStackView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.ModulesProvider
import expo.modules.kotlin.modules.Module
import java.lang.ref.WeakReference
import java.lang.reflect.Proxy
import kotlin.math.abs

// 使用真实容器绘制首帧，页面尺寸由测试独立控制。
class FolioNavigationTestActivity : ComponentActivity() {
    lateinit var stack: FolioFontStackView
    lateinit var previous: View
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
        stack = FolioFontStackView(react, app)
        previous = View(react).apply { setBackgroundColor(Color.WHITE) }
        stack.addView(previous)
        stage = object : FrameLayout(this) {
            override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
                stack.layout(0, 0, 320, 480)
                previous.layout(0, 0, 320, 480)
            }
        }
        stage.addView(stack, FrameLayout.LayoutParams(320, 480))
        setContentView(stage)
    }

    override fun onDestroy() {
        super.onDestroy()
        app.javaClass.declaredMethods.first { it.name.startsWith("onDestroy") }.apply { isAccessible = true }.invoke(app)
    }
}

internal object FolioNavigationSmoke {
    fun run(test: Instrumentation) {
        val activity = test.startActivitySync(Intent(test.context, FolioNavigationTestActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as FolioNavigationTestActivity
        try {
            test.waitForIdleSync()
            test.runOnMainSync {
                val stack = activity.stack
                fun field(name: String) = stack.javaClass.getDeclaredField(name).apply { isAccessible = true }.get(stack)
                fun update() {
                    val task = field("updateTask") as Runnable
                    stack.removeCallbacks(task)
                    task.run()
                }
                fun animation() = field("animator") as ValueAnimator?
                fun sample(x: Int = 2): Int {
                    val bitmap = Bitmap.createBitmap(stack.width, stack.height, Bitmap.Config.ARGB_8888)
                    return try {
                        stack.draw(Canvas(bitmap))
                        bitmap.getPixel(x, stack.height / 2)
                    } finally { bitmap.recycle() }
                }
                fun page() = View(stack.context).apply { setBackgroundColor(Color.GREEN) }
                fun size(page: View) = page.layout(0, 0, stack.width, stack.height)
                fun restored() {
                    check(activity.previous.visibility == View.VISIBLE && activity.previous.translationX == 0f)
                    check(activity.previous.importantForAccessibility == View.IMPORTANT_FOR_ACCESSIBILITY_AUTO)
                    check(sample() == Color.WHITE) { "关闭后上一页仍被压暗" }
                    check(animation() == null)
                }

                val detail = page()
                stack.visible = true
                stack.addView(detail)
                check(detail.visibility == View.INVISIBLE) { "新页面挂载时提前可见" }
                update()
                check(animation() == null) { "零尺寸页面提前开始动画" }
                check(sample() == Color.WHITE)
                size(detail)
                // 模拟 RN 在布局提交时重置可见性，绘制保护仍须阻止闪帧。
                detail.visibility = View.VISIBLE
                check(sample() == Color.WHITE) { "异步更新前新页面闪现" }
                update()
                if (ValueAnimator.areAnimatorsEnabled()) {
                    val enter = checkNotNull(animation())
                    enter.currentPlayTime = 0
                    check(detail.visibility == View.VISIBLE && detail.translationX == stack.width.toFloat())
                    check(sample() == Color.WHITE) { "动画首帧没有位于屏幕外" }
                    enter.end()
                }
                check(detail.translationX == 0f && sample() == Color.GREEN)
                check(activity.previous.visibility == View.INVISIBLE)

                val back = field("backCallback") as OnBackPressedCallback
                fun backEvent(progress: Float) = BackEventCompat(0f, 0f, progress, BackEventCompat.EDGE_LEFT)
                for (dim in listOf(0.2f, 0.48f)) {
                    stack.dimAmount = dim
                    back.handleOnBackStarted(backEvent(0f))
                    back.handleOnBackProgressed(backEvent(0.8f))
                    if (ValueAnimator.areAnimatorsEnabled()) {
                        val expected = (255f * (1f - dim * (1f - detail.translationX / stack.width))).toInt()
                        check(abs(Color.red(sample()) - expected) <= 2) { "返回进度与主题压暗不一致" }
                    }
                    back.handleOnBackCancelled()
                    animation()?.end()
                    check(detail.translationX == 0f && activity.previous.visibility == View.INVISIBLE)
                }
                stack.visible = false
                update()
                animation()?.end()
                restored()
                stack.removeView(detail)

                // 打开后立即关闭、移除旧页面，不得留下延迟入场任务。
                val cancelled = page()
                stack.visible = true
                stack.addView(cancelled)
                stack.visible = false
                update()
                check(cancelled.visibility == View.INVISIBLE)
                restored()
                stack.removeView(cancelled)
                check(field("updateScheduled") == false)

                val replacement = page()
                stack.visible = true
                stack.addView(replacement)
                size(replacement)
                update()
                stack.removeView(replacement)
                restored()
                check(field("updateScheduled") == false)

                // 卸载时清除动画与回调，重新挂载仍从屏幕外开始。
                val reattached = page()
                stack.addView(reattached)
                size(reattached)
                update()
                activity.stage.removeView(stack)
                check(field("updateScheduled") == false && animation() == null)
                check(reattached.visibility == View.INVISIBLE)
                activity.stage.addView(stack)
                update()
                if (ValueAnimator.areAnimatorsEnabled()) {
                    check(reattached.translationX == stack.width.toFloat())
                }
                stack.removeView(reattached)
                restored()
            }
        } finally { test.runOnMainSync { activity.finish() } }
    }
}
