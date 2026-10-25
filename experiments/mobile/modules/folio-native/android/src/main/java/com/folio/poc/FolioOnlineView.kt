// 在线内容使用独立原生 WebView，不向网页暴露应用桥接。
package com.folio.poc

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.content.Intent
import android.graphics.RenderEffect
import android.graphics.Shader
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.View
import android.view.MotionEvent
import android.view.animation.PathInterpolator
import android.webkit.*
import android.widget.FrameLayout
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject

class FolioOnlineView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val onBrowserState by EventDispatcher()
    private val onVisit by EventDispatcher()
    private val onPageScroll by EventDispatcher()
    private val onDownloadIntent by EventDispatcher()
    private val web = WebView(context)
    private val blobs = FolioOnlineBlobs(web)
    private val refresh = SwipeRefreshLayout(context)
    private var commandId = ""
    private var provider = JSONObject()
    private var sourcePage = ""
    private var visitSequence = 0L
    private var visitedSequence = -1L
    private var visitedUrl = ""
    private var historyReload = false
    private var historyHttpError = false
    private var userScrolling = false
    private var userTouching = false
    private var scrollViewportHeight = 0
    private val finishUserScroll = Runnable { userScrolling = false }
    private var disposed = false
    private var webTheme = ""
    private var pendingTheme: String? = null
    private var lastState = ""
    private var lastThemeUrl = ""
    private var active = false
    private var loading = true
    private var pageLoaded = false
    private var pageFailed = false
    private var contentReady = false
    private var themeRevision = 0L
    private var loadError: String? = null
    private var pendingReveal = false
    private var revealAnimator: ValueAnimator? = null
    private var alphaAnimator: android.view.ViewPropertyAnimator? = null
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
        web.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    userTouching = true; userScrolling = true
                    scrollViewportHeight = web.height; removeCallbacks(finishUserScroll)
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    userTouching = false; postDelayed(finishUserScroll, 200)
                }
            }
            false
        }
        web.setOnScrollChangeListener { _, _, y, _, _ ->
            if (active && !loading && userScrolling) {
                val resized = scrollViewportHeight != web.height
                scrollViewportHeight = web.height
                onPageScroll(mapOf("offset" to y / resources.displayMetrics.density, "reset" to resized))
                if (!userTouching) { removeCallbacks(finishUserScroll); postDelayed(finishUserScroll, 200) }
            }
        }
        web.visibility = android.view.View.INVISIBLE
        refresh.setOnRefreshListener { pendingReveal = false; beginLoading(); web.reload() }
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            useWideViewPort = true
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
                visitSequence++; historyReload = false; historyHttpError = false
                beginLoading(); updateSource(url)
            }
            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                if (isReload) historyReload = true
                updateSource(url); emit(loading)
                if (pageLoaded && !pageFailed && !isReload && url != visitedUrl) emitVisit(true)
            }
            override fun onPageCommitVisible(view: WebView, url: String?) {
                blobs.install()
            }
            override fun onPageFinished(view: WebView, url: String?) {
                if (pageFailed || url != web.url) return
                pageLoaded = true
                emitVisit()
                lastThemeUrl = url ?: ""
                blobs.install()
                applyWebTheme()
                updateSource(url)
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
                if (!request.isForMainFrame) return
                pageFailed = true
                failLoading(loadErrorKey(error.errorCode))
            }
            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (request.isForMainFrame) historyHttpError = response.statusCode >= 400
                if (!request.isForMainFrame || response.statusCode < 500) return
                pageFailed = true
                failLoading("online.browser.serverError")
            }
            override fun onReceivedSslError(view: WebView, handler: android.webkit.SslErrorHandler, error: android.net.http.SslError) {
                handler.cancel(); pageFailed = true; failLoading("online.browser.secureConnection")
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
            if (!contentReady) {
                pageLoaded = true
                emitVisit()
                lastThemeUrl = web.url ?: ""
                applyWebTheme()
            }
            if (url.startsWith("blob:")) {
                // 沙箱 frame 的 blob 不能重放，先在页面内分块转存。
                val fallback = URLUtil.guessFileName(url, disposition, mime)?.takeIf { it.isNotBlank() } ?: "download"
                blobs.capture(url, fallback) { file, name, error ->
                    if (file == null || error != null) {
                        emit(false, error ?: "online.browser.blobUnavailable")
                        return@capture
                    }
                    try {
                        val headers = JSONObject().put("User-Agent", agent)
                        web.url?.let { headers.put("Referer", it) }
                        val id = FolioOnlineTransfers.intent(
                            context, "", name ?: fallback, origin(url), headers, file.absolutePath
                        )
                        onDownloadIntent(mapOf("id" to id, "name" to (name ?: fallback)))
                    } catch (_: Exception) {
                        file.delete()
                        emit(false, "online.browser.invalidDownload")
                    }
                }
                return@setDownloadListener
            }
            try {
                FolioFileRuntime.get(context).browser.validateAddress(url)
                val name = URLUtil.guessFileName(url, disposition, mime)
                val headers = JSONObject().put("User-Agent", agent)
                CookieManager.getInstance().getCookie(url)?.let { headers.put("Cookie", it) }
                web.url?.let { headers.put("Referer", it) }
                val id = FolioOnlineTransfers.intent(context, url, name, origin(url), headers)
                onDownloadIntent(mapOf("id" to id, "name" to name))
            } catch (_: Exception) { emit(false, "online.browser.invalidDownload") }
        }
    }

    fun setProvider(value: String) { provider = JSONObject(value) }
    fun setWebTheme(value: String) {
        if (webTheme == value) return
        webTheme = value
        applyWebTheme()
    }
    fun setAccentColor(value: String) {
        try { refresh.setColorSchemeColors(android.graphics.Color.parseColor(value)) } catch (_: Exception) {}
    }
    private fun applyWebTheme() {
        if (disposed || !pageLoaded || pageFailed || webTheme.isEmpty() || web.url == null) return
        val script = webTheme
        if (pendingTheme == script) return
        val revision = ++themeRevision
        pendingTheme = script
        loadError = null
        // 同一文档的地址和主题更新不重置已经就绪的页面。
        if (!contentReady) {
            loading = true
            updateVisibility()
            emit(true)
        }
        web.evaluateJavascript(script) { value ->
            if (disposed || revision != themeRevision || !pageLoaded || pageFailed) return@evaluateJavascript
            if (value != "true") { failLoading(); return@evaluateJavascript }
            // 样式进入下一帧绘制后才展示网页，避免未适配内容闪现。
            web.postVisualStateCallback(revision, object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) {
                    if (disposed || revision != themeRevision || !pageLoaded || pageFailed) return
                    pendingTheme = null
                    val wasReady = contentReady
                    contentReady = true
                    loading = false
                    refresh.isRefreshing = false
                    if (!wasReady) {
                        showContent(pendingReveal)
                        pendingReveal = false
                    }
                    emit(false)
                }
            })
        }
    }
    private fun beginLoading() {
        themeRevision++
        pendingTheme = null
        loadError = null
        pageLoaded = false
        pageFailed = false
        contentReady = false
        loading = true
        updateVisibility()
        emit(true, force = true)
    }
    private fun failLoading(error: String? = "online.browser.loadError") {
        themeRevision++
        pendingTheme = null
        pendingReveal = false
        loadError = error
        contentReady = false
        loading = false
        refresh.isRefreshing = false
        updateVisibility()
        emit(false)
    }
    private fun updateVisibility() {
        alphaAnimator?.cancel(); alphaAnimator = null
        revealAnimator?.cancel(); revealAnimator = null
        clearBlur()
        web.alpha = 1f
        web.visibility = if (active && contentReady) View.VISIBLE else View.INVISIBLE
    }
    // 只有来源切换播放模糊与透明度过渡；站内跳转和刷新直接显示网页。
    private fun showContent(reveal: Boolean) {
        updateVisibility()
        if (!active || !contentReady) return
        if (!reveal || reduceMotion()) return
        val duration = 620L
        web.alpha = 0f
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) startBlur(duration)
        val animation = web.animate().alpha(1f).setDuration(duration)
            .setInterpolator(PathInterpolator(0.22f, 1f, 0.36f, 1f))
            .withEndAction { clearBlur(); alphaAnimator = null }
        alphaAnimator = animation
        animation.start()
    }
    private fun reduceMotion(): Boolean = try {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    } catch (_: Exception) {
        false
    }
    private fun startBlur(duration: Long) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        val radius = 12f * resources.displayMetrics.density
        val animator = ValueAnimator.ofFloat(radius, 0f)
        animator.duration = duration
        animator.interpolator = PathInterpolator(0.22f, 1f, 0.36f, 1f)
        animator.addUpdateListener { value ->
            val radius = value.animatedValue as Float
            web.setRenderEffect(
                if (radius < 0.5f) null
                else RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP)
            )
        }
        animator.addListener(object : AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: Animator) { clearBlur() }
        })
        animator.start()
        revealAnimator = animator
    }
    private fun clearBlur() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) web.setRenderEffect(null)
    }
    private fun loadErrorKey(code: Int): String = when (code) {
        WebViewClient.ERROR_HOST_LOOKUP, WebViewClient.ERROR_CONNECT,
        WebViewClient.ERROR_TIMEOUT, WebViewClient.ERROR_IO ->
            if (offline()) "online.browser.offline" else "online.browser.unreachable"
        WebViewClient.ERROR_FAILED_SSL_HANDSHAKE -> "online.browser.secureConnection"
        else -> if (offline()) "online.browser.offline" else "online.browser.loadError"
    }
    private fun offline(): Boolean = try {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        manager?.activeNetwork == null
    } catch (_: Exception) {
        false
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
                    sourcePage = ""; beginLoading()
                    pendingReveal = request.optBoolean("reveal", false)
                    web.loadUrl(url)
                } catch (_: Exception) {
                    if (!contentReady) loading = false
                    pendingReveal = false
                    emit(loading, "online.browser.invalidSource")
                }
            }
            "back" -> if (web.canGoBack()) { pendingReveal = false; beginLoading(); web.goBack() }
            "forward" -> if (web.canGoForward()) { pendingReveal = false; beginLoading(); web.goForward() }
            "reload" -> { pendingReveal = false; beginLoading(); web.reload() }
            "stop" -> { pendingReveal = false; web.stopLoading(); pageFailed = true; failLoading(null) }
            "clear" -> { pendingReveal = false; web.stopLoading(); web.clearHistory(); web.clearCache(true); WebStorage.getInstance().deleteAllData(); CookieManager.getInstance().removeAllCookies(null); beginLoading(); web.loadUrl("about:blank") }
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
    private fun origin(url: String): JSONObject {
        val page = sourcePage.ifEmpty { web.url ?: url }
        val host = if (url.startsWith("blob:")) Uri.parse(page).host else Uri.parse(url).host
        return JSONObject().put("providerId", provider.optString("id").ifEmpty { null })
            .put("providerName", provider.optString("name").ifEmpty { Uri.parse(page).host ?: "" })
            .put("sourcePageUrl", page).put("downloadHost", host ?: "")
    }
    // 访问事件仅在主页面成功完成或同页地址变化后发送。
    private fun emitVisit(sameDocument: Boolean = false) {
        val url = web.url ?: return
        if (historyHttpError || pageFailed || !url.startsWith("https://")) return
        if (!sameDocument && visitedSequence == visitSequence) return
        visitedSequence = visitSequence
        visitedUrl = url
        onVisit(mapOf("visitedAt" to System.currentTimeMillis(), "id" to visitSequence.toString(), "url" to url, "title" to (web.title ?: ""),
            "reload" to (historyReload && !sameDocument), "sameDocument" to sameDocument))
        historyReload = false
    }
    private fun emit(loading: Boolean, error: String? = null, force: Boolean = false) {
        val url = web.url ?: ""
        val title = web.title ?: ""
        val errorKey = error ?: loadError
        val signature = "$url|$title|$loading|${web.canGoBack()}|${web.canGoForward()}|$errorKey"
        if (!force && error == null && signature == lastState) return
        lastState = signature
        onBrowserState(mapOf("url" to url, "title" to title, "loading" to loading,
            "canGoBack" to web.canGoBack(), "canGoForward" to web.canGoForward(), "errorKey" to (errorKey ?: "")))
    }
    fun setActive(active: Boolean) {
        this.active = active
        if (!active) { userScrolling = false; userTouching = false; removeCallbacks(finishUserScroll) }
        updateVisibility()
        removeCallbacks(poll)
        if (active) { web.onResume(); post(poll) } else web.onPause()
    }
    fun dispose() {
        if (!disposed) {
            disposed = true; active = false; removeCallbacks(finishUserScroll); removeCallbacks(poll); blobs.cancel()
            alphaAnimator?.cancel(); alphaAnimator = null
            revealAnimator?.cancel(); revealAnimator = null
            clearBlur()
            web.stopLoading(); web.webChromeClient = null; web.webViewClient = WebViewClient()
            refresh.removeView(web); removeView(refresh); web.destroy()
        }
    }
}
