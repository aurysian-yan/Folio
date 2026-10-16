import { useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';

// 新字形解码完成后才替换旧图，滚动与轴值更新不重置图片身份。
export function CharacterGlyphImage({ dataUrl, identity, style, accessibilityLabel }: {
  dataUrl: string | null | undefined; identity: string; style: StyleProp<ViewStyle>; accessibilityLabel?: string;
}) {
  const [decoded, setDecoded] = useState<{ identity: string; url: string } | null>(null);
  const requested = useRef({ identity, dataUrl });
  useLayoutEffect(() => { requested.current = { identity, dataUrl }; }, [identity, dataUrl]);
  const previous = decoded?.identity === identity && dataUrl !== null ? decoded.url : undefined;
  return <View style={style} accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel}>
    {!!previous && <Image source={previous} style={StyleSheet.absoluteFill} contentFit="contain" transition={0} accessible={false} />}
    {!!dataUrl && dataUrl !== previous && <Image key={`${identity}:${dataUrl}`} source={dataUrl}
      style={[StyleSheet.absoluteFill, { opacity: 0 }]} contentFit="contain" transition={0} accessible={false}
      onLoad={() => {
        if (requested.current.identity === identity && requested.current.dataUrl === dataUrl) setDecoded({ identity, url: dataUrl });
      }} />}
  </View>;
}
