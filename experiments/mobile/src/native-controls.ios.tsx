import {
  Button, GlassEffectContainer, Host, HStack, Image, Label, List, Menu,
  NavigationSplitView, Picker, RNHostView, Section, Spacer, TabView, Text, TextField,
  Toolbar, ToolbarItem, useNativeState, VStack,
  type ButtonProps, type TextFieldRef, type NavigationSplitViewColumn, type NavigationSplitViewVisibility,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel, autocorrectionDisabled, background, buttonBorderShape,
  buttonStyle, contentShape, controlSize, disabled, font, foregroundStyle, frame, glassEffect,
  labelStyle, listStyle, menuIndicator, menuStyle, navigationSplitViewStyle, navigationTitle, onSubmit, opacity, padding, submitLabel,
  shapes, tabViewStyle, tag, textFieldStyle, textInputAutocapitalization, tint,
} from '@expo/ui/swift-ui/modifiers';
import { requireNativeView } from 'expo';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Platform, StyleSheet, View } from 'react-native';
import { collectionColorValue, collectionSystemImage } from './collection-style';
import type {
  NativeActionProps, NativeDestination, NativeHeaderProps, NativeLibraryContentProps, NativeNavigationProps, NativeScrollContainerProps,
} from './native-controls';

export const usesNativeControls = true;
export const usesNativeSidebar = Platform.OS === 'ios' && Platform.isPad;
const glass = Number(Platform.Version) >= 26;
const toolbarHeight = 44;

export const NativeScrollContainer = requireNativeView<NativeScrollContainerProps>('FolioNative', 'FolioScrollContainer');
const NativeTabContent = requireNativeView<{ children: React.ReactNode }>('FolioNative', 'FolioTabContent');

// 原生玻璃尺寸与控件边界保持一致。
function iconButtonModifiers(color: string, diameter = toolbarHeight, plain = false, prominent = false) {
  return [
    buttonStyle(glass || plain ? 'plain' : prominent ? 'borderedProminent' : 'bordered'),
    controlSize(diameter < toolbarHeight ? 'small' : 'large'),
    buttonBorderShape('circle'), labelStyle('iconOnly'),
    font({ size: diameter < toolbarHeight ? 14 : 20 }), tint(color),
    frame({ width: diameter, height: diameter }),
    ...(glass && !plain ? [glassEffect({ glass: { variant: 'regular', interactive: true, ...(prominent ? { tint: color } : {}) }, shape: 'circle' })] : []),
  ];
}

// iPad 常规窗口使用原生分栏，紧凑窗口沿用 iPhone 标签栏。
export function NativeNavigation({ children, settings, search, cloud, theme, sidebar, destination, snapshot, onDestinationChange }: NativeNavigationProps) {
  const { t } = useTranslation();
  const [visibility, setVisibility] = useState<NavigationSplitViewVisibility>('all');
  const [compactColumn, setCompactColumn] = useState<NavigationSplitViewColumn>('detail');

  if (sidebar) {
    const row = (id: NativeDestination, title: string, symbol: ButtonProps['systemImage'], count?: number, color?: string, smart = false) => (
      <HStack key={id} modifiers={[tag(id)]}>
        {color ? <><Image systemName={symbol!} modifiers={[foregroundStyle(color)]} /><Text>{title}</Text></>
          : <Label title={title} systemImage={symbol} />}
        <Spacer />
        {smart && <Image systemName="sparkles" modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]} />}
        {count !== undefined && <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>{count}</Text>}
      </HStack>
    );
    return (
      <Host style={styles.fill} modifiers={[background(theme.background)]}>
        <NavigationSplitView columnVisibility={visibility} onColumnVisibilityChange={setVisibility}
          preferredCompactColumn={compactColumn} onPreferredCompactColumnChange={setCompactColumn}
          modifiers={[navigationSplitViewStyle('balanced'), tint(theme.accent)]}>
          <NavigationSplitView.Sidebar>
            <List selection={[destination]} onSelectionChange={(selection) => {
              const value = selection[0];
              if (value === 'local' || value === 'search' || value === 'favorites' || value === 'cloud' || value === 'settings' || (typeof value === 'string' && (value.startsWith('collection:') || value.startsWith('smart:')))) {
                onDestinationChange(value as NativeDestination);
                setCompactColumn('detail');
              }
            }} modifiers={[listStyle('sidebar'), navigationTitle('Folio')]}>
              <Section title={t('navigation.local')}>
                {row('local', t('navigation.allFonts'), 'textformat.alt', snapshot?.familyCount)}
                {row('favorites', t('mobile.starredCollections'), 'star')}
              </Section>
              {(!!snapshot?.collections.length || !!snapshot?.smartFolders.length) && <Section title={t('navigation.collections')}>
                {snapshot?.smartFolders.map((folder) => row(`smart:${folder.id}`, folder.name,
                  collectionSystemImage(folder.icon) as ButtonProps['systemImage'], folder.matchCount, collectionColorValue(folder.color), true))}
                {snapshot?.collections.map((collection) => row(`collection:${collection.id}`, collection.name,
                  collectionSystemImage(collection.icon) as ButtonProps['systemImage'], collection.memberCount, collectionColorValue(collection.color)))}
              </Section>}
              <Section>{row('search', t('common.search'), 'magnifyingglass')}</Section>
              <Section title={t('navigation.cloud')}>{row('cloud', t('mobile.cloudFonts'), 'cloud')}</Section>
              <Section>{row('settings', t('navigation.settings'), 'gear')}</Section>
            </List>
          </NavigationSplitView.Sidebar>
          <NavigationSplitView.Detail>{destination === 'settings' ? settings : destination === 'search' ? search
            : destination === 'cloud' ? <RNHostView><View style={styles.fill}>{cloud}</View></RNHostView> : children}</NavigationSplitView.Detail>
        </NavigationSplitView>
      </Host>
    );
  }

  return (
    <Host style={styles.fill} modifiers={[background(theme.background)]}>
      <TabView selection={destination} onSelectionChange={(value) => {
        if (value === 'local' || value === 'search' || value === 'cloud' || value === 'settings') onDestinationChange(value);
      }}
        modifiers={[tabViewStyle({ type: 'automatic' }), tint(theme.accent), background(theme.background)]}>
        <TabView.Tab value="local" label={t('navigation.local')} systemImage="textformat.alt">
          <NativeTabContent>
            <RNHostView><View style={styles.fill}>{children}</View></RNHostView>
          </NativeTabContent>
        </TabView.Tab>
        <TabView.Tab value="search" label={t('common.search')} systemImage="magnifyingglass">
          <NativeTabContent><RNHostView><View style={styles.fill}>{search}</View></RNHostView></NativeTabContent>
        </TabView.Tab>
        <TabView.Tab value="cloud" label={t('navigation.cloud')} systemImage="cloud">
          <NativeTabContent><RNHostView><View style={styles.fill}>{cloud}</View></RNHostView></NativeTabContent>
        </TabView.Tab>
        <TabView.Tab value="settings" label={t('navigation.settings')} systemImage="gear">
          <NativeTabContent><RNHostView><View style={styles.fill}>{settings}</View></RNHostView></NativeTabContent>
        </TabView.Tab>
      </TabView>
    </Host>
  );
}

// 分栏详情只保留系统工具栏，React Native 内容不再绘制顶部操作区。
export function NativeLibraryContent({ children, title, subtitle, active, theme, mode, width,
  searchOpen, searchText, ready, importing, importBlocked = false, onModeChange, onSearchTextChange, onImport, onFilter, filterCount }: NativeLibraryContentProps) {
  const { t } = useTranslation();
  const text = useNativeState(searchText);
  const searchInput = useRef<TextFieldRef>(null);
  useEffect(() => {
    if (searchOpen && active && ready) void searchInput.current?.focus();
    else void searchInput.current?.blur();
  }, [active, ready, searchOpen]);
  useEffect(() => { if (searchText !== text.get()) text.set(searchText); }, [searchText, text]);

  const actionModifiers = [labelStyle('iconOnly'), tint(theme.label)];
  return (
    <Toolbar>
      <NativeTabContent><RNHostView>{children}</RNHostView></NativeTabContent>
      <Toolbar.Content>
        <ToolbarItem placement="principal">
          {active && searchOpen ? <HStack spacing={8} modifiers={[
            padding({ horizontal: 12 }), frame({ width: Math.max(100, width - toolbarHeight), height: toolbarHeight }),
            ...(glass ? [glassEffect({ glass: { variant: 'regular' }, shape: 'capsule' })] : []),
          ]}>
            <Image systemName="magnifyingglass" size={20} color={theme.secondary} />
            <TextField ref={searchInput} text={text} placeholder={t('mobile.searchPlaceholder')}
              onTextChange={onSearchTextChange} modifiers={[
                textFieldStyle(glass ? 'plain' : 'roundedBorder'), font({ textStyle: 'body' }), tint(theme.accent),
                accessibilityLabel(t('mobile.searchFonts')), autocorrectionDisabled(), disabled(!ready || !active),
                textInputAutocapitalization('never'), submitLabel('search'), onSubmit(() => Keyboard.dismiss()),
              ]} />
            {searchText.length > 0 && <Button label={t('mobile.clearSearch')} systemImage="xmark.circle.fill"
              onPress={() => { text.set(''); onSearchTextChange(''); }}
              modifiers={[buttonStyle('plain'), labelStyle('iconOnly'), tint(theme.secondary), accessibilityLabel(t('mobile.clearSearch'))]} />}
          </HStack> : <VStack>
            <Text modifiers={[font({ textStyle: 'headline' })]}>{title}</Text>
            {active && <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>{subtitle}</Text>}
          </VStack>}
        </ToolbarItem>
        {active && <ToolbarItem placement="topBarTrailing">
          <HStack>
            {searchOpen ? <>
              <Button label={filterCount ? t('mobile.filtersSelected', { count: filterCount }) : t('library.filterFonts')} systemImage="line.3.horizontal.decrease"
                onPress={onFilter} modifiers={[...actionModifiers, tint(filterCount ? theme.accent : theme.label), disabled(!ready)]} />
            </> : <>
              <Menu label={<Label title={t('libraryView.viewOptions')} systemImage={mode === 'grid' ? 'square.grid.2x2' : 'list.bullet'} />}
                modifiers={[labelStyle('iconOnly'), menuIndicator('hidden'), tint(theme.label), accessibilityLabel(t('libraryView.viewOptions'))]}>
                <Picker label={t('mobile.viewMode')} selection={mode} onSelectionChange={onModeChange} modifiers={[tint(theme.accent)]}>
                  <Label title={t('mobile.gridView')} systemImage="square.grid.2x2" modifiers={[tag('grid')]} />
                  <Label title={t('mobile.listView')} systemImage="list.bullet" modifiers={[tag('list')]} />
                </Picker>
              </Menu>
              <Button label={filterCount ? t('mobile.filtersSelected', { count: filterCount }) : t('library.filterFonts')} systemImage="line.3.horizontal.decrease"
                onPress={onFilter} modifiers={[...actionModifiers, tint(filterCount ? theme.accent : theme.label), disabled(!ready)]} />
              <Button label={importing ? t('mobile.loadingImport') : t('import.importFonts')} systemImage="plus" onPress={onImport}
                modifiers={[...actionModifiers, disabled(!ready || importing || importBlocked)]} />
            </>}
          </HStack>
        </ToolbarItem>}
      </Toolbar.Content>
    </Toolbar>
  );
}

// 系统 Menu 保留原生展开、收起与菜单项选择行为。
export function NativeHeaderControls({ theme, active, mode, width, searchOpen, searchText, ready, importing, importBlocked = false,
  onModeChange, onSearchTextChange, onImport, onFilter, filterCount }: NativeHeaderProps) {
  const { t } = useTranslation();
  const menuWidth = width < toolbarHeight * 7 ? toolbarHeight : 64;
  const text = useNativeState(searchText);
  const searchInput = useRef<TextFieldRef>(null);
  useEffect(() => {
    if (searchOpen && active && ready) void searchInput.current?.focus();
    else void searchInput.current?.blur();
  }, [active, ready, searchOpen]);
  useEffect(() => { if (searchText !== text.get()) text.set(searchText); }, [searchText, text]);

  return (
    <Host style={styles.header}>
      <GlassEffectContainer spacing={10}>
        <HStack spacing={10} modifiers={[frame({ width, height: toolbarHeight, alignment: 'trailing' })]}>
          {searchOpen ? <>
            <HStack spacing={8} modifiers={[
              padding({ horizontal: 12 }), frame({ width: width - toolbarHeight - 10, height: toolbarHeight }),
              ...(glass ? [glassEffect({ glass: { variant: 'regular' }, shape: 'capsule' })] : []),
            ]}>
              <Image systemName="magnifyingglass" size={20} color={theme.secondary} />
              <TextField ref={searchInput} text={text} placeholder={t('mobile.searchPlaceholder')} onTextChange={onSearchTextChange}
                modifiers={[textFieldStyle(glass ? 'plain' : 'roundedBorder'), font({ textStyle: 'body' }), tint(theme.accent),
                  accessibilityLabel(t('mobile.searchFonts')), autocorrectionDisabled(), disabled(!ready || !active),
                  textInputAutocapitalization('never'), submitLabel('search'), onSubmit(() => Keyboard.dismiss())]} />
              {searchText.length > 0 && <Button label={t('mobile.clearSearch')} systemImage="xmark.circle.fill"
                onPress={() => { text.set(''); onSearchTextChange(''); }}
                modifiers={[buttonStyle('plain'), labelStyle('iconOnly'), tint(theme.secondary), accessibilityLabel(t('mobile.clearSearch'))]} />}
            </HStack>
            <Button onPress={onFilter}
              modifiers={[...iconButtonModifiers(filterCount ? theme.accent : theme.label), disabled(!ready || !active),
                accessibilityLabel(filterCount ? t('mobile.filtersSelected', { count: filterCount }) : t('library.filterFonts'))]}>
              <Image systemName="line.3.horizontal.decrease" size={20} color={filterCount ? theme.accent : theme.label}
                modifiers={[frame({ width: toolbarHeight, height: toolbarHeight }), contentShape(shapes.circle())]} />
            </Button>
          </> : <>
            <Menu label={<HStack spacing={6}
              modifiers={[frame({ width: menuWidth, height: toolbarHeight }), contentShape(shapes.capsule())]}>
              <Image systemName={mode === 'grid' ? 'square.grid.2x2' : 'list.bullet'} size={20} color={theme.label} />
              <Image systemName="chevron.down" size={10} color={theme.secondary} />
            </HStack>}
              modifiers={[menuStyle('button'), buttonStyle(glass ? 'plain' : 'bordered'),
                controlSize('large'), menuIndicator('hidden'), tint(theme.label), accessibilityLabel(t('libraryView.viewOptions')),
                frame({ width: menuWidth, height: toolbarHeight }),
                ...(glass ? [glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' })] : [])]}>
              <Picker label={t('mobile.viewMode')} selection={mode} onSelectionChange={onModeChange} modifiers={[tint(theme.accent)]}>
                <Label title={t('mobile.gridView')} systemImage="square.grid.2x2" modifiers={[tag('grid')]} />
                <Label title={t('mobile.listView')} systemImage="list.bullet" modifiers={[tag('list')]} />
              </Picker>
            </Menu>
            <Button onPress={onFilter}
              modifiers={[...iconButtonModifiers(filterCount ? theme.accent : theme.label), disabled(!ready),
                accessibilityLabel(filterCount ? t('mobile.filtersSelected', { count: filterCount }) : t('library.filterFonts'))]}>
              <Image systemName="line.3.horizontal.decrease" size={20} color={filterCount ? theme.accent : theme.label}
                modifiers={[frame({ width: toolbarHeight, height: toolbarHeight }), contentShape(shapes.circle())]} />
            </Button>
            <Button onPress={onImport}
              modifiers={[...iconButtonModifiers(theme.label), accessibilityLabel(importing ? t('mobile.loadingImport') : t('import.importFonts')), disabled(!ready || importing || importBlocked)]}>
              <Image systemName="plus" size={20} color={theme.label}
                modifiers={[frame({ width: toolbarHeight, height: toolbarHeight }), contentShape(shapes.circle())]} />
            </Button>
          </>}
        </HStack>
      </GlassEffectContainer>
    </Host>
  );
}

export function NativeActionButton({ label, systemImage, color, onPress, disabled: unavailable,
  prominent = false, iconOnly = false, diameter = 44, plain = false, minimumWidth, foregroundColor }: NativeActionProps) {
  return (
    <Host matchContents={!iconOnly} style={iconOnly ? { width: diameter, height: diameter } : undefined}>
      <Button label={iconOnly ? undefined : label} systemImage={systemImage as ButtonProps['systemImage']} onPress={onPress}
        modifiers={iconOnly ? [...iconButtonModifiers(color, diameter, plain, prominent), disabled(!!unavailable),
          opacity(unavailable ? 0.5 : 1), accessibilityLabel(label)] : [
          buttonStyle(plain ? 'plain' : glass ? (prominent ? 'glassProminent' : 'glass') : (prominent ? 'borderedProminent' : 'bordered')),
          labelStyle('titleAndIcon'), disabled(!!unavailable),
          controlSize('large'), buttonBorderShape('capsule'), font({ size: 16, weight: 'semibold' }),
          frame({ minHeight: toolbarHeight, minWidth: minimumWidth }), tint(color), accessibilityLabel(label),
        ]}>
        {iconOnly && systemImage ? <Image systemName={systemImage as ButtonProps['systemImage']}
          size={diameter < toolbarHeight ? 14 : 20} color={foregroundColor ?? color}
          modifiers={[frame({ width: diameter, height: diameter }), contentShape(shapes.circle())]} /> : undefined}
      </Button>
    </Host>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flex: 1, height: toolbarHeight },
});
