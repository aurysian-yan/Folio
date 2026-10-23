// 在线内容使用独立原生 WebView，不向网页暴露应用桥接。
package com.folio.poc

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.*
import android.widget.FrameLayout
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject

class FolioOnlineView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val onBrowserState by EventDispatcher()
    private val onDownloadIntent by EventDispatcher()
    private val web = WebView(context)
    private val refresh = SwipeRefreshLayout(context)
    private var commandId = ""
    private var provider = JSONObject()
    private var sourcePage = ""
    private var disposed = false
    private var webTheme = ""
    private var lastState = ""
    private var lastThemeUrl = ""
    private var active = false
    private var loading = false
    private val poll = object : Runnable {
        override fun run() {
            if (!active || disposed) return
            val url = web.url ?: ""
            if (url != lastThemeUrl) { lastThemeUrl = url; applyWebTheme() }
            emit(loading)
            postDelayed(this, 500)
        }
    }

    init {
        refresh.addView(web, FrameLayout.LayoutParams(-1, -1))
        addView(refresh, FrameLayout.LayoutParams(-1, -1))
        refresh.setOnRefreshListener { web.reload() }
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = false
            safeBrowsingEnabled = true
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = navigate(request.url)
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                loading = true; updateSource(url); emit(true, force = true)
            }
            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                updateSource(url); emit(loading)
            }
            override fun onPageFinished(view: WebView, url: String?) {
                loading = false
                refresh.isRefreshing = false
                lastThemeUrl = url ?: ""
                applyWebTheme()
                updateSource(url); emit(false, force = true)
                val providerId = provider.optString("id")
                if (url == null || providerId.isEmpty()) return
                web.evaluateJavascript(FolioOnlineIcons.discoveryScript) { value ->
                    if (value.length > 32768) return@evaluateJavascript
                    val candidates = try {
                        val items = org.json.JSONArray(value)
                        (0 until minOf(4, items.length())).map { items.getString(it) }
                    } catch (_: Exception) { emptyList() }
                    FolioOnlineIcons.capture(context, providerId, url, candidates)
                }
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) { loading = false; refresh.isRefreshing = false; emit(false, "online.browser.loadError") }
            }
            override fun onReceivedSslError(view: WebView, handler: android.webkit.SslErrorHandler, error: android.net.http.SslError) {
                handler.cancel(); loading = false; refresh.isRefreshing = false; emit(false, "online.browser.loadError")
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
            override fun onCreateWindow(view: WebView, dialog: Boolean, userGesture: Boolean, resultMsg: android.os.Message): Boolean {
                if (!userGesture) return false
                val popup = WebView(context)
                popup.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        val url = request.url
                        if (!navigate(url)) web.loadUrl(url.toString())
                        popup.destroy()
                        return true
                    }
                }
                (resultMsg.obj as WebView.WebViewTransport).webView = popup
                resultMsg.sendToTarget()
                return true
            }
        }
        web.setDownloadListener { url, agent, disposition, mime, _ ->
            try {
                FolioFileRuntime.get(context).browser.validateAddress(url)
                val name = URLUtil.guessFileName(url, disposition, mime)
                val origin = JSONObject().put("providerId", provider.optString("id").ifEmpty { null })
                    .put("providerName", provider.optString("name"))
                    .put("sourcePageUrl", sourcePage.ifEmpty { web.url ?: url }).put("downloadHost", Uri.parse(url).host ?: "")
                val headers = JSONObject().put("User-Agent", agent)
                CookieManager.getInstance().getCookie(url)?.let { headers.put("Cookie", it) }
                web.url?.let { headers.put("Referer", it) }
                val id = FolioOnlineTransfers.intent(context, url, name, origin, headers)
                onDownloadIntent(mapOf("id" to id, "name" to name))
            } catch (_: Exception) { emit(false, "online.browser.invalidDownload") }
        }
    }

    fun setProvider(value: String) { provider = JSONObject(value) }
    fun setWebTheme(value: String) { webTheme = value; applyWebTheme() }
    fun setAccentColor(value: String) {
        try { refresh.setColorSchemeColors(android.graphics.Color.parseColor(value)) } catch (_: Exception) {}
    }
    private fun applyWebTheme() {
        if (webTheme.isEmpty()) return
        web.evaluateJavascript(webTheme) { }
    }
    fun command(value: String) {
        if (disposed) return
        val request = JSONObject(value)
        val id = request.optString("id")
        if (id == commandId) return
        commandId = id
        when (request.optString("action")) {
            "navigate" -> {
                try {
                    val url = FolioFileRuntime.get(context).browser.validateAddress(request.getString("url"))
                    sourcePage = ""; web.loadUrl(url)
                } catch (_: Exception) { emit(false, "online.browser.invalidSource") }
            }
            "back" -> if (web.canGoBack()) web.goBack()
            "forward" -> if (web.canGoForward()) web.goForward()
            "reload" -> web.reload()
            "stop" -> web.stopLoading()
            "clear" -> { web.stopLoading(); web.clearHistory(); web.clearCache(true); WebStorage.getInstance().deleteAllData(); CookieManager.getInstance().removeAllCookies(null); web.loadUrl("about:blank") }
        }
    }
    private fun navigate(uri: Uri): Boolean {
        if (uri.scheme == "https") {
            return try { FolioFileRuntime.get(context).browser.validateAddress(uri.toString()); false }
            catch (_: Exception) { emit(false,"online.browser.invalidSource"); true }
        }
        if (uri.scheme in setOf("baiduyun", "bdpan", "aliyundrive", "alipan", "quark")) {
            try { context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            catch (_: Exception) { emit(false,"online.browser.clientMissing") }
        } else emit(false,"online.browser.unsupportedLink")
        return true
    }
    private fun updateSource(value: String?) {
        val host = Uri.parse(value ?: "").host ?: return
        val home = Uri.parse(provider.optString("homepage")).host ?: return
        if (host == home || host.endsWith(".$home")) sourcePage = value ?: sourcePage
    }
    private fun emit(loading: Boolean, error: String? = null, force: Boolean = false) {
        val url = web.url ?: ""
        val title = web.title ?: ""
        val signature = "$url|$title|$loading|${web.canGoBack()}|${web.canGoForward()}"
        if (!force && error == null && signature == lastState) return
        lastState = signature
        onBrowserState(mapOf("url" to url, "title" to title, "loading" to loading,
            "canGoBack" to web.canGoBack(), "canGoForward" to web.canGoForward(), "errorKey" to (error ?: "")))
    }
    fun setActive(active: Boolean) {
        this.active = active
        web.visibility = if (active) android.view.View.VISIBLE else android.view.View.INVISIBLE
        removeCallbacks(poll)
        if (active) { web.onResume(); post(poll) } else web.onPause()
    }
    fun dispose() {
        if (!disposed) {
            disposed = true; active = false; removeCallbacks(poll)
            web.stopLoading(); web.webChromeClient = null; web.webViewClient = WebViewClient()
            refresh.removeView(web); removeView(refresh); web.destroy()
        }
    }
}
