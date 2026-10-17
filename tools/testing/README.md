# Local WebDAV Validation

仅用于隔离的本机 HTTPS WebDAV 验收。服务监听 `127.0.0.1`，数据写入明确指定的
测试目录；不要指定用户字体库或真实服务商凭据。两个本地实例仍属于同一种实现，
不能代替 123PAN、独立服务商、真机或实际桌面／移动应用的往返验收。

## Server

在仓库根目录执行：

```sh
python3 -m venv experiments/mobile/.build/local-dav-env
experiments/mobile/.build/local-dav-env/bin/pip install -r tools/testing/requirements-webdav.txt
mkdir -p experiments/mobile/.build/local-dav
openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -keyout experiments/mobile/.build/local-dav/key.pem \
  -out experiments/mobile/.build/local-dav/ca.pem \
  -subj '/CN=Folio Local WebDAV Test' \
  -addext 'subjectAltName=IP:127.0.0.1,IP:10.0.2.2,DNS:localhost'
FOLIO_LOCAL_DAV_PASSWORD=folio-local-test \
  experiments/mobile/.build/local-dav-env/bin/python tools/testing/local-webdav.py \
  --root experiments/mobile/.build/local-dav/data \
  --certificate experiments/mobile/.build/local-dav/ca.pem \
  --key experiments/mobile/.build/local-dav/key.pem
```

第二个实例使用另一数据目录和 `--port 9444`。测试结束发送 SIGINT／SIGTERM；
服务会关闭监听并回收工作线程。

## Android Native Cycle

使用模拟器的只读运行模式 `-read-only -no-snapshot`，安装与测试写入在退出后丢弃。
不要在已有模拟器上执行 `-wipe-data`。测试应用只建立临时子库，不读取本机已保存
的连接或密码。

显式设置 `FOLIO_LOCAL_DAV_CA` 为测试证书的绝对路径后，执行
`pnpm --dir experiments/mobile rust:android arm64-v8a`。构建脚本仅在此环境变量存在时
启用 `folio-sync/local-webdav-test`，将公钥证书传给验收构建。

此特性只对 `localhost`、`127.0.0.1` 和 Android 模拟器宿主地址 `10.0.2.2`
使用指定测试根，仍执行证书链与主机名验证。其他地址继续使用系统信任库，HTTP
仍被拒绝；不安装系统 CA、不关闭 TLS 校验。未指定证书时，即使启用该特性也使用
普通配置。私钥不进入客户端、版本库或正式构建。

在 `experiments/mobile/android` 中构建目标开发包与测试包：

```sh
./gradlew :app:assembleDebug :folio-native:assembleDebugAndroidTest \
  -PfolioSyncTarget=com.folio.mobile.poc.dev -PreactNativeArchitectures=arm64-v8a
```

原生测试的 `newApplication` 不启动 Expo／Metro。若目标包中的 AndroidX Startup
在该组合下因测试资源 ID 冲突启动失败，仅在本次生成的 debug manifest 中临时移除
`androidx.startup.InitializationProvider`，结束后恢复原文件；这不验证 JS 页面或完整
应用启动生命周期。不得修改生产 manifest。使用相同签名安装目标 APK 与测试 APK；
替换旧测试包只能在上述可丢弃模拟器中执行。

```sh
adb -s emulator-5580 reverse tcp:9443 tcp:9443
adb -s emulator-5580 shell am instrument -w \
  -e localServer https://127.0.0.1:9443 \
  com.folio.poc.test/com.folio.poc.FolioLiveSyncInstrumentation
```

检查结果流，不能仅凭命令退出码判断成功。测试覆盖 TTF、OTF、TTC 非零成员、
变量轴、下载字节、原生绘制、仅云端、重下、墓碑／恢复、收藏／成员／最近状态、
并发收藏夹三种决策、错误认证及取消／重试。字体按字节指纹定位，不依赖下载后
文件名。测试子目录名写入结果，服务数据留在指定本机目录便于核对。

## Cleanup

恢复临时 debug manifest，移除临时证书资源；清除 `FOLIO_LOCAL_DAV_CA` 后重新执行
正常 Rust Android 构建，恢复普通 `.so`。退出本次启动的模拟器，停止 WebDAV、ADB、
Gradle 与 Kotlin 测试进程，并核对监听端口和子进程已退出。保留验证报告与必要日志。
