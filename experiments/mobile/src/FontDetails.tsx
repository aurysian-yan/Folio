import { CaretLeftIcon, CheckIcon, CopyIcon, FolderPlusIcon, StarIcon } from 'phosphor-react-native';
import { useRef, useState } from 'react';
import { FlatList, PixelRatio, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { FontFace, FontFamily, LibrarySnapshot } from './library';
import { FamilyCollectionsPanel } from './CollectionsPanel';
import { copyText, NativeFontPreview, type PreviewStatus } from './native';
import { IconButton, type Theme } from './ui';

// 字体二级页展示家族字款，并承接复制与收藏操作。
export function FontDetails({ family, theme, snapshot, collectionId, onSnapshotChange, onClose, onFavorite }: {
  family: FontFamily;
  theme: Theme;
  snapshot: LibrarySnapshot | null;
  collectionId?: string;
  onSnapshotChange: (snapshot: LibrarySnapshot) => void;
  onClose: () => void;
  onFavorite: () => Promise<void>;
}) {
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
    } catch { setError('无法复制字体名称，请重试。'); }
  }

  async function favorite() {
    if (favoriteInFlight.current) return;
    favoriteInFlight.current = true;
    setFavoritePending(true);
    try {
      await onFavorite();
      setError(null);
    } catch { setError('无法更新收藏，请重试。'); }
    finally { favoriteInFlight.current = false; setFavoritePending(false); }
  }

  return <SafeAreaProvider>
      <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
        <View accessibilityViewIsModal style={styles.screen}>
          <View style={styles.header}>
            <IconButton theme={theme} label="返回字体库" systemImage="chevron.left" onPress={onClose}>
              <CaretLeftIcon size={20} color={theme.label} />
            </IconButton>
            <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: theme.label }]}>{family.displayName}</Text>
            <IconButton theme={theme} label={copied ? '已复制字体名称' : '复制字体名称'}
              systemImage={copied ? 'checkmark' : 'document.on.document'} onPress={copy}>
              {copied ? <CheckIcon size={20} color={theme.accent} /> : <CopyIcon size={20} color={theme.label} />}
            </IconButton>
            <IconButton theme={theme} label={family.isFavorite ? '取消收藏' : '收藏字体'}
              systemImage={family.isFavorite ? 'star.fill' : 'star'}
              disabled={favoritePending} selected={family.isFavorite} onPress={favorite}>
              <StarIcon size={20} weight={family.isFavorite ? 'fill' : 'regular'} color={family.isFavorite ? theme.accent : theme.label} />
            </IconButton>
            <IconButton theme={theme} label="添加到收藏夹" systemImage="folder.badge.plus"
              onPress={() => setCollectionsOpen(true)}>
              <FolderPlusIcon size={20} color={theme.label} />
            </IconButton>
          </View>
          <FlatList data={family.faces} keyExtractor={(face) => face.id}
            contentContainerStyle={styles.content} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
            ListHeaderComponent={<View style={styles.summary}>
              <Text style={[styles.detail, { color: theme.secondary }]}>{family.faces.length}个样式</Text>
              {error && <Text accessibilityRole="alert" style={[styles.detail, { color: theme.danger }]}>{error}</Text>}
            </View>}
            renderItem={({ item }) => <FacePreview key={`${item.id}:${item.revisionId}`} face={item} familyName={family.displayName} theme={theme} />} />
          <FamilyCollectionsPanel visible={collectionsOpen} family={family} snapshot={snapshot} collectionId={collectionId}
            theme={theme} onSnapshot={onSnapshotChange} onClose={() => setCollectionsOpen(false)} />
        </View>
      </SafeAreaView>
  </SafeAreaProvider>;
}

function FacePreview({ face, familyName, theme }: { face: FontFace; familyName: string; theme: Theme }) {
  const [status, setStatus] = useState<PreviewStatus['status'] | null>(null);
  return <View style={[styles.face, { borderColor: theme.border }]}>
    <Text style={[styles.styleName, { color: theme.label }]}>{face.styleName}</Text>
    <View style={styles.preview}>
      {face.sourcePath && status !== 'error' && status !== 'missing-glyph' ? (
        <NativeFontPreview style={styles.screen} accessibilityLabel={`${familyName}，${face.styleName} 字体预览`}
          selection={{ sourcePath: face.sourcePath, faceIndex: face.faceIndex, revisionId: face.revisionId,
            axes: Object.fromEntries(face.axes.map((axis) => [axis.tag, axis.defaultValue])),
            text: 'Preview Text', fontSize: 24 * PixelRatio.getFontScale(), centered: false }}
          onStatus={(event) => setStatus(event.nativeEvent.status)} />
      ) : <Text style={[styles.detail, { color: theme.secondary }]}>
        {status === 'missing-glyph' ? '缺少预览字符' : '暂时无法预览'}
      </Text>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 18, fontWeight: '600' },
  content: { paddingHorizontal: 16, paddingBottom: 16 },
  summary: { paddingVertical: 12, gap: 8 },
  detail: { fontSize: 14, lineHeight: 20 },
  face: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  styleName: { fontSize: 16, lineHeight: 22, fontWeight: '500' },
  preview: { minHeight: 64, height: 64, justifyContent: 'center' },
});
