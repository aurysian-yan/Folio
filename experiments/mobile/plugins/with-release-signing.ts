import { withAppBuildGradle, type ConfigPlugin } from 'expo/config-plugins';

// 生产构建使用固定签名；仅构建模式明确生成未签名 APK。
const signing = `
def folioBuildOnly = System.getenv('FOLIO_BUILD_ONLY') == '1'
def folioSigning = ['FOLIO_KEYSTORE_PATH', 'FOLIO_KEYSTORE_PASSWORD', 'FOLIO_KEY_ALIAS', 'FOLIO_KEY_PASSWORD'].collectEntries { key -> [(key): System.getenv(key)] }
def folioHasSigning = folioSigning.values().every { it != null && !it.isEmpty() } && file(folioSigning.FOLIO_KEYSTORE_PATH ?: '').isFile()
def folioReleaseRequested = gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }
if (folioReleaseRequested && !folioBuildOnly && !folioHasSigning) {
    throw new GradleException('Folio 正式构建缺少发布签名配置')
}
android {
    signingConfigs {
        folioRelease {
            if (folioHasSigning) {
                storeFile file(folioSigning.FOLIO_KEYSTORE_PATH)
                storePassword folioSigning.FOLIO_KEYSTORE_PASSWORD
                keyAlias folioSigning.FOLIO_KEY_ALIAS
                keyPassword folioSigning.FOLIO_KEY_PASSWORD
            }
        }
    }
    buildTypes {
        release {
            signingConfig folioHasSigning ? signingConfigs.folioRelease : null
        }
    }
}
// 共享资源变动后重新生成离线包。
tasks.matching { it.name.startsWith('createBundle') && it.name.endsWith('JsAndAssets') }.configureEach {
    inputs.dir(new File(rootDir, '../../../shared/about')).withPropertyName('folioAbout')
    inputs.dir(new File(rootDir, '../../../locales')).withPropertyName('folioLocales')
}
`;
const withReleaseSigning: ConfigPlugin = (config) => {
  if (process.env.APP_VARIANT !== 'production') return config;
  return withAppBuildGradle(config, (gradle) => {
    if (gradle.modResults.language !== 'groovy') throw new Error('Folio 发布签名需要 Groovy 构建配置');
    const start = '// Folio 发布签名开始'; const end = '// Folio 发布签名结束';
    const oldBlock = new RegExp(`${start}[\\s\\S]*?${end}\\n?`, 'g');
    gradle.modResults.contents = gradle.modResults.contents.replace(oldBlock, '').trimEnd() + `\n\n${start}\n${signing}${end}\n`;
    return gradle;
  });
};
export default withReleaseSigning;
