import { ConfigPlugin, withProjectBuildGradle } from 'expo/config-plugins';

// rustls-platform-verifier 的 Android AAR 只发布在项目自建的 GitHub Maven 归档，
// 不在 Maven Central。该仓库必须写进根工程 build.gradle 的 allprojects.repositories：
// expo run:android 固定以 --configure-on-demand 调用 Gradle，只配置任务相关工程，
// 子模块 build.gradle 里后加的仓库在 :app 解析 debugRuntimeClasspath 时尚未注册，
// 会导致 Debug 构建报 “Could not find org.rustls:rustls-platform-verifier”。
const RUSTLS_MAVEN_URL =
  'https://raw.githubusercontent.com/rustls/rustls-platform-verifier/maven-archive/android-release-support/maven/';

export const withRustlsVerifierRepo: ConfigPlugin = (config) =>
  withProjectBuildGradle(config, (gradle) => {
    // 仓库已注入时直接跳过，保证重复 prebuild 幂等。
    if (gradle.modResults.contents.includes(RUSTLS_MAVEN_URL)) {
      return gradle;
    }

    const repositoriesAnchor = /allprojects\s*\{\s*repositories\s*\{/;
    if (!repositoriesAnchor.test(gradle.modResults.contents)) {
      throw new Error(
        'android/build.gradle 缺少 allprojects.repositories，无法注入 rustls-platform-verifier 仓库'
      );
    }

    gradle.modResults.contents = gradle.modResults.contents.replace(
      repositoriesAnchor,
      (match) =>
        `${match}\n    maven {\n      url "${RUSTLS_MAVEN_URL}"\n      content { includeGroup 'org.rustls' }\n    }`
    );

    return gradle;
  });

export default withRustlsVerifierRepo;
