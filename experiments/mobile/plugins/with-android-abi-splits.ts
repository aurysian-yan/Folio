import { withAppBuildGradle, type ConfigPlugin } from 'expo/config-plugins';

// Release 与 Debug 均按 ABI 拆分 APK，避免把两个架构打进同一个安装包。
// -Pfolio.android.abi=all|arm64|x64 只控制本机 Gradle 输出，CI 默认构建全部。
const splits = `
def folioAbiAliases = ['arm64': 'arm64-v8a', 'x64': 'x86_64']
def folioAbiRequest = (findProperty('folio.android.abi') ?: 'all').toString()
def folioAbis = folioAbiRequest == 'all'
    ? ['arm64-v8a', 'x86_64']
    : [folioAbiAliases[folioAbiRequest]]
if (folioAbis.any { it == null }) {
    throw new GradleException("无效的 folio.android.abi：\${folioAbiRequest}")
}
android {
    splits {
        abi {
            enable true
            reset()
            folioAbis.each { abi -> include abi }
            universalApk = false
        }
    }
}
`;
const withAndroidAbiSplits: ConfigPlugin = (config) => {
  return withAppBuildGradle(config, (gradle) => {
    if (gradle.modResults.language !== 'groovy') throw new Error('Folio ABI 拆分需要 Groovy 构建配置');
    const start = '// Folio ABI 拆分开始'; const end = '// Folio ABI 拆分结束';
    const oldBlock = new RegExp(`${start}[\\s\\S]*?${end}\\n?`, 'g');
    gradle.modResults.contents = gradle.modResults.contents.replace(oldBlock, '').trimEnd() + `\n\n${start}\n${splits}${end}\n`;
    return gradle;
  });
};
export default withAndroidAbiSplits;
