// 下载后的字体沿用原生导入器，压缩包先分析再选择。
package com.folio.poc

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

internal object FolioOnlineFiles {
    fun job(context:Context,id:String):JSONObject {
        val jobs=JSONObject(FolioFileRuntime.get(context).browser.state()).getJSONArray("jobs")
        return (0 until jobs.length()).map { jobs.getJSONObject(it) }.firstOrNull {it.getString("id")==id}
            ?: error("online.browser.invalidDownload")
    }
    private fun entries(context:Context,id:String):List<JSONObject> {
        val runtime=FolioFileRuntime.get(context)
        val job=job(context,id)
        check(job.getString("state")=="ready") {"online.browser.invalidDownload"}
        if(job.optString("kind")=="font")return listOf(JSONObject().put("id","font").put("name",job.getString("name")).put("path",runtime.browser.downloadPath(id)).put("size",job.getLong("bytesDone")))
        val array=JSONArray(runtime.browser.archiveEntries(id))
        return (0 until array.length()).map {array.getJSONObject(it)}
    }
    fun inspect(context:Context,id:String):String {
        val engine=FolioFileRuntime.get(context).engine
        return JSONArray(entries(context,id).map {entry->
            val result=JSONObject().put("id",entry.getString("id")).put("name",entry.getString("name")).put("size",entry.getLong("size"))
            try {
                val analysis=JSONObject(engine.analyzeFontFile(entry.getString("path")))
                val faces=analysis.getJSONArray("faces")
                val duplicate=faces.length()>0 && (0 until faces.length()).all {faces.getJSONObject(it).getBoolean("duplicate")}
                result.put("previewPath",entry.getString("path")).put("analysis",analysis).put("eligible",faces.length()>0).put("duplicate",duplicate)
            }catch (_:Exception){result.put("eligible",false).put("duplicate",false)}
            result
        }).toString()
    }
    fun collect(context:Context,id:String,selection:List<String>):Map<String,Any> {
        val runtime=FolioFileRuntime.get(context)
        check(!runtime.sync.status().isRunning) {"workflow.error.busy"}
        val selected=entries(context,id).filter {it.getString("id") in selection.toSet()}
        check(selected.isNotEmpty() && selected.size==selection.distinct().size) {"online.browser.invalidDownload"}
        val fingerprints=selected.map { JSONObject(runtime.engine.analyzeFontFile(it.getString("path"))).getString("fingerprint") }
        val importer=FolioFontImporter(runtime.engine,runtime.root,{uri->context.contentResolver.openInputStream(Uri.parse(uri)) ?: error("online.browser.fileError")})
        val report=importer.importFiles(selected.map {SelectedImportFile(Uri.fromFile(File(it.getString("path"))).toString(),it.getString("name"))})
        report.items.forEachIndexed {index,item->if(item.status in setOf("imported","duplicate")) runtime.browser.recordOrigin(id,fingerprints[index])}
        if(report.items.all {it.status in setOf("imported","duplicate")})runtime.browser.setDownloadState(id,"completed",null,null)
        runtime.notifyChanges()
        return mapOf("snapshot" to FolioLibraryMapper.snapshot(report.snapshot),"items" to report.items.map {it.dictionary()})
    }
}

class FolioOnlineExportActivity:Activity() {
    private var jobId=""
    override fun onCreate(state:Bundle?) {
        super.onCreate(state)
        jobId=state?.getString("id") ?: intent.getStringExtra("id") ?: ""
        if(state!=null)return
        try {
            val job=FolioOnlineFiles.job(this,jobId)
            check(job.getString("state")=="ready")
            startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(if(job.optString("kind")=="archive")"application/zip"else"application/octet-stream")
                .putExtra(Intent.EXTRA_TITLE,job.getString("name")),1)
        }catch (_:Exception){finish()}
    }
    override fun onSaveInstanceState(outState:Bundle) {outState.putString("id",jobId);super.onSaveInstanceState(outState)}
    @Deprecated("系统文件选择器回调")
    override fun onActivityResult(requestCode:Int,resultCode:Int,data:Intent?) {
        super.onActivityResult(requestCode,resultCode,data)
        val target=data?.data
        if(requestCode!=1 || resultCode!=RESULT_OK || target==null){finish();return}
        FolioFileRuntime.get(this).executor.execute {
            try {
                val path=FolioFileRuntime.get(this).browser.downloadPath(jobId)
                contentResolver.openOutputStream(target,"wt").use {output->check(output!=null);File(path).inputStream().use {it.copyTo(output)}}
            }catch (_:Exception) {
                runOnUiThread {android.widget.Toast.makeText(this,FolioFileRuntime.localized(this,"online.browser.fileError"),android.widget.Toast.LENGTH_LONG).show()}
            }finally {runOnUiThread {finish()}}
        }
    }
}
