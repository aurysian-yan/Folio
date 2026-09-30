import { getDocumentAsync } from 'expo-document-picker';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Button, FlatList, PixelRatio, Platform, PlatformColor,
  Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LibraryError, type FontFace, type LibraryPage } from './library';
import { library, NativeFontPreview, type PreviewStatus } from './native';

const textColor = PlatformColor(Platform.OS === 'ios' ? 'label' : '?android:attr/textColorPrimary');
const backgroundColor = PlatformColor(Platform.OS === 'ios' ? 'systemBackground' : '?android:attr/colorBackground');
const pageSize = 40;
const emptyPage: LibraryPage = { totalMatches: 0, families: [] };

function LibraryScreen() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [text, setText] = useState('');
  const [offset, setOffset] = useState(0);
  const [loadedQuery, setLoadedQuery] = useState({ key: '', page: emptyPage });
  const [importing, setImporting] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selectedFace, setSelectedFace] = useState<FontFace | null>(null);
  const [previewText, setPreviewText] = useState('Hamburgefontsiv 012345');
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus['status'] | null>(null);
  const queryKey = JSON.stringify([text, offset, revision, retry]);
  const loading = ready && loadedQuery.key !== queryKey;
  const page = loading ? emptyPage : loadedQuery.page;

  useEffect(() => {
    let active = true;
    library.initialize().then(() => {
      if (active) { setReady(true); setError(null); }
    }).catch(() => {
      if (active) setError('无法打开字体库，请重试。');
    });
    return () => { active = false; };
  }, [retry]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    library.query({ text, scope: 'all', offset, limit: pageSize }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setLoadedQuery({ key: queryKey, page: result });
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && !(cause instanceof LibraryError && cause.code === 'cancelled')) {
          setError('暂时无法读取字体库，请重试。');
          setLoadedQuery({ key: queryKey, page: emptyPage });
        }
      });
    return () => controller.abort();
  }, [ready, text, offset, queryKey]);

  async function importFont() {
    setImporting(true);
    setError(null);
    try {
      const result = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;
      await library.importFont(asset.uri);
      setOffset(0);
      setSelectedFace(null);
      setPreviewStatus(null);
      setRevision((value) => value + 1);
    } catch {
      setError('无法导入此文件，请选择可读取的 TTF、OTF、TTC 或 OTC 字体。');
    } finally {
      setImporting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor }}>
      <StatusBar style="auto" />
      <Text accessibilityRole="header" style={{ color: textColor }}>Folio</Text>
      <Button title={importing ? '正在导入…' : '导入字体'} disabled={!ready || importing} onPress={importFont} />
      <TextInput
        accessibilityLabel="搜索字体" placeholder="搜索字体" style={{ color: textColor }}
        value={text} editable={ready} onChangeText={(value) => { setText(value); setOffset(0); }}
        autoCorrect={false} returnKeyType="search"
      />
      {error && (
        <View>
          <Text accessibilityRole="alert" style={{ color: textColor }}>{error}</Text>
          <Button title="重试" onPress={() => setRetry((value) => value + 1)} />
        </View>
      )}
      {loading && <ActivityIndicator accessibilityLabel="正在读取字体库" />}
      <FlatList
        data={page.families} keyExtractor={(family) => family.id}
        renderItem={({ item }) => (
          <View>
            <Text style={{ color: textColor }}>{item.displayName}</Text>
            {item.faces.map((face) => (
              <Button key={face.id} title={face.styleName} onPress={() => {
                setSelectedFace(face); setPreviewStatus(null);
              }} />
            ))}
          </View>
        )}
        ListEmptyComponent={ready && !loading && !error
          ? <Text style={{ color: textColor }}>{text ? '没有匹配的字体。' : '导入字体，开始建立字体库。'}</Text> : null}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Button title="上一页" disabled={loading || offset === 0} onPress={() => setOffset(Math.max(0, offset - pageSize))} />
        <Text style={{ color: textColor }}>{page.totalMatches} 个字体家族</Text>
        <Button title="下一页" disabled={loading || offset + pageSize >= page.totalMatches} onPress={() => setOffset(offset + pageSize)} />
      </View>
      {selectedFace && (
        <View>
          <Text style={{ color: textColor }}>{selectedFace.styleName}</Text>
          <TextInput accessibilityLabel="预览文字" value={previewText}
            onChangeText={(value) => { setPreviewText(value); setPreviewStatus(null); }} style={{ color: textColor }} />
          {selectedFace.sourcePath ? (
            <NativeFontPreview
              key={selectedFace.id}
              style={{ height: 32 * 3 * PixelRatio.getFontScale() }}
              accessibilityLabel={`字体预览：${previewText}`}
              selection={{ sourcePath: selectedFace.sourcePath, faceIndex: selectedFace.faceIndex,
                revisionId: selectedFace.revisionId, text: previewText,
                axes: Object.fromEntries(selectedFace.axes.map((axis) => [axis.tag, axis.defaultValue])) }}
              onStatus={(event) => setPreviewStatus(event.nativeEvent.status)}
            />
          ) : <Text style={{ color: textColor }}>字体文件不可用。</Text>}
          {previewStatus === 'missing-glyph' && <Text style={{ color: textColor }}>此字体不包含当前预览文字。</Text>}
          {previewStatus === 'error' && <Text style={{ color: textColor }}>暂时无法预览此字体。</Text>}
        </View>
      )}
    </SafeAreaView>
  );
}

export default function App() {
  return <SafeAreaProvider><LibraryScreen /></SafeAreaProvider>;
}
