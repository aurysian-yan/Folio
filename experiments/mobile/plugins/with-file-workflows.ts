// 持久生成移动端文件权限、共享资源和独立 iOS 扩展。
import { IOSConfig, withFinalizedMod, withDangerousMod, withEntitlementsPlist, withInfoPlist, withPodfile, withXcodeProject, type ConfigPlugin } from 'expo/config-plugins';
import { mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const extensions = [
    { name: 'FolioShare', suffix: '.share', source: 'FolioShareExtension.swift', principal: 'FolioShareExtension', point: 'com.apple.share-services' },
    { name: 'FolioFiles', suffix: '.files', source: 'FolioFileProvider.swift', principal: 'FolioFileProvider', point: 'com.apple.fileprovider-nonui' },
];
const plist = (value: unknown): string => {
    if (typeof value === 'boolean')
        return value ? '<true/>' : '<false/>';
    if (typeof value === 'number')
        return `<integer>${value}</integer>`;
    if (Array.isArray(value))
        return `<array>${value.map(plist).join('')}</array>`;
    if (value && typeof value === 'object')
        return `<dict>${Object.entries(value).map(([key, item]) => `<key>${key}</key>${plist(item)}`).join('')}</dict>`;
    return `<string>${String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</string>`;
};
function writePlist(path: string, value: unknown) { writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0">${plist(value)}</plist>\n`); }
const withFileWorkflows: ConfigPlugin = (config) => {
    const identity = config.ios?.bundleIdentifier ?? 'com.folio.mobile.poc';
    const group = `group.${identity}`;
    const keychain = `$(AppIdentifierPrefix)${identity}.shared`;
    config = withEntitlementsPlist(config, (mod) => { mod.modResults['com.apple.security.application-groups'] = [group]; mod.modResults['keychain-access-groups'] = [keychain, `$(AppIdentifierPrefix)${identity}`]; return mod; });
    config = withInfoPlist(config, (mod) => {
        const manifest = mod.modResults.UIApplicationSceneManifest as {
            UISceneConfigurations?: {
                UIWindowSceneSessionRoleApplication?: {
                    UISceneDelegateClassName?: string;
                }[];
            };
        } | undefined;
        if (manifest?.UISceneConfigurations?.UIWindowSceneSessionRoleApplication?.[0]?.UISceneDelegateClassName === 'EXExpoAppSceneDelegate')
            delete mod.modResults.UIApplicationSceneManifest;
        Object.assign(mod.modResults, { FolioApplicationIdentifier: identity, FolioKeychainGroup: keychain, FolioLegacyKeychainGroup: `$(AppIdentifierPrefix)${identity}`, LSSupportsOpeningDocumentsInPlace: true, CFBundleDocumentTypes: [{ CFBundleTypeName: 'Font', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', LSItemContentTypes: ['public.font', 'public.truetype-font', 'public.opentype-font', 'public.truetype-collection-font', 'public.zip-archive'] }] });
        return mod;
    });
    config = withDangerousMod(config, ['ios', async (mod) => {
            const out = join(mod.modRequest.projectRoot, 'modules/folio-native/ios/generated/locales');
            mkdirSync(out, { recursive: true });
            for (const language of ['zh-CN', 'en'])
                copyFileSync(join(mod.modRequest.projectRoot, '../../locales', `${language}.json`), join(out, `${language}.json`));
            return mod;
        }]);
    config = withFinalizedMod(config, ['ios', async (mod) => {
            const path = join(IOSConfig.Paths.getSourceRoot(mod.modRequest.projectRoot), 'Info.plist');
            const before = readFileSync(path, 'utf8');
            const after = before.replace(/(<key>UIApplicationSupportsMultipleScenes<\/key>\s*)<false\/>/, '$1<true/>');
            if (after !== before)
                writeFileSync(path, after);
            return mod;
        }]);
    config = withDangerousMod(config, ['android', async (mod) => {
            const out = join(mod.modRequest.platformProjectRoot, 'app/src/main/assets/folio-locales');
            mkdirSync(out, { recursive: true });
            for (const language of ['zh-CN', 'en'])
                copyFileSync(join(mod.modRequest.projectRoot, '../../locales', `${language}.json`), join(out, `${language}.json`));
            return mod;
        }]);
    config = withXcodeProject(config, (mod) => {
        const project = mod.modResults;
        project.hash.project.objects.PBXTargetDependency ??= {};
        project.hash.project.objects.PBXContainerItemProxy ??= {};
        for (const extension of extensions) {
            const folder = join(mod.modRequest.platformProjectRoot, extension.name);
            mkdirSync(folder, { recursive: true });
            copyFileSync(join(mod.modRequest.projectRoot, 'modules/folio-native/ios/extensions', extension.source), join(folder, extension.source));
            const attributes: Record<string, unknown> = extension.name === 'FolioShare' ? { NSExtensionActivationRule: { NSExtensionActivationSupportsFileWithMaxCount: 1000 } } : { NSExtensionFileProviderDocumentGroup: group, NSExtensionFileProviderSupportsEnumeration: true };
            writePlist(join(folder, `${extension.name}-Info.plist`), { CFBundleDisplayName: 'Folio', CFBundleExecutable: '$(EXECUTABLE_NAME)', CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)', CFBundleName: '$(PRODUCT_NAME)', CFBundlePackageType: 'XPC!', CFBundleShortVersionString: config.version ?? '1.1.0', CFBundleVersion: '$(CURRENT_PROJECT_VERSION)', FolioApplicationIdentifier: identity, FolioKeychainGroup: keychain, NSExtension: { NSExtensionPointIdentifier: extension.point, NSExtensionPrincipalClass: `$(PRODUCT_MODULE_NAME).${extension.principal}`, ...(extension.name === 'FolioFiles' ? attributes : { NSExtensionAttributes: attributes }) } });
            writePlist(join(folder, `${extension.name}.entitlements`), { 'com.apple.security.application-groups': [group], 'keychain-access-groups': [keychain] });
            const existing = Object.entries(project.pbxNativeTargetSection()).find(([key, value]) => !key.endsWith('_comment') && typeof value === 'object' && value !== null && 'name' in value && String(value.name).replaceAll('"', '') === extension.name);
            if (existing) {
                const host = project.getFirstTarget();
                const dependencies = host.firstTarget.dependencies ?? [];
                const section = project.hash.project.objects.PBXTargetDependency;
                if (!dependencies.some((entry: {
                    value: string;
                }) => section[entry.value]?.target === existing[0]))
                    project.addTargetDependency(host.uuid, [existing[0]]);
                continue;
            }
            const target = project.addTarget(extension.name, 'app_extension', extension.name, identity + extension.suffix);
            project.addBuildPhase([`${extension.name}/${extension.source}`], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
            project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
            project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
            const list = project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList];
            for (const reference of list.buildConfigurations) {
                const settings = project.pbxXCBuildConfigurationSection()[reference.value].buildSettings;
                Object.assign(settings, { SWIFT_VERSION: '5.9', IPHONEOS_DEPLOYMENT_TARGET: '16.4', TARGETED_DEVICE_FAMILY: '"1,2"', APPLICATION_EXTENSION_API_ONLY: 'YES', CODE_SIGN_ENTITLEMENTS: `${extension.name}/${extension.name}.entitlements`, CURRENT_PROJECT_VERSION: '1', GENERATE_INFOPLIST_FILE: 'NO', ENABLE_USER_SCRIPT_SANDBOXING: 'NO', SWIFT_EMIT_LOC_STRINGS: 'NO' });
            }
        }
        return mod;
    });
    config = withPodfile(config, (mod) => {
        const start = '# Folio 文件扩展开始';
        const end = '# Folio 文件扩展结束';
        const path = relative(mod.modRequest.platformProjectRoot, join(mod.modRequest.projectRoot, 'modules/folio-native/ios')).replaceAll('\\', '/');
        mod.modResults.contents = mod.modResults.contents.replace(new RegExp(`${start}[\\s\\S]*?${end}\\n?`, 'g'), '');
        // 主应用显式登记共享 Pod；扩展只链接无 Expo 的原生服务。
        const mainName = mod.modResults.contents.match(/target '([^']+)' do/)?.[1];
        if (mainName && !mod.modResults.contents.includes("pod 'FolioFileServices'"))
            mod.modResults.contents = mod.modResults.contents.replace(`target '${mainName}' do`, `target '${mainName}' do\n  pod 'FolioFileServices', :path => '${path}'`);
        mod.modResults.contents += `\n${start}\n${extensions.map((extension) => `target '${extension.name}' do\n  pod 'FolioFileServices', :path => '${path}'\nend`).join('\n')}\n${end}\n`;
        return mod;
    });
    return config;
};
export default withFileWorkflows;
