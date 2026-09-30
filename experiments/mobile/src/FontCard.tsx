import { CaretLeftIcon, CaretRightIcon, CheckIcon, CopyIcon, StarIcon } from 'phosphor-react-native';
import { memo, useState } from 'react';
import { PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';
import type { FontFamily } from './library';
import { copyText, NativeFontPreview, type PreviewStatus } from './native';
import { NativeActionButton, usesNativeControls } from './native-controls';
import { IconButton, type Theme } from './ui';

export const FontCard = memo(function FontCard({ family, selected, mode, theme, onSelect, onFavorite }: {
  family: FontFamily;
  selected: boolean;
  mode: 'grid' | 'list';
  theme: Theme;
  onSelect: () => void;
  onFavorite: () => Promise<void>;
}) {
  const [faceIndex, setFaceIndex] = useState(() => Math.max(0,
    family.faces.findIndex((face) => /^(regular|normal|book|常规)$/i.test(face.styleName))));
  const [previewStatus, setPreviewStatus] = useState<{ key: string; status: PreviewStatus['status'] } | null>(null);
  const [favoritePending, setFavoritePending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const face = family.faces[faceIndex] ?? family.faces[0];
  const variable = family.faces.some((item) => item.axes.length > 0);
  const previewKey = `${face?.id}:${face?.revisionId}`;
  const status = previewStatus?.key === previewKey ? previewStatus.status : null;
  const compact = mode === 'list';

  function changeFace(direction: number) {
    setFaceIndex((index) => (index + direction + family.faces.length) % family.faces.length);
    setPreviewStatus(null);
    setCopied(false);
  }

  async function favorite() {
    setFavoritePending(true);
    try { await onFavorite(); } finally { setFavoritePending(false); }
  }

  async function copy() {
    try {
      await copyText(family.displayName);
      setCopied(true);
      setCopyError(false);
    } catch { setCopyError(true); }
  }

  return (
    <View style={[styles.card, compact && styles.listCard, {
      backgroundColor: theme.surface, borderColor: selected ? theme.accent : theme.border,
      borderWidth: selected ? 3 : 1,
      experimental_backgroundImage: selected
        ? `linear-gradient(to bottom, ${theme.surface} 53%, ${theme.selection} 100%)` : undefined,
    }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`选择 ${family.displayName}`}
        accessibilityState={{ selected }} onPress={onSelect} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[styles.preview, compact && styles.listPreview]}>
        {face?.sourcePath && status !== 'error' && status !== 'missing-glyph' ? (
          <NativeFontPreview key={previewKey} style={styles.nativePreview}
            accessibilityLabel={`${family.displayName}，${face.styleName} 字体预览`}
            selection={{ sourcePath: face.sourcePath, faceIndex: face.faceIndex,
              revisionId: face.revisionId, axes: Object.fromEntries(face.axes.map((axis) => [axis.tag, axis.defaultValue])),
              text: compact ? 'Preview Text' : 'Preview\nText',
              fontSize: 24 * PixelRatio.getFontScale(), centered: true }}
            onStatus={(event) => setPreviewStatus({ key: previewKey, status: event.nativeEvent.status })} />
        ) : (
          <Text style={[styles.unavailable, { color: theme.secondary }]}>
            {status === 'missing-glyph' ? '缺少预览字符' : '暂时无法预览'}
          </Text>
        )}
      </View>
      <View pointerEvents="box-none" style={[styles.metadata, compact && styles.listMetadata]}>
        <Text pointerEvents="none" numberOfLines={1} style={[styles.name, { color: theme.label }]}>{family.displayName}</Text>
        {selected && family.faces.length > 1 ? (
          <View pointerEvents="box-none" style={styles.facePicker}>
            {usesNativeControls ? <NativeActionButton label={`${family.displayName} 上一个样式`}
              systemImage="chevron.left" color={theme.secondary} onPress={() => changeFace(-1)} iconOnly diameter={24} plain />
              : <Pressable accessibilityRole="button" accessibilityLabel={`${family.displayName} 上一个样式`}
              hitSlop={10} onPress={() => changeFace(-1)} style={styles.arrow}>
              <CaretLeftIcon size={12} color={theme.secondary} />
            </Pressable>}
            <Text pointerEvents="none" numberOfLines={1} style={[styles.styleName, { color: theme.secondary }]}>{face?.styleName}</Text>
            {usesNativeControls ? <NativeActionButton label={`${family.displayName} 下一个样式`}
              systemImage="chevron.right" color={theme.secondary} onPress={() => changeFace(1)} iconOnly diameter={24} plain />
              : <Pressable accessibilityRole="button" accessibilityLabel={`${family.displayName} 下一个样式`}
              hitSlop={10} onPress={() => changeFace(1)} style={styles.arrow}>
              <CaretRightIcon size={12} color={theme.secondary} />
            </Pressable>}
          </View>
        ) : (
          <View pointerEvents="none" style={styles.details}>
            <Text style={[styles.detail, { color: theme.secondary }]}>{family.faces.length} 个样式</Text>
            {variable && <>
              <View style={[styles.separator, { backgroundColor: theme.border }]} />
              <Text accessibilityLabel="可变字体" style={[styles.detail, { color: theme.secondary }]}>VF</Text>
            </>}
          </View>
        )}
        {copyError && <Text accessibilityRole="alert" style={[styles.detail, { color: theme.danger }]}>无法复制，请重试</Text>}
      </View>
      {selected && (
        <View pointerEvents="box-none" style={styles.actions}>
          <IconButton theme={theme} label={copied ? '已复制字体名称' : '复制字体名称'}
            systemImage={copied ? 'checkmark' : 'document.on.document'} onPress={copy} style={styles.cardAction}>
            {copied ? <CheckIcon size={13} color={theme.accent} /> : <CopyIcon size={13} color={theme.secondary} />}
          </IconButton>
          <IconButton theme={theme} label={family.isFavorite ? '取消收藏' : '收藏字体'}
            systemImage={family.isFavorite ? 'star.fill' : 'star'}
            disabled={favoritePending} selected={family.isFavorite} onPress={favorite} style={styles.cardAction}>
            <StarIcon size={13} weight={family.isFavorite ? 'fill' : 'regular'}
              color={family.isFavorite ? theme.accent : theme.secondary} />
          </IconButton>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  card: { flex: 1, aspectRatio: 1, borderRadius: 16, padding: 10, overflow: 'hidden' },
  listCard: { aspectRatio: undefined, minHeight: 116, flexDirection: 'row', gap: 12 },
  preview: { flex: 1, minHeight: 48, justifyContent: 'center', marginBottom: 4 },
  listPreview: { flex: 1, marginBottom: 0 },
  nativePreview: { width: '100%', flex: 1 },
  unavailable: { fontSize: 12, textAlign: 'center' },
  metadata: { gap: 2, alignItems: 'center' },
  listMetadata: { flex: 1, justifyContent: 'center' },
  name: { fontSize: 14, fontWeight: '500', lineHeight: 18, textAlign: 'center', maxWidth: '100%' },
  details: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 16 },
  detail: { fontSize: 12, lineHeight: 16 },
  separator: { height: 10, width: 1 },
  facePicker: { flexDirection: 'row', alignItems: 'center', width: '100%', minHeight: 18 },
  styleName: { flex: 1, fontSize: 12, lineHeight: 16, textAlign: 'center' },
  arrow: { width: 24, minHeight: 24, alignItems: 'center', justifyContent: 'center' },
  actions: { position: 'absolute', top: 7, right: 7, flexDirection: 'row', gap: 6 },
  cardAction: { minWidth: 26, minHeight: 26, borderRadius: 13 },
});
