package com.folio.filecaller;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import java.io.InputStream;
import java.security.MessageDigest;

// 独立 UID 的调用方，验证系统返回授权后的真实文件读取。
public final class CallerActivity extends Activity {
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        if (saved != null) return;
        Intent request = new Intent(getIntent().getStringExtra("action"));
        request.addCategory(Intent.CATEGORY_OPENABLE).setType("font/ttf");
        if (Intent.ACTION_GET_CONTENT.equals(request.getAction())) request.setPackage(getIntent().getStringExtra("providerPackage"));
        if (Intent.ACTION_OPEN_DOCUMENT.equals(request.getAction())) request.putExtra(android.provider.DocumentsContract.EXTRA_INITIAL_URI,
            android.provider.DocumentsContract.buildRootUri(getIntent().getStringExtra("providerPackage") + ".documents", "folio"));
        startActivityForResult(request, 17);
    }
    @Override public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        Intent output = new Intent("com.folio.filecaller.RESULT").setPackage(getIntent().getStringExtra("providerPackage"));
        try {
            if (resultCode != RESULT_OK || data == null || data.getData() == null) throw new Exception("cancelled");
            Uri uri = data.getData();
            MessageDigest hash = MessageDigest.getInstance("SHA-256");
            try (InputStream input = getContentResolver().openInputStream(uri)) {
                if (input == null) throw new Exception("missing stream");
                byte[] buffer = new byte[65536]; int count;
                while ((count = input.read(buffer)) != -1) hash.update(buffer, 0, count);
            }
            boolean rejected = false;
            try { android.os.ParcelFileDescriptor fd = getContentResolver().openFileDescriptor(uri, "rw"); if (fd != null) fd.close(); }
            catch (Exception expected) { rejected = true; }
            if (!rejected) throw new Exception("write access granted");
            StringBuilder digest = new StringBuilder();
            for (byte value : hash.digest()) digest.append(String.format("%02x", value));
            output.putExtra("digest", digest.toString()).putExtra("uri", uri.toString()).putExtra("success", true);
        } catch (Exception error) { output.putExtra("error", error.toString()); }
        sendBroadcast(output); finish();
    }
}
