import { withAppBuildGradle, withGradleProperties, withProjectBuildGradle, withSettingsGradle, type ConfigPlugin } from 'expo/config-plugins';

// 双版本共用应用身份，原生依赖由对应构建变体隔离。
export function replaceGlassBlock(source: string, name: string, content: string): string {
  const start = `// Folio ${name} 开始`;
  const end = `// Folio ${name} 结束`;
  return source.replace(new RegExp(`${start}[\\s\\S]*?${end}\\n?`, 'g'), '').trimEnd()
    + `\n\n${start}\n${content.trim()}\n${end}\n`;
}

const appBlock = `
def folioBuildBase = (System.getenv('FOLIO_BUILD_NUMBER') ?: '1').toLong()
if (folioBuildBase < 1 || folioBuildBase > 209999999) {
    throw new GradleException('无效的发布构建号')
}
android {
    flavorDimensions += 'glassTier'
    productFlavors {
        legacy {
            dimension 'glassTier'
            minSdk 30
            versionCode = (folioBuildBase * 10 + 1).toInteger()
            manifestPlaceholders.folioGlassTier = 'legacy'
        }
        glasmio {
            dimension 'glassTier'
            minSdk 33
            versionCode = (folioBuildBase * 10 + 2).toInteger()
            manifestPlaceholders.folioGlassTier = 'glasmio'
        }
    }
}
react { debuggableVariants = ['legacyDebug', 'glasmioDebug'] }
`;

const settingsBlock = `
['core', 'glass', 'icons', 'ui'].each { part ->
    include(":glasmio-\${part}")
    project(":glasmio-\${part}").projectDir = new File(rootDir, "../vendor/glasmio/glasmio-\${part}")
}
`;

const withAndroidGlassTiers: ConfigPlugin = (config) => {
  // Pika 尚未发布对应编译器制品，使用 Expo 标准运行时桥接。
  config = withGradleProperties(config, (result) => {
    const properties = {
      'expo.enableCompileTimeOptimization': 'false',
      'org.gradle.jvmargs': '-Xmx4096m -XX:MaxMetaspaceSize=2048m',
      'org.gradle.workers.max': '2',
      'kotlin.daemon.jvmargs': '-Xmx2048m -XX:MaxMetaspaceSize=1024m',
      'android.builtInKotlin': 'false',
      'android.newDsl': 'false',
      'android.sourceset.disallowProvider': 'false',
    };
    result.modResults = result.modResults.filter((entry) => entry.type !== 'property' || !Object.hasOwn(properties, entry.key));
    for (const [key, value] of Object.entries(properties)) result.modResults.push({ type: 'property', key, value });
    return result;
  });
  config = withProjectBuildGradle(config, (result) => {
    const kotlinDependency = /classpath\(['"]org\.jetbrains\.kotlin:kotlin-gradle-plugin(?::[^'"]+)?['"]\)/;
    if (!kotlinDependency.test(result.modResults.contents)) throw new Error('缺少 Kotlin 构建插件声明');
    result.modResults.contents = result.modResults.contents.replace(kotlinDependency,
      'classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")');
    result.modResults.contents = result.modResults.contents.replace(/classpath\(['"]com\.android\.tools\.build:gradle(?::[^'"]+)?['"]\)/,
      'classpath("com.android.tools.build:gradle:9.1.0")');
    return result;
  });
  config = withAppBuildGradle(config, (result) => {
    if (result.modResults.language !== 'groovy') throw new Error('双版本构建需要 Groovy 配置');
    result.modResults.contents = result.modResults.contents.replaceAll("getDefaultProguardFile(\"proguard-android.txt\")", "getDefaultProguardFile(\"proguard-android-optimize.txt\")");
    result.modResults.contents = replaceGlassBlock(result.modResults.contents, '玻璃版本', appBlock);
    return result;
  });
  return withSettingsGradle(config, (result) => {
    result.modResults.contents = replaceGlassBlock(result.modResults.contents, 'Glasmio 模块', settingsBlock);
    return result;
  });
};

export default withAndroidGlassTiers;
