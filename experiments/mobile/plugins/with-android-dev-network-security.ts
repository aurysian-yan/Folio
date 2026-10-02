import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type ConfigPlugin, withDangerousMod } from 'expo/config-plugins';

// 仅覆盖调试变体的 rustls 网络安全资源，允许 Metro 使用局域网 HTTP。
const DEBUG_NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;

const withAndroidDevNetworkSecurity: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    'android',
    async (mod) => {
      for (const variant of ['debug', 'debugOptimized']) {
        const resourceDirectory = join(
          mod.modRequest.platformProjectRoot,
          'app/src',
          variant,
          'res/xml'
        );
        await mkdir(resourceDirectory, { recursive: true });
        await writeFile(
          join(resourceDirectory, 'network_security_config.xml'),
          DEBUG_NETWORK_SECURITY_CONFIG,
          'utf8'
        );
      }
      return mod;
    },
  ]);

export default withAndroidDevNetworkSecurity;
