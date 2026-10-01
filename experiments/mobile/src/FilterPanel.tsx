import { CaretDownIcon, CaretUpIcon, CheckIcon } from 'phosphor-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { facetTitles, mergeFacetOptions, normalizeFacets, type FacetKind, type FacetOption, type FacetSelection } from './library';
import { FilterDrawer, FilterList } from './FilterDrawer';
import { PanelAction, panelStyles } from './panel-content';
import type { Theme } from './ui';

// 筛选直接更新当前查询，候选与计数保持 Rust 语义。
export function FilterPanel({ visible, theme, options, counts, selected, loading, error, totalMatches, onChange, onClose, onRetry }: {
  visible: boolean; theme: Theme; options: FacetOption[]; counts: FacetOption[]; selected: FacetSelection[];
  loading: boolean; error: string | null; totalMatches: number;
  onChange: (facets: FacetSelection[]) => void; onClose: () => void; onRetry: () => void;
}) {
  const available = mergeFacetOptions(options, counts, selected);
  const sections = (Object.keys(facetTitles) as FacetKind[]).map((kind) => ({
    kind, title: facetTitles[kind], data: available.filter((option) => option.kind === kind),
  })).filter((section) => section.data.length > 0);
  function toggle(option: FacetSelection) {
    const exists = selected.some((item) => item.kind === option.kind && item.value === option.value);
    onChange(normalizeFacets(exists ? selected.filter((item) => item.kind !== option.kind || item.value !== option.value)
      : [...selected, { kind: option.kind, value: option.value }]));
  }
  return <FilterDrawer visible={visible} title="筛选字体" theme={theme} onClose={onClose}>
    <FilterList data={sections} keyExtractor={(section) => section.kind}
      contentContainerStyle={panelStyles.content} keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<View>
        <View style={[panelStyles.row, { borderColor: theme.border }]}>
          <Text accessibilityLiveRegion="polite" style={[panelStyles.label, { color: theme.secondary }]}>
            {loading ? '正在筛选…' : `${totalMatches} 个匹配字体`}
          </Text>
          <PanelAction label="清空筛选" theme={theme} disabled={selected.length === 0} onPress={() => onChange([])} />
        </View>
        {error && <View style={[panelStyles.row, { borderColor: theme.border }]}>
          <Text accessibilityRole="alert" style={[panelStyles.label, { color: theme.danger }]}>{error}</Text>
          <PanelAction label="重试" theme={theme} onPress={onRetry} />
        </View>}
      </View>}
      ListEmptyComponent={loading ? <ActivityIndicator color={theme.accent} accessibilityLabel="正在读取筛选条件" />
        : <Text style={[panelStyles.section, { color: theme.secondary }]}>当前范围暂无可筛选的字体。</Text>}
      renderItem={({ item }) => <FilterGroup title={item.title} options={item.data} selected={selected}
        theme={theme} loading={loading} onToggle={toggle} />} />
  </FilterDrawer>;
}

// 分类卡片沿用桌面折叠与标签流布局，触摸按钮采用移动端标准高度。
function FilterGroup({ title, options, selected, theme, loading, onToggle }: {
  title: string; options: FacetOption[]; selected: FacetSelection[]; theme: Theme;
  loading: boolean; onToggle: (option: FacetSelection) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const Chevron = expanded ? CaretUpIcon : CaretDownIcon;
  return <View style={[styles.card, { backgroundColor: theme.surface }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded }}
      onPress={() => setExpanded((value) => !value)} style={styles.header}>
      <Text style={[styles.title, { color: theme.label }]}>{title}</Text>
      <Chevron size={16} color={theme.secondary} />
    </Pressable>
    {expanded && <View style={styles.options}>
      {options.map((option) => {
        const checked = selected.some((facet) => facet.kind === option.kind && facet.value === option.value);
        const color = checked ? theme.onAccent : theme.label;
        return <Pressable key={option.value} accessibilityRole="checkbox" accessibilityState={{ checked }}
          hitSlop={{ top: 2, bottom: 2 }}
          accessibilityLabel={`${option.label}，${loading ? '正在读取数量' : `${option.familyCount} 个字族`}`}
          onPress={() => onToggle(option)} style={({ pressed }) => [styles.chip, {
            backgroundColor: checked ? theme.accent : theme.raised, opacity: pressed ? 0.6 : 1,
          }]}>
          {checked && <CheckIcon size={16} color={color} />}
          <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.label, { color }]}>{option.label}</Text>
          <Text style={[styles.count, { color }]}>{loading ? '…' : option.familyCount}</Text>
        </Pressable>;
      })}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  card: { marginTop: 8, padding: 12, borderRadius: 24 },
  header: { minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: '600' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  chip: { minWidth: 44, minHeight: 40, maxWidth: '100%', paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { flexShrink: 1, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  count: { fontSize: 14, lineHeight: 20, fontVariant: ['tabular-nums'], opacity: 0.75 },
});
