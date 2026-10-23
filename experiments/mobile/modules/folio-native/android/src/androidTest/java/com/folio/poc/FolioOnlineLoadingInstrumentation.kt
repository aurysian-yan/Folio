package com.folio.poc

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebResourceError
import android.widget.FrameLayout
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.CatalystInstance
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.ModulesProvider
import expo.modules.kotlin.modules.Module
import java.lang.ref.WeakReference
import java.lang.reflect.Proxy
import java.io.ByteArrayInputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class FolioOnlineLoadingTestActivity : Activity() {
    lateinit var browser: FolioOnlineView
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
        browser = FolioOnlineView(react, app)
        setContentView(object : FrameLayout(this) {
            init { addView(browser, LayoutParams(-1, -1)) }
            override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
                browser.layout(0, 0, width, height)
                browser.measureAndLayout()
            }
        })
        browser.setActive(true)
    }

    override fun onDestroy() {
        browser.dispose()
        app.javaClass.declaredMethods.first { it.name.startsWith("onDestroy") }.apply { isAccessible = true }.invoke(app)
        super.onDestroy()
    }
}

// 用离线网页重现 Google Fonts 的站内地址更新与重复完成回调。
class FolioOnlineLoadingInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }

    override fun onStart() {
        val result = Bundle()
        var activity: FolioOnlineLoadingTestActivity? = null
        try {
            val page = startActivitySync(Intent(context, FolioOnlineLoadingTestActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as FolioOnlineLoadingTestActivity
            activity = page
            val browser = page.browser
            fun field(name: String): Any? = browser.javaClass.getDeclaredField(name).apply { isAccessible = true }.get(browser)
            val web = field("web") as WebView
            val html = AtomicReference("")
            runOnMainSync {
                val callbacks = web.webViewClient
                web.webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) =
                        WebResourceResponse("text/html", "UTF-8", ByteArrayInputStream(html.get().toByteArray()))
                    override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) =
                        callbacks.onPageStarted(view, url, favicon)
                    override fun onPageFinished(view: WebView, url: String?) = callbacks.onPageFinished(view, url)
                    override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) =
                        callbacks.doUpdateVisitedHistory(view, url, isReload)
                    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) =
                        callbacks.onReceivedError(view, request, error)
                }
            }
            fun <T> main(action: () -> T): T {
                val value = AtomicReference<T>()
                runOnMainSync { value.set(action()) }
                return value.get()
            }
            fun await(condition: () -> Boolean) {
                val deadline = SystemClock.uptimeMillis() + 10000
                while (SystemClock.uptimeMillis() < deadline) {
                    if (main(condition)) return
                    SystemClock.sleep(20)
                }
                error(main {
                    "网页状态未按预期完成：loaded=${field("pageLoaded")}, failed=${field("pageFailed")}, ready=${field("contentReady")}, pending=${field("pendingTheme")}, error=${field("loadError")}, url=${web.url}, size=${web.width}x${web.height}, attached=${web.isAttachedToWindow}"
                })
            }
            fun script(value: String): String {
                val latch = CountDownLatch(1)
                val output = AtomicReference<String>()
                runOnMainSync { web.evaluateJavascript(value) { output.set(it); latch.countDown() } }
                check(latch.await(3, TimeUnit.SECONDS))
                return output.get()
            }
            fun ready() = field("contentReady") == true && field("loading") == false && web.visibility == View.VISIBLE
            fun theme(color: String) = """(function(){var s=document.getElementById('folio-web-theme');if(!s){s=document.createElement('style');s.id='folio-web-theme';document.head.appendChild(s);}s.textContent='body{color:$color;}';return document.readyState==='complete'&&!!s.sheet;})();"""
            fun load(name: String) {
                html.set("<html><head></head><body data-page='$name'>Google Fonts</body></html>")
                web.loadUrl("https://fonts.google.com/$name")
            }
            main { browser.setWebTheme(theme("red")); load("first") }
            await(::ready)
            val revision = main { field("themeRevision") as Long }
            main {
                repeat(3) {
                    web.webViewClient.onPageFinished(web, web.url)
                    check(ready()) { "重复完成回调重新进入加载状态" }
                    check(field("themeRevision") == revision + 1) { "同一批完成回调重复提交样式" }
                }
            }
            await { field("pendingTheme") == null && ready() }
            script("history.replaceState({},'', '/?query=Inter');true;")
            await { web.url?.contains("query=Inter") == true }
            main {
                val poll = field("poll") as Runnable
                browser.removeCallbacks(poll)
                poll.run()
                browser.removeCallbacks(poll)
                check(ready()) { "站内地址更新重置加载状态" }
                browser.setWebTheme(theme("blue"))
                check(ready()) { "已就绪页面的主题更新触发加载遮罩" }
            }
            await { field("pendingTheme") == null && ready() }
            check(script("getComputedStyle(document.body).color") == "\"rgb(0, 0, 255)\"")
            val previousRevision = main { field("themeRevision") as Long }
            main { load("second") }
            await { (field("themeRevision") as Long) > previousRevision && web.url?.endsWith("/second") == true && ready() }
            check(script("document.body.dataset.page") == "\"second\"")
            check(script("getComputedStyle(document.body).color") == "\"rgb(0, 0, 255)\"") { "新文档没有重新注入样式" }
            val viewportRevision = main { field("themeRevision") as Long }
            main {
                html.set("""<!doctype html><html><head>
                    <meta name="viewport" content="width=device-width, initial-scale=0.85, maximum-scale=1">
                    <style>body{margin:0;min-width:350px}nav{display:flex;justify-content:space-between}</style>
                    </head><body><nav><span>ZSFT</span><button>菜单</button></nav></body></html>""")
                browser.setWebTheme("""(function(){var s=document.createElement('style');s.textContent='body{min-width:unset!important}';document.head.appendChild(s);return document.readyState==='complete'&&!!s.sheet;})();""")
                web.loadUrl("https://fonts.zeoseven.com/viewport")
            }
            await { (field("themeRevision") as Long) > viewportRevision + 1 && ready() }
            check(script("document.documentElement.scrollWidth <= visualViewport.width + 1") == "true") { "网页布局超出可见视口" }
            check(script("visualViewport.scale < 0.9") == "true") { "网页声明的初始缩放没有生效" }
            main { browser.setWebTheme("false;") }
            await { field("loadError") != null }
            check(main { !ready() && web.visibility == View.INVISIBLE }) { "注入失败展示了网页" }
            result.putString("stream", "PASS: 重复完成、站内地址更新、原位配色、新文档注入、移动视口缩放与失败隐藏\n")
            finish(Activity.RESULT_OK, result)
        } catch (error: Throwable) {
            result.putString("stream", "FAIL: ${error.stackTraceToString()}\n")
            finish(Activity.RESULT_CANCELED, result)
        } finally {
            activity?.let { page -> runOnMainSync { page.finish() } }
        }
    }
}
