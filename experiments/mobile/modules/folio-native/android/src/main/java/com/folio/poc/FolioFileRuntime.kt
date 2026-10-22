package com.folio.poc

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import com.folio.poc.ffi.FolioEngine
import com.folio.poc.ffi.FolioFileService
import com.folio.poc.ffi.FolioSync
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

// 引擎属于原生进程，Provider 和选择器不依赖 React 实例。
internal class FolioFileRuntime private constructor(val context: Context) {
    val root = File(context.filesDir, "FolioMobilePoC").apply { mkdirs() }
    val engine = FolioEngine.open(File(root, "folio.sqlite").absolutePath)
    val browser = com.folio.poc.ffi.FolioBrowser.open(File(root, "folio.sqlite").absolutePath, File(root, "transfers").absolutePath)
    val files = FolioFileService.open(File(root, "folio.sqlite").absolutePath, File(root, "fonts").absolutePath)
    val sync: FolioSync by lazy {
        FolioTls.initialize(context)
        FolioSync.open(File(root,"folio.sqlite").absolutePath,File(root,"fonts").absolutePath)
    }
    val executor = Executors.newSingleThreadExecutor()
    fun password(): String = sync.profile()?.let { FolioSyncCredentials(context).read(it) } ?: ""
    fun documents(parent: String): JSONArray = JSONArray(files.documents(parent))
    fun title(item: JSONObject): String = item.optString("titleKey").takeIf { it.isNotEmpty() && it != "null" }?.let { text(it) } ?: item.getString("name")
    fun text(key: String): String = localized(context,key)
    @Synchronized fun refreshReferences() {
        val sources=JSONArray(files.sources())
        for(index in 0 until sources.length()) {
            val source=sources.getJSONObject(index)
            try { snapshot(source); source.put("available",true) }
            catch (error: Exception) { source.put("available",false).put("unavailableReason",if(error is SecurityException)"permission"else if(error is java.io.IOException)"offline"else "unavailable") }
            files.saveSource(source.toString())
        }
    }
    fun reference(uri: Uri, name: String, tree: Boolean, replaceId: String? = null) {
        if (context.contentResolver.persistedUriPermissions.none { it.uri == uri && it.isReadPermission }) throw IllegalStateException("workflow.error.persistentPermission")
        val existing=JSONArray(files.sources())
        val locator=JSONObject().put("uri",uri.toString()).put("tree",tree).toString()
        val old=(0 until existing.length()).map {existing.getJSONObject(it)}.firstOrNull {it.getString("locator")==locator}
        val id=replaceId ?: old?.getString("id") ?: UUID.randomUUID().toString()
        val source=JSONObject().put("id",id).put("platform","android").put("locator",locator).put("displayName",name).put("snapshotPath",File(root,"ReferenceCache/$id").absolutePath).put("available",true)
        snapshot(source); files.saveSource(source.toString())
    }
    private fun snapshot(source: JSONObject) {
        val locator=JSONObject(source.getString("locator")); val uri=Uri.parse(locator.getString("uri"))
        if (context.contentResolver.persistedUriPermissions.none {it.uri==uri && it.isReadPermission}) throw SecurityException()
        val directory=File(source.getString("snapshotPath")).apply {mkdirs()}
        val candidates=mutableListOf<Pair<Uri,String>>()
        fun walk(parent:Uri,depth:Int) {
            check(depth<32 && candidates.size<10_000)
            val id=DocumentsContract.getDocumentId(parent)
            val children=DocumentsContract.buildChildDocumentsUriUsingTree(uri,id)
            context.contentResolver.query(children,arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE),null,null,null)?.use {cursor ->
                while(cursor.moveToNext()) {
                    val child=DocumentsContract.buildDocumentUriUsingTree(uri,cursor.getString(0));val name=cursor.getString(1)
                    if(cursor.getString(2)==DocumentsContract.Document.MIME_TYPE_DIR) walk(child,depth+1)
                    else if(name.substringAfterLast('.').lowercase() in listOf("ttf","otf","ttc","otc","font","woff","woff2")) candidates.add(child to name)
                }
            } ?: throw java.io.FileNotFoundException()
        }
        if(locator.getBoolean("tree")) walk(DocumentsContract.buildDocumentUriUsingTree(uri,DocumentsContract.getTreeDocumentId(uri)),0)
        else candidates.add(uri to source.getString("displayName"))
        val retained=mutableSetOf<String>()
        val origins=JSONObject()
        for((document,name) in candidates) {
            val key=MessageDigest.getInstance("SHA-256").digest(document.toString().toByteArray()).joinToString(""){"%02x".format(it)}
            val target=File(directory,key).apply {mkdirs()}
            val output=File(target,name.substringAfterLast('/').substringAfterLast('\\'))
            val staging=File(directory,".${UUID.randomUUID()}.part")
            try {
                context.contentResolver.openInputStream(document)?.use {input -> staging.outputStream().use {out -> val buffer=ByteArray(65536);var total=0L;while(true){val count=input.read(buffer);if(count<0)break;total+=count;check(total<=256L*1024*1024);out.write(buffer,0,count)} }} ?: throw java.io.FileNotFoundException()
                try {engine.analyzeFontFile(staging.absolutePath)} catch(error:Exception) {if(!locator.getBoolean("tree"))throw error}
                check(staging.renameTo(output));retained.add(output.relativeTo(directory).path)
                origins.put(output.relativeTo(directory).path,document.toString())
            } finally {staging.delete()}
        }
        directory.walkTopDown().filter {it.isFile && it.relativeTo(directory).path !in retained}.forEach {it.delete()}
        File(directory,".origins.json").writeText(origins.toString())
    }
    fun previewFont(path:String):File {
        val file=File(path).canonicalFile
        val transfers=File(root,"transfers").canonicalFile
        if(file.path.startsWith(transfers.path+File.separator)) {
            val parts=file.relativeTo(transfers).path.split(File.separatorChar)
            val jobs=JSONObject(browser.state()).getJSONArray("jobs")
            check((0 until jobs.length()).any {jobs.getJSONObject(it).let {job->job.getString("id")==parts[0] && job.getString("state")=="ready"}})
            check(file.isFile && file.canRead())
            return file
        }
        return readableFont(path)
    }
    fun readableFont(path:String):File {
        val file=File(path).canonicalFile
        val managed=File(root,"fonts").canonicalFile
        if(file.path.startsWith(managed.path+File.separator) && file.canRead())return file
        val sources=JSONArray(files.sources())
        val source=(0 until sources.length()).map {sources.getJSONObject(it)}.firstOrNull {
            file.path.startsWith(File(it.getString("snapshotPath")).canonicalPath+File.separator)
        } ?: throw java.io.FileNotFoundException()
        try {
            check(source.getBoolean("available"))
            val locator=JSONObject(source.getString("locator"));val uri=Uri.parse(locator.getString("uri"))
            if(context.contentResolver.persistedUriPermissions.none {it.uri==uri && it.isReadPermission})throw SecurityException()
            val directory=File(source.getString("snapshotPath"))
            val origins=JSONObject(File(directory,".origins.json").readText())
            val original=Uri.parse(origins.getString(file.relativeTo(directory).path))
            context.contentResolver.openAssetFileDescriptor(original,"r")?.use {} ?: throw java.io.FileNotFoundException()
            check(file.canRead())
            return file
        }catch(error:Exception){source.put("available",false);files.saveSource(source.toString());throw error}
    }
    fun notifyChanges() {
        executor.execute {
            try {
                val authority="${context.packageName}.documents"
                context.contentResolver.notifyChange(DocumentsContract.buildRootsUri(authority),null)
                val parents=mutableListOf("root","local","favorites","collections","cloud")
                val collections=documents("collections")
                for(index in 0 until collections.length())parents.add(collections.getJSONObject(index).getString("id"))
                for(parent in parents)context.contentResolver.notifyChange(DocumentsContract.buildChildDocumentsUri(authority,parent),null)
            }catch(_:Exception){}
        }
    }
    fun inbox():JSONArray {
        val directory=File(root,"Inbox").apply {mkdirs()}
        return JSONArray(directory.listFiles()?.filter {it.isDirectory}?.mapNotNull {entry->try {JSONObject(File(entry,"manifest.json").readText()).put("id",entry.name)}catch(_:Exception){null}} ?: emptyList<JSONObject>())
    }
    fun launch(activity:Activity,request:String,complete:(String?,Exception?)->Unit) {
        val id=UUID.randomUUID().toString();callbacks[id]=complete
        activity.startActivity(Intent(activity,FolioFileActivity::class.java).putExtra("request",request).putExtra("callback",id))
    }
    companion object {
        @Volatile private var shared:FolioFileRuntime?=null
        val callbacks=ConcurrentHashMap<String,(String?,Exception?)->Unit>()
        val activeFiles=ConcurrentHashMap<String,java.lang.ref.WeakReference<FolioFileActivity>>()
        fun get(context:Context):FolioFileRuntime=shared ?: synchronized(this){shared ?: FolioFileRuntime(context.applicationContext).also {shared=it}}
        fun localized(context:Context,key:String):String {
            val language=if(context.resources.configuration.locales[0].language=="zh")"zh-CN" else "en"
            return try {var value:Any=JSONObject((try {context.assets.open("folio-locales/$language.json")}catch(_:java.io.IOException){context.assets.open("$language.json")}).bufferedReader().use {it.readText()});for(part in key.split('.'))value=(value as JSONObject).get(part);value as String}catch(_:Exception){context.applicationInfo.loadLabel(context.packageManager).toString()}
        }
    }
}
