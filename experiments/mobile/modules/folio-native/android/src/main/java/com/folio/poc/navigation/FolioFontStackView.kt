package com.folio.poc.navigation

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.Build
import android.view.MotionEvent
import android.view.RoundedCorner
import android.view.View
import android.view.WindowInsets
import android.view.animation.AnimationUtils
import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.roundToInt

// 二级页与上一页同步推移，预测性返回保留底层页面。
class FolioFontStackView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val onDismissed by EventDispatcher()
    private var presented = false
    private var dismissing = false
    private var backInProgress = false
    private var backProgress = 0f
    private var animator: ValueAnimator? = null
    private var callbackRegistered = false
    private var updateScheduled = false
    private var backgroundDim = 0f
    private val dimPaint = Paint().apply { color = Color.BLACK }
    private val cornerPath = Path()
    private val cornerBounds = RectF()
    private val cornerRadii = FloatArray(8)

    var visible = false
        set(value) {
            field = value
            scheduleUpdate()
        }

    private val root: View? get() = getChildAt(0)
    private val detail: View? get() = if (childCount > 1) getChildAt(1) else null

    private val backCallback = object : OnBackPressedCallback(false) {
        override fun handleOnBackStarted(backEvent: BackEventCompat) {
            if (!presented || dismissing) return
            cancelAnimation()
            backInProgress = true
            updateCornerRadii(rootWindowInsets)
            root?.visibility = VISIBLE
            applyBackProgress(0f)
        }

        override fun handleOnBackProgressed(backEvent: BackEventCompat) {
            if (backInProgress && !dismissing) applyBackProgress(backEvent.progress)
        }

        override fun handleOnBackCancelled() {
            if (!backInProgress || dismissing) return
            val start = backProgress
            animate({ fraction -> applyBackProgress(start * (1f - fraction)) }) {
                backInProgress = false
                root?.visibility = INVISIBLE
                backgroundDim = 0f
                invalidate()
            }
        }

        override fun handleOnBackPressed() { dismiss() }
    }

    // Yoga 管理两个页面的边界，原生只改变绘制变换。
    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        updateCornerRadii(rootWindowInsets)
        scheduleUpdate()
        if (backInProgress && !dismissing) applyBackProgress(backProgress)
    }

    override fun onApplyWindowInsets(insets: WindowInsets): WindowInsets {
        updateCornerRadii(insets)
        return super.onApplyWindowInsets(insets)
    }

    // 遮罩仅覆盖底层页面，前层圆角随位移一起裁剪。
    override fun drawChild(canvas: Canvas, child: View, drawingTime: Long): Boolean {
        val saveCount = canvas.save()
        try {
            if (child === detail && child.translationX != 0f && cornerRadii.any { it > 0f }) {
                val left = child.left + child.translationX
                val top = child.top + child.translationY
                cornerBounds.set(left, top, left + child.width, top + child.height)
                cornerPath.rewind()
                cornerPath.addRoundRect(cornerBounds, cornerRadii, Path.Direction.CW)
                canvas.clipPath(cornerPath)
            }
            val drawn = super.drawChild(canvas, child, drawingTime)
            if (child === root && backgroundDim > 0f) {
                dimPaint.alpha = (backgroundDim * 255f).roundToInt()
                canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), dimPaint)
            }
            return drawn
        } finally {
            canvas.restoreToCount(saveCount)
        }
    }

    // 使用窗口报告的四角半径，旧系统与无圆角屏幕保持直角。
    private fun updateCornerRadii(insets: WindowInsets?) {
        cornerRadii.fill(0f)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val positions = intArrayOf(
                RoundedCorner.POSITION_TOP_LEFT, RoundedCorner.POSITION_TOP_RIGHT,
                RoundedCorner.POSITION_BOTTOM_RIGHT, RoundedCorner.POSITION_BOTTOM_LEFT,
            )
            positions.forEachIndexed { index, position ->
                val radius = insets?.getRoundedCorner(position)?.radius?.toFloat() ?: 0f
                cornerRadii[index * 2] = radius
                cornerRadii[index * 2 + 1] = radius
            }
        }
        invalidate()
    }

    override fun onViewAdded(child: View) {
        super.onViewAdded(child)
        scheduleUpdate()
    }

    override fun onViewRemoved(child: View) {
        super.onViewRemoved(child)
        if (childCount < 2) {
            cancelAnimation()
            presented = false
            dismissing = false
            backInProgress = false
            backCallback.isEnabled = false
            restoreRoot()
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        updateCornerRadii(rootWindowInsets)
        registerBackCallback()
        scheduleUpdate()
    }

    override fun onDetachedFromWindow() {
        cancelAnimation()
        backCallback.remove()
        callbackRegistered = false
        backInProgress = false
        dismissing = false
        detail?.translationX = 0f
        restoreRoot()
        super.onDetachedFromWindow()
    }

    override fun onInterceptTouchEvent(event: MotionEvent): Boolean =
        animator != null || backInProgress || super.onInterceptTouchEvent(event)

    override fun onTouchEvent(event: MotionEvent): Boolean =
        animator != null || backInProgress || super.onTouchEvent(event)

    private fun registerBackCallback() {
        if (callbackRegistered || !isAttachedToWindow) return
        val activity = appContext.currentActivity as? ComponentActivity ?: return
        activity.onBackPressedDispatcher.addCallback(activity, backCallback)
        callbackRegistered = true
    }

    private fun scheduleUpdate() {
        if (updateScheduled) return
        updateScheduled = true
        post {
            updateScheduled = false
            registerBackCallback()
            if (!isAttachedToWindow || width <= 0 || height <= 0 || detail == null) return@post
            if (visible && !presented) present()
            else if (!visible && presented && !dismissing) dismiss()
            else if (visible && presented && animator == null && !backInProgress && !dismissing) {
                detail?.let { applyTranslation(it, 0f) }
                root?.visibility = INVISIBLE
                root?.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
                backgroundDim = 0f
            }
        }
    }

    private fun present() {
        val page = detail ?: return
        presented = true
        dismissing = false
        backCallback.isEnabled = true
        root?.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        root?.visibility = VISIBLE
        page.visibility = VISIBLE
        animate({ fraction -> applyTranslation(page, width * (1f - fraction)) }) {
            root?.visibility = INVISIBLE
            backgroundDim = 0f
            invalidate()
        }
    }

    // 两侧返回手势统一向右退出；取消复位，提交后才通知 JS 出栈。
    private fun applyBackProgress(value: Float) {
        backProgress = value.coerceIn(0f, 1f)
        val progress = if (ValueAnimator.areAnimatorsEnabled()) backProgress else 0f
        detail?.let { applyTranslation(it, width * 0.25f * progress) }
    }

    private fun applyTranslation(page: View, translation: Float) {
        page.translationX = translation
        val fraction = (translation / width.coerceAtLeast(1)).coerceIn(0f, 1f)
        root?.translationX = -width / 3f * (1f - fraction)
        backgroundDim = 0.2f * (1f - fraction)
        invalidate()
    }

    private fun dismiss() {
        val page = detail ?: return
        if (!presented || dismissing) return
        dismissing = true
        root?.visibility = VISIBLE
        val startX = page.translationX
        animate({ fraction ->
            applyTranslation(page, startX + (width - startX) * fraction)
        }) {
            page.visibility = INVISIBLE
            presented = false
            dismissing = false
            backInProgress = false
            visible = false
            backCallback.isEnabled = false
            restoreRoot()
            onDismissed(emptyMap<String, Any>())
        }
    }

    private fun restoreRoot() {
        backgroundDim = 0f
        root?.translationX = 0f
        root?.visibility = VISIBLE
        root?.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_AUTO
        invalidate()
    }

    private fun cancelAnimation() {
        val previous = animator
        animator = null
        previous?.cancel()
    }

    private fun animate(update: (Float) -> Unit, finish: () -> Unit) {
        cancelAnimation()
        if (!ValueAnimator.areAnimatorsEnabled()) {
            update(1f)
            finish()
            return
        }
        update(0f)
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = resources.getInteger(android.R.integer.config_mediumAnimTime).toLong()
            interpolator = AnimationUtils.loadInterpolator(context, android.R.interpolator.fast_out_slow_in)
            addUpdateListener { update(it.animatedValue as Float) }
            addListener(object : AnimatorListenerAdapter() {
                private var cancelled = false
                override fun onAnimationCancel(animation: Animator) { cancelled = true }
                override fun onAnimationEnd(animation: Animator) {
                    if (!cancelled) { animator = null; finish() }
                }
            })
            start()
        }
    }
}
