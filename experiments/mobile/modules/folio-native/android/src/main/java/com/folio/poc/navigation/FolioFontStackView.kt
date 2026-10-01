package com.folio.poc.navigation

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.view.MotionEvent
import android.view.View
import android.view.animation.AnimationUtils
import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

// 字体页原生转场与预测性返回，底层字体库保持挂载。
class FolioFontStackView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val onDismissed by EventDispatcher()
    private var presented = false
    private var dismissing = false
    private var backInProgress = false
    private var backProgress = 0f
    private var backDirection = 1f
    private var animator: ValueAnimator? = null
    private var callbackRegistered = false
    private var updateScheduled = false

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
            backDirection = if (backEvent.swipeEdge == BackEventCompat.EDGE_LEFT) 1f else -1f
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
            }
        }

        override fun handleOnBackPressed() { dismiss() }
    }

    // Yoga 管理两个页面的边界，原生只改变绘制变换。
    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        scheduleUpdate()
        if (backInProgress && !dismissing) applyBackProgress(backProgress)
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
        registerBackCallback()
        scheduleUpdate()
    }

    override fun onDetachedFromWindow() {
        cancelAnimation()
        backCallback.remove()
        callbackRegistered = false
        backInProgress = false
        dismissing = false
        detail?.let { it.translationX = 0f; it.scaleX = 1f; it.scaleY = 1f }
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
        animate({ fraction -> page.translationX = width * (1f - fraction) }) {
            root?.visibility = INVISIBLE
        }
    }

    // 手势进度直接绘制；取消回到详情页，提交后才通知 JS 出栈。
    private fun applyBackProgress(value: Float) {
        backProgress = value.coerceIn(0f, 1f)
        val progress = if (ValueAnimator.areAnimatorsEnabled()) backProgress else 0f
        detail?.let {
            it.translationX = backDirection * width * 0.1f * progress
            it.scaleX = 1f - 0.1f * progress
            it.scaleY = 1f - 0.1f * progress
        }
    }

    private fun dismiss() {
        val page = detail ?: return
        if (!presented || dismissing) return
        dismissing = true
        root?.visibility = VISIBLE
        val startX = page.translationX
        val startScale = page.scaleX
        val direction = if (backInProgress) backDirection else 1f
        animate({ fraction ->
            page.translationX = startX + (direction * width - startX) * fraction
            page.scaleX = startScale + (1f - startScale) * fraction
            page.scaleY = page.scaleX
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
        root?.visibility = VISIBLE
        root?.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_AUTO
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
