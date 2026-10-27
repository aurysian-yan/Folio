import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export function androidBuildInfo(variant, buildNumber) {
  const base = Number(buildNumber);
  if (!['legacy', 'glasmio'].includes(variant) || !Number.isSafeInteger(base) || base < 1 || base > 209999999) {
    throw new Error('Android 类型或发布构建号无效');
  }
  return { androidVariant: variant, minSdk: variant === 'legacy' ? 30 : 33,
    ...(variant === 'legacy' ? { maxSdk: 32 } : {}), versionCode: base * 10 + (variant === 'legacy' ? 1 : 2) };
}

// 根据 Gradle 输出元数据选包，避免依赖变体前缀和签名后缀。
export function androidOutputs(directory, version, buildNumber, architecture = 'all') {
  const abis = [['arm64', 'arm64-v8a'], ['x64', 'x86_64']].filter(([arch]) => architecture === 'all' || architecture === arch);
  if (!abis.length) throw new Error('Android 架构无效');
  return ['legacy', 'glasmio'].flatMap((variant) => {
    const folder = join(directory, variant, 'release');
    const metadata = JSON.parse(readFileSync(join(folder, 'output-metadata.json'), 'utf8'));
    const build = androidBuildInfo(variant, buildNumber);
    if (metadata.applicationId !== 'com.folio.mobile.poc' || metadata.variantName !== `${variant}Release`
      || metadata.artifactType?.type !== 'APK' || metadata.elements?.length !== abis.length) throw new Error(`Android 输出矩阵错误：${variant}`);
    return abis.map(([arch, abi]) => {
      const matches = metadata.elements.filter((item) => item.filters?.length === 1
        && item.filters[0].filterType === 'ABI' && item.filters[0].value === abi);
      const item = matches[0];
      if (matches.length !== 1 || item.versionCode !== build.versionCode || item.versionName !== version
        || typeof item.outputFile !== 'string' || basename(item.outputFile) !== item.outputFile
        || item.outputFile.includes('\\') || !item.outputFile.endsWith('.apk')) throw new Error(`Android 安装包元数据错误：${variant}/${arch}`);
      return { variant, arch, file: join(folder, item.outputFile) };
    });
  });
}

