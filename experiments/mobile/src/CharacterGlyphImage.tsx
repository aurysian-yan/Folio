import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';

// 解码完成才替换旧图，通道只保留执行中与最新地址，避免连续刷新饿死中间帧。
export function CharacterGlyphImage({ dataUrl, identity, style, accessibilityLabel, attempt = 0, onError, transition = 0 }: {
  dataUrl: string | null | undefined; identity: string; style: StyleProp<ViewStyle>; accessibilityLabel?: string;
  attempt?: number; onError?: () => void; transition?: number;
}) {
  const [decoded, setDecoded] = useState<{ identity: string; url: string } | null>(null);
  const [candidate, setCandidate] = useState(dataUrl ? { identity, url: dataUrl } : null);
  const inputKey = JSON.stringify([identity, dataUrl, attempt]);
  const [observed, setObserved] = useState(inputKey);
  const [opacity] = useState(() => new Animated.Value(0));
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const requested = useRef({ identity, dataUrl });
  if (observed !== inputKey) {
    setObserved(inputKey);
    if (!candidate || (candidate.identity === decoded?.identity && candidate.url === decoded.url)) {
      setCandidate(dataUrl && (decoded?.identity !== identity || decoded.url !== dataUrl) ? { identity, url: dataUrl } : null);
    }
  }
  useLayoutEffect(() => { requested.current = { identity, dataUrl }; }, [identity, dataUrl]);
  useEffect(() => () => animation.current?.stop(), []);
  const finishFade = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!transition && finishFade.current) {
      animation.current?.stop();
      finishFade.current();
      finishFade.current = null;
    }
  }, [transition]);
  const previous = decoded?.identity === identity && dataUrl !== null ? decoded.url : undefined;
  const finish = (success: boolean) => {
    finishFade.current = null;
    opacity.setValue(0);
    const latest = requested.current;
    if (success && candidate?.identity === latest.identity && latest.dataUrl !== null) setDecoded(candidate);
    if (!success && candidate?.identity === latest.identity && candidate?.url === latest.dataUrl) onError?.();
    setCandidate(latest.dataUrl && (latest.dataUrl !== candidate?.url || latest.identity !== candidate?.identity)
      ? { identity: latest.identity, url: latest.dataUrl } : null);
  };
  return <View style={style} accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel}>
    {!!previous && <Image source={previous} style={StyleSheet.absoluteFill} contentFit="contain" transition={0} accessible={false} />}
    {!!candidate && (candidate.url !== previous || candidate.identity !== identity) && <Animated.View key={`${candidate.identity}:${candidate.url}:${attempt}`} style={[StyleSheet.absoluteFill, { opacity }]}>
      <Image source={candidate.url} style={StyleSheet.absoluteFill} contentFit="contain" transition={0} accessible={false}
        onLoad={() => {
          if (transition && previous) {
            finishFade.current = () => finish(true);
            animation.current = Animated.timing(opacity, { toValue: 1, duration: transition, easing: Easing.out(Easing.cubic), useNativeDriver: true });
            animation.current.start(({ finished }) => { if (finished) finish(true); });
          } else finish(true);
        }} onError={() => finish(false)} />
    </Animated.View>}
  </View>;
}
