package com.folio.poc

import android.app.Instrumentation
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.io.File
import kotlin.math.abs

// 在真实字符表页面回归菜单按压、空字形、收起回顶与前后台切换。
internal object FolioCharacterMapPageSmoke {
    fun run(test: Instrumentation, copyFeedback: Boolean = false) {
        fun shell(command: String) = ParcelFileDescriptor.AutoCloseInputStream(test.uiAutomation.executeShellCommand(command))
            .use { it.readBytes() }
        fun find(predicate: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
            fun walk(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
                if (node.isVisibleToUser && predicate(node)) return node
                for (index in 0 until node.childCount) node.getChild(index)?.let { walk(it)?.let { found -> return found } }
                return null
            }
            return test.uiAutomation.rootInActiveWindow?.let(::walk)
        }
        fun awaitNode(predicate: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo {
            val deadline = SystemClock.uptimeMillis() + 15000
            while (SystemClock.uptimeMillis() < deadline) {
                find(predicate)?.let { return it }
                SystemClock.sleep(100)
            }
            error("字符表未出现预期控件")
        }
        fun labeled(node: AccessibilityNodeInfo, en: String, zh: String) = node.contentDescription?.toString().orEmpty().let {
            it == en || it == zh || it.startsWith("$en ·") || it.startsWith("$zh ·")
        }
        fun bounds(node: AccessibilityNodeInfo) = Rect().also(node::getBoundsInScreen)
        fun button(node: AccessibilityNodeInfo): AccessibilityNodeInfo {
            var current = node
            while (!current.isClickable) current = current.parent ?: error("控件不可点击")
            return current
        }
        fun click(en: String, zh: String) {
            val node = button(awaitNode { labeled(it, en, zh) || it.text?.toString() in listOf(en, zh) })
            node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.id)
            check(node.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            SystemClock.sleep(500)
        }
        fun handle() = awaitNode { labeled(it, "Character Map", "字符表") && it.isClickable }
        fun tap(node: AccessibilityNodeInfo) {
            val area = bounds(node)
            val down = SystemClock.uptimeMillis()
            for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
                val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, area.exactCenterX(), area.exactCenterY(), 0)
                try { check(test.uiAutomation.injectInputEvent(event, true)) } finally { event.recycle() }
                SystemClock.sleep(16)
            }
        }
        fun screenshot(name: String): Bitmap = checkNotNull(test.uiAutomation.takeScreenshot()).also { bitmap ->
            File(test.context.getExternalFilesDir(null), "character-map-$name.png").outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        }
        fun summary() {
            awaitNode { labeled(it, "Blank glyph", "空白字形") }
            awaitNode { labeled(it, "Character", "复制字符") }
            check(find { it.text?.toString() in listOf("Blank glyph", "空白字形") } == null) { "空字形仍显示说明文字" }
        }
        fun backgroundAndRestore(expectedTop: Int) {
            test.sendKeyDownUpSync(KeyEvent.KEYCODE_HOME)
            SystemClock.sleep(500)
            shell("am start -n com.folio.mobile.poc/.MainActivity")
            val deadline = SystemClock.uptimeMillis() + 10000
            while (SystemClock.uptimeMillis() < deadline) {
                val current = find { labeled(it, "Character Map", "字符表") && it.isClickable }
                if (current != null && abs(bounds(current).top - expectedTop) < 12) return
                SystemClock.sleep(100)
            }
            error("回到前台后面板档位未恢复")
        }

        shell("am start -a android.intent.action.VIEW -d 'folio-poc://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' com.folio.mobile.poc")
        awaitNode { labeled(it, "Enter a character or U+ code point", "输入字符或 U+ 码位") ||
            labeled(it, "Roboto Flex · View details", "Roboto Flex · 查看详情") || it.className?.toString() == "android.widget.EditText" }
        if (find { labeled(it, "Enter a character or U+ code point", "输入字符或 U+ 码位") } == null) {
            if (find { it.className?.toString() == "android.widget.EditText" } == null) {
                click("Roboto Flex · View details", "Roboto Flex · 查看详情")
            }
            repeat(12) {
                if (find { labeled(it, "Character Map", "字符表") || it.text?.toString() in listOf("Character Map", "字符表") } == null) {
                    find { it.isScrollable }?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
                    SystemClock.sleep(200)
                }
            }
            click("Character Map", "字符表")
        }
        // 空字形用例显式选择 NULL，兼容默认选中首个非空字符。
        tap(button(awaitNode { it.contentDescription?.toString()?.startsWith("U+0000") == true }))
        summary()
        if (copyFeedback) {
            // 验证真实复制入口的成功反馈与定时复原，截图保留各稳定状态。
            fun validateCopy(en: String, zh: String, copiedEn: String = "Copied", copiedZh: String = "已复制", name: String) {
                repeat(12) {
                    if (find { it.contentDescription?.toString() in listOf(en, zh) } == null) {
                        find { it.isScrollable }?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
                        SystemClock.sleep(150)
                    }
                }
                val node = button(awaitNode { it.contentDescription?.toString() in listOf(en, zh) })
                val area = bounds(node)
                val baseline = screenshot("copy-$name-before")
                val start = SystemClock.uptimeMillis()
                tap(button(awaitNode { it.contentDescription?.toString() in listOf(en, zh) }))
                awaitNode { it.contentDescription?.toString() in listOf(copiedEn, copiedZh) && bounds(it).centerX() == area.centerX() }
                SystemClock.sleep(220)
                val success = screenshot("copy-$name-success")
                fun differences(a: Bitmap, b: Bitmap): Int {
                    var count = 0
                    for (y in area.top.coerceAtLeast(0) until area.bottom.coerceAtMost(a.height)) {
                        for (x in area.left.coerceAtLeast(0) until area.right.coerceAtMost(a.width)) {
                            if (a.getPixel(x, y) != b.getPixel(x, y)) count++
                        }
                    }
                    return count
                }
                check(differences(baseline, success) > 50) { "复制成功未替换按钮内容" }
                awaitNode { it.contentDescription?.toString() in listOf(en, zh) && bounds(it).centerX() == area.centerX() }
                val elapsed = SystemClock.uptimeMillis() - start
                check(elapsed in 1800..6500) { "复制反馈未按时复原：$elapsed 毫秒" }
                SystemClock.sleep(250)
                val restored = screenshot("copy-$name-restored")
                for (image in listOf(baseline, success, restored)) image.recycle()
                tap(awaitNode { it.text?.toString() == "Roboto Flex" && bounds(it).top < area.top })
                SystemClock.sleep(200)
            }
            val nullCopy = awaitNode { it.contentDescription?.toString() in listOf("Character", "复制字符") }
            check(!nullCopy.isEnabled) { "NULL 字符的复制入口未禁用" }
            tap(nullCopy)
            check(find { it.contentDescription?.toString() in listOf("Copied", "已复制") } == null) { "禁用入口仍触发复制" }
            validateCopy("Code point", "复制码位", name = "codepoint")
            tap(button(awaitNode { it.contentDescription?.toString()?.startsWith("U+0021,") == true }))
            awaitNode { it.contentDescription?.toString() in listOf("Character", "复制字符") && it.isEnabled }
            validateCopy("Character", "复制字符", name = "character")
            // 两个按钮的成功反馈独立保留两秒，不互相提前复原。
            val characterButton = awaitNode { it.contentDescription?.toString() in listOf("Character", "复制字符") }
            val codepointButton = awaitNode { it.contentDescription?.toString() in listOf("Code point", "复制码位") }
            val right = bounds(codepointButton).centerX()
            tap(characterButton)
            SystemClock.sleep(700)
            tap(awaitNode { it.contentDescription?.toString() in listOf("Code point", "复制码位") })
            SystemClock.sleep(1450)
            awaitNode { it.contentDescription?.toString() in listOf("Character", "复制字符") }
            check(find { it.contentDescription?.toString() in listOf("Copied", "已复制") && bounds(it).centerX() == right } != null)
            SystemClock.sleep(800)
            awaitNode { it.contentDescription?.toString() in listOf("Code point", "复制码位") }
            click("Back", "返回")
            validateCopy("Copy As Family Name", "复制为 字族名", "Copied Family Name", "已复制 字族名", "family")
            validateCopy("Copy As CSS", "复制为 CSS", "Copied CSS", "已复制 CSS", "css")
            validateCopy("Copy As CSS @font-face", "复制为 CSS @font-face", "Copied CSS @font-face", "已复制 CSS @font-face", "fontface")
            validateCopy("Copy As SwiftUI", "复制为 SwiftUI", "Copied SwiftUI", "已复制 SwiftUI", "swiftui")
            return
        }
        val collapsedTop = bounds(handle()).top
        val baseline = screenshot("collapsed")
        val script = bounds(awaitNode { labeled(it, "Script", "脚本") })
        var down = SystemClock.uptimeMillis()
        fun touch(action: Int, x: Float, y: Float) {
            if (action == MotionEvent.ACTION_DOWN) down = SystemClock.uptimeMillis()
            val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x, y, 0)
            try { check(test.uiAutomation.injectInputEvent(event, true)) } finally { event.recycle() }
        }
        touch(MotionEvent.ACTION_DOWN, script.exactCenterX(), script.exactCenterY())
        SystemClock.sleep(700)
        val held = screenshot("script-held")
        var changed = 0
        val padding = 20
        val top = (script.top - padding).coerceAtLeast(0)
        val bottom = (script.bottom + padding).coerceAtMost(baseline.height)
        for (y in top until bottom) for (x in 0 until baseline.width) {
            if (baseline.getPixel(x, y) != held.getPixel(x, y)) changed++
        }
        check(changed < baseline.width * (bottom - top) / 100) { "脚本按住仍改变表层或阴影：$changed 像素" }
        baseline.recycle(); held.recycle()
        touch(MotionEvent.ACTION_UP, script.exactCenterX(), script.exactCenterY())
        click("All scripts", "全部脚本")

        repeat(2) { iteration ->
            click("Character Map", "字符表")
            val expandedTop = bounds(handle()).top
            check(expandedTop < collapsedTop)
            val scroller = awaitNode { it.isScrollable && bounds(it).top >= expandedTop && it.className?.toString() == "android.widget.ScrollView" }
            repeat(3) { scroller.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD); SystemClock.sleep(250) }
            if (iteration == 0) click("Character Map", "字符表") else {
                val grip = bounds(handle())
                touch(MotionEvent.ACTION_DOWN, grip.exactCenterX(), grip.exactCenterY())
                for (step in 1..12) {
                    touch(MotionEvent.ACTION_MOVE, grip.exactCenterX(), grip.exactCenterY() + (collapsedTop - expandedTop) * step / 12f)
                    SystemClock.sleep(25)
                }
                touch(MotionEvent.ACTION_UP, grip.exactCenterX(), grip.exactCenterY() + collapsedTop - expandedTop)
                SystemClock.sleep(700)
            }
            check(abs(bounds(handle()).top - collapsedTop) < 12)
            summary()
            backgroundAndRestore(collapsedTop)
            summary()
        }
        click("Character Map", "字符表")
        val expandedTop = bounds(handle()).top
        backgroundAndRestore(expandedTop)
        summary()
        screenshot("restored-expanded").recycle()
        click("Character Map", "字符表")
        summary()
        screenshot("restored-collapsed").recycle()
        // 搜索键盘和面板吸附动画也可能在进入后台时被系统中断。
        val search = awaitNode { labeled(it, "Enter a character or U+ code point", "输入字符或 U+ 码位") }
        check(search.performAction(AccessibilityNodeInfo.ACTION_CLICK))
        SystemClock.sleep(500)
        test.sendKeyDownUpSync(KeyEvent.KEYCODE_HOME)
        SystemClock.sleep(500)
        shell("am start -n com.folio.mobile.poc/.MainActivity")
        summary()
        check(handle().performAction(AccessibilityNodeInfo.ACTION_CLICK))
        test.sendKeyDownUpSync(KeyEvent.KEYCODE_HOME)
        SystemClock.sleep(500)
        shell("am start -n com.folio.mobile.poc/.MainActivity")
        summary()
    }
}
