package com.folio.poc

import android.database.Cursor
import android.database.MatrixCursor
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.DocumentsProvider
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException

// 仅提供文件读取，不暴露路径或接受外部写入。
class FolioDocumentsProvider: DocumentsProvider() {
    private val runtime get()=FolioFileRuntime.get(requireNotNull(context))
    override fun onCreate()=true
    override fun queryRoots(projection:Array<out String>?):Cursor {
        val cursor=MatrixCursor(projection ?: arrayOf(DocumentsContract.Root.COLUMN_ROOT_ID,DocumentsContract.Root.COLUMN_DOCUMENT_ID,DocumentsContract.Root.COLUMN_TITLE,DocumentsContract.Root.COLUMN_MIME_TYPES,DocumentsContract.Root.COLUMN_FLAGS,DocumentsContract.Root.COLUMN_ICON))
        val row=cursor.newRow()
        for(column in cursor.columnNames)row.add(column,when(column){
            DocumentsContract.Root.COLUMN_ROOT_ID->"folio"
            DocumentsContract.Root.COLUMN_DOCUMENT_ID->"root"
            DocumentsContract.Root.COLUMN_TITLE->"Folio"
            DocumentsContract.Root.COLUMN_MIME_TYPES->"font/ttf\nfont/otf\nfont/collection\napplication/octet-stream"
            DocumentsContract.Root.COLUMN_FLAGS->DocumentsContract.Root.FLAG_SUPPORTS_IS_CHILD
            DocumentsContract.Root.COLUMN_ICON->requireNotNull(context).applicationInfo.icon
            else->null
        })
        return cursor
    }
    private val columns get()=arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE,DocumentsContract.Document.COLUMN_FLAGS,DocumentsContract.Document.COLUMN_LAST_MODIFIED)
    private fun append(cursor:MatrixCursor,item:JSONObject) {
        val row=cursor.newRow()
        for(column in cursor.columnNames) row.add(column,when(column){DocumentsContract.Document.COLUMN_DOCUMENT_ID->item.getString("id");DocumentsContract.Document.COLUMN_DISPLAY_NAME->runtime.title(item);DocumentsContract.Document.COLUMN_MIME_TYPE->item.getString("mimeType");DocumentsContract.Document.COLUMN_SIZE->if(item.getBoolean("directory"))null else item.getLong("size");DocumentsContract.Document.COLUMN_FLAGS->0;DocumentsContract.Document.COLUMN_LAST_MODIFIED->null;else->null})
    }
    override fun queryDocument(documentId:String,projection:Array<out String>?):Cursor = MatrixCursor(projection ?: columns).also {try{append(it,JSONObject(runtime.files.document(documentId)))}catch(error:Exception){throw FileNotFoundException(runtime.text("workflow.error.sourceUnavailable"))}}
    override fun queryChildDocuments(parentDocumentId:String,projection:Array<out String>?,sortOrder:String?):Cursor {
        val cursor=MatrixCursor(projection ?: columns)
        val items=runtime.documents(parentDocumentId)
        for(index in 0 until items.length()) append(cursor,items.getJSONObject(index))
        cursor.setNotificationUri(requireNotNull(context).contentResolver,DocumentsContract.buildChildDocumentsUri(authority(),parentDocumentId))
        return cursor
    }
    override fun isChildDocument(parentDocumentId:String,documentId:String):Boolean {
        var current=documentId
        repeat(4){if(current==parentDocumentId)return true;current=try{JSONObject(runtime.files.document(current)).getString("parentId")}catch(_:Exception){return false}}
        return false
    }
    override fun openDocument(documentId:String,mode:String,signal:CancellationSignal?):ParcelFileDescriptor {
        if(mode!="r")throw FileNotFoundException(runtime.text("workflow.readOnly"))
        signal?.throwIfCanceled();runtime.refreshReferences()
        val request=runtime.files.read(documentId)
        signal?.setOnCancelListener {request.cancel()}
        try {
            val file=File(request.open(runtime.password()));signal?.throwIfCanceled()
            return ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY,Handler(Looper.getMainLooper())) {request.release();request.destroy();signal?.setOnCancelListener(null)}
        } catch(error:Exception) {request.release();request.destroy();signal?.setOnCancelListener(null);if(signal?.isCanceled==true)throw android.os.OperationCanceledException();throw FileNotFoundException(runtime.text("workflow.error.sourceUnavailable"))}
    }
    private fun authority()="${requireNotNull(context).packageName}.documents"
}
