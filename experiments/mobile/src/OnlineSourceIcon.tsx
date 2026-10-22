import { Image } from 'expo-image';
import { useState } from 'react';
import { GlobeIcon } from './icons';
import type { OnlineProvider } from './online';
import type { Theme } from './ui';

// 图标按内容寻址，读取失败时保留统一的来源占位图形。
export function OnlineSourceIcon({ provider, theme, size = 20 }: {
  provider?: Pick<OnlineProvider, 'iconUri'> | null; theme: Theme; size?: number;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const uri = provider?.iconUri;
  return uri && failed !== uri ? <Image source={{ uri }} accessible={false} contentFit="contain"
    style={{ width: size, height: size }} onError={() => setFailed(uri)} />
    : <GlobeIcon size={size} color={theme.secondary} />;
}
