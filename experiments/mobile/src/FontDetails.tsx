import { CaretLeftIcon, CheckIcon, CopyIcon, FolderPlusIcon, StarIcon } from './icons';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, PixelRatio, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { FontFace, FontFamily, LibrarySnapshot } from './library';
import { PanelAction } from './panel-content';
import { FamilyCollectionsPanel } from './CollectionsPanel';
import { copyText, NativeFontPreview, type PreviewStatus } from './native';
import { IconButton, type Theme } from './ui';
import { NavigationBackdrop } from './bottom-navigation';
import { NativeScrollContainer } from './native-controls';
import { PageHeader, PageTitle, usePageHeader } from './PageHeader';

interface FontDetailsProps {
  family: FontFamily;
  theme: Theme;
  snapshot: LibrarySnapshot | null;
  collectionId?: string;
  recentError: string | null;
  onRetryRecent: () => void;
  onSnapshotChange: (snapshot: LibrarySnapshot) => void;
  onClose: () => void;
  onFavorite: () => Promise<void>;
}

// 字体二级页展示家族字款，并承接复制与收藏操作。
export function FontDetails(props: FontDetailsProps) {
  return <SafeAreaProvider><FontDetailsContent {...props} /></SafeAreaProvider>;
}

function FontDetailsContent({ family, theme, snapshot, collectionId, recentError, onRetryRecent, onSnapshotChange, onClose, onFavorite }: FontDetailsProps) {
  const { t } = useTranslation();
  const header = usePageHeader({ bottomTabs: false });
  const [favoritePending, setFavoritePending] = useState(false);
  const favoriteInFlight = useRef(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    try {
      await copyText(family.displayName);
      setCopied(true);
      setError(null);
    } catch { setError(t('mobile.errorCopyName')); }
  }

  async function favorite() {
    if (favoriteInFlight.current) return;
    favoriteInFlight.current = true;
    setFavoritePending(true);
    try {
      await onFavorite();
      setError(null);
    } catch { setError(t('mobile.errorFavorite')); }
    finally { favoriteInFlight.current = false; setFavoritePending(false); }
  }

  return <SafeAreaView edges={['left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
        <NativeScrollContainer accessibilityViewIsModal hasHeader onInsetsChange={header.onInsetsChange} style={styles.screen}>
          <PageHeader {...header} title={family.displayName} theme={theme} style={styles.header} leading={
            <IconButton theme={theme} label={t('mobile.backToLibrary')} systemImage="chevron.left" onPress={onClose}>
              <CaretLeftIcon size={20} color={theme.label} />
            </IconButton>
          } actions={<>
            <IconButton theme={theme} label={copied ? t('mobile.copiedName') : t('mobile.copyName')}
              systemImage={copied ? 'checkmark' : 'document.on.document'} onPress={copy}>
              {copied ? <CheckIcon size={20} color={theme.accent} /> : <CopyIcon size={20} color={theme.label} />}
            </IconButton>
            <IconButton theme={theme} label={family.isFavorite ? t('collection.unfavorite') : t('collection.favorite')}
              systemImage={family.isFavorite ? 'star.fill' : 'star'}
              disabled={favoritePending} selected={family.isFavorite} onPress={favorite}>
              <StarIcon size={20} weight={family.isFavorite ? 'fill' : 'regular'} color={family.isFavorite ? theme.accent : theme.label} />
            </IconButton>
            <IconButton theme={theme} label={t('collection.addTo')} systemImage="folder.badge.plus"
              onPress={() => setCollectionsOpen(true)}>
              <FolderPlusIcon size={20} color={theme.label} />
            </IconButton>
          </>} />
          <NavigationBackdrop sourceId={header.sourceId} active theme={theme} style={styles.screen}>
          <Animated.FlatList data={family.faces} keyExtractor={(face) => face.id}
            onScroll={header.onScroll} scrollEventThrottle={16}
            contentInsetAdjustmentBehavior="never" automaticallyAdjustsScrollIndicatorInsets={false}
            scrollIndicatorInsets={{ top: header.contentTop, bottom: header.contentBottom }}
            contentContainerStyle={[styles.content, { paddingTop: header.contentTop, paddingBottom: header.contentBottom }]}
            initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
            ListHeaderComponent={<View style={styles.summary}>
              <PageTitle title={family.displayName} theme={theme} collapsed={header.collapsed} />
              <Text style={[styles.detail, { color: theme.secondary }]}>{t('macos.stylesCount', { count: family.faces.length })}</Text>
              {recentError && <View><Text accessibilityRole="alert" style={[styles.detail, { color: theme.danger }]}>{recentError}</Text>
                <PanelAction label={t('common.retry')} theme={theme} onPress={onRetryRecent} /></View>}
              {error && <Text accessibilityRole="alert" style={[styles.detail, { color: theme.danger }]}>{error}</Text>}
            </View>}
            renderItem={({ item }) => <FacePreview key={`${item.id}:${item.revisionId}`} face={item} familyName={family.displayName} theme={theme} />} />
          </NavigationBackdrop>
          <FamilyCollectionsPanel visible={collectionsOpen} family={family} snapshot={snapshot} collectionId={collectionId}
            theme={theme} onSnapshot={onSnapshotChange} onClose={() => setCollectionsOpen(false)} />
        </NativeScrollContainer>
  </SafeAreaView>;
}

function FacePreview({ face, familyName, theme }: { face: FontFace; familyName: string; theme: Theme }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PreviewStatus['status'] | null>(null);
  return <View style={[styles.face, { borderColor: theme.border }]}>
    <Text style={[styles.styleName, { color: theme.label }]}>{face.styleName}</Text>
    <View style={styles.preview}>
      {face.sourcePath && status !== 'error' && status !== 'missing-glyph' ? (
        <NativeFontPreview style={styles.screen} accessibilityLabel={t('mobile.previewLabel', { name: familyName, style: face.styleName })}
          selection={{ sourcePath: face.sourcePath, faceIndex: face.faceIndex, revisionId: face.revisionId,
            axes: Object.fromEntries(face.axes.map((axis) => [axis.tag, axis.defaultValue])),
            text: 'Preview Text', fontSize: 24 * PixelRatio.getFontScale(), centered: false }}
          onStatus={(event) => setStatus(event.nativeEvent.status)} />
      ) : <Text style={[styles.detail, { color: theme.secondary }]}>
        {status === 'missing-glyph' ? t('mobile.missingPreviewChars') : t('mobile.previewUnavailable')}
      </Text>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16 },
  content: { paddingHorizontal: 16, paddingBottom: 16 },
  summary: { paddingVertical: 12, gap: 8 },
  detail: { fontSize: 14, lineHeight: 20 },
  face: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  styleName: { fontSize: 16, lineHeight: 22, fontWeight: '500' },
  preview: { minHeight: 64, height: 64, justifyContent: 'center' },
});
