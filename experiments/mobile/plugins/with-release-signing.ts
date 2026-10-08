import { withAppBuildGradle, type ConfigPlugin } from 'expo/config-plugins';

// 生产构建使用固定签名；仅构建模式明确生成未签名 APK。
// 本地回退到未入库的签名文件，CI 仍以环境变量为唯一来源。
const signing = `
def folioBuildOnly = System.getenv('FOLIO_BUILD_ONLY') == '1'
def folioSigningFile = file('../../.signing/android.properties')
def folioSigningProps = new Properties()
if (folioSigningFile.isFile()) folioSigningFile.withReader('UTF-8') { reader -> folioSigningProps.load(reader) }
def folioSigning = [
    'FOLIO_KEYSTORE_PATH': System.getenv('FOLIO_KEYSTORE_PATH') ?: folioSigningProps.getProperty('storeFile'),
    'FOLIO_KEYSTORE_PASSWORD': System.getenv('FOLIO_KEYSTORE_PASSWORD') ?: folioSigningProps.getProperty('storePassword'),
    'FOLIO_KEY_ALIAS': System.getenv('FOLIO_KEY_ALIAS') ?: folioSigningProps.getProperty('keyAlias'),
    'FOLIO_KEY_PASSWORD': System.getenv('FOLIO_KEY_PASSWORD') ?: folioSigningProps.getProperty('keyPassword')
]
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
