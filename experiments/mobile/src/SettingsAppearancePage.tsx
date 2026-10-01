import { CheckIcon } from 'phosphor-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { previewScaleOptions, usePreferences, type AccentId, type AppearanceMode } from './settings';
import { SettingsChoiceRow, SettingsGroup, SettingsPage } from './settings-ui';
import { accentPresets, type Theme } from './ui';

// 外观：深浅色、主题色与字体预览字号。
export function SettingsAppearancePage({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const { t } = useTranslation();
  const { preferences, update } = usePreferences();
  const appearanceOptions: { value: AppearanceMode; label: string }[] = [
    { value: 'system', label: t('mobile.settings.appearanceSystem') },
    { value: 'light', label: t('mobile.settings.appearanceLight') },
    { value: 'dark', label: t('mobile.settings.appearanceDark') },
  ];
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
    <SettingsGroup theme={theme} title={t('settings.appearance')} footer={t('settings.appearanceDescription')}>
      <SettingsChoiceRow theme={theme} title={t('mobile.settings.appearanceMode')} options={appearanceOptions}
        value={preferences.appearance} onChange={(value) => update({ appearance: value })} />
      <View style={[styles.accentRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
        <Text style={[styles.accentTitle, { color: theme.label }]}>{t('theme.default')}</Text>
        <View style={styles.swatches}>
          {accents.map(({ id, label }) => {
            const selected = preferences.accent === id;
            return <Pressable key={id} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected }}
              onPress={() => update({ accent: id })}
              style={({ pressed }) => [styles.swatch, { backgroundColor: accentPresets[id].light, opacity: pressed ? 0.7 : 1,
                borderColor: selected ? theme.label : 'transparent' }]}>
              {selected && <CheckIcon size={16} color="#FFFFFF" />}
            </Pressable>;
          })}
        </View>
      </View>
    </SettingsGroup>
    <SettingsGroup theme={theme} title={t('preview.size')}>
      <SettingsChoiceRow theme={theme} title={t('preview.size')} options={scaleOptions}
        value={String(preferences.previewScale)} onChange={(value) => update({ previewScale: Number(value) })} last />
    </SettingsGroup>
  </SettingsPage>;
}

const styles = StyleSheet.create({
  accentRow: { paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  accentTitle: { fontSize: 16, lineHeight: 22 },
  swatches: { flexDirection: 'row', gap: 12 },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
