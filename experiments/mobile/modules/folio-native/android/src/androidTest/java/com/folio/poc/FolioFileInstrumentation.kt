package com.folio.poc

import android.app.Activity
import android.app.Instrumentation
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import android.os.CancellationSignal
import android.os.SystemClock
import android.provider.DocumentsContract
import android.view.accessibility.AccessibilityNodeInfo
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONObject

// 使用隔离测试包与独立 UID 调用方验证无 JS 的真实入口。
class FolioFileInstrumentation:Instrumentation() {
    override fun onCreate(arguments:Bundle?) {super.onCreate(arguments);start()}
    override fun onStart() {
        val result=Bundle();val runtime=FolioFileRuntime.get(targetContext)
        val directory=File(runtime.root,"file-validation/${UUID.randomUUID()}").apply {mkdirs()}
        var root:com.folio.poc.ffi.RootDto?=null
        var code=Activity.RESULT_CANCELED
        try {
            val file=File(directory,"P2-${UUID.randomUUID()}.ttf")
            file.writeBytes(context.assets.open("Lato-Regular.ttf").use {it.readBytes()}+UUID.randomUUID().toString().toByteArray())
            root=runtime.engine.addLibraryRoot(directory.path);runtime.engine.refreshLibrary()
            val analysis=JSONObject(runtime.engine.analyzeFontFile(file.path));val fingerprint=analysis.getString("fingerprint")
            val uri=DocumentsContract.buildDocumentUri("${targetContext.packageName}.documents","local/$fingerprint")
            targetContext.contentResolver.openInputStream(uri)!!.use {check(it.readBytes().contentEquals(file.readBytes()))}
            val signal=CancellationSignal().apply {cancel()}
            check(runCatching {targetContext.contentResolver.openFileDescriptor(uri,"r",signal)}.isFailure)
            val digest=MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString(""){"%02x".format(it)}
            for(action in listOf(Intent.ACTION_GET_CONTENT,Intent.ACTION_OPEN_DOCUMENT)) {
            val latch=CountDownLatch(1);var received:Intent?=null
            val receiver=object:BroadcastReceiver(){override fun onReceive(context:Context,intent:Intent){received=intent;latch.countDown()}}
            targetContext.registerReceiver(receiver,IntentFilter("com.folio.filecaller.RESULT"),Context.RECEIVER_EXPORTED)
            try {
                targetContext.startActivity(Intent().setClassName("com.folio.filecaller","com.folio.filecaller.CallerActivity").putExtra("providerPackage",targetContext.packageName).putExtra("action",action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                click(runtime.text("workflow.local"));click(file.name);if(action==Intent.ACTION_GET_CONTENT)click(runtime.text("workflow.select"))
                check(latch.await(20,TimeUnit.SECONDS));check(received?.getBooleanExtra("success",false)==true){received?.getStringExtra("error") ?: "caller failed"};check(received?.getStringExtra("digest")==digest)
            }finally{targetContext.unregisterReceiver(receiver)}
            }
            result.putString("stream","PASS: native Provider, cancellation, independent UID GET_CONTENT and DocumentsUI OPEN_DOCUMENT, read grant, byte digest and write rejection without React runtime\n")
            code=Activity.RESULT_OK
        }catch(error:Throwable){result.putString("stream",error.stackTraceToString())}
        finally{root?.let {runtime.engine.removeLibraryRoot(it.id)};directory.deleteRecursively();runtime.engine.refreshLibrary()}
        finish(code,result)
    }
    private fun click(text:String) {
        val deadline=SystemClock.uptimeMillis()+20_000
        while(SystemClock.uptimeMillis()<deadline) {
            val root=uiAutomation.rootInActiveWindow
            // 仅清理模拟器启动时遗留的系统界面弹窗，应用自身无响应仍视为失败。
            if(root?.findAccessibilityNodeInfosByText("System UI isn't responding")?.isNotEmpty()==true) {
                root.findAccessibilityNodeInfosByText("Close app").firstOrNull()?.let {close ->
                    var current:AccessibilityNodeInfo?=close
                    while(current!=null){if(current.isClickable&&current.performAction(AccessibilityNodeInfo.ACTION_CLICK))break;current=current.parent}
                }
            }
            val node=root?.findAccessibilityNodeInfosByText(text)?.firstOrNull {it.text?.toString()==text}
            if(node!=null){var current:AccessibilityNodeInfo?=node;while(current!=null){if(current.isClickable&&current.performAction(AccessibilityNodeInfo.ACTION_CLICK))return;current=current.parent}}
            Thread.sleep(100)
        }
        error("Missing UI: $text")
    }
}
