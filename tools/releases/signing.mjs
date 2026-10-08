import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
// 密钥只写入构建机临时目录，不输出任何签名凭据。
const names = ['FOLIO_KEYSTORE_BASE64','FOLIO_KEYSTORE_PATH','FOLIO_KEYSTORE_PASSWORD','FOLIO_KEY_ALIAS','FOLIO_KEY_PASSWORD'];
const complete = names.every((name) => Boolean(process.env[name]));
if (!complete && process.env.FOLIO_BUILD_ONLY !== '1') throw new Error('正式发布缺少固定 Android 签名 Secrets');
if (complete) {
  const key = process.env.FOLIO_KEYSTORE_BASE64;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(key)) throw new Error('Android 密钥编码无效');
  const bytes = Buffer.from(key,'base64');
  if (!bytes.length) throw new Error('Android 密钥为空');
  mkdirSync(dirname(process.env.FOLIO_KEYSTORE_PATH),{recursive:true,mode:0o700});
  writeFileSync(process.env.FOLIO_KEYSTORE_PATH,bytes,{mode:0o600});
} else console.log('仅构建模式：生成未签名 APK，不发布');
