import { CheckIcon, PencilSimpleIcon } from 'phosphor-react-native';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { collectionColors, collectionIcons, CollectionSymbol, collectionColorValue } from './collection-style';
import { LibraryPanel } from './LibraryPanel';
import { library } from './native';
import { PanelAction, panelStyles } from './panel-content';
import { targetKey, type CollectionInput, type FontCollection, type FontFamily, type LibrarySnapshot, type LibraryTarget } from './library';
import type { Theme } from './ui';

// 范围选择与手动收藏夹管理共用面板，删除仅影响成员关系。
export function CollectionsPanel({ visible, theme, target, snapshot, onSelect, onSnapshot, onClose }: {
  visible: boolean; theme: Theme; target: LibraryTarget; snapshot: LibrarySnapshot | null;
  onSelect: (target: LibraryTarget) => void; onSnapshot: (snapshot: LibrarySnapshot) => void; onClose: () => void;
}) {
  const [editor, setEditor] = useState<{ collection: FontCollection | null; input: CollectionInput } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<'icon' | 'color' | null>(null);

  function close() {
    if (pending.current) return;
    setEditor(null); setDeleting(false); setError(null); setExpanded(null); onClose();
  }
  function edit(collection: FontCollection | null) {
    setEditor({ collection, input: collection ? { name: collection.name, icon: collection.icon, color: collection.color }
      : { name: '', icon: 'folder', color: 'gray' } });
    setDeleting(false); setError(null); setExpanded(null);
  }
  async function save(remove = false) {
    if (!editor || pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const input = { ...editor.input, name: editor.input.name.trim() };
      const updated = remove && editor.collection ? await library.deleteCollection(editor.collection.id)
        : editor.collection ? await library.updateCollection(editor.collection.id, input) : await library.createCollection(input);
      onSnapshot(updated); setEditor(null); setDeleting(false); setExpanded(null);
    } catch { setError(remove ? '无法删除收藏夹，请重试。' : '无法保存收藏夹，请检查名称后重试。'); }
    finally { pending.current = false; setBusy(false); }
  }
  function updateInput(change: Partial<CollectionInput>) {
    setEditor((value) => value && ({ ...value, input: { ...value.input, ...change } }));
  }
  function select(value: LibraryTarget) { onSelect(value); close(); }
  const iconLabel = collectionIcons.find((item) => item.key === editor?.input.icon)?.label ?? '文件夹';
  const colorLabel = collectionColors.find((item) => item.key === editor?.input.color)?.label ?? '灰色';

  return <LibraryPanel visible={visible} title={editor ? deleting ? '删除收藏夹' : editor.collection ? '编辑收藏夹' : '新建收藏夹' : '字体库'}
    theme={theme} busy={busy} closeLabel={editor ? '取消' : '完成'} onClose={close}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={panelStyles.content}>
      {error && <Text accessibilityRole="alert" style={[panelStyles.section, { color: theme.danger }]}>{error}</Text>}
      {editor ? deleting ? <View>
        <Text style={[panelStyles.section, { color: theme.label }]}>删除「{editor.input.name}」？</Text>
        <Text style={[panelStyles.detail, { color: theme.secondary }]}>其中的字体和星标收藏会保留。</Text>
        <PanelAction label={busy ? '正在删除…' : '删除收藏夹'} theme={theme} destructive disabled={busy} onPress={() => { void save(true); }} />
        <PanelAction label="返回编辑" theme={theme} disabled={busy} onPress={() => setDeleting(false)} />
      </View> : <View>
        <Text style={[panelStyles.section, { color: theme.secondary }]}>名称</Text>
        <TextInput autoFocus accessibilityLabel="收藏夹名称" value={editor.input.name} editable={!busy}
          placeholder="输入收藏夹名称" placeholderTextColor={theme.muted} autoCorrect={false}
          style={[panelStyles.input, { color: theme.label, borderColor: theme.border }]}
          onChangeText={(name) => updateInput({ name })} returnKeyType="done" onSubmitEditing={() => {
            if (editor.input.name.trim()) void save();
          }} />
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === 'icon', disabled: busy }} disabled={busy}
          onPress={() => setExpanded(expanded === 'icon' ? null : 'icon')} style={[panelStyles.row, { borderColor: theme.border }]}>
          <CollectionSymbol icon={editor.input.icon} color={collectionColorValue(editor.input.color)} />
          <Text style={[panelStyles.label, { color: theme.label }]}>图标</Text>
          <Text style={[panelStyles.detail, { color: theme.secondary }]}>{iconLabel}</Text>
        </Pressable>
        {expanded === 'icon' && <View accessibilityRole="radiogroup" style={panelStyles.choices}>
          {collectionIcons.map(({ key, label, Icon }) => <Pressable key={key} accessibilityRole="radio" accessibilityLabel={label}
            accessibilityState={{ checked: editor.input.icon === key, disabled: busy }} disabled={busy} onPress={() => updateInput({ icon: key })}
            style={[panelStyles.choice, { borderColor: editor.input.icon === key ? theme.accent : theme.border }]}>
            <Icon size={20} color={editor.input.icon === key ? theme.accent : theme.label} />
          </Pressable>)}
        </View>}
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === 'color', disabled: busy }} disabled={busy}
          onPress={() => setExpanded(expanded === 'color' ? null : 'color')} style={[panelStyles.row, { borderColor: theme.border }]}>
          <CollectionSymbol icon={editor.input.icon} color={collectionColorValue(editor.input.color)} />
          <Text style={[panelStyles.label, { color: theme.label }]}>颜色</Text>
          <Text style={[panelStyles.detail, { color: theme.secondary }]}>{colorLabel}</Text>
        </Pressable>
        {expanded === 'color' && <View accessibilityRole="radiogroup" style={panelStyles.choices}>
          {collectionColors.map(({ key, label }) => <Pressable key={key} accessibilityRole="radio"
            accessibilityState={{ checked: editor.input.color === key, disabled: busy }} disabled={busy} onPress={() => updateInput({ color: key })}
            style={[panelStyles.choice, { borderColor: editor.input.color === key ? theme.accent : theme.border }]}>
            <CollectionSymbol icon={editor.input.icon} color={collectionColorValue(key)} />
            <Text style={{ color: editor.input.color === key ? theme.accent : theme.label }}>{label}</Text>
          </Pressable>)}
        </View>}
        <PanelAction label={busy ? '正在保存…' : '保存收藏夹'} theme={theme} disabled={busy || !editor.input.name.trim()} onPress={() => { void save(); }} />
        {editor.collection && <PanelAction label="删除收藏夹" theme={theme} destructive disabled={busy} onPress={() => setDeleting(true)} />}
        <PanelAction label="返回字体库" theme={theme} disabled={busy} onPress={() => { setEditor(null); setError(null); }} />
      </View> : <View>
        {([{ scope: 'all' }, { scope: 'favorites' }] as LibraryTarget[]).map((value) => <Pressable key={value.scope}
          accessibilityRole="radio" accessibilityState={{ checked: targetKey(target) === targetKey(value) }} onPress={() => select(value)}
          style={[panelStyles.row, { borderColor: theme.border }]}>
          <Text style={[panelStyles.label, { color: theme.label }]}>{value.scope === 'all' ? '全部字体' : '星标收藏'}</Text>
          {targetKey(target) === targetKey(value) && <CheckIcon size={20} color={theme.accent} />}
        </Pressable>)}
        <View style={panelStyles.header}>
          <Text accessibilityRole="header" style={[panelStyles.section, { color: theme.secondary }]}>收藏夹</Text>
          <PanelAction label="新建" theme={theme} disabled={!snapshot} onPress={() => edit(null)} />
        </View>
        {snapshot?.collections.map((collection) => <View key={collection.id} style={[panelStyles.row, { borderColor: theme.border }]}>
          <Pressable accessibilityRole="radio" accessibilityLabel={`${collection.name}，${collection.memberCount} 个成员`}
            accessibilityState={{ checked: target.scope === 'collection' && target.collectionId === collection.id }}
            onPress={() => select({ scope: 'collection', collectionId: collection.id })}
            style={[panelStyles.row, { flex: 1, borderBottomWidth: 0 }]}>
            <CollectionSymbol icon={collection.icon} color={collectionColorValue(collection.color)} />
            <Text style={[panelStyles.label, { color: theme.label }]}>{collection.name}</Text>
            <Text style={[panelStyles.detail, { color: theme.secondary }]}>{collection.memberCount}</Text>
            {target.scope === 'collection' && target.collectionId === collection.id && <CheckIcon size={20} color={theme.accent} />}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`编辑${collection.name}`} onPress={() => edit(collection)} style={panelStyles.action}>
            <PencilSimpleIcon size={20} color={theme.accent} />
          </Pressable>
        </View>)}
        {snapshot?.collections.length === 0 && <Text style={[panelStyles.section, { color: theme.secondary }]}>还没有收藏夹。</Text>}
      </View>}
    </ScrollView>
  </LibraryPanel>;
}

// 字体成员操作使用完整身份集合，重复加入保持幂等。
export function FamilyCollectionsPanel({ visible, family, snapshot, collectionId, theme, onSnapshot, onClose }: {
  visible: boolean; family: FontFamily; snapshot: LibrarySnapshot | null; collectionId?: string; theme: Theme;
  onSnapshot: (snapshot: LibrarySnapshot) => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function change(collection: FontCollection, member: boolean) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null); setMessage(null);
    try {
      onSnapshot(await library.setCollectionMembers(collection.id, [...new Set(family.identityIds)], member));
      setMessage(`已${member ? '加入' : '移出'}「${collection.name}」`);
    } catch { setError('无法更新收藏夹，请重试。'); }
    finally { pending.current = false; setBusy(false); }
  }
  const current = snapshot?.collections.find((item) => item.id === collectionId);
  return <LibraryPanel visible={visible} title="添加到收藏夹" theme={theme} busy={busy}
    onClose={() => { if (!pending.current) { setMessage(null); setError(null); onClose(); } }}>
    <ScrollView contentContainerStyle={panelStyles.content} keyboardShouldPersistTaps="handled">
      <Text style={[panelStyles.section, { color: theme.secondary }]}>{family.displayName}</Text>
      {message && <Text accessibilityLiveRegion="polite" style={[panelStyles.section, { color: theme.secondary }]}>{message}</Text>}
      {error && <Text accessibilityRole="alert" style={[panelStyles.section, { color: theme.danger }]}>{error}</Text>}
      {snapshot?.collections.map((collection) => <Pressable key={collection.id} accessibilityRole="button"
        accessibilityLabel={`将字体加入${collection.name}`} accessibilityState={{ disabled: busy }} disabled={busy}
        onPress={() => { void change(collection, true); }} style={[panelStyles.row, { borderColor: theme.border }]}>
        <CollectionSymbol icon={collection.icon} color={collectionColorValue(collection.color)} />
        <Text style={[panelStyles.label, { color: theme.label }]}>{collection.name}</Text>
        <Text style={[panelStyles.detail, { color: theme.secondary }]}>加入</Text>
      </Pressable>)}
      {current && <PanelAction label={`移出「${current.name}」`} theme={theme} destructive disabled={busy}
        onPress={() => { void change(current, false); }} />}
      {snapshot?.collections.length === 0 && <Text style={[panelStyles.detail, { color: theme.secondary }]}>还没有收藏夹，请在字体库中创建。</Text>}
    </ScrollView>
  </LibraryPanel>;
}
