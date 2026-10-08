import { locationLabel, transferLabel } from "../../../shared/font-location";
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelRatio, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { representativeFace, type FontFamily } from './library';
import { NativeFontPreview, type PreviewStatus } from './native';
import { usePreferences } from './settings';
import type { Theme } from './ui';
import { StarIcon } from './icons';

export const FontCard = memo(function FontCard({ family, mode, theme, onOpen, sampleText }: {
  family: FontFamily;
  mode: 'grid' | 'list';
  theme: Theme;
  onOpen?: () => void;
  sampleText?: string;
}) {
  const { t } = useTranslation();
  const { preferences } = usePreferences();
  const [previewStatus, setPreviewStatus] = useState<{ key: string; status: PreviewStatus['status'] } | null>(null);
  const face = representativeFace(family);
  const variable = family.faces.some((item) => item.axes.length > 0);
  const previewKey = `${face?.id}:${face?.revisionId}`;
  const status = previewStatus?.key === previewKey ? previewStatus.status : null;
  const compact = mode === 'list';
  const locationText = locationLabel(family.faces,undefined,t,family.location);
  const transfers = face?.location?.files.map((file) => ({ fingerprint: file.fingerprint, text: transferLabel(file,t) })).filter((item) => item.text) ?? [];

  return (
    <Pressable accessibilityRole={onOpen ? 'button' : undefined} accessible={!!onOpen}
      accessibilityLabel={onOpen ? [family.isFavorite ? t('mobile.viewDetailsFavorite', { name: family.displayName }) : `${family.displayName} · ${t('mobile.viewDetails')}`, locationText, ...transfers.map((item) => item.text)].join(' · ') : undefined}
      disabled={!onOpen} onPress={onOpen} style={[styles.card, compact ? styles.listCard : styles.gridCard,
        { backgroundColor: compact ? theme.listCardSurface : theme.surface, borderColor: theme.border }]}>
      {compact && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.outline, { borderColor: theme.listCardBorder }]} />}
      <View pointerEvents="none" style={[styles.preview, compact && styles.listPreview]}>
        {sampleText !== undefined ? (
          <Text adjustsFontSizeToFit={!compact} style={[styles.sample, {
            color: theme.label, fontSize: preferences.previewScale, lineHeight: preferences.previewScale * 1.05,
            textAlign: compact ? 'left' : 'center',
          }]}>{compact ? sampleText.replaceAll('\n', ' ') : sampleText}</Text>
        ) : face?.sourcePath && status !== 'error' && status !== 'missing-glyph' ? (
          <NativeFontPreview key={previewKey} style={styles.nativePreview}
            accessibilityLabel={t('mobile.previewLabel', { name: family.displayName, style: face.styleName })}
            selection={{ sourcePath: face.sourcePath, faceIndex: face.faceIndex,
              revisionId: face.revisionId, axes: Object.fromEntries(face.axes.map((axis) => [axis.tag, axis.defaultValue])),
              text: compact ? 'Preview Text' : 'Preview\nText',
              fontSize: preferences.previewScale * PixelRatio.getFontScale(), centered: !compact }}
            onStatus={(event) => setPreviewStatus({ key: previewKey, status: event.nativeEvent.status })} />
        ) : (
          <Text style={[styles.unavailable, { color: theme.secondary }, compact && styles.listUnavailable]}>
            {status === 'missing-glyph' ? t('mobile.missingPreviewChars') : t(face?.location?.cloudAvailable && !face.location.localAvailable ? 'fontLocation.previewHint' : 'mobile.previewUnavailable')}
          </Text>
        )}
      </View>
      <Text style={[styles.detail, { color: theme.secondary }]}>{locationText}</Text>
      {transfers.map((item) => <Text key={item.fingerprint} accessibilityLiveRegion="polite" style={[styles.detail, { color: theme.secondary }]}>{item.text}</Text>)}
      {preferences.showCardMetadata && <View pointerEvents="none" style={[styles.metadata, compact && styles.listMetadata]}>
        <Text numberOfLines={1} style={[styles.name, { color: theme.label }, compact && styles.listName]}>{family.displayName}</Text>
        <View style={styles.details}>
          {family.isFavorite && preferences.showFavoriteBadge && <StarIcon size={12} weight="fill" color={theme.accent} />}
          <Text style={[styles.detail, { color: theme.secondary }, compact && styles.listDetail]}>{t('macos.stylesCount', { count: family.faces.length })}</Text>
          {variable && <>
            <View style={[styles.separator, { backgroundColor: compact ? theme.listCardBorder : theme.border }]} />
            <Text accessibilityLabel={t('font.variable')} style={[styles.detail, { color: theme.secondary }, compact && styles.listDetail]}>VF</Text>
          </>}
        </View>
      </View>}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 10, overflow: 'hidden' },
  gridCard: { flex: 1, aspectRatio: 1 },
  listCard: { minHeight: 84, borderWidth: 0 },
  outline: { borderWidth: 1, borderRadius: 16 },
  preview: { flex: 1, minHeight: 48, justifyContent: 'center', marginBottom: 4 },
  listPreview: { flex: 0, minHeight: 42, height: 42, marginBottom: 0, marginHorizontal: 4 },
  nativePreview: { width: '100%', flex: 1 },
  sample: { width: '100%' },
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
