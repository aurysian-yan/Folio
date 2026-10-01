import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

// APP_VARIANT 显式声明构建身份：development 对应 Debug，production 对应 Release。
const appVariant = process.env.APP_VARIANT ?? 'development';
const isDevelopment = appVariant === 'development';

// 版本以 package.json 为唯一来源，供根目录版本管理脚本统一维护。
const { version } = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

// 优先使用 Debug 专用资源；资源缺失时回退到正式资源，保证 prebuild 始终可执行。
function debugAsset(debugPath: string, productionPath: string): string {
  return isDevelopment && existsSync(join(__dirname, debugPath)) ? debugPath : productionPath;
}

const productionAssets = {
  icon: './assets/design/icon.png',
  appIcon: './assets/design/AppIcon.icon',
  adaptiveIcon: {
    foregroundImage: './assets/design/foreground.png',
    backgroundImage: './assets/design/background.png',
    monochromeImage: './assets/design/monochrome.png',
  },
};

const developmentAssets = {
  icon: './assets/design/dev/icon.png',
  appIcon: './assets/design/dev/AppIcon.icon',
  adaptiveIcon: {
    foregroundImage: './assets/design/dev/foreground.png',
    backgroundImage: './assets/design/dev/background.png',
    monochromeImage: './assets/design/dev/monochrome.png',
  },
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: isDevelopment ? 'Folio Dev' : 'Folio',
  slug: 'folio-mobile-poc',
  version,
  scheme: isDevelopment ? 'folio-poc-dev' : 'folio-poc',
  platforms: ['ios', 'android'],
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: isDevelopment ? 'com.folio.mobile.poc.dev' : 'com.folio.mobile.poc',
    supportsTablet: true,
    icon: debugAsset(developmentAssets.appIcon, productionAssets.appIcon),
  },
  android: {
    package: isDevelopment ? 'com.folio.mobile.poc.dev' : 'com.folio.mobile.poc',
    predictiveBackGestureEnabled: true,
    permissions: [],
    icon: debugAsset(developmentAssets.icon, productionAssets.icon),
    adaptiveIcon: {
      foregroundImage: debugAsset(
        developmentAssets.adaptiveIcon.foregroundImage,
        productionAssets.adaptiveIcon.foregroundImage
      ),
      backgroundImage: debugAsset(
        developmentAssets.adaptiveIcon.backgroundImage,
        productionAssets.adaptiveIcon.backgroundImage
      ),
      monochromeImage: debugAsset(
        developmentAssets.adaptiveIcon.monochromeImage,
        productionAssets.adaptiveIcon.monochromeImage
      ),
    },
  },
  plugins: [
    'expo-document-picker',
    [
      'expo-build-properties',
      {
        ios: {
          deploymentTarget: '16.4',
          enableSceneSupport: true,
        },
        android: {
          minSdkVersion: 28,
          buildArchs: ['arm64-v8a', 'x86_64'],
        },
      },
    ],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#FFFFFF',
        image: './assets/splash-light.png',
        imageWidth: 128,
        resizeMode: 'contain',
        dark: {
          backgroundColor: '#000000',
          image: './assets/splash-dark.png',
        },
      },
    ],
  ],
});
