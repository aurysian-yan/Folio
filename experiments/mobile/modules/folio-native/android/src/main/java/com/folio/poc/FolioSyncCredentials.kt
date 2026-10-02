package com.folio.poc

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import com.folio.poc.ffi.SyncProfileDto
import org.json.JSONArray
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// 密钥由 Keystore 管理，密文存放于不参与备份的应用私有目录。
internal class FolioSyncCredentials(private val context: Context) {
    private val alias = "${context.packageName}.webdav"
    private fun file(profile: SyncProfileDto): AtomicFile {
        val scope = JSONArray(listOf(profile.serverUrl, profile.remoteDirectory, profile.username)).toString()
        val name = MessageDigest.getInstance("SHA-256").digest(scope.toByteArray()).joinToString("") { "%02x".format(it) }
        return AtomicFile(File(context.noBackupFilesDir, "webdav-$name.bin"))
    }
    private fun key(create: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        check(create)
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
        }.generateKey()
    }
    fun read(profile: SyncProfileDto): String? {
        val file = file(profile)
        if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) return null
        val bytes = file.readFully()
        check(bytes.size >= 29 && bytes[0] == 1.toByte())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
        cipher.updateAAD(file.baseFile.name.toByteArray())
        return cipher.doFinal(bytes.copyOfRange(13, bytes.size)).toString(Charsets.UTF_8)
    }
    fun write(password: String?, profile: SyncProfileDto) {
        val file = file(profile)
        if (password == null) {
            file.delete()
            check(!file.baseFile.exists())
            return
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(true))
        check(cipher.iv.size == 12)
        cipher.updateAAD(file.baseFile.name.toByteArray())
        val bytes = byteArrayOf(1) + cipher.iv + cipher.doFinal(password.toByteArray())
        val stream = file.startWrite()
        try { stream.write(bytes); file.finishWrite(stream) }
        catch (error: Exception) { file.failWrite(stream); throw error }
    }
}
