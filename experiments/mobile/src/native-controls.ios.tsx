import {
  Button, GlassEffectContainer, Host, HStack, Image, Label, Menu, Namespace, Picker,
  RNHostView, TabView, TextField, useNativeState,
  type ButtonProps,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel, animation, Animation, autocorrectionDisabled, buttonBorderShape,
  buttonStyle, contentShape, controlSize, disabled, font, frame, glassEffect, glassEffectId,
  labelStyle, menuIndicator, menuStyle, onSubmit, padding, submitLabel,
  shapes, tabViewStyle, tag, textFieldStyle, textInputAutocapitalization, tint,
} from '@expo/ui/swift-ui/modifiers';
import { useEffect, useId, useState } from 'react';
import { AccessibilityInfo, Keyboard, Platform, StyleSheet, View } from 'react-native';
import type { NativeActionProps, NativeHeaderProps, NativeTabsProps } from './native-controls';

export const usesNativeControls = true;
const glass = Number(Platform.Version) >= 26;
const toolbarHeight = 44;

// 原生玻璃尺寸与控件边界保持一致。
function iconButtonModifiers(color: string, diameter = toolbarHeight, plain = false) {
  return [
    buttonStyle(glass || plain ? 'plain' : 'bordered'),
    controlSize(diameter < toolbarHeight ? 'small' : 'large'),
    buttonBorderShape('circle'), labelStyle('iconOnly'),
    font({ size: diameter < toolbarHeight ? 14 : 20 }), tint(color),
    frame({ width: diameter, height: diameter }),
    ...(glass && !plain ? [glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' })] : []),
  ];
}

// iOS 导航由系统 TabView 管理选中项、拖动和玻璃动效。
export function NativeTabs({ children, theme, onTabChange }: NativeTabsProps) {
  return (
    <Host style={styles.fill}>
      <TabView defaultSelection="local" onSelectionChange={(value) => onTabChange(value === 'local')}
        modifiers={[tabViewStyle({ type: 'automatic' }), tint(theme.accent)]}>
        <TabView.Tab value="local" label="本地" systemImage="textformat.alt">
          <RNHostView><View style={styles.fill}>{children}</View></RNHostView>
        </TabView.Tab>
        <TabView.Tab value="recent" label="最近" systemImage="clock">
          <RNHostView><View style={[styles.fill, { backgroundColor: theme.background }]} /></RNHostView>
        </TabView.Tab>
        <TabView.Tab value="cloud" label="云端" systemImage="cloud">
          <RNHostView><View style={[styles.fill, { backgroundColor: theme.background }]} /></RNHostView>
        </TabView.Tab>
        <TabView.Tab value="settings" label="设置" systemImage="gear">
          <RNHostView><View style={[styles.fill, { backgroundColor: theme.background }]} /></RNHostView>
        </TabView.Tab>
      </TabView>
    </Host>
  );
}

// 系统 Menu 保留原生展开、收起与菜单项选择行为。
export function NativeHeaderControls({ theme, mode, width, searchOpen, searchText, ready, importing,
  onModeChange, onSearch, onSearchTextChange, onImport }: NativeHeaderProps) {
  const namespace = useId();
  const text = useNativeState(searchText);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);

  useEffect(() => { if (!searchOpen) text.set(''); }, [searchOpen, text]);

  return (
    <Host style={styles.header}>
      <Namespace id={namespace}>
        <GlassEffectContainer spacing={10}
          modifiers={reduceMotion ? [] : [animation(Animation.default, searchOpen)]}>
          <HStack spacing={10} modifiers={[frame({ width, height: toolbarHeight, alignment: 'trailing' })]}>
            {searchOpen ? <>
              <HStack spacing={8} modifiers={[
                padding({ horizontal: 12 }), frame({ width: width - toolbarHeight - 10, height: toolbarHeight }),
                ...(glass ? [glassEffect({ glass: { variant: 'regular' }, shape: 'capsule' }), glassEffectId('search', namespace)] : []),
              ]}>
                <Image systemName="magnifyingglass" size={20} color={theme.secondary} />
                <TextField text={text} placeholder="搜索字体名称或样式" autoFocus onTextChange={onSearchTextChange}
                  modifiers={[textFieldStyle(glass ? 'plain' : 'roundedBorder'), font({ textStyle: 'body' }),
                    accessibilityLabel('搜索字体'), autocorrectionDisabled(),
                    textInputAutocapitalization('never'), submitLabel('search'), onSubmit(() => Keyboard.dismiss())]} />
                {searchText.length > 0 && <Button label="清除搜索" systemImage="xmark.circle.fill"
                  onPress={() => { text.set(''); onSearchTextChange(''); }}
                  modifiers={[buttonStyle('plain'), labelStyle('iconOnly'), tint(theme.secondary), accessibilityLabel('清除搜索')]} />}
              </HStack>
              <Button onPress={onSearch} modifiers={[...iconButtonModifiers(theme.label), accessibilityLabel('关闭搜索')]}>
                <Image systemName="xmark" size={20} color={theme.label}
                  modifiers={[frame({ width: toolbarHeight, height: toolbarHeight }), contentShape(shapes.circle())]} />
              </Button>
            </> : <>
              <Menu label={<HStack spacing={6}
                modifiers={[frame({ width: 64, height: toolbarHeight }), contentShape(shapes.capsule())]}>
                <Image systemName={mode === 'grid' ? 'square.grid.2x2' : 'list.bullet'} size={20} color={theme.label} />
                <Image systemName="chevron.down" size={10} color={theme.secondary} />
              </HStack>}
                modifiers={[menuStyle('button'), buttonStyle(glass ? 'plain' : 'bordered'),
                  controlSize('large'), menuIndicator('hidden'), tint(theme.label), accessibilityLabel('视图选项'),
                  frame({ width: 64, height: toolbarHeight }),
                  ...(glass ? [glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' })] : [])]}>
                <Picker label="视图" selection={mode} onSelectionChange={onModeChange}>
                  <Label title="网格视图" systemImage="square.grid.2x2" modifiers={[tag('grid')]} />
                  <Label title="列表视图" systemImage="list.bullet" modifiers={[tag('list')]} />
                </Picker>
              </Menu>
              <Button onPress={onSearch}
                modifiers={[...iconButtonModifiers(theme.label), accessibilityLabel('搜索字体'),
                  ...(glass ? [glassEffectId('search', namespace)] : [])]}>
                <Image systemName="magnifyingglass" size={20} color={theme.label}
                  modifiers={[frame({ width: toolbarHeight, height: toolbarHeight }), contentShape(shapes.circle())]} />
              </Button>
              <Button onPress={onImport}
                modifiers={[...iconButtonModifiers(theme.label), accessibilityLabel(importing ? '正在导入…' : '导入字体'), disabled(!ready || importing)]}>
                <Image systemName="plus" size={20} color={theme.label}
                  modifiers={[frame({ width: toolbarHeight, height: toolbarHeight }), contentShape(shapes.circle())]} />
              </Button>
            </>}
          </HStack>
        </GlassEffectContainer>
      </Namespace>
    </Host>
  );
}

export function NativeActionButton({ label, systemImage, color, onPress, disabled: unavailable,
  prominent = false, iconOnly = false, diameter = 44, plain = false }: NativeActionProps) {
  return (
    <Host matchContents={!iconOnly} style={iconOnly ? { width: diameter, height: diameter } : undefined}>
      <Button label={iconOnly ? undefined : label} systemImage={systemImage as ButtonProps['systemImage']} onPress={onPress}
        modifiers={iconOnly ? [...iconButtonModifiers(color, diameter, plain), disabled(!!unavailable), accessibilityLabel(label)] : [
          buttonStyle(plain ? 'plain' : glass ? (prominent ? 'glassProminent' : 'glass') : (prominent ? 'borderedProminent' : 'bordered')),
          labelStyle('titleAndIcon'), disabled(!!unavailable),
          controlSize('large'), tint(color), accessibilityLabel(label),
        ]}>
        {iconOnly && systemImage ? <Image systemName={systemImage as ButtonProps['systemImage']}
          size={diameter < toolbarHeight ? 14 : 20} color={color}
          modifiers={[frame({ width: diameter, height: diameter }), contentShape(shapes.circle())]} /> : undefined}
      </Button>
    </Host>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flex: 1, height: toolbarHeight },
});
