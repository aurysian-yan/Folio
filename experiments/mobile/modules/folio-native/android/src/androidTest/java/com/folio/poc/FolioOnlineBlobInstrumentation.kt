package com.folio.poc

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class FolioBlobTestActivity : Activity() {
    lateinit var web: WebView
    internal lateinit var blobs: FolioOnlineBlobs
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        web = WebView(this)
        blobs = FolioOnlineBlobs(web)
        web.settings.javaScriptEnabled = true
        web.webViewClient = WebViewClient()
        setContentView(web, ViewGroup.LayoutParams(-1, -1))
    }
    override fun onDestroy() {
        blobs.cancel()
        web.destroy()
        super.onDestroy()
    }
}

// 验证沙箱 srcdoc 中的 Blob 能转交主文档并完整写入缓存。
class FolioOnlineBlobInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }

    override fun onStart() {
        val result = Bundle()
        var activity: FolioBlobTestActivity? = null
        try {
            val page = startActivitySync(Intent(context, FolioBlobTestActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as FolioBlobTestActivity
            activity = page
            val web = page.web
            val blobs = page.blobs
            val loaded = CountDownLatch(1)
            val received = CountDownLatch(1)
            val output = AtomicReference<File?>()
            val name = AtomicReference<String?>()
            val error = AtomicReference<String?>()
            runOnMainSync {
                web.webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView, url: String?) {
                        blobs.install()
                        loaded.countDown()
                    }
                }
                web.setDownloadListener { url, _, _, _, _ ->
                    check(url.startsWith("blob:")) { "非 blob 下载：$url" }
                    blobs.capture(url, "sample.zip") { file, value, failure ->
                        output.set(file)
                        name.set(value)
                        error.set(failure)
                        received.countDown()
                    }
                }
                web.loadDataWithBaseURL(
                    "https://fonts.google.com/",
                    "<!doctype html><html><head></head><body>blob</body></html>",
                    "text/html", "UTF-8", null
                )
            }
            check(loaded.await(10, TimeUnit.SECONDS)) { "测试页面未完成加载" }
            // 页面加载后由主文档创建一个沙箱 srcdoc，再从其中生成并下载 Blob。
            val script = """(function(){
              var frame = document.createElement('iframe');
              frame.setAttribute('sandbox', 'allow-scripts allow-downloads');
              frame.srcdoc = '<!doctype html><body><script>' +
                'var bytes = new Uint8Array(700000); for (var i = 0; i < bytes.length; i++) bytes[i] = i % 251;' +
                'var url = URL.createObjectURL(new Blob([bytes], {type: "application/zip"}));' +
                'var a = document.createElement("a"); a.href = url; a.download = "sample.zip"; a.click();' +
                '</' + 'script></body>';
              document.body.appendChild(frame);
              return 'started';
            })();"""
            val evaluated = AtomicReference<String?>()
            val evaluatedLatch = CountDownLatch(1)
            runOnMainSync {
                web.evaluateJavascript(script) { evaluated.set(it); evaluatedLatch.countDown() }
            }
            check(evaluatedLatch.await(5, TimeUnit.SECONDS) && evaluated.get()?.contains("started") == true) {
                "无法创建沙箱页面：${evaluated.get()}"
            }
            check(received.await(20, TimeUnit.SECONDS)) { "没有收到 blob 下载" }
            val file = output.get()
            check(error.get() == null) { "读取 Blob 失败：${error.get()}" }
            check(file != null && file.isFile) { "没有生成临时文件" }
            check(name.get() == "sample.zip") { "文件名错误：${name.get()}" }
            val bytes = file!!.readBytes()
            check(bytes.size == 700000) { "Blob 大小错误：${bytes.size}" }
            check((0 until 700000).all { bytes[it] == (it % 251).toByte() }) { "Blob 内容错误" }
            file.delete()

            // 本地任务沿用同一套传输校验；使用真实字体样本而不是上面的测试字节。
            val runtime = FolioFileRuntime.get(context)
            runtime.browser.acceptDisclaimer()
            val staged = File(context.cacheDir, "folio-local-${System.nanoTime()}.ttf")
            context.assets.open("Lato-Regular.ttf").use { input ->
                staged.outputStream().use { output -> input.copyTo(output) }
            }
            val origin = org.json.JSONObject().put("providerId", "google-fonts")
                .put("providerName", "Google Fonts")
                .put("sourcePageUrl", "https://fonts.google.com/selection")
                .put("downloadHost", "fonts.google.com")
            val intentId = FolioOnlineTransfers.intent(
                context, "", "Roboto.zip", origin, org.json.JSONObject(), staged.absolutePath
            )
            val jobId = FolioOnlineTransfers.start(context, intentId)
            val state = runtime.browser.state()
            check(state.contains("\"name\":\"Roboto.ttf\"")) { "本地任务名称错误：$state" }
            check(state.contains("\"state\":\"ready\"")) { "本地任务未完成：$state" }
            runtime.browser.cancelDownload(jobId)
            result.putString("stream", "PASS: 沙箱 Blob 转存与本地任务交接\n")
            finish(Activity.RESULT_OK, result)
        } catch (failure: Throwable) {
            result.putString("stream", "FAIL: ${failure.stackTraceToString()}\n")
            finish(Activity.RESULT_CANCELED, result)
        } finally {
            activity?.let { page -> runOnMainSync { page.finish() } }
        }
    }
}
