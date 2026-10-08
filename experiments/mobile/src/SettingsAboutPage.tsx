import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Animated, FlatList, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import content from '../../../shared/about/content.json';
import glyphs from '../../../shared/about/glyphs.json';
import licenses from '../../../shared/about/licenses.json';
import { checkForUpdate, isAllowedExternalUrl, WordmarkVariation, type AppInfo, type UpdateResult } from '../../../shared/about/update';
import { getAboutInfo } from './native';
import { CaretLeftIcon, XIcon } from './icons';
import { SettingsActionRow, SettingsGroup, SettingsNavRow, SettingsNote, SettingsPage, settingsLayout, settingsTypography } from './settings-ui';
import { IconButton, type Theme } from './ui';

type LicenseEntry = typeof licenses.entries[number];
const AnimatedG = Animated.createAnimatedComponent(G);

// 字标与轮廓共享帧状态，始终占用相同画布。
function Wordmark({ frame, color, reduced, specimen = false }: { frame: number; color: string; reduced: boolean; specimen?: boolean }) {
  const [opacities] = useState(() => glyphs.map((_, index) => new Animated.Value(index === 0 ? 1 : 0)));
  useEffect(() => {
    const animation = Animated.parallel(opacities.map((opacity, index) => Animated.timing(opacity, {
      toValue: frame === index ? 1 : 0, duration: reduced ? 0 : 150, useNativeDriver: false,
    })));
    animation.start(); return () => animation.stop();
  }, [frame, opacities, reduced]);
  return <Svg width="100%" height="100%" viewBox={specimen ? '0 0 1024 700' : '0 0 1024 364'} accessible={false}>
    {glyphs.map((glyph, index) => <AnimatedG key={glyph.name} opacity={opacities[index]}>
      {specimen ? <>
        <G transform="translate(-740 -150) scale(2.4)">{glyph.paths.map((path, p) => <Path key={p} d={path} fill="none" stroke={color} strokeWidth={0.6} />)}</G>
        <G transform="translate(710 560) scale(1.7)">{glyph.paths.map((path, p) => <Path key={p} d={path} fill="none" stroke={color} strokeWidth={0.6} />)}</G>
      </> : glyph.paths.map((path, p) => <Path key={p} d={path} fill={color} />)}
    </AnimatedG>)}
    {specimen && <Path d="M0 144h140 M884 144h140 M0 556h100 M924 556h100 M96 128v32 M928 540v32" fill="none" stroke={color} />}
  </Svg>;
}
export function SettingsAboutPage({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [app, setApp] = useState<AppInfo>();
  const [frame, setFrame] = useState(0);
  const [reduced, setReduced] = useState(true);
  const reducedRef = useRef(true);
  const [update, setUpdate] = useState<UpdateResult>({ status: 'idle' });
  const [reader, setReader] = useState(false);
  const [selected, setSelected] = useState<LicenseEntry>();
  const [query, setQuery] = useState('');
  const [linkError, setLinkError] = useState(false);
  const variation = useRef<WordmarkVariation | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    const egg = new WordmarkVariation(setFrame, () => reducedRef.current); variation.current = egg;
    const setMotion = (value: boolean) => { if (active) { reducedRef.current = value; setReduced(value); } };
    void AccessibilityInfo.isReduceMotionEnabled().then(setMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setMotion);
    void Promise.resolve().then(getAboutInfo).then((value) => { if (active) setApp(value); }).catch(() => { if (active) setUpdate({ status: 'failed' }); });
    return () => { active = false; subscription.remove(); egg.dispose(); request.current?.abort(); variation.current = null; };
  }, []);
  async function open(url: string) {
    if (!isAllowedExternalUrl(url) && !licenses.entries.some((entry) => entry.source === url && url.startsWith('https://'))) { setLinkError(true); return; }
    try { await Linking.openURL(url); setLinkError(false); } catch { setLinkError(true); }
  }
  async function check() {
    if (!app || request.current) return;
    const controller = new AbortController(); request.current = controller; setUpdate({ status: 'checking' });
    const result = await checkForUpdate(app, undefined, controller.signal);
    if (!controller.signal.aborted) setUpdate(result);
    if (request.current === controller) request.current = null;
  }
  function closeReader() { setReader(false); setSelected(undefined); setQuery(''); }
  const licenseLabel = (value: string) => value === 'See notices' ? t('about.licenseNotices') : value;
  const entries = licenses.entries.filter((entry) => entry.platforms.includes(Platform.OS === 'ios' ? 'ios' : 'android')
    && `${entry.name} ${entry.version} ${licenseLabel(entry.license)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <>
    <SettingsPage title={t('settings.about')} theme={theme} onClose={onClose}>
      <View style={styles.home}>
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.specimen}>
          <Wordmark frame={frame} color={theme.label} reduced={reduced} specimen />
        </View>
        <View style={styles.hero}>
          <Pressable style={styles.logo} accessibilityRole="button" accessibilityLabel={t('about.logoLabel')} accessibilityHint={t('about.logoHint')}
            onPress={() => variation.current?.activate()} accessibilityActions={[{ name: 'play', label: t('about.play') }]}
            onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === 'play') variation.current?.play(); }}>
            <Wordmark frame={frame} color={theme.label} reduced={reduced} />
          </Pressable>
          <Text style={[settingsTypography.body, { color: theme.label, textAlign: 'center' }]}>{t('about.tagline')}</Text>
          <Text style={[settingsTypography.detail, { color: theme.secondary }]}>{app ? t('macos.versionWithBuild', { version: app.version, build: app.build }) : t('common.unknownVersion')}</Text>
          <Text style={[settingsTypography.detail, { color: theme.secondary }]}>{app ? t('about.platform', { platform: t(`about.platformNames.${app.platform}`), arch: app.arch }) : ''}</Text>
          <Text accessibilityLiveRegion="polite" style={[settingsTypography.detail, { color: theme.secondary }]}>{frame > 0 ? t('about.fontVariant', { font: glyphs[frame]?.name }) : '\u00a0'}</Text>
        </View>
        <SettingsGroup theme={theme}>
          <SettingsActionRow theme={theme} title={t(update.status === 'checking' ? 'about.checking' : 'about.check')} busy={update.status === 'checking'}
            disabled={!app || update.status === 'checking'} onPress={() => void check()} />
          {!['idle', 'checking'].includes(update.status) && <View style={settingsLayout.row}>
            <Text accessibilityLiveRegion="polite" style={[settingsTypography.body, { color: theme.label }]}>{t(`about.${update.status}`, { version: update.release?.version })}</Text>
            {update.release && <Text style={[settingsTypography.detail, { color: theme.secondary }]}>{t('about.published', { date: new Date(update.release.publishedAt).toLocaleDateString(i18n.language) })}</Text>}
          </View>}
          {update.release && <SettingsActionRow theme={theme} title={t('about.notes')} onPress={() => void open(update.release!.releaseUrl)} />}
          {update.artifacts?.map((artifact) => <SettingsActionRow key={artifact.format} theme={theme} title={t('about.download')} onPress={() => void open(artifact.url)} />)}
        </SettingsGroup>
        <SettingsGroup theme={theme} title={t('about.links')}>
          {content.links.map((link) => <SettingsNavRow key={link.key} theme={theme} title={t(`about.${link.key}`)} onPress={() => void open(link.url)} />)}
        </SettingsGroup>
        <SettingsGroup theme={theme} title={t('about.licenses')} footer={t('about.projectLicense')}>
          <SettingsNavRow theme={theme} title={t('about.allLicenses')} detail={t('about.licenseSummary')} onPress={() => setReader(true)} />
        </SettingsGroup>
        <SettingsGroup theme={theme} title={t('about.thanks')}>
          {content.credits.map((credit) => <SettingsNavRow key={credit.key} theme={theme} title={credit.name} detail={t(`about.${credit.key}`)} onPress={() => void open(credit.url)} />)}
        </SettingsGroup>
        {linkError && <SettingsNote theme={theme}>{t('about.failed')}</SettingsNote>}
        <SettingsNote theme={theme}>{t('about.copyright')}</SettingsNote>
      </View>
    </SettingsPage>
    <Modal visible={reader} animationType={reduced ? 'none' : 'slide'} presentationStyle="pageSheet" onRequestClose={() => selected ? setSelected(undefined) : closeReader()}>
      <SafeAreaView style={[styles.reader, { backgroundColor: theme.background }]}>
        <View style={styles.readerToolbar}>
          {selected && <IconButton theme={theme} label={t('about.back')} onPress={() => setSelected(undefined)}><CaretLeftIcon size={20} color={theme.label} /></IconButton>}
          <Text accessibilityRole="header" style={[settingsTypography.body, styles.readerTitle, { color: theme.label }]}>{t('about.licenses')}</Text>
          <IconButton theme={theme} label={t('about.close')} onPress={closeReader}><XIcon size={20} color={theme.label} /></IconButton>
        </View>
        <View style={styles.reader}><View style={[styles.reader, selected && styles.hidden]} pointerEvents={selected ? "none" : "auto"} accessibilityElementsHidden={!!selected} importantForAccessibility={selected ? 'no-hide-descendants' : 'auto'}>
          <TextInput value={query} onChangeText={setQuery} placeholder={t('about.search')} accessibilityLabel={t('about.search')} placeholderTextColor={theme.secondary}
            style={[styles.search, settingsTypography.body, { color: theme.label, backgroundColor: theme.surface }]} clearButtonMode="while-editing" autoCorrect={false} />
          <FlatList data={entries} keyExtractor={(entry) => entry.id} keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => <SettingsNavRow theme={theme} title={`${item.name} ${item.version}`} detail={licenseLabel(item.license)} onPress={() => setSelected(item)} />}
            ListEmptyComponent={<SettingsNote theme={theme}>{t('about.noResults')}</SettingsNote>} />
        </View>
        {selected && <ScrollView key={selected.id} style={[styles.reader, StyleSheet.absoluteFill]} contentContainerStyle={styles.licenseContent}>
          <Text accessibilityRole="header" selectable style={[settingsTypography.body, { color: theme.label }]}>{selected.name} {selected.version}</Text>
          <Text selectable style={[settingsTypography.detail, { color: theme.secondary }]}>{licenseLabel(selected.license)}</Text>
          <Text style={[settingsTypography.detail, { color: theme.secondary }]}>{t("about.appliesTo", { platforms: selected.platforms.map((platform) => t(`about.platformNames.${platform}`)).join(' · ') })}</Text>
          <SettingsActionRow theme={theme} title={t('about.sourceLink')} onPress={() => void open(selected.source)} />
          {selected.declarationOnly && <Text selectable style={[settingsTypography.detail, { color: theme.label }]}>{t('about.declaration')}: {licenseLabel(selected.license)}</Text>}
          {selected.documents.map((document, index) => <Text selectable key={index} style={[settingsTypography.detail, { color: theme.label }]}>{(licenses.texts as Record<string, string>)[document.text]}</Text>)}
        </ScrollView>}</View>
      </SafeAreaView>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  home: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: 24 },
  hero: { alignItems: 'center', gap: 12, paddingVertical: 32 },
  logo: { width: 192, height: 72 },
  specimen: { ...StyleSheet.absoluteFill, opacity: 0.06 },
  reader: { flex: 1 },
  readerToolbar: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  readerTitle: { flex: 1 },
  hidden: { opacity: 0 },
  search: { ...settingsLayout.control, margin: 16, padding: 16 },
  licenseContent: { padding: 16, gap: 24 },
});
