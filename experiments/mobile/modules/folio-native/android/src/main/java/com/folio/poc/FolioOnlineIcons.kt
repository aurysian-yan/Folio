// 图标处理独立于页面生命周期，原始文件只作短暂的受限中转。
package com.folio.poc

import android.content.Context
import android.net.Uri
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

internal object FolioOnlineIcons {
    private const val limit = 8L * 1024 * 1024
    private val executor = Executors.newFixedThreadPool(2)
    const val discoveryScript = """(() => Array.from(document.querySelectorAll('link[rel]')).filter(el => /(^|\s)(icon|apple-touch-icon)(\s|$)/i.test(el.rel)).filter(el => !el.media || matchMedia(el.media).matches).map(el => el.href).filter(value => value.startsWith('https://')).slice(0, 4))()"""

    fun capture(context: Context, providerId: String, pageUrl: String, candidates: List<String>) {
        executor.execute {
            try {
                FolioTls.initialize(context)
                FolioFileRuntime.get(context).browser.refreshIcon(providerId, pageUrl, candidates.take(4))
            } catch (_: Exception) { }
        }
    }

    fun importFile(context: Context, uri: String): String {
        val temporary = File(context.cacheDir, "folio-icon-${UUID.randomUUID()}")
        try {
            context.contentResolver.openInputStream(Uri.parse(uri)).use { input ->
                check(input != null) { "online.browser.invalidIcon" }
                temporary.outputStream().use { output ->
                    val buffer = ByteArray(65536)
                    var total = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        check(total <= limit) { "online.browser.invalidIcon" }
                        output.write(buffer, 0, count)
                    }
                }
            }
            return FolioFileRuntime.get(context).browser.importIcon(temporary.absolutePath)
        } finally { temporary.delete() }
    }
}
