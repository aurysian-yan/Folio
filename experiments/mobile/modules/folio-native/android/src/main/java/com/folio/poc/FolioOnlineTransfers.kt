// 系统任务持有下载，网页与 React 生命周期不影响执行。
package com.folio.poc

import android.app.*
import android.app.job.*
import android.content.*
import android.content.pm.ServiceInfo
import android.os.*
import androidx.work.*
import com.folio.poc.ffi.SyncProfileDto
import org.json.JSONObject
import org.json.JSONArray
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

internal object FolioOnlineTransfers {
    private val intents = ConcurrentHashMap<String, JSONObject>()
    private fun profile(id: String) = SyncProfileDto("https://transfer.folio.invalid", id, "", false)
    private fun vault(context: Context) = FolioSyncCredentials(context, "online-transfers")
    fun intent(context: Context, url: String, name: String, origin: JSONObject, headers: JSONObject): String {
        val id = UUID.randomUUID().toString()
        if (intents.size >= 20) intents.clear()
        intents[id] = JSONObject().put("url",url).put("name",name).put("origin",origin).put("headers",headers)
        return id
    }
    fun start(context: Context, intentId: String): String {
        val request = intents.remove(intentId) ?: error("online.browser.expiredLink")
        val browser = FolioFileRuntime.get(context).browser
        val job = JSONObject(browser.createDownload(request.getString("url"),request.getString("name"),request.getJSONObject("origin").toString()))
        val id = job.getString("id")
        try { vault(context).write(request.toString(),profile(id)); schedule(context,id) }
        catch (error: Exception) { browser.setDownloadState(id,"failed","online.browser.scheduleError",null); throw error }
        return id
    }
    fun retry(context: Context, id: String) {
        val browser = FolioFileRuntime.get(context).browser
        if (vault(context).read(profile(id)) == null) error("online.browser.expiredLink")
        browser.setDownloadState(id,"queued",null,null)
        schedule(context,id)
    }
    fun cancel(context: Context,id: String) {
        FolioFileRuntime.get(context).browser.cancelDownload(id)
        context.getSystemService(JobScheduler::class.java).cancel(jobId(id))
        WorkManager.getInstance(context).cancelUniqueWork("folio-online-$id")
        vault(context).write(null,profile(id))
    }
    fun run(context: Context,id: String,generation:ULong) {
        val browser = FolioFileRuntime.get(context).browser
        if(FolioOnlineFiles.job(context,id).getLong("generation").toULong()!=generation)return
        val request = JSONObject(vault(context).read(profile(id)) ?: error("online.browser.expiredLink"))
        FolioTls.initialize(context)
        browser.runDownload(id,request.getString("url"),request.getJSONObject("headers").toString())
        val jobs=JSONArray(JSONObject(browser.state()).getJSONArray("jobs").toString())
        val state=(0 until jobs.length()).map {jobs.getJSONObject(it)}.firstOrNull {it.getString("id")==id}?.optString("state")
        if(state in setOf("ready","completed","cancelled")) vault(context).write(null,profile(id))
    }
    fun pauseForSystem(context:Context,id:String,generation:ULong) {
        try {FolioFileRuntime.get(context).browser.setDownloadState(id,"paused",null,generation)} catch (_:Exception) {}
    }
    fun pause(context:Context,id:String) {
        val generation=FolioOnlineFiles.job(context,id).getLong("generation").toULong()
        FolioFileRuntime.get(context).browser.setDownloadState(id,"paused",null,generation)
        context.getSystemService(JobScheduler::class.java).cancel(jobId(id))
        WorkManager.getInstance(context).cancelUniqueWork("folio-online-$id")
    }
    fun notification(context:Context,id:String): Notification {
        val manager=context.getSystemService(NotificationManager::class.java)
        val title=FolioFileRuntime.localized(context,"online.browser.downloads")
        manager.createNotificationChannel(NotificationChannel("folio-transfers",title,NotificationManager.IMPORTANCE_LOW))
        val open=context.packageManager.getLaunchIntentForPackage(context.packageName)
        val builder=Notification.Builder(context,"folio-transfers").setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title).setContentText(FolioFileRuntime.localized(context,"online.browser.states.transferring"))
            .setProgress(0,0,true).setOngoing(true)
        if(open!=null)builder.setContentIntent(PendingIntent.getActivity(context,jobId(id),open,PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        val cancel=Intent(context,FolioOnlineCancelReceiver::class.java).putExtra("id",id)
        builder.addAction(Notification.Action.Builder(null,FolioFileRuntime.localized(context,"common.cancel"),PendingIntent.getBroadcast(context,jobId(id),cancel,PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)).build())
        return builder.build()
    }
    fun jobId(id:String)=id.hashCode().and(0x3fffffff) or 0x40000000
    private fun schedule(context: Context,id:String) {
        val generation=FolioOnlineFiles.job(context,id).getLong("generation")
        if (Build.VERSION.SDK_INT>=34) {
            val info=JobInfo.Builder(jobId(id),ComponentName(context,FolioOnlineJob::class.java))
                .setUserInitiated(true).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setExtras(PersistableBundle().apply {putString("id",id);putLong("generation",generation)}).build()
            check(context.getSystemService(JobScheduler::class.java).schedule(info)==JobScheduler.RESULT_SUCCESS) {"online.browser.scheduleError"}
        } else {
            val work=OneTimeWorkRequestBuilder<FolioOnlineWorker>().setInputData(workDataOf("id" to id,"generation" to generation))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
            WorkManager.getInstance(context).enqueueUniqueWork("folio-online-$id",ExistingWorkPolicy.KEEP,work)
        }
    }
}

class FolioOnlineJob: JobService() {
    private val executor=Executors.newFixedThreadPool(2)
    override fun onStartJob(params:JobParameters):Boolean {
        val id=params.extras.getString("id") ?: return false
        val generation=params.extras.getLong("generation").toULong()
        if(Build.VERSION.SDK_INT>=34)setNotification(params,FolioOnlineTransfers.jobId(id),FolioOnlineTransfers.notification(this,id),JOB_END_NOTIFICATION_POLICY_REMOVE)
        executor.execute {
            try {FolioOnlineTransfers.run(this,id,generation)} catch (_:Exception) {
                try {FolioFileRuntime.get(this).browser.setDownloadState(id,"failed","online.browser.networkError",generation)} catch (_:Exception) {}
            }
            jobFinished(params,false)
        }
        return true
    }
    override fun onStopJob(params:JobParameters):Boolean {
        params.extras.getString("id")?.let {FolioOnlineTransfers.pauseForSystem(this,it,params.extras.getLong("generation").toULong())}
        return false
    }
    override fun onDestroy() {executor.shutdown();super.onDestroy()}
}

class FolioOnlineWorker(context:Context,params:WorkerParameters):Worker(context,params) {
    override fun doWork():Result {
        val id=inputData.getString("id") ?: return Result.failure()
        val generation=inputData.getLong("generation",0).toULong()
        return try {
            setForegroundAsync(ForegroundInfo(FolioOnlineTransfers.jobId(id),FolioOnlineTransfers.notification(applicationContext,id),ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)).get()
            FolioOnlineTransfers.run(applicationContext,id,generation);Result.success()
        } catch (_:Exception) {
            try {FolioFileRuntime.get(applicationContext).browser.setDownloadState(id,"failed","online.browser.networkError",generation)}catch (_:Exception){}
            Result.failure()
        }
    }
    override fun onStopped() {inputData.getString("id")?.let {FolioOnlineTransfers.pauseForSystem(applicationContext,it,inputData.getLong("generation",0).toULong())}}
}

class FolioOnlineCancelReceiver:BroadcastReceiver() {
    override fun onReceive(context:Context,intent:Intent) {
        intent.getStringExtra("id")?.let {id->try {FolioOnlineTransfers.cancel(context,id)}catch (_:Exception){}}
    }
}
