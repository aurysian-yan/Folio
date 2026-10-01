import { CheckIcon, DotsThreeIcon, PlusIcon, SparkleIcon, StarIcon, TextAaIcon } from 'phosphor-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { collectionColors, collectionIcons, CollectionSymbol, collectionColorValue } from './collection-style';
import { CollectionEditorDialog } from './CollectionEditorDialog';
import { FilterDrawer, FilterList } from './FilterDrawer';
import { LibraryPanel } from './LibraryPanel';
import { PanelTabs } from './PanelTabs';
import { SmartConditionsEditor } from './SmartConditionsEditor';
import { library } from './native';
import { PanelAction, PanelSection, panelStyles } from './panel-content';
import { hasSmartConditions, mergeSmartConditions, targetKey, type CollectionInput, type FontCollection, type FontFamily,
  type LibrarySnapshot, type LibraryTarget, type SmartConditions, type SmartFolder } from './library';
import { IconButton, type Theme } from './ui';

type Folder = (FontCollection & { kind: 'manual' }) | (SmartFolder & { kind: 'smart' });
type FolderEditor = { collection: Folder | null; input: CollectionInput; query: SmartConditions };

// 手动与智慧收藏夹混排，编辑器按条件自动判断类型。
export function CollectionsPanel({ visible, theme, target, snapshot, currentConditions, libraryVersion, onSelect, onSnapshot, onClose }: {
  visible: boolean; theme: Theme; target: LibraryTarget; snapshot: LibrarySnapshot | null;
  currentConditions: SmartConditions; libraryVersion: number;
  onSelect: (target: LibraryTarget) => void; onSnapshot: (snapshot: LibrarySnapshot) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [editor, setEditor] = useState<FolderEditor | null>(null);
  const [tab, setTab] = useState<'general' | 'filters'>('general');
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFromList, setDeleteFromList] = useState(false);
  const openSwipe = useRef<SwipeableMethods | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const isSmart = editor ? hasSmartConditions(editor.query) : false;
  const folders: Folder[] = [
    ...(snapshot?.smartFolders ?? []).map((folder) => ({ ...folder, kind: 'smart' as const })),
    ...(snapshot?.collections ?? []).map((folder) => ({ ...folder, kind: 'manual' as const })),
  ];
  function close() {
    if (pending.current) return;
    openSwipe.current?.close(); setEditor(null); setDeleting(false); setConfirming(false); setError(null); onClose();
  }
  function cancelEditor() {
    if (pending.current) return;
    setEditor(null); setDeleting(false); setConfirming(false); setError(null);
  }
  async function edit(collection: Folder | null) {
    if (pending.current) return;
    openSwipe.current?.close(); setError(null); setDeleting(false); setDeleteFromList(false); setConfirming(false); setTab('general');
    pending.current = true; setBusy(true);
    try {
      let query: SmartConditions = collection ? { text: '', facets: [] }
        : { text: currentConditions.text, facets: currentConditions.facets.map((facet) => ({ ...facet })) };
      if (collection?.kind === 'smart') query = (await library.getSmartFolder(collection.id)).query;
      else if (!collection && target.scope === 'smart') {
        query = mergeSmartConditions((await library.getSmartFolder(target.smartFolderId)).query, query);
      }
      setEditor({ collection, input: collection ? { name: collection.name, icon: collection.icon, color: collection.color }
        : { name: '', icon: 'folder', color: 'gray' }, query });
    } catch { setError(t('mobile.errorCollectionRead')); }
    finally { pending.current = false; setBusy(false); }
  }
  function requestDelete(collection: Folder) {
    if (pending.current) return;
    openSwipe.current?.close(); setError(null); setConfirming(false); setDeleting(true); setDeleteFromList(true);
    setEditor({ collection, input: { name: collection.name, icon: collection.icon, color: collection.color }, query: { text: '', facets: [] } });
  }
  function cancelConfirmation() {
    if (pending.current) return;
    if (deleting && deleteFromList) cancelEditor();
    else { setDeleting(false); setConfirming(false); setError(null); }
  }
  async function save(remove = false, confirmed = false) {
    if (!editor || pending.current) return;
    const converting = editor.collection && (editor.collection.kind === 'smart') !== isSmart;
    if (!remove && converting && !confirmed) { setConfirming(true); return; }
    pending.current = true; setBusy(true); setError(null);
    try {
      const input = { ...editor.input, name: editor.input.name.trim() };
      const smartInput = { ...input, query: editor.query };
      if (remove && editor.collection) {
        onSnapshot(editor.collection.kind === 'smart' ? await library.deleteSmartFolder(editor.collection.id)
          : await library.deleteCollection(editor.collection.id));
      } else if (converting && editor.collection) {
        const result = isSmart ? await library.convertCollectionToSmart(editor.collection.id, smartInput)
          : await library.convertSmartToCollection(editor.collection.id, input);
        onSnapshot(result.snapshot); onSelect(result.target);
      } else if (isSmart) {
        const result = await library.saveSmartFolder(editor.collection?.id ?? null, smartInput);
        onSnapshot(result.snapshot); onSelect(result.target);
      } else {
        const updated = editor.collection ? await library.updateCollection(editor.collection.id, input) : await library.createCollection(input);
        onSnapshot(updated);
        const saved = editor.collection ?? updated.collections.find((folder) => !snapshot?.collections.some((existing) => existing.id === folder.id));
        if (saved) onSelect({ scope: 'collection', collectionId: saved.id });
      }
      setEditor(null); setDeleting(false); setConfirming(false); onClose();
    } catch { setError(remove ? t('mobile.errorCollectionDelete') : t('mobile.errorCollectionSave')); }
    finally { pending.current = false; setBusy(false); }
  }
  function updateInput(change: Partial<CollectionInput>) {
    setEditor((value) => value && ({ ...value, input: { ...value.input, ...change } }));
  }
  function select(value: LibraryTarget) { if (!pending.current) { onSelect(value); close(); } }
  const colorLabel = collectionColors.find((item) => item.key === editor?.input.color)?.label ?? t('color.gray');

  if (editor) return <CollectionEditorDialog visible={visible} title={deleting ? t('collection.delete') : confirming
    ? t(isSmart ? 'smartCollection.convertToSmartTitle' : 'smartCollection.convertToManualTitle') : editor.collection ? t('collection.edit') : t('collection.new')}
    theme={theme} busy={busy} closeLabel={t('common.cancel')} onClose={confirming || deleting ? cancelConfirmation : cancelEditor}
    headerAction={!confirming && !deleting ? <IconButton label={busy ? t('mobile.saving') : t(editor.collection ? 'common.save' : 'common.create')}
      theme={theme} primary systemImage="checkmark" disabled={busy || !editor.input.name.trim()} busy={busy}
      onPress={() => { void save(); }}><CheckIcon size={20} color={theme.onAccent} /></IconButton> : undefined}>
    {confirming || deleting ? <ScrollView contentContainerStyle={panelStyles.content}>
      <View style={[panelStyles.card, styles.confirmation, { backgroundColor: theme.surface }]}>
        <CollectionSymbol icon={editor.input.icon} color={collectionColorValue(editor.input.color)} />
        <Text style={[styles.confirmTitle, { color: theme.label }]}>{deleting ? t('collection.deleteConfirmTitle', { name: editor.input.name }) : editor.input.name}</Text>
        <Text style={[panelStyles.detail, { color: theme.secondary }]}>{deleting ? t('collection.deleteConfirmMessage')
          : t(isSmart ? 'smartCollection.convertToSmartMessage' : 'smartCollection.convertToManualMessage')}</Text>
      </View>
      {error && <Text accessibilityRole="alert" style={[panelStyles.section, { color: theme.danger }]}>{error}</Text>}
      <View style={styles.confirmActions}>
        <PanelAction label={deleting && deleteFromList ? t('common.cancel') : t('mobile.backToEditing')} theme={theme} disabled={busy} onPress={cancelConfirmation} />
        <PanelAction label={deleting ? t('collection.delete') : t('common.confirm')} theme={theme} primary destructive={deleting} disabled={busy}
          systemImage={deleting ? 'trash' : 'checkmark'} onPress={() => { void save(deleting, true); }} />
      </View>
    </ScrollView> : <>
      <View style={styles.tabs}>
        <PanelTabs label={t('collection.settings')} value={tab} disabled={busy} theme={theme}
          options={[{ value: 'general', label: t('collection.general'), systemImage: 'folder' },
            { value: 'filters', label: t('filters.conditions'), systemImage: 'line.3.horizontal.decrease' }]}
          onChange={(value) => { if (value === 'general' || value === 'filters') setTab(value); }} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={panelStyles.content}>
        {tab === 'general' ? <View>
          <View style={[panelStyles.card, { backgroundColor: theme.surface }]}>
            <Text style={[panelStyles.section, { color: theme.secondary }]}>{t('collection.name')}</Text>
            <TextInput accessibilityLabel={t('collection.name')} value={editor.input.name} editable={!busy}
              placeholder={t('collection.namePlaceholder')} placeholderTextColor={theme.muted} autoCorrect={false}
              style={[panelStyles.input, { color: theme.label, borderColor: theme.border, backgroundColor: theme.raised }]}
              onChangeText={(name) => updateInput({ name })} returnKeyType="done" onSubmitEditing={() => { if (editor.input.name.trim()) void save(); }} />
          </View>
          <PanelSection title={t('common.icon')} theme={theme}>
            <View accessibilityRole="radiogroup" style={panelStyles.choices}>
              {collectionIcons.map(({ key, label, Icon }) => <Pressable key={key} accessibilityRole="radio" accessibilityLabel={label}
                accessibilityState={{ checked: editor.input.icon === key, disabled: busy }} disabled={busy} onPress={() => updateInput({ icon: key })}
                style={({ pressed }) => [panelStyles.choice, styles.icon, { backgroundColor: editor.input.icon === key ? theme.selection : theme.raised,
                  borderColor: editor.input.icon === key ? theme.accent : theme.border, opacity: pressed ? 0.6 : 1 }]}>
                <Icon size={20} color={editor.input.icon === key ? theme.accent : theme.label} />
              </Pressable>)}
            </View>
          </PanelSection>
          <PanelSection title={t('common.color')} theme={theme} action={<Text style={[panelStyles.detail, { color: theme.secondary }]}>{colorLabel}</Text>}>
            <View accessibilityRole="radiogroup" style={panelStyles.choices}>
              {collectionColors.map(({ key, label }) => <Pressable key={key} accessibilityRole="radio" accessibilityLabel={label}
                accessibilityState={{ checked: editor.input.color === key, disabled: busy }} disabled={busy} onPress={() => updateInput({ color: key })}
                style={[styles.swatch, { backgroundColor: collectionColorValue(key), borderColor: editor.input.color === key ? theme.label : theme.border }]}>
                {editor.input.color === key && <CheckIcon size={20} color={theme.onAccent} />}
              </Pressable>)}
            </View>
          </PanelSection>
        </View> : <SmartConditionsEditor value={editor.query} theme={theme} version={libraryVersion} disabled={busy}
          onChange={(query) => setEditor({ ...editor, query })} />}
      </ScrollView>
      {error && <Text accessibilityRole="alert" style={[panelStyles.section, styles.error, { color: theme.danger }]}>{error}</Text>}
    </>}
  </CollectionEditorDialog>;

  return <FilterDrawer visible={visible} title={t('library.title')} theme={theme} busy={busy} onClose={close}
    headerAction={<IconButton label={t('collection.new')} theme={theme} primary systemImage="plus" disabled={!snapshot || busy}
      onPress={() => { void edit(null); }}><PlusIcon size={20} color={theme.onAccent} /></IconButton>}>
    <FilterList data={folders} keyExtractor={(folder) => `${folder.kind}:${folder.id}`}
      contentContainerStyle={panelStyles.content} keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<View>
        {error && <Text accessibilityRole="alert" style={[panelStyles.section, { color: theme.danger }]}>{error}</Text>}
        <Text accessibilityRole="header" style={[panelStyles.section, { color: theme.secondary }]}>{t('navigation.local')}</Text>
        <View style={styles.scopeOptions}>
          {([{ scope: 'all' }, { scope: 'favorites' }] as LibraryTarget[]).map((value) => <Pressable key={value.scope}
            accessibilityRole="radio" disabled={busy} accessibilityState={{ checked: targetKey(target) === targetKey(value), disabled: busy }} onPress={() => select(value)}
            style={({ pressed }) => [styles.scopeCard, { backgroundColor: targetKey(target) === targetKey(value) ? theme.selection : theme.surface,
              borderColor: targetKey(target) === targetKey(value) ? theme.accent : theme.border, opacity: pressed ? 0.6 : 1 }]}>
            {value.scope === 'all' ? <TextAaIcon size={24} color={theme.accent} /> : <StarIcon size={24} color={theme.accent} />}
            <Text style={[panelStyles.label, { color: theme.label }]}>{value.scope === 'all' ? t('mobile.allFonts') : t('mobile.starredCollections')}</Text>
            {value.scope === 'all' && <Text style={[styles.count, { color: theme.secondary }]}>{snapshot?.familyCount ?? 0}</Text>}
            {targetKey(target) === targetKey(value) && <CheckIcon size={20} color={theme.accent} />}
          </Pressable>)}
        </View>
        <Text accessibilityRole="header" style={[panelStyles.section, styles.folderHeading, { color: theme.secondary }]}>{t('collection.collections')}</Text>
        {(hasSmartConditions(currentConditions) || target.scope === 'smart') && <View style={styles.saveCurrent}>
          <PanelAction label={t('smartCollection.saveCurrent')} theme={theme} systemImage="sparkles"
            disabled={!snapshot || busy} onPress={() => { void edit(null); }} />
        </View>}
      </View>}
      ListEmptyComponent={<View style={styles.emptyFolders}>
        <Text style={[panelStyles.detail, { color: theme.secondary }]}>{t('collection.none')}</Text>
      </View>}
      renderItem={({ item: folder }) => {
        const value: LibraryTarget = folder.kind === 'smart' ? { scope: 'smart', smartFolderId: folder.id } : { scope: 'collection', collectionId: folder.id };
        const checked = targetKey(target) === targetKey(value);
        return <View style={styles.folderRow}>
          <FolderCard folder={folder} checked={checked} busy={busy} theme={theme} onSelect={() => select(value)}
            onEdit={() => { void edit(folder); }} onDelete={() => requestDelete(folder)} onOpen={(methods) => {
              if (openSwipe.current !== methods) openSwipe.current?.close();
              openSwipe.current = methods;
            }} />
        </View>;
      }} />
  </FilterDrawer>;
}

// 卡片侧滑复用 Gesture Handler，更多入口和读屏动作提供等价操作。
function FolderCard({ folder, checked, busy, theme, onSelect, onEdit, onDelete, onOpen }: {
  folder: Folder; checked: boolean; busy: boolean; theme: Theme; onSelect: () => void;
  onEdit: () => void; onDelete: () => void; onOpen: (methods: SwipeableMethods) => void;
}) {
  const { t } = useTranslation();
  const swipe = useRef<SwipeableMethods>(null);
  const [open, setOpen] = useState(false);
  return <Swipeable ref={swipe} enabled={!busy} enableTrackpadTwoFingerGesture overshootRight={false}
    containerStyle={styles.swipeCard} onSwipeableWillOpen={() => { if (swipe.current) onOpen(swipe.current); setOpen(true); }}
    onSwipeableClose={() => setOpen(false)} renderRightActions={() => <View style={[styles.swipeActions, { backgroundColor: theme.surface }]}
      accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}>
      <PanelAction label={t('common.edit')} theme={theme} systemImage="pencil" disabled={busy} onPress={onEdit} />
      <PanelAction label={t('common.delete')} theme={theme} primary destructive systemImage="trash" disabled={busy} onPress={onDelete} />
    </View>}>
    <View style={[styles.folderCard, { backgroundColor: checked ? theme.selection : theme.surface, borderColor: checked ? theme.accent : theme.border }]}>
      <Pressable accessibilityRole="radio" disabled={busy} accessibilityState={{ checked, disabled: busy }}
        accessibilityLabel={t(folder.kind === 'smart' ? 'mobile.smartFolderCount' : 'mobile.collectionCount',
          { name: folder.name, count: folder.kind === 'smart' ? folder.matchCount : folder.memberCount })}
        accessibilityHint={t('mobile.swipeCollection')}
        accessibilityActions={[{ name: 'edit', label: t('collection.edit') }, { name: 'delete', label: t('collection.delete') }]}
        onAccessibilityAction={({ nativeEvent }) => { if (!busy) { if (nativeEvent.actionName === 'edit') onEdit(); else if (nativeEvent.actionName === 'delete') onDelete(); } }}
        onPress={() => { if (open) swipe.current?.close(); else onSelect(); }} onLongPress={() => swipe.current?.openRight()}
        style={({ pressed }) => [styles.folderSelect, { opacity: pressed ? 0.6 : 1 }]}>
        <CollectionSymbol icon={folder.icon} color={collectionColorValue(folder.color)} />
        <View style={styles.spacer}>
          <Text numberOfLines={1} style={[panelStyles.label, { flex: 0, color: theme.label }]}>{folder.name}</Text>
          {folder.kind === 'smart' && <View style={styles.smartLabel}><SparkleIcon size={14} color={theme.secondary} />
            <Text style={[panelStyles.detail, { color: theme.secondary }]}>{t('navigation.smartCollections')}</Text>
          </View>}
        </View>
        <Text style={[styles.count, { color: theme.secondary }]}>{folder.kind === 'smart' ? folder.matchCount : folder.memberCount}</Text>
        {checked && <CheckIcon size={20} color={theme.accent} />}
      </Pressable>
      <IconButton label={`${folder.name}，${t('desktop.collectionActions')}`} theme={theme} disabled={busy} systemImage="ellipsis"
        onPress={() => { if (open) swipe.current?.close(); else swipe.current?.openRight(); }}>
        <DotsThreeIcon size={24} color={theme.accent} />
      </IconButton>
    </View>
  </Swipeable>;
}

const styles = StyleSheet.create({
  tabs: { paddingHorizontal: 16, paddingBottom: 8 }, spacer: { flex: 1 }, error: { paddingHorizontal: 16 },
  confirmation: { gap: 12 }, confirmTitle: { fontSize: 18, fontWeight: '600' },
  confirmActions: { paddingVertical: 16, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  scopeOptions: { gap: 8 },
  scopeCard: { minHeight: 64, padding: 16, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
  folderHeading: { marginTop: 8 }, folderRow: { paddingBottom: 8 },
  emptyFolders: { paddingVertical: 12 }, saveCurrent: { paddingBottom: 12 },
  swipeCard: { borderRadius: 24 }, swipeActions: { flexDirection: 'row', alignItems: 'center', paddingLeft: 8, gap: 8 },
  folderCard: { paddingRight: 8, minHeight: 64, borderWidth: StyleSheet.hairlineWidth, borderRadius: 24, flexDirection: 'row', alignItems: 'center' },
  folderSelect: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 },
  smartLabel: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  count: { fontSize: 14, fontVariant: ['tabular-nums'] },
  icon: { borderRadius: 12 }, swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});

// 字体成员操作使用完整身份集合，重复加入保持幂等。
export function FamilyCollectionsPanel({ visible, family, snapshot, collectionId, theme, onSnapshot, onClose }: {
  visible: boolean; family: FontFamily; snapshot: LibrarySnapshot | null; collectionId?: string; theme: Theme;
  onSnapshot: (snapshot: LibrarySnapshot) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function change(collection: FontCollection, member: boolean) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null); setMessage(null);
    try {
      onSnapshot(await library.setCollectionMembers(collection.id, [...new Set(family.identityIds)], member));
      setMessage(member ? t('collection.memberAdded', { name: collection.name }) : t('collection.memberRemoved', { name: collection.name }));
    } catch { setError(t('mobile.errorCollection')); }
    finally { pending.current = false; setBusy(false); }
  }
  const current = snapshot?.collections.find((item) => item.id === collectionId);
  return <LibraryPanel visible={visible} title={t('collection.addTo')} theme={theme} busy={busy}
    onClose={() => { if (!pending.current) { setMessage(null); setError(null); onClose(); } }}>
    <ScrollView contentContainerStyle={panelStyles.content} keyboardShouldPersistTaps="handled">
      <Text style={[panelStyles.section, { color: theme.secondary }]}>{family.displayName}</Text>
      {message && <Text accessibilityLiveRegion="polite" style={[panelStyles.section, { color: theme.secondary }]}>{message}</Text>}
      {error && <Text accessibilityRole="alert" style={[panelStyles.section, { color: theme.danger }]}>{error}</Text>}
      <PanelSection title={t('collection.collections')} theme={theme}>
        {snapshot?.collections.map((collection) => <View key={collection.id} style={[styles.scopeCard, { backgroundColor: theme.raised, borderColor: theme.border }]}>
          <CollectionSymbol icon={collection.icon} color={collectionColorValue(collection.color)} />
          <Text style={[panelStyles.label, { color: theme.label }]}>{collection.name}</Text>
          <PanelAction label={t('collection.add')} theme={theme} systemImage="plus" disabled={busy} onPress={() => { void change(collection, true); }} />
        </View>)}
        {current && <PanelAction label={t('collection.removeFromNamed', { name: current.name })} theme={theme} destructive disabled={busy}
          onPress={() => { void change(current, false); }} />}
        {snapshot?.collections.length === 0 && <Text style={[panelStyles.detail, { color: theme.secondary }]}>{t('collection.emptyCreateHint')}</Text>}
      </PanelSection>
    </ScrollView>
  </LibraryPanel>;
}
