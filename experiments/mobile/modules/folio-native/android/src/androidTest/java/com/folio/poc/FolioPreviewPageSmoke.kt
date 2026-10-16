package com.folio.poc

import android.app.Instrumentation
import android.graphics.Rect
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.view.MotionEvent
import android.view.KeyEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlin.math.abs

// 在已启动的调试应用中验证共享页面、原生编辑器与受控滑块之间的完整回传。
internal object FolioPreviewPageSmoke {
    fun run(test: Instrumentation) {
        fun find(predicate: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
            fun walk(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
                if (!node.refresh()) return null
                if (predicate(node)) return node
                for (index in 0 until node.childCount) node.getChild(index)?.let { child -> walk(child)?.let { return it } }
                return null
            }
            return test.uiAutomation.rootInActiveWindow?.let(::walk)
        }
        fun awaitNode(predicate: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo {
            val deadline = SystemClock.uptimeMillis() + 10000
            while (SystemClock.uptimeMillis() < deadline) {
                find(predicate)?.let { return it }
                SystemClock.sleep(100)
            }
            error("页面未出现预期控件")
        }
        fun editor() = awaitNode { it.className?.toString() == "android.widget.EditText" }
        fun bounds(node: AccessibilityNodeInfo) = Rect().also(node::getBoundsInScreen)
        fun labeled(node: AccessibilityNodeInfo, en: String, zh: String): Boolean {
            val label = node.contentDescription?.toString().orEmpty()
            return label.startsWith(en) || label.startsWith(zh)
        }
        fun range(en: String, zh: String) = awaitNode { it.rangeInfo != null && labeled(it, en, zh) }
        fun buttonFor(node: AccessibilityNodeInfo): AccessibilityNodeInfo {
            var button = node
            while (!button.isClickable) button = button.parent ?: break
            return button
        }
        fun reset() {
            val menu = buttonFor(awaitNode { labeled(it, "Font Actions", "字体操作") })
            check(menu.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            val label = awaitNode { it.text?.toString() in listOf("Reset", "重置") || labeled(it, "Reset", "重置") }
            val button = buttonFor(label)
            if (button.isEnabled) check(button.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            else test.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
            SystemClock.sleep(200)
        }
        ParcelFileDescriptor.AutoCloseInputStream(test.uiAutomation.executeShellCommand(
            "am start -a android.intent.action.VIEW -d 'folio-poc://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' com.folio.mobile.poc"
        )).use { it.readBytes() }
        awaitNode { it.packageName?.toString() == "com.folio.mobile.poc" }
        if (find { it.className?.toString() == "android.widget.EditText" } == null) {
            val card = awaitNode { labeled(it, "Roboto Flex · View details", "Roboto Flex · 查看详情") }
            check(card.performAction(AccessibilityNodeInfo.ACTION_CLICK))
        }
        editor()
        reset()
        val initialText = editor().text.toString()
        val initialHeight = bounds(editor()).height()
        val initialAxis = checkNotNull(range("Optical Size", "光学字号").rangeInfo).current
        val replacement = "Folio\n可变字体 😀"
        check(editor().performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, replacement)
        }))
        awaitNode { it.className?.toString() == "android.widget.EditText" && it.text?.toString() == replacement }
        check(bounds(editor()).height() == initialHeight) { "Editing changed viewport height" }
        val density = test.targetContext.resources.displayMetrics.density
        fun resize(points: Float) {
            val handle = awaitNode { labeled(it, "Adjust Preview Height", "调整预览区高度") }
            handle.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.id)
            SystemClock.sleep(200)
            val area = bounds(awaitNode { labeled(it, "Adjust Preview Height", "调整预览区高度") })
            val down = SystemClock.uptimeMillis()
            fun send(action: Int, y: Float) {
                val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, area.exactCenterX(), y, 0)
                try { check(test.uiAutomation.injectInputEvent(event, true)) } finally { event.recycle() }
                SystemClock.sleep(24)
            }
            send(MotionEvent.ACTION_DOWN, area.exactCenterY())
            for (step in 1..8) send(MotionEvent.ACTION_MOVE, area.exactCenterY() + points * density * step / 8f)
            send(MotionEvent.ACTION_UP, area.exactCenterY() + points * density)
            SystemClock.sleep(200)
        }
        resize(64f)
        val resizedHeight = bounds(editor()).height()
        check(abs(resizedHeight - initialHeight - 64f * density) < 4f) { "Bottom drag did not resize viewport" }
        fun setRange(en: String, zh: String, value: Float) {
            check(range(en, zh).performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SET_PROGRESS.id, Bundle().apply {
                putFloat(AccessibilityNodeInfo.ACTION_ARGUMENT_PROGRESS_VALUE, value)
            }))
            awaitNode { it.rangeInfo?.current == value && labeled(it, en, zh) }
        }
        setRange("Preview Size", "预览字号", 64f)
        setRange("Optical Size", "光学字号", 100f)
        check(bounds(editor()).height() == resizedHeight) { "Font controls changed viewport height" }
        reset()
        awaitNode { it.className?.toString() == "android.widget.EditText" && it.text?.toString() == initialText }
        awaitNode { it.rangeInfo?.current == 36f && labeled(it, "Preview Size", "预览字号") }
        awaitNode { it.rangeInfo?.current == initialAxis && labeled(it, "Optical Size", "光学字号") }
        check(bounds(editor()).height() == resizedHeight) { "Reset changed manual viewport height" }
        resize(-64f)
        check(abs(bounds(editor()).height() - initialHeight) < 4) { "Viewport height did not restore" }
        check(editor().performAction(AccessibilityNodeInfo.ACTION_FOCUS))
        check(editor().performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "First line\nSecond line\nThird line\nFourth line")
        }))
        setRange("Preview Size", "预览字号", 64f)
        editor().performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
        resize(-64f)
        check(editor().actionList.none { it.id == AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD }) {
            "Shrinking the page preview retained a scroll offset"
        }
        for (size in listOf(36f, 64f, 48f, 64f)) {
            setRange("Preview Size", "预览字号", size)
            SystemClock.sleep(300)
            check(editor().actionList.none { it.id == AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD }) {
                "Changing font size after resizing clipped the page preview"
            }
        }
        resize(32f)
        resize(-32f)
        check(editor().actionList.none { it.id == AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD }) {
            "Repeated resizing scrolled past the first line"
        }
        test.uiAutomation.takeScreenshot()?.let { bitmap ->
            java.io.File(test.context.getExternalFilesDir(null), "preview-editor-small.png").outputStream().use {
                bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
            }
            bitmap.recycle()
        }
        reset()
        resize(64f)
        // 验证菜单重置、字符表独立轴值与持久化偏好之间的完整交互。
        fun click(en: String, zh: String) {
            val node = buttonFor(awaitNode { labeled(it, en, zh) })
            node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.id)
            SystemClock.sleep(200)
            check(buttonFor(awaitNode { labeled(it, en, zh) }).performAction(AccessibilityNodeInfo.ACTION_CLICK))
            SystemClock.sleep(400)
        }
        fun revealDetailAxes() {
            repeat(12) {
                if (find { it.rangeInfo != null && labeled(it, "Optical Size", "光学字号") } != null) return
                find { it.isScrollable && it.actionList.any { action -> action.id == AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD } }
                    ?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)
                SystemClock.sleep(150)
            }
        }
        fun openCharacterMap(expectedAxis: Float) {
            click("Character Map", "字符表")
            awaitNode { labeled(it, "Enter a character or U+ code point", "输入字符或 U+ 码位") }
            click("Character Map", "字符表")
            check(checkNotNull(range("Optical Size", "光学字号").rangeInfo).current == expectedAxis) {
                "Character map did not honor the axis inheritance preference"
            }
        }
        setRange("Optical Size", "光学字号", 100f)
        openCharacterMap(100f)
        reset()
        awaitNode { it.rangeInfo?.current == initialAxis && labeled(it, "Optical Size", "光学字号") }
        click("Back", "返回")
        revealDetailAxes()
        check(checkNotNull(range("Optical Size", "光学字号").rangeInfo).current == 100f) {
            "Character map reset changed the font detail axes"
        }
        click("Back to Library", "返回字体库")
        click("Settings", "设置")
        val inheritEn = "Inherit Font Detail Axes"
        val inheritZh = "继承字体详情可变轴"
        val toggle = buttonFor(awaitNode { labeled(it, inheritEn, inheritZh) })
        check(toggle.isChecked) { "Axis inheritance should default to enabled" }
        click(inheritEn, inheritZh)
        awaitNode { labeled(it, inheritEn, inheritZh) && !buttonFor(it).isChecked }
        click("Library", "字体库")
        click("Roboto Flex · View details", "Roboto Flex · 查看详情")
        setRange("Optical Size", "光学字号", 100f)
        openCharacterMap(initialAxis)
        setRange("Optical Size", "光学字号", 80f)
        reset()
        awaitNode { it.rangeInfo?.current == initialAxis && labeled(it, "Optical Size", "光学字号") }
        click("Back", "返回")
        revealDetailAxes()
        check(checkNotNull(range("Optical Size", "光学字号").rangeInfo).current == 100f)
        reset()
        click("Back to Library", "返回字体库")
        click("Settings", "设置")
        check(!buttonFor(awaitNode { labeled(it, inheritEn, inheritZh) }).isChecked)
        click(inheritEn, inheritZh)
        awaitNode { labeled(it, inheritEn, inheritZh) && buttonFor(it).isChecked }
        click("Library", "字体库")
    }
}
