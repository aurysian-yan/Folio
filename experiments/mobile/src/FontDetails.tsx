import { CaretLeftIcon, CaretRightIcon, CheckIcon, CopyIcon } from './icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, ActivityIndicator, Animated, KeyboardAvoidingView, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { representativeFace, type FontFace, type FontFamily, type LibrarySnapshot } from './library';
import { PanelAction } from './panel-content';
import { FamilyCollectionsPanel } from './CollectionsPanel';
import { copyText, NativeFontPreview, type PreviewStatus } from './native';
import { IconButton, type Theme } from './ui';
import { NavigationBackdrop } from './bottom-navigation';
import { NativeScrollContainer } from './native-controls';
import { PageHeader, PageTitle, usePageHeader } from './PageHeader';
import { FontActionsMenu } from './FontActionsMenu';
import { SettingsGroup, settingsLayout, settingsTypography } from './settings-ui';
import { DetailSlider } from './DetailSlider';
import { adjustableAxes, axisStep, defaultAxisValues, detailPreviewSize, formatAxisValue, stepFaceId } from './font-details';

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

const axisLabelKeys: Record<string, string> = {
  wght: 'font.weight', wdth: 'filters.width', ital: 'fontFeature.italic',
  slnt: 'fontFeature.oblique', opsz: 'font.opticalSize',
};

// 字体详情复用设置页的分组、文字尺度与滚动导航。
export function FontDetails(props: FontDetailsProps) {
  return <SafeAreaProvider><FontDetailsContent {...props} /></SafeAreaProvider>;
}

function FontDetailsContent({ family, theme, snapshot, collectionId, recentError, onRetryRecent, onSnapshotChange, onClose, onFavorite }: FontDetailsProps) {
  const { t } = useTranslation();
  const scroll = useRef<ScrollView>(null);
  const styleScroll = useRef<ScrollView>(null);
  const styleLayouts = useRef(new Map<string, { x: number; width: number }>());
  const styleViewport = useRef(0);
  const header = usePageHeader({ bottomTabs: false,
    onSnap: (offset, animated) => scroll.current?.scrollTo({ y: offset, animated }) });
  const [favoritePending, setFavoritePending] = useState(false);
  const favoriteInFlight = useRef(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initialFace = representativeFace(family);
  const [selectedFaceId, setSelectedFaceId] = useState(initialFace?.id);
  const selectedFace = family.faces.find((face) => face.id === selectedFaceId) ?? initialFace;
  const faceKey = selectedFace ? `${selectedFace.id}:${selectedFace.revisionId}` : '';
  const faceIndex = selectedFace ? family.faces.findIndex((face) => face.id === selectedFace.id) : -1;
  const [previewText, setPreviewText] = useState(() => t('mobile.previewSample'));
  const [previewSize, setPreviewSize] = useState(detailPreviewSize.defaultValue);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [previewStatus, setPreviewStatus] = useState<{ key: string; result: PreviewStatus } | null>(null);

  // 轴值跟随字款与版本身份重置。
  const [axisState, setAxisState] = useState<{ key: string; values: Record<string, number> }>(
    () => ({ key: faceKey, values: defaultAxisValues(selectedFace) }));
  const axisValues = axisState.key === faceKey ? axisState.values : defaultAxisValues(selectedFace);
  const axes = adjustableAxes(selectedFace);
  const variable = family.faces.some((face) => adjustableAxes(face).length > 0);
  const fontSize = Math.min(160, previewSize * PixelRatio.getFontScale());
  const result = previewStatus?.key === faceKey ? previewStatus.result : null;
  const previewHeight = Math.max(200, result?.contentHeight ?? 0);
  const showFallback = !selectedFace?.sourcePath || result?.status === 'error' || result?.status === 'missing-glyph';

  function revealStyle() {
    const layout = selectedFace ? styleLayouts.current.get(selectedFace.id) : undefined;
    if (layout && styleViewport.current > 0) styleScroll.current?.scrollTo({
      x: Math.max(0, layout.x - (styleViewport.current - layout.width) / 2), animated: !header.reduceMotion,
    });
  }

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  useEffect(revealStyle, [selectedFace, header.reduceMotion]);

  async function copyValue(id: string, value: string) {
    try {
      await copyText(value);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      setCopied(id);
      setError(null);
      AccessibilityInfo.announceForAccessibility(t('common.copied'));
      copyTimer.current = setTimeout(() => setCopied(null), 2000);
    } catch { setError(t('mobile.errorCopyName')); }
  }

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
        favoritePending={favoritePending} onFavorite={favorite} onAddToCollection={() => setCollectionsOpen(true)} />} />
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
                {!!selectedFace?.sourcePath && previewWidth > 0 && <NativeFontPreview key={faceKey} style={styles.fill}
                  accessibilityLabel={t('mobile.previewLabel', { name: family.displayName, style: selectedFace.styleName })}
                  selection={{ sourcePath: selectedFace.sourcePath, faceIndex: selectedFace.faceIndex, revisionId: selectedFace.revisionId,
                    axes: axisValues, text: previewText, fontSize, centered: true, wrapWidth: previewWidth }}
                  onStatus={(event) => setPreviewStatus({ key: faceKey, result: event.nativeEvent })} />}
                {showFallback ? <View style={styles.previewOverlay} pointerEvents="none">
                  <Text accessibilityLiveRegion="polite" style={[styles.previewFallback, { color: theme.secondary }]}>
                    {result?.status === 'missing-glyph' ? t('mobile.missingPreviewChars') : t('mobile.previewUnavailable')}
                  </Text>
                </View> : !result && <View style={styles.previewOverlay} pointerEvents="none">
                  <ActivityIndicator accessibilityLabel={t('preview.loading')} color={theme.secondary} />
                </View>}
              </View>
            </View>
            <View style={styles.previewMeta}>
              <View style={styles.styleHeading}>
                <Text style={[styles.body, { color: theme.label }]}>{selectedFace?.styleName ?? family.displayName}</Text>
                {faceIndex >= 0 && family.faces.length > 1 && <Text style={[styles.detail, { color: theme.secondary }]}>
                  {t('common.indexOfTotal', { index: faceIndex + 1, total: family.faces.length })}
                </Text>}
              </View>
              {family.faces.length > 1 && <View style={styles.styleNavigation}>
                <PreviewNavButton side="left" theme={theme} disabled={faceIndex <= 0} label={t('mobile.previousStyle')}
                  onPress={() => setSelectedFaceId(stepFaceId(family.faces, selectedFace?.id, -1))} />
                <PreviewNavButton side="right" theme={theme} disabled={faceIndex < 0 || faceIndex >= family.faces.length - 1}
                  label={t('mobile.nextStyle')} onPress={() => setSelectedFaceId(stepFaceId(family.faces, selectedFace?.id, 1))} />
              </View>}
            </View>
            <View style={styles.previewEditor}>
              <Text style={[styles.detail, { color: theme.secondary }]}>{t('preview.customText')}</Text>
              <TextInput value={previewText} onChangeText={setPreviewText} placeholder={t('preview.inputText')}
                placeholderTextColor={theme.muted} selectionColor={theme.selection} cursorColor={theme.accent}
                accessibilityLabel={t('preview.customText')} style={[styles.previewTextInput, { color: theme.label, backgroundColor: theme.raised }]}
                multiline scrollEnabled={false} textAlignVertical="top" autoCapitalize="none" autoCorrect={false}
                returnKeyType="done" submitBehavior="blurAndSubmit" />
            </View>
            <DetailSlider label={t('preview.size')} value={previewSize} minimum={detailPreviewSize.minimum}
              maximum={detailPreviewSize.maximum} step={1} formatValue={(value) => String(Math.round(value))}
              onChange={setPreviewSize} theme={theme} />
          </SettingsGroup>

          {family.faces.length > 1 && <SettingsGroup theme={theme} title={t('font.styles')}>
            <ScrollView ref={styleScroll} horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}
              onLayout={(event) => { styleViewport.current = event.nativeEvent.layout.width; revealStyle(); }}
              accessibilityRole="radiogroup" accessibilityLabel={t('font.styles')} contentContainerStyle={styles.chips}>
              {family.faces.map((face) => <Pressable key={face.id} accessibilityRole="radio" accessibilityLabel={face.styleName}
                accessibilityState={{ selected: face.id === selectedFace?.id }} onPress={() => setSelectedFaceId(face.id)}
                onLayout={(event) => { styleLayouts.current.set(face.id, event.nativeEvent.layout); if (face.id === selectedFace?.id) revealStyle(); }}
                style={({ pressed }) => [styles.chip, { backgroundColor: face.id === selectedFace?.id ? theme.accent : theme.raised,
                  opacity: pressed ? 0.7 : 1 }]}>
                <Text style={[styles.chipLabel, { color: face.id === selectedFace?.id ? theme.onAccent : theme.label }]}>{face.styleName}</Text>
              </Pressable>)}
            </ScrollView>
          </SettingsGroup>}

          {axes.length > 0 && <SettingsGroup theme={theme} title={t('inspector.variableAxes')}>
            {axes.map((axis) => <DetailSlider key={`${faceKey}:${axis.tag}`} label={axisLabelKeys[axis.tag] ? t(axisLabelKeys[axis.tag]!) : axis.name}
              value={axisValues[axis.tag] ?? axis.defaultValue} minimum={axis.minimum} maximum={axis.maximum}
              step={axisStep(axis.minimum, axis.maximum)} formatValue={formatAxisValue}
              onChange={(value) => setAxisState({ key: faceKey, values: { ...axisValues, [axis.tag]: value } })} theme={theme} />)}
          </SettingsGroup>}

          <SettingsGroup theme={theme} title={t('inspector.copyAs')}>
            {copyOptions.map((option) => <Pressable key={option.id} accessibilityRole="button"
              accessibilityLabel={`${t(copied === option.id ? 'common.copied' : 'inspector.copyAs')} ${option.label}`}
              onPress={() => { void copyValue(option.id, option.value); }}
              style={({ pressed }) => [styles.copyRow, { backgroundColor: pressed ? theme.raised : undefined }]}>
              <View style={styles.copyBody}>
                <Text style={[styles.body, { color: theme.label }]}>{option.label}</Text>
                {!!option.detail && <Text style={[styles.detail, { color: theme.secondary }]}>{option.detail}</Text>}
              </View>
              {copied === option.id ? <>
                <Text style={[styles.detail, { color: theme.accent }]}>{t('common.copied')}</Text>
                <CheckIcon size={20} color={theme.accent} />
              </> : <CopyIcon size={20} color={theme.secondary} />}
            </Pressable>)}
          </SettingsGroup>
        </Animated.ScrollView>
      </NavigationBackdrop>
      <FamilyCollectionsPanel visible={collectionsOpen} family={family} snapshot={snapshot} collectionId={collectionId}
        theme={theme} onSnapshot={onSnapshotChange} onClose={() => setCollectionsOpen(false)} />
    </NativeScrollContainer>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

// 字款导航保留 44 点触摸区域，独立于字形展示。
function PreviewNavButton({ side, disabled, label, onPress, theme }: {
  side: 'left' | 'right'; disabled: boolean; label: string; onPress: () => void; theme: Theme;
}) {
  const Icon = side === 'left' ? CaretLeftIcon : CaretRightIcon;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [styles.navButton, { backgroundColor: theme.raised, opacity: disabled ? 0.35 : pressed ? 0.7 : 1 }]}>
    <Icon size={20} color={theme.label} />
  </Pressable>;
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
  previewStage: { ...settingsLayout.section, paddingVertical: 16 },
  previewContent: { width: '100%', overflow: 'hidden' },
  previewOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  previewFallback: { ...settingsTypography.detail, textAlign: 'center' },
  previewMeta: { ...settingsLayout.row, paddingTop: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  styleHeading: { flex: 1, minWidth: 0, gap: 4 },
  styleNavigation: { flexDirection: 'row', gap: 8 },
  navButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  previewEditor: { ...settingsLayout.section, gap: 8 },
  previewTextInput: { ...settingsLayout.control, ...settingsTypography.body, fontWeight: '400', minHeight: 64, padding: 12 },
  chips: { ...settingsLayout.formControls, flexDirection: 'row', gap: 8 },
  chip: { ...settingsLayout.formControl, minHeight: 44, minWidth: 64, paddingHorizontal: 16, paddingVertical: 12,
    alignItems: 'center', justifyContent: 'center' },
  chipLabel: { ...settingsTypography.detail, fontWeight: '500' },
  copyRow: { minHeight: 64, ...settingsLayout.row, flexDirection: 'row', alignItems: 'center', gap: 12 },
  copyBody: { flex: 1, minWidth: 0, gap: 4 },
});
