# 使用现有 Android SDK 构建独立文件调用方，不引入项目依赖。
from pathlib import Path
import os, subprocess, zipfile
root = Path(__file__).resolve().parents[3]
source = Path(__file__).resolve().parent
output = root / 'experiments/mobile/.build/file-caller'
output.mkdir(parents=True, exist_ok=True)
sdk = Path(os.environ.get('ANDROID_HOME', str(Path.home() / 'Library/Android/sdk')))
build = sorted((sdk / 'build-tools').iterdir(), key=lambda p: tuple(int(n) for n in p.name.split('.') if n.isdigit()))[-1]
platform = sdk / 'platforms/android-37.0/android.jar'
classes = output / 'classes'
classes.mkdir(exist_ok=True)
def run(args): subprocess.run([str(x) for x in args], check=True)
run(['javac', '-source', '8', '-target', '8', '-bootclasspath', platform, '-d', classes, source / 'CallerActivity.java'])
run([build / 'd8', '--min-api', '28', '--lib', platform, '--output', output, classes / 'com/folio/filecaller/CallerActivity.class'])
apk = output / 'caller.apk'
run([build / 'aapt2', 'link', '-I', platform, '--manifest', source / 'AndroidManifest.xml', '-o', apk])
with zipfile.ZipFile(apk, 'a') as package: package.write(output / 'classes.dex', 'classes.dex')
key = output / 'debug.keystore'
if not key.exists(): run(['keytool', '-genkeypair', '-keystore', key, '-storepass', 'android', '-keypass', 'android', '-alias', 'test', '-keyalg', 'RSA', '-dname', 'CN=FolioValidation', '-validity', '30'])
run([build / 'apksigner', 'sign', '--ks', key, '--ks-key-alias', 'test', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', apk])
print(apk)
