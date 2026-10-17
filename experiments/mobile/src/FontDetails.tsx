import { CaretLeftIcon, EqualsIcon } from './icons';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Animated, KeyboardAvoidingView, PanResponder, PixelRatio, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { representativeFace, type FontFace, type FontFamily, type LibrarySnapshot } from './library';
import { PanelAction } from './panel-content';
import { FamilyCollectionsPanel } from './CollectionsPanel';
import { NativeFontPreview, type PreviewStatus } from './native';
import { CopyButton } from './CopyButton';
import { IconButton, type Theme } from './ui';
import { NavigationBackdrop } from './bottom-navigation';
import { NativeScrollContainer } from './native-controls';
import { PageHeader, PageTitle, usePageHeader } from './PageHeader';
import { FontActionsMenu } from './FontActionsMenu';
import { SettingsGroup, SettingsNavRow, settingsLayout, settingsTypography } from './settings-ui';
import { DetailSlider } from './DetailSlider';
import { CharacterMap } from './CharacterMap';
import { FontNavigation } from './FontNavigation';
import { FontStylePicker } from './FontStylePicker';
import { FontStorageCard } from './FontStorageCard';
import { adjustableAxes, axisStep, clampAxisValue, defaultAxisValues, detailPreviewHeight, detailPreviewSize, formatAxisValue } from './font-details';

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
  onFileAction: (fingerprint: string,action: "download" | "cloudOnly" | "excludeUpload" | "includeUpload") => Promise<void>;
}

const axisLabelKeys: Record<string, string> = {
  wght: 'font.weight', wdth: 'filters.width', ital: 'fontFeature.italic',
  slnt: 'fontFeature.oblique', opsz: 'font.opticalSize',
};

// 字体详情复用设置页的分组、文字尺度与滚动导航。
export function FontDetails(props: FontDetailsProps) {
  const [target, setTarget] = useState<{ face: FontFace; axes: Record<string, number> } | null>(null);
  const [visible, setVisible] = useState(false);
  const navigating = useRef(false);
  const exiting = useRef(false);
  const deferredCloses = useRef(new Set<() => void>());
  useEffect(() => {
    const sessions = deferredCloses.current;
    return () => { exiting.current = false; for (const close of sessions) close(); sessions.clear(); };
  }, []);
  const finishNavigation = () => {
    for (const close of deferredCloses.current) close();
    deferredCloses.current.clear();
    exiting.current = false;
    navigating.current = false;
    setVisible(false);
    setTarget(null);
  };
  return <SafeAreaProvider><FontNavigation theme={props.theme} visible={visible} onDismissed={finishNavigation}
    detail={target && <CharacterMap family={props.family} initialFace={target.face} initialAxes={target.axes} theme={props.theme}
      onClose={() => { exiting.current = true; setVisible(false); }}
      deferClose={(close) => {
        if (!exiting.current) return false;
        deferredCloses.current.add(close);
        return true;
      }}
      onDownload={(fingerprint) => props.onFileAction(fingerprint, 'download')} />}>
    <FontDetailsContent {...props} onOpenCharacterMap={(face, axes) => {
      if (navigating.current) return;
      navigating.current = true;
      setTarget({ face, axes });
      setVisible(true);
    }} />
  </FontNavigation></SafeAreaProvider>;
}

function FontDetailsContent({ family, theme, snapshot, collectionId, recentError, onRetryRecent, onSnapshotChange, onClose, onFavorite, onFileAction, onOpenCharacterMap }: FontDetailsProps & { onOpenCharacterMap: (face: FontFace, axes: Record<string, number>) => void }) {
  const { t } = useTranslation();
  const scroll = useRef<ScrollView>(null);
  const header = usePageHeader({ bottomTabs: false,
    onSnap: (offset, animated) => scroll.current?.scrollTo({ y: offset, animated }) });
  const [favoritePending, setFavoritePending] = useState(false);
  const favoriteInFlight = useRef(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialFace = representativeFace(family);
  const [selectedFaceId, setSelectedFaceId] = useState(initialFace?.id);
  const selectedFace = family.faces.find((face) => face.id === selectedFaceId) ?? initialFace;
  const faceKey = selectedFace ? `${selectedFace.id}:${selectedFace.revisionId}` : '';
  const [previewText, setPreviewText] = useState(() => t('mobile.previewSample'));
  const [previewTextEventCount, setPreviewTextEventCount] = useState(0);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [previewSize, setPreviewSize] = useState(detailPreviewSize.defaultValue);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [previewHeight, setPreviewHeight] = useState(detailPreviewHeight.defaultValue);
  const [previewStatus, setPreviewStatus] = useState<{ key: string; identity: string; result: PreviewStatus } | null>(null);

  // 轴值跟随字款与版本身份重置。
  const [axisState, setAxisState] = useState<{ key: string; values: Record<string, number> }>(
    () => ({ key: faceKey, values: defaultAxisValues(selectedFace) }));
  const axisValues = axisState.key === faceKey ? axisState.values : defaultAxisValues(selectedFace);
  const axes = adjustableAxes(selectedFace);
  const variable = family.faces.some((face) => adjustableAxes(face).length > 0);
  const fontSize = Math.min(160, previewSize * PixelRatio.getFontScale());
  const previewIdentity = JSON.stringify([faceKey, selectedFace?.sourcePath, selectedFace?.faceIndex]);
  const previewKey = JSON.stringify([previewIdentity, axisValues, previewText, fontSize, previewWidth, theme.label, previewRetry]);
  const result = previewStatus?.key === previewKey ? previewStatus.result : null;
  const committed = previewStatus?.identity === previewIdentity ? previewStatus.result : null;
  const showFallback = !selectedFace?.sourcePath || result?.status === 'error' || result?.status === 'missing-glyph';
  const previewChanged = previewText !== t('mobile.previewSample') || previewSize !== detailPreviewSize.defaultValue
    || axes.some((axis) => axisValues[axis.tag] !== axis.defaultValue);

  async function favorite() {
    if (favoriteInFlight.current) return;
    favoriteInFlight.current = true;
    setFavoritePending(true);
    try { await onFavorite(); setError(null); }
    catch { setError(t('mobile.errorFavorite')); }
    finally { favoriteInFlight.current = false; setFavoritePending(false); }
  }

  const copyOptions = [
    { id: 'family', label: t('font.familyName'), detail: family.displayName, value: family.displayName },
    { id: 'css', label: t('inspector.copyCSS'), value: `font-family: "${family.displayName}";` },
    { id: 'font-face', label: t('inspector.copyCSSFontFace'), value: cssFontFace(family, selectedFace) },
    { id: 'swiftui', label: t('inspector.copySwiftUI'), value: swiftUIFont(family) },
  ];

  return <SafeAreaView edges={['left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <NativeScrollContainer accessibilityViewIsModal hasHeader onInsetsChange={header.onInsetsChange} style={styles.screen}>
      <PageHeader {...header} title={family.displayName} theme={theme} style={styles.header} leading={
        <IconButton theme={theme} label={t('mobile.backToLibrary')} systemImage="chevron.left" onPress={onClose}>
          <CaretLeftIcon size={20} color={theme.label} />
        </IconButton>
      } actions={<FontActionsMenu theme={theme} sourceId={header.sourceId} favorite={family.isFavorite}
        favoritePending={favoritePending} onFavorite={favorite} onAddToCollection={() => setCollectionsOpen(true)}
        resetDisabled={!previewChanged} onReset={() => {
          setPreviewText(t('mobile.previewSample'));
          setPreviewSize(detailPreviewSize.defaultValue);
          setAxisState({ key: faceKey, values: defaultAxisValues(selectedFace) });
        }} />} />
      <NavigationBackdrop sourceId={header.sourceId} active theme={theme} style={styles.screen}>
        <Animated.ScrollView ref={scroll} {...header.snapScrollProps} onScroll={header.onScroll} scrollEventThrottle={16}
          contentInsetAdjustmentBehavior="never" automaticallyAdjustsScrollIndicatorInsets={false}
          scrollIndicatorInsets={{ top: header.contentTop, bottom: header.contentBottom }}
          contentContainerStyle={[settingsLayout.content, { paddingTop: header.contentTop, paddingBottom: header.contentBottom }]}
          keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View>
            <PageTitle {...header} title={family.displayName} theme={theme} style={settingsLayout.pageTitle} />
            <Text style={[styles.summary, { color: theme.secondary }]}>
              {t('macos.stylesCount', { count: family.faces.length })}{variable ? ` · ${t('font.variable')}` : ''}
            </Text>
          </View>
          {(recentError || error) && <View style={styles.feedback}>
            {!!recentError && <View style={styles.feedback}>
              <Text accessibilityRole="alert" style={[styles.detail, { color: theme.danger }]}>{recentError}</Text>
              <PanelAction label={t('common.retry')} theme={theme} onPress={onRetryRecent} />
            </View>}
            {!!error && <Text accessibilityRole="alert" style={[styles.detail, { color: theme.danger }]}>{error}</Text>}
          </View>}

          <SettingsGroup theme={theme}>
            <View style={styles.previewStage}>
              <View onLayout={(event) => setPreviewWidth(event.nativeEvent.layout.width)}
                style={[styles.previewContent, { height: previewHeight }]}>
                {selectedFace && previewWidth > 0 && <NativeFontPreview key={previewIdentity} style={styles.fill} editable
                  tintColor={theme.accent} mostRecentTextEventCount={previewTextEventCount}
                  accessibilityLabel={t('mobile.previewLabel', { name: family.displayName, style: selectedFace.styleName })}
                  selection={{ requestId: previewKey, sourcePath: selectedFace.sourcePath ?? '', faceIndex: selectedFace.faceIndex, revisionId: selectedFace.revisionId,
                    axes: axisValues, text: previewText, fontSize, centered: true, wrapWidth: previewWidth, foregroundColor: theme.label }}
                  onTextChange={({ nativeEvent }) => {
                    setPreviewTextEventCount(nativeEvent.eventCount);
                    setPreviewText(nativeEvent.text);
                  }}
                  onStatus={(event) => {
                    if (event.nativeEvent.requestId === previewKey) setPreviewStatus({ key: previewKey, identity: previewIdentity, result: event.nativeEvent });
                  }} />}
                {!showFallback && !result && !committed && <View style={styles.previewOverlay} pointerEvents="none">
                  <ActivityIndicator accessibilityLabel={t('preview.loading')} color={theme.secondary} />
                </View>}
              </View>
              {showFallback && <View style={styles.previewFeedback}>
                <Text accessibilityLiveRegion="polite" style={[styles.previewFallback, { color: theme.secondary }]}>
                  {result?.status === 'missing-glyph' ? t('mobile.missingPreviewChars') : t(selectedFace?.location?.cloudAvailable && !selectedFace.location.localAvailable ? 'fontLocation.previewHint' : 'mobile.previewUnavailable')}
                </Text>
                {result?.status === 'error' && <PanelAction label={t('common.retry')} theme={theme} onPress={() => setPreviewRetry((value) => value + 1)} />}
              </View>}
              <PreviewResizeHandle height={previewHeight} onChange={setPreviewHeight} theme={theme} />
            </View>
            {selectedFace && <FontStylePicker faces={family.faces} selectedFaceId={selectedFace.id}
              onChange={setSelectedFaceId} theme={theme} sourceId={header.sourceId} />}
            <DetailSlider label={t('preview.size')} value={previewSize} minimum={detailPreviewSize.minimum}
              maximum={detailPreviewSize.maximum} step={1} formatValue={(value) => String(Math.round(value))}
              onChange={setPreviewSize} theme={theme} />
          </SettingsGroup>

          {axes.length > 0 && <SettingsGroup theme={theme} title={t('inspector.variableAxes')}>
            {axes.map((axis) => <DetailSlider key={`${faceKey}:${axis.tag}`} label={axisLabelKeys[axis.tag] ? t(axisLabelKeys[axis.tag]!) : axis.name}
              value={axisValues[axis.tag] ?? axis.defaultValue} minimum={axis.minimum} maximum={axis.maximum}
              step={axisStep(axis.minimum, axis.maximum)} formatValue={formatAxisValue}
              onChange={(value) => setAxisState({ key: faceKey, values: { ...axisValues, [axis.tag]: value } })} theme={theme} />)}
          </SettingsGroup>}

          {selectedFace && <SettingsGroup theme={theme}>
            <SettingsNavRow title={t('characterMap.title')} theme={theme} last
              onPress={() => onOpenCharacterMap(selectedFace, axisValues)} />
          </SettingsGroup>}
          <SettingsGroup theme={theme} title={t('inspector.copyAs')}>
            {copyOptions.map((option) => <CopyButton key={option.id} label={option.label} value={option.value}
              detail={option.detail} variant="row" theme={theme} onSuccess={() => setError(null)}
              onError={() => setError(t('mobile.errorCopyName'))} />)}
          </SettingsGroup>
          <FontStorageCard family={family} face={selectedFace} theme={theme} onAction={onFileAction} />
        </Animated.ScrollView>
      </NavigationBackdrop>
      <FamilyCollectionsPanel visible={collectionsOpen} family={family} snapshot={snapshot} collectionId={collectionId}
        theme={theme} onSnapshot={onSnapshotChange} onClose={() => setCollectionsOpen(false)} />
    </NativeScrollContainer>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

// 拖动手柄只调整视口高度，不改变字号或字体轴。
function PreviewResizeHandle({ height, onChange, theme }: { height: number; onChange: (height: number) => void; theme: Theme }) {
  const { t } = useTranslation();
  const inputs = useRef({ height, onChange });
  const origin = useRef(height);
  useLayoutEffect(() => { inputs.current = { height, onChange }; }, [height, onChange]);
  const clampHeight = (value: number) => Math.round(clampAxisValue(value, detailPreviewHeight.minimum, detailPreviewHeight.maximum));
  // 手势回调仅在触摸事件中读取最新受控值。
  // eslint-disable-next-line react-hooks/refs
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { origin.current = inputs.current.height; },
    onPanResponderMove: (_event, gesture) => inputs.current.onChange(clampHeight(origin.current + gesture.dy)),
    onPanResponderTerminationRequest: () => false,
  }), []);
  return <View style={styles.previewResize} {...responder.panHandlers} accessible accessibilityRole="adjustable"
    accessibilityLabel={t('preview.resizeHeight')}
    accessibilityValue={{ min: detailPreviewHeight.minimum, max: detailPreviewHeight.maximum, now: height }}
    accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
    onAccessibilityAction={({ nativeEvent }) => onChange(clampHeight(height + (nativeEvent.actionName === 'increment' ? 16 : -16)))}>
    <EqualsIcon size={20} color={theme.secondary} />
  </View>;
}

function cssFontFace(family: FontFamily, face: FontFace | undefined) {
  const fileName = face?.sourcePath ? face.sourcePath.split('/').pop() ?? 'font-file' : 'font-file';
  return `@font-face {\n  font-family: "${family.displayName}";\n  src: url("${fileName}");\n  font-style: normal;\n}`;
}

function swiftUIFont(family: FontFamily) {
  return `.font(.custom("${family.displayName}", size: 16))`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fill: { ...StyleSheet.absoluteFill },
  header: { paddingHorizontal: 16 },
  summary: { ...settingsTypography.detail, ...settingsLayout.section },
  feedback: { ...settingsLayout.section, gap: 8 },
  body: { ...settingsTypography.body },
  detail: { ...settingsTypography.detail },
  previewStage: { ...settingsLayout.section, paddingVertical: 16, gap: 8 },
  previewContent: { width: '100%', overflow: 'hidden' },
  previewOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 8 },
  previewFallback: { ...settingsTypography.detail, textAlign: 'center' },
  previewFeedback: { alignItems: 'center', gap: 8 },
  previewResize: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
