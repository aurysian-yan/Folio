import { memo, useState } from 'react';
import { PixelRatio, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { FontFamily } from './library';
import { NativeFontPreview, type PreviewStatus } from './native';
import type { Theme } from './ui';

export const FontCard = memo(function FontCard({ family, mode, theme, onOpen }: {
  family: FontFamily;
  mode: 'grid' | 'list';
  theme: Theme;
  onOpen: () => void;
}) {
  const [previewStatus, setPreviewStatus] = useState<{ key: string; status: PreviewStatus['status'] } | null>(null);
  const face = family.faces.find((item) => /^(regular|normal|book|常规)$/i.test(item.styleName)) ?? family.faces[0];
  const variable = family.faces.some((item) => item.axes.length > 0);
  const previewKey = `${face?.id}:${face?.revisionId}`;
  const status = previewStatus?.key === previewKey ? previewStatus.status : null;
  const compact = mode === 'list';

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`查看 ${family.displayName} 字体详情`}
      onPress={onOpen} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border },
        compact && [styles.listCard, { backgroundColor: theme.listCardSurface }]]}>
      {compact && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.outline, { borderColor: theme.listCardBorder }]} />}
      <View pointerEvents="none" style={[styles.preview, compact && styles.listPreview]}>
        {face?.sourcePath && status !== 'error' && status !== 'missing-glyph' ? (
          <NativeFontPreview key={previewKey} style={styles.nativePreview}
            accessibilityLabel={`${family.displayName}，${face.styleName} 字体预览`}
            selection={{ sourcePath: face.sourcePath, faceIndex: face.faceIndex,
              revisionId: face.revisionId, axes: Object.fromEntries(face.axes.map((axis) => [axis.tag, axis.defaultValue])),
              text: compact ? 'Preview Text' : 'Preview\nText',
              fontSize: 24 * PixelRatio.getFontScale(), centered: !compact }}
            onStatus={(event) => setPreviewStatus({ key: previewKey, status: event.nativeEvent.status })} />
        ) : (
          <Text style={[styles.unavailable, { color: theme.secondary }, compact && styles.listUnavailable]}>
            {status === 'missing-glyph' ? '缺少预览字符' : '暂时无法预览'}
          </Text>
        )}
      </View>
      <View pointerEvents="none" style={[styles.metadata, compact && styles.listMetadata]}>
        <Text numberOfLines={1} style={[styles.name, { color: theme.label }, compact && styles.listName]}>{family.displayName}</Text>
        <View style={styles.details}>
          <Text style={[styles.detail, { color: theme.secondary }, compact && styles.listDetail]}>{family.faces.length}个样式</Text>
          {variable && <>
            <View style={[styles.separator, { backgroundColor: compact ? theme.listCardBorder : theme.border }]} />
            <Text accessibilityLabel="可变字体" style={[styles.detail, { color: theme.secondary }, compact && styles.listDetail]}>VF</Text>
          </>}
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { flex: 1, aspectRatio: 1, borderRadius: 16, borderWidth: 1, padding: 10, overflow: 'hidden' },
  listCard: { aspectRatio: undefined, minHeight: 84, borderWidth: 0 },
  outline: { borderWidth: 1, borderRadius: 16 },
  preview: { flex: 1, minHeight: 48, justifyContent: 'center', marginBottom: 4 },
  listPreview: { flex: 0, minHeight: 42, height: 42, marginBottom: 0, marginHorizontal: 4 },
  nativePreview: { width: '100%', flex: 1 },
  unavailable: { fontSize: 12, textAlign: 'center' },
  listUnavailable: { textAlign: 'left' },
  metadata: { gap: 2, alignItems: 'center' },
  listMetadata: { flexDirection: 'row', justifyContent: 'space-between', gap: 5, paddingHorizontal: 4, minHeight: 22 },
  name: { fontSize: 14, fontWeight: '500', lineHeight: 18, textAlign: 'center', maxWidth: '100%' },
  listName: { flex: 1, fontSize: 15, lineHeight: 22, textAlign: 'left' },
  details: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 16 },
  detail: { fontSize: 12, lineHeight: 16 },
  listDetail: { lineHeight: 22, fontWeight: '500', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  separator: { height: 12, width: 1, marginHorizontal: 1 },
});
