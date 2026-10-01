import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, TextInput, View } from 'react-native';
import { FilterGroup } from './FilterPanel';
import { facetTitles, mergeFacetOptions, normalizeFacets, type FacetKind, type LibraryPage, type SmartConditions } from './library';
import { library } from './native';
import { PanelAction, panelStyles } from './panel-content';
import type { Theme } from './ui';

// 编辑条件仅更新草稿；预览查询不写入持久状态。
export function SmartConditionsEditor({ value, theme, version, disabled, onChange }: {
  value: SmartConditions; theme: Theme; version: number; disabled: boolean; onChange: (value: SmartConditions) => void;
}) {
  const { t } = useTranslation();
  const [result, setResult] = useState<{ key: string; page: LibraryPage; options: LibraryPage['facets'] } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([value, version, retry]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      Promise.all([
        library.query({ scope: 'all', ...value, offset: 0, limit: 1 }, controller.signal),
        library.query({ scope: 'all', text: value.text, facets: [], offset: 0, limit: 1 }, controller.signal),
      ]).then(([page, options]) => {
        if (!controller.signal.aborted) { setResult({ key, page, options: options.facets }); setFailure(null); }
      }).catch(() => { if (!controller.signal.aborted) setFailure(key); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, value]);
  const loading = result?.key !== key && failure !== key;
  const available = mergeFacetOptions(result?.options ?? [], result?.page.facets ?? [], value.facets);
  return <View pointerEvents={disabled ? 'none' : 'auto'} accessibilityElementsHidden={disabled}>
    <View style={[panelStyles.card, { backgroundColor: theme.surface }]}>
      <Text style={[panelStyles.section, { color: theme.secondary }]}>{t('filters.keyword')}</Text>
      <TextInput accessibilityLabel={t('filters.keyword')} placeholder={t('filters.inputKeyword')}
        placeholderTextColor={theme.muted} value={value.text} editable={!disabled} autoCorrect={false} autoCapitalize="none"
        style={[panelStyles.input, { color: theme.label, borderColor: theme.border, backgroundColor: theme.raised }]}
        onChangeText={(text) => onChange({ ...value, text })} />
      <Text style={[panelStyles.detail, { color: theme.secondary, paddingTop: 12 }]}>{t('filters.smartHint')}</Text>
    </View>
    <View style={[panelStyles.row, { borderColor: theme.border }]}>
      <Text accessibilityLiveRegion="polite" style={[panelStyles.label, { color: theme.secondary }]}>
        {loading ? t('mobile.loadingFiltering') : failure === key ? t('mobile.errorFilters') : t('mobile.matchCount', { total: result?.page.totalMatches ?? 0 })}
      </Text>
      {failure === key ? <PanelAction label={t('common.retry')} theme={theme} onPress={() => setRetry((count) => count + 1)} />
        : <PanelAction label={t('mobile.clearFilters')} theme={theme} disabled={!value.facets.length || disabled} onPress={() => onChange({ ...value, facets: [] })} />}
    </View>
    {(Object.keys(facetTitles) as FacetKind[]).map((kind) => {
      const options = available.filter((option) => option.kind === kind);
      return options.length ? <FilterGroup key={kind} title={facetTitles[kind]} options={options} selected={value.facets}
        theme={theme} loading={loading} onToggle={(option) => {
          const checked = value.facets.some((facet) => facet.kind === option.kind && facet.value === option.value);
          onChange({ ...value, facets: normalizeFacets(checked ? value.facets.filter((facet) => facet.kind !== option.kind || facet.value !== option.value)
            : [...value.facets, { kind: option.kind, value: option.value }]) });
        }} /> : null;
    })}
  </View>;
}
