// 沙箱 iframe 生成的 blob 只能在页面内读取；分块转存后再交给原生传输。
package com.folio.poc

import android.os.SystemClock
import android.util.Base64
import android.webkit.WebView
import org.json.JSONObject
import org.json.JSONTokener
import java.io.BufferedOutputStream
import java.io.File
import java.util.UUID

internal class FolioOnlineBlobs(private val web: WebView) {
    private val directory = File(web.context.cacheDir, "folio-online-blobs").apply { mkdirs() }
    private var active = false
    private var stage: File? = null
    private var output: BufferedOutputStream? = null
    private var callback: ((File?, String?, String?) -> Unit)? = null
    private var url = ""
    private var fallback = "download"
    private var blobName = ""
    private var startedAt = 0L

    // 安装页面内中继；沙箱 frame 创建 Blob 时把对象转交给主文档。
    fun install() {
        cleanupStale()
        web.evaluateJavascript(hook, null)
    }

    fun capture(url: String, fallbackName: String, complete: (File?, String?, String?) -> Unit) {
        if (active) {
            complete(null, null, "online.browser.invalidDownload")
            return
        }
        cleanupStale()
        active = true
        this.url = url
        fallback = fallbackName.ifBlank { "download" }
        callback = complete
        blobName = ""
        startedAt = SystemClock.uptimeMillis()
        val file = File(directory, UUID.randomUUID().toString())
        stage = file
        output = try {
            BufferedOutputStream(file.outputStream())
        } catch (_: Exception) {
            fail()
            return
        }
        web.evaluateJavascript(PREPARE.replace("__URL__", JSONObject.quote(url))) { poll() }
    }

    fun cancel() {
        active = false
        callback = null
        cleanupJs()
        runCatching { output?.close() }
        output = null
        stage?.delete()
        stage = null
    }

    private fun poll() {
        if (!active) return
        if (timedOut()) return fail()
        web.evaluateJavascript(POLL) { value ->
            when (val state = stringValue(value)) {
                "wait" -> web.postDelayed({ poll() }, 25)
                null, "missing", "error", "ready" -> fail()
                else -> {
                    val text = state ?: run { fail(); return@evaluateJavascript }
                    val total = text.removePrefix("ready:").toLongOrNull() ?: -1
                    if (!text.startsWith("ready:") || total <= 0 || total > LIMIT) {
                        fail()
                        return@evaluateJavascript
                    }
                    web.evaluateJavascript(META) { meta ->
                        if (!active) return@evaluateJavascript
                        blobName = runCatching {
                            JSONObject(stringValue(meta) ?: "{}").optString("name")
                        }.getOrDefault("")
                        readChunk()
                    }
                }
            }
        }
    }

    private fun readChunk() {
        if (!active) return
        if (timedOut()) return fail()
        web.evaluateJavascript(CHUNK) { value ->
            when (val chunk = stringValue(value)) {
                "wait" -> web.postDelayed({ readChunk() }, 10)
                "missing", "error", null -> fail()
                "end" -> finish()
                else -> try {
                    output?.write(Base64.decode(chunk, Base64.DEFAULT))
                    readChunk()
                } catch (_: Exception) {
                    fail()
                }
            }
        }
    }

    private fun finish() {
        val file = stage
        if (file == null) return fail()
        try {
            output?.flush()
            output?.close()
        } catch (_: Exception) {
            return fail()
        }
        output = null
        val name = safeName(blobName.ifBlank { fallback })
        val done = callback
        cleanupJs()
        reset()
        done?.invoke(file, name, null)
    }

    private fun fail() {
        if (!active) return
        val done = callback
        cleanupJs()
        runCatching { output?.close() }
        output = null
        stage?.delete()
        reset()
        done?.invoke(null, null, "online.browser.blobUnavailable")
    }

    private fun reset() {
        active = false
        callback = null
        stage = null
        url = ""
        blobName = ""
    }

    private fun cleanupJs() {
        if (url.isNotEmpty()) {
            runCatching {
                web.evaluateJavascript(CLEANUP.replace("__URL__", JSONObject.quote(url)), null)
            }
        }
    }

    private fun cleanupStale() {
        val deadline = System.currentTimeMillis() - STALE_MS
        directory.listFiles()?.forEach { file ->
            if (file != stage && file.lastModified() < deadline) file.delete()
        }
    }

    private fun timedOut() = SystemClock.uptimeMillis() - startedAt > TIMEOUT_MS

    private fun stringValue(value: String?): String? {
        if (value == null || value == "null") return null
        return runCatching { JSONTokener(value).nextValue() as? String }.getOrNull()
    }

    private fun safeName(value: String): String {
        val name = value.substringAfterLast('/').substringAfterLast('\\').trim()
        return (name.ifEmpty { fallback }).take(180)
    }

    companion object {
        private const val LIMIT = 512L * 1024 * 1024
        private const val TIMEOUT_MS = 5 * 60 * 1000L
        private const val STALE_MS = 24 * 60 * 60 * 1000L

        private const val CHILD = """<script>(function(){
  if (window.__folioBlobRelayFrame) return;
  window.__folioBlobRelayFrame = true;
  var create = URL.createObjectURL;
  URL.createObjectURL = function(value) {
    var url = create.call(URL, value);
    try { parent.postMessage({__folioBlobUrl:url, __folioBlobName:window.__folioBlobName||'', blob:value}, '*'); } catch (e) {}
    return url;
  };
  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function() {
    try {
      if (this.download) {
        window.__folioBlobName = this.download;
        parent.postMessage({__folioName:this.download, __folioNameUrl:this.href||''}, '*');
      }
    } catch (e) {}
    return click.apply(this, arguments);
  };
})();</script>"""

        private val hook = """(function(){
  if (window.__folioBlobRelay) return true;
  if (!window.__folioBlobRelayListener) {
    window.__folioBlobRelayListener = true;
    window.__folioBlobStore = window.__folioBlobStore || {};
    window.__folioBlobNames = window.__folioBlobNames || {};
    window.addEventListener('message', function(event) {
      var data = event.data;
      try {
        if (!data) return;
        if (data.__folioBlobUrl && data.blob instanceof Blob) {
          window.__folioBlobStore[data.__folioBlobUrl] = data.blob;
          if (data.__folioBlobName) window.__folioBlobNames[data.__folioBlobUrl] = String(data.__folioBlobName).slice(0, 180);
          var keys = Object.keys(window.__folioBlobStore);
          while (keys.length > 4) delete window.__folioBlobStore[keys.shift()];
        }
        if (data.__folioName && data.__folioNameUrl) {
          window.__folioBlobNames[data.__folioNameUrl] = String(data.__folioName).slice(0, 180);
        }
      } catch (e) {}
    }, false);
  }
  var inject = __FOLIO_CHILD__;
  function patch(value) {
    try {
      var text = String(value);
      if (text.indexOf('__folioBlobRelayFrame') >= 0) return value;
      var nonceMatch = /<script[^>]*\snonce="([^"]+)"/i.exec(text);
      var nonce = nonceMatch ? nonceMatch[1] : ((document.querySelector('script[nonce]') || {}).nonce || '');
      var script = inject.replace('<script>', '<script' + (nonce ? ' nonce="' + nonce + '"' : '') + '>');
      var result = text.replace(/(<body[^>]*>)/i, '${'$'}1' + script);
      if (result === text) result = text.replace(/^(<!doctype[^>]*>)?/i, '${'$'}1' + script);
      if (typeof value === 'string') return result;
      if (window.trustedTypes && window.trustedTypes.createPolicy) {
        var policy = window.__folioTrustedPolicy;
        if (!policy) policy = window.__folioTrustedPolicy = window.trustedTypes.createPolicy('folio-srcdoc', {createHTML: function(v){return v;}});
        return policy.createHTML(result);
      }
      return result;
    } catch (e) { return value; }
  }
  try {
    var descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
    if (descriptor && descriptor.set) {
      Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
        configurable: true, enumerable: descriptor.enumerable, get: descriptor.get,
        set: function(value) {
          var output = value;
          try { output = patch(value); } catch (e) {}
          try { return descriptor.set.call(this, output); }
          catch (e) { return descriptor.set.call(this, value); }
        }
      });
    }
  } catch (e) {}
  try {
    var setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
      if (this instanceof HTMLIFrameElement && String(name).toLowerCase() === 'srcdoc') {
        var output = value;
        try { output = patch(value); } catch (e) {}
        try { return setAttribute.call(this, name, output); }
        catch (e) { return setAttribute.call(this, name, value); }
      }
      return setAttribute.call(this, name, value);
    };
  } catch (e) {}
  window.__folioBlobRelay = true;
  return true;
})();""".replace("__FOLIO_CHILD__", JSONObject.quote(CHILD))

        private const val PREPARE = """(function(){
  var url = __URL__;
  var state = {blob:null, done:false, error:null, size:0, offset:0, busy:false, chunk:null, type:'', name:''};
  window.__folioBlobPull = state;
  var settled = false;
  function fail(e){ if (settled) return; settled = true; state.error = String((e && e.message) || e || 'error'); state.done = true; }
  function load(b){
    if (settled) return;
    settled = true;
    state.blob = b;
    state.size = b.size || 0;
    state.type = b.type || '';
    state.name = (window.__folioBlobNames || {})[url] || '';
    state.done = true;
  }
  function wait(attempt){
    if (settled) return;
    var blob = (window.__folioBlobStore || {})[url];
    if (blob) { load(blob); return; }
    if (attempt >= 100) { fail('missing'); return; }
    setTimeout(function(){ wait(attempt + 1); }, 20);
  }
  wait(0);
  if (typeof fetch === 'function') fetch(url).then(function(r){ return r.blob(); }).then(load).catch(function(){});
  return 'started';
})();"""

        private const val POLL = """(function(){
  var p = window.__folioBlobPull;
  if (!p) return 'missing';
  if (p.error) return 'error';
  if (!p.done) return 'wait';
  return 'ready:' + p.size;
})();"""

        private const val META = """(function(){
  var p = window.__folioBlobPull;
  return JSON.stringify({type:(p&&p.type)||'',name:(p&&p.name)||''});
})();"""

        private const val CHUNK = """(function(){
  var p = window.__folioBlobPull;
  if (!p) return 'missing';
  if (p.error) return 'error';
  if (!p.done) return 'wait';
  if (p.chunk !== null) { var value = p.chunk; p.chunk = null; return value; }
  if (p.offset >= p.size) return 'end';
  if (p.busy) return 'wait';
  p.busy = true;
  var end = Math.min(p.offset + 262144, p.size);
  var reader = new FileReader();
  reader.onload = function(){
    try {
      var bytes = new Uint8Array(reader.result);
      var text = '';
      for (var i = 0; i < bytes.length; i += 8192) text += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
      p.chunk = btoa(text);
      p.offset = end;
    } catch (e) { p.error = String(e); }
    p.busy = false;
  };
  reader.onerror = function(){ p.error = String(reader.error); p.busy = false; };
  reader.readAsArrayBuffer(p.blob.slice(p.offset, end));
  return 'wait';
})();"""

        private const val CLEANUP = """(function(){
  var p = window.__folioBlobPull;
  if (p) { delete p.blob; p.chunk = null; }
  delete window.__folioBlobPull;
  var store = window.__folioBlobStore;
  if (store) delete store[__URL__];
  var names = window.__folioBlobNames;
  if (names) delete names[__URL__];
  return true;
})();"""
    }
}
