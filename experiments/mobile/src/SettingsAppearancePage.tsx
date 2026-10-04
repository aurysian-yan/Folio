import { CheckIcon, CircleHalfIcon } from './icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { previewScaleOptions, usePreferences, type AccentId } from './settings';
import { SettingsChoiceRow, SettingsGroup, SettingsIcon, SettingsPage, settingsLayout, settingsTypography } from './settings-ui';
import { accentPresets, type Theme } from './ui';

// 外观跟随系统，仅提供主题色与预览字号偏好。
export function SettingsAppearancePage({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const { t } = useTranslation();
  const { preferences, update } = usePreferences();
  const scaleOptions = previewScaleOptions.map((scale) => ({
    value: String(scale),
    label: scale === 18 ? t('mobile.settings.scaleSmall') : scale === 24 ? t('mobile.settings.scaleMedium') : t('mobile.settings.scaleLarge'),
  }));
  const accents: { id: AccentId; label: string }[] = [
    { id: 'folio', label: t('theme.folioOrange') },
    { id: 'blue', label: t('mobile.settings.accentBlue') },
    { id: 'green', label: t('mobile.settings.accentGreen') },
    { id: 'purple', label: t('mobile.settings.accentPurple') },
  ];

  return <SettingsPage title={t('settings.appearance')} theme={theme} onClose={onClose}>
    <SettingsGroup theme={theme}>
      <View style={styles.systemTheme}>
        <SettingsIcon><CircleHalfIcon size={22} color={theme.accent} /></SettingsIcon>
        <View style={styles.systemBody}>
          <Text style={[styles.title, { color: theme.label }]}>{t('mobile.settings.appearanceMode')}</Text>
          <Text style={[styles.detail, { color: theme.secondary }]}>{t('mobile.settings.appearanceSystem')}</Text>
        </View>
        <Text style={[styles.modeValue, { color: theme.secondary }]}>{t(theme.dark ? 'mobile.settings.appearanceDark' : 'mobile.settings.appearanceLight')}</Text>
      </View>
    </SettingsGroup>
    <SettingsGroup theme={theme} title={t('settings.theme')}>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('settings.theme')} style={styles.swatches}>
        {accents.map(({ id, label }) => {
          const selected = preferences.accent === id;
          const color = accentPresets[id][theme.dark ? 'dark' : 'light'];
          return <Pressable key={id} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected }}
            onPress={() => update({ accent: id })}
            style={({ pressed }) => [styles.swatchOption, { opacity: pressed ? 0.7 : 1 }]}>
            <View style={[styles.swatchOutline, { borderColor: selected ? color : 'transparent' }]}>
              <View style={[styles.swatch, { backgroundColor: color }]}>
                {selected && <CheckIcon size={20} color={theme.onAccent} weight="bold" />}
              </View>
            </View>
            <Text style={[styles.swatchLabel, { color: selected ? theme.label : theme.secondary }]}>{id === 'folio' ? t('color.orange') : label}</Text>
          </Pressable>;
        })}
      </View>
    </SettingsGroup>
    <SettingsGroup theme={theme} title={t('preview.size')}>
      <View style={styles.preview}>
        <Text style={[styles.sample, { fontSize: preferences.previewScale, lineHeight: Math.round(preferences.previewScale * 1.5), color: theme.label }]}>{t('mobile.settings.previewSample')}</Text>
      </View>
      <SettingsChoiceRow theme={theme} title={t('preview.size')} options={scaleOptions}
        value={String(preferences.previewScale)} onChange={(value) => update({ previewScale: Number(value) })} hideTitle last />
    </SettingsGroup>
  </SettingsPage>;
}

const styles = StyleSheet.create({
  systemTheme: { minHeight: 64, ...settingsLayout.row, flexDirection: 'row', alignItems: 'center', gap: 12 },
  systemBody: { flex: 1, gap: 4 },
  title: { ...settingsTypography.body },
  detail: { ...settingsTypography.detail },
  modeValue: { fontSize: 14, lineHeight: 20 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', padding: settingsLayout.section.paddingHorizontal, gap: 12 },
  swatchOption: { flex: 1, minWidth: 56, alignItems: 'center', gap: 8 },
  swatchOutline: { padding: 4, borderRadius: 26, borderWidth: 2 },
  swatch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  swatchLabel: { ...settingsTypography.detail, textAlign: 'center' },
  preview: { minHeight: 144, ...settingsLayout.section, paddingTop: settingsLayout.section.paddingHorizontal,
    paddingBottom: 8 * (settingsLayout.section.paddingHorizontal / 24), justifyContent: 'center', alignItems: 'center' },
  sample: { textAlign: 'center' },
});
