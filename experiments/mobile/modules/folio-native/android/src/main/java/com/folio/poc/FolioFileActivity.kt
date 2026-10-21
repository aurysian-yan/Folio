package com.folio.poc

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.DocumentsContract
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.atomic.AtomicBoolean

// 系统选取、原生 fallback 和逐项文件导出均可在 JS 未启动时运行。
class FolioFileActivity:Activity() {
    private val runtime get()=FolioFileRuntime.get(this)
    private lateinit var request:JSONObject
    private val cancelled=AtomicBoolean(false)
    private var waiting:CompletableFuture<String?>?=null
    private var reading:com.folio.poc.ffi.FolioFileRead?=null
    private var batch:JSONObject?=null
    private var frozenSelection:List<JSONObject>?=null
    override fun onCreate(state:Bundle?) {
        super.onCreate(state)
        request=JSONObject(intent.getStringExtra("request") ?: "{}")
        title=runtime.text("workflow.pickerTitle")
        if(intent.action==Intent.ACTION_GET_CONTENT){picker("root");return}
        if(intent.action in listOf(Intent.ACTION_SEND,Intent.ACTION_SEND_MULTIPLE,Intent.ACTION_VIEW)){if(state!=null)finish()else stageIncoming();return}
        if(intent.getStringExtra("callback")?.let { FolioFileRuntime.callbacks.containsKey(it) } != true){finish();return}
        intent.getStringExtra("callback")?.let { FolioFileRuntime.activeFiles[it]=java.lang.ref.WeakReference(this) }
        if(state!=null){finishResult("{}",null);return}
        when(request.optString("action")) {
            "collectInbox" -> collectInbox()
            "analyzeInbox" -> collectInbox(true)
            "refresh" -> runtime.executor.execute { try {runtime.refreshReferences();runtime.engine.refreshLibrary();finishResult("{}",null)}catch(error:Exception){finishResult(null,error)} }
            "referenceFolder","importFolder" -> launchPicker(Intent.ACTION_OPEN_DOCUMENT_TREE)
            "exportFiles" -> runtime.executor.execute {try {frozenSelection=selected();runOnUiThread {launchPicker(Intent.ACTION_OPEN_DOCUMENT_TREE)}}catch(error:Exception){finishResult(null,error)}}
            "referenceFiles","importFiles" -> launchPicker(Intent.ACTION_OPEN_DOCUMENT)
            "shareFiles" -> share()
            else -> finishResult(null,IllegalArgumentException("workflow.error.invalidRequest"))
        }
    }
    @Suppress("DEPRECATION")
    private fun stageIncoming() {
        runtime.executor.execute {
            val directory=java.io.File(runtime.root,"Inbox/${UUID.randomUUID()}").apply {mkdirs()}
            try {
                val uris=when(intent.action){Intent.ACTION_SEND_MULTIPLE->intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.toList() ?: emptyList();Intent.ACTION_SEND->listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM));else->listOfNotNull(intent.data)}
                check(uris.isNotEmpty() && uris.size<=1000)
                val names=uris.map {uri->val name="${UUID.randomUUID()}-${displayName(uri).substringAfterLast('/').substringAfterLast('\\')}";val output=java.io.File(directory,name);contentResolver.openInputStream(uri)?.use {input->output.outputStream().use {out->val buffer=ByteArray(65536);var total=0L;while(true){val count=input.read(buffer);if(count<0)break;total+=count;check(total<=256L*1024*1024);out.write(buffer,0,count)}}} ?: throw java.io.IOException();name}
                android.util.AtomicFile(java.io.File(directory,"manifest.json")).let {file->val stream=file.startWrite();try{stream.write(JSONObject().put("names",JSONArray(names)).toString().toByteArray());file.finishWrite(stream)}catch(error:Exception){file.failWrite(stream);throw error}}
                runOnUiThread {AlertDialog.Builder(this).setTitle(runtime.text("workflow.pendingShare")).setMessage(names.joinToString("\n"){it.drop(37)}).setPositiveButton(runtime.text("common.done")){_,_->finish()}.show()}
            }catch(error:Exception){directory.deleteRecursively();finishResult(null,error)}
        }
    }
    private fun collectInbox(analyzeOnly:Boolean=false) {
        runtime.executor.execute {
            try {
                val id=request.getString("inboxId");check(UUID.fromString(id).toString()==id)
                val directory=java.io.File(runtime.root,"Inbox/$id")
                val names=JSONObject(java.io.File(directory,"manifest.json").readText()).getJSONArray("names")
                val inputs=(0 until names.length()).map {names.getString(it)}
                check(inputs.all {java.io.File(it).name==it})
                check(!runtime.sync.status().isRunning)
                val report=FolioFontImporter(runtime.engine,runtime.root,{uri->java.io.File(Uri.parse(uri).path!!).inputStream()}).importFiles(inputs.map {SelectedImportFile(Uri.fromFile(java.io.File(directory,it)).toString(),it.drop(37))},analyzeOnly)
                if(analyzeOnly){finishResult(JSONObject().put("items",JSONArray(report.items.map {JSONObject(it.dictionary())})).toString(),null);return@execute}
                val failed=inputs.filter {stored->val name=stored.drop(37);report.items.any {(it.archiveName==name || it.name==name) && it.status !in listOf("imported","duplicate")}}
                if(failed.isEmpty())directory.deleteRecursively()else java.io.File(directory,"manifest.json").writeText(JSONObject().put("names",JSONArray(failed)).toString())
                finishResult("{\"changed\":true}",null)
            }catch(error:Exception){finishResult(null,error)}
        }
    }
    private fun launchPicker(action:String) {
        val picker=Intent(action).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        if(action==Intent.ACTION_OPEN_DOCUMENT)picker.addCategory(Intent.CATEGORY_OPENABLE).setType("*/*").putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true)
        startActivityForResult(picker,7311)
    }
    @Deprecated("系统文件选择回调")
    override fun onActivityResult(code:Int,result:Int,data:Intent?) {
        super.onActivityResult(code,result,data)
        if(code!=7311)return
        if(result!=RESULT_OK || data==null){finishResult("{}",null);return}
        val uris=if(data.clipData!=null)(0 until data.clipData!!.itemCount).map {data.clipData!!.getItemAt(it).uri}else listOfNotNull(data.data)
        if(uris.isEmpty()){finishResult("{}",null);return}
        runtime.executor.execute {
            try {
                when(request.getString("action")) {
                    "referenceFolder","referenceFiles" -> {
                        for(uri in uris){contentResolver.takePersistableUriPermission(uri,data.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION);runtime.reference(uri,displayName(uri),request.getString("action")=="referenceFolder",request.optString("sourceId").takeIf {it.isNotEmpty()})}
                        finishResult(JSONObject().put("changed",true).toString(),null)
                    }
                    "importFiles","importFolder" -> {
                        check(!runtime.sync.status().isRunning)
                        val importer=FolioFontImporter(runtime.engine,runtime.root,{uri->contentResolver.openInputStream(Uri.parse(uri)) ?: throw java.io.FileNotFoundException()})
                        val report=importer.importFiles(if(request.getString("action")=="importFolder")folderFiles(uris.first())else uris.map {SelectedImportFile(it.toString(),displayName(it))})
                        finishResult(JSONObject().put("items",JSONArray(report.items.map {JSONObject(it.dictionary())})).put("changed",true).toString(),null)
                    }
                    "exportFiles" -> export(uris.first())
                }
            } catch(error:Exception){finishResult(null,error)}
        }
    }
    private fun folderFiles(tree:Uri):List<SelectedImportFile> {
        val result=mutableListOf<SelectedImportFile>()
        fun walk(parent:Uri,depth:Int){
            check(depth<32 && result.size<10_000)
            val children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getDocumentId(parent))
            contentResolver.query(children,arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE),null,null,null)?.use {cursor->
                while(cursor.moveToNext()){
                    if(cancelled.get())throw InterruptedException()
                    val child=DocumentsContract.buildDocumentUriUsingTree(tree,cursor.getString(0));val name=cursor.getString(1)
                    if(cursor.getString(2)==DocumentsContract.Document.MIME_TYPE_DIR)walk(child,depth+1)
                    else if(name.substringAfterLast('.').lowercase() in listOf("ttf","otf","ttc","otc","zip"))result.add(SelectedImportFile(child.toString(),name))
                }
            } ?: throw java.io.FileNotFoundException()
        }
        walk(DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree)),0)
        return result
    }
    private fun displayName(uri:Uri):String=try {contentResolver.query(uri,arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),null,null,null)?.use {if(it.moveToFirst())it.getString(0)else null} ?: uri.lastPathSegment.orEmpty()}catch(_:Exception){uri.lastPathSegment.orEmpty()}
    private fun selected():List<JSONObject> {
        frozenSelection?.let {return it}
        val ids=request.optJSONArray("ids")
        if(ids!=null)return (0 until ids.length()).map {JSONObject(runtime.files.document(ids.getString(it)))}.distinctBy {it.optString("fingerprint")}
        val values=runtime.documents(request.optString("parent","local"))
        return (0 until values.length()).map {values.getJSONObject(it)}.filter {!it.getBoolean("directory")}
    }
    private fun share() {
        try {
            val values=selected();check(values.isNotEmpty())
            val uris=ArrayList(values.map {DocumentsContract.buildDocumentUri("$packageName.documents",it.getString("id"))})
            val output=Intent(if(uris.size==1)Intent.ACTION_SEND else Intent.ACTION_SEND_MULTIPLE).setType(if(uris.size==1)values.first().getString("mimeType")else "font/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            if(uris.size==1)output.putExtra(Intent.EXTRA_STREAM,uris.first())else output.putParcelableArrayListExtra(Intent.EXTRA_STREAM,uris)
            output.clipData=ClipData.newUri(contentResolver,"Folio",uris.first()).also {clip->uris.drop(1).forEach {clip.addItem(ClipData.Item(it))}}
            startActivity(Intent.createChooser(output,runtime.text("workflow.shareFiles")));finishResult("{}",null)
        }catch(error:Exception){finishResult(null,error)}
    }
    internal fun isRequest(id:String)=this::request.isInitialized && request.optString("requestId")==id
    internal fun cancelWorkflow() {cancelled.set(true);waiting?.complete(null);reading?.cancel()}
    private fun export(tree:Uri) {
        runOnUiThread {
            setContentView(LinearLayout(this).apply {
                orientation=LinearLayout.VERTICAL
                addView(android.widget.TextView(this@FolioFileActivity).apply {text=runtime.text("workflow.exportFiles")})
                addView(Button(this@FolioFileActivity).apply {text=runtime.text("common.cancel");setOnClickListener {cancelWorkflow()}})
            })
        }
        val values=selected()
        val items=JSONArray(values.map {value->JSONObject().put("id",UUID.randomUUID().toString()).put("source",value.getString("id")).put("name",value.getString("name")).put("action","export").put("stage","export").put("status","pending").put("fingerprint",value.getString("fingerprint")).put("destination",tree.toString()).put("errorKey",JSONObject.NULL)})
        val current=JSONObject().put("id",UUID.randomUUID().toString()).put("items",items).put("cancelRequested",false);batch=current
        runtime.files.beginBatch(current.getString("id"))
        try {
        runtime.files.saveBatch(current.toString())
        val parent=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree))
        for(index in 0 until items.length()) {
            val item=items.getJSONObject(index)
            if(cancelled.get()){item.put("status","cancelled");continue}
            var created:Uri?=null
            try {
                var name=item.getString("name")
                while(exists(tree,parent,name)) {
                    item.put("status","awaitingDecision");runtime.files.saveBatch(current.toString())
                    val choice=conflict(name)
                    if(choice==null){item.put("status",if(cancelled.get())"cancelled"else "skipped");break}
                    name=choice
                }
                if(item.getString("status") in listOf("skipped","cancelled"))continue
                check(name.isNotBlank() && name!="." && name!=".." && !name.any {it=='/'||it=='\\'||it.isISOControl()})
                item.put("status","running");runtime.files.saveBatch(current.toString())
                val read=runtime.files.read(item.getString("source"));reading=read
                try {
                    val file=java.io.File(read.open(runtime.password()))
                    created=DocumentsContract.createDocument(contentResolver,parent,values[index].getString("mimeType"),name) ?: throw java.io.IOException()
                    if(displayName(created)!=name)throw IllegalStateException("workflow.error.nameConflict")
                    contentResolver.openOutputStream(created,"w")?.use {out->file.inputStream().use {input->val buffer=ByteArray(65536);while(true){if(cancelled.get())throw InterruptedException();val count=input.read(buffer);if(count<0)break;out.write(buffer,0,count)}}} ?: throw java.io.IOException()
                    item.put("destination",created.toString()).put("status","succeeded")
                } finally {reading=null;read.release();read.destroy()}
            } catch(error:Exception) {created?.let {try{DocumentsContract.deleteDocument(contentResolver,it)}catch(_:Exception){}};item.put("status",if(cancelled.get())"cancelled"else "failed").put("errorKey",error.message?.takeIf {it.startsWith("workflow.")} ?: "workflow.error.operationFailed")}
            finally {runtime.files.saveBatch(current.toString())}
        }
        runtime.files.saveBatch(current.toString());finishResult(current.toString(),null)
        } finally {runtime.files.endBatch(current.getString("id"))}
    }
    private fun exists(tree:Uri,parent:Uri,name:String):Boolean = contentResolver.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getDocumentId(parent)),arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),null,null,null)?.use {cursor->var found=false;while(cursor.moveToNext())if(cursor.getString(0).equals(name,true))found=true;found} ?: throw java.io.IOException()
    private fun conflict(name:String):String? {
        val future=CompletableFuture<String?>();waiting=future
        runOnUiThread {
            val input=EditText(this).apply {setText(name)}
            AlertDialog.Builder(this).setTitle(runtime.text("workflow.nameConflictTitle")).setView(input)
                .setPositiveButton(runtime.text("workflow.rename")){_,_->future.complete(input.text.toString())}
                .setNeutralButton(runtime.text("workflow.skip")){_,_->future.complete(null)}
                .setNegativeButton(runtime.text("workflow.cancelRemaining")){_,_->cancelled.set(true);future.complete(null)}
                .setOnCancelListener {future.complete(null)}.show()
        }
        return try {future.get()}finally{waiting=null}
    }
    private fun matchesMime(actual:String):Boolean {
        val types=intent.getStringArrayExtra(Intent.EXTRA_MIME_TYPES)?.toList() ?: listOf(intent.type ?: "*/*")
        return types.any {requested->requested=="*/*" || requested==actual || (requested.endsWith("/*") && actual.startsWith(requested.substringBefore('/')+"/"))}
    }
    private fun picker(parent:String) {
        runtime.executor.execute {
            try {val values=runtime.documents(parent);val items=(0 until values.length()).map {values.getJSONObject(it)}.filter {item->
                item.getBoolean("directory") || matchesMime(item.getString("mimeType"))
            }
                runOnUiThread {
                    val layout=LinearLayout(this).apply {orientation=LinearLayout.VERTICAL}
                    val list=ListView(this).apply {choiceMode=if(intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE,false))ListView.CHOICE_MODE_MULTIPLE else ListView.CHOICE_MODE_SINGLE;adapter=ArrayAdapter(this@FolioFileActivity,android.R.layout.simple_list_item_multiple_choice,items.map {runtime.title(it)})}
                    list.setOnItemClickListener {_,_,position,_->if(items[position].getBoolean("directory"))picker(items[position].getString("id"))}
                    layout.addView(list,LinearLayout.LayoutParams(-1,0,1f))
                    layout.addView(Button(this).apply {text=runtime.text("workflow.select");setOnClickListener {
                        val selected=items.indices.filter {list.isItemChecked(it) && !items[it].getBoolean("directory")}.map {items[it]}
                        if(selected.isEmpty())return@setOnClickListener
                        val uris=selected.map {DocumentsContract.buildDocumentUri("$packageName.documents",it.getString("id"))}
                        val output=Intent().setDataAndType(uris.first(),selected.first().getString("mimeType")).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        output.clipData=ClipData.newUri(contentResolver,"Folio",uris.first()).also {clip->uris.drop(1).forEach {clip.addItem(ClipData.Item(it))}}
                        setResult(RESULT_OK,output);finish()
                    }})
                    setContentView(layout)
                }
            }catch(error:Exception){finishResult(null,error)}
        }
    }
    private fun finishResult(value:String?,error:Exception?) {if(error==null)runtime.notifyChanges();runOnUiThread {intent.getStringExtra("callback")?.let {FolioFileRuntime.callbacks.remove(it)?.invoke(value,error)};if(error!=null && intent.action==Intent.ACTION_GET_CONTENT)AlertDialog.Builder(this).setMessage(runtime.text("workflow.error.operationFailed")).setPositiveButton(runtime.text("common.ok")){_,_->finish()}.show()else finish()}}
    override fun onDestroy(){if(isFinishing){cancelWorkflow();intent.getStringExtra("callback")?.let {FolioFileRuntime.activeFiles.remove(it);FolioFileRuntime.callbacks.remove(it)?.invoke("{}",null)}};super.onDestroy()}
}
