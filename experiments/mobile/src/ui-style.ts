// 安卓 UI 风格与配色约束，不依赖运行时平台，供迁移和测试共用。
export type AndroidUiStyle = 'glasmio' | 'material3-expressive';
export function normalizeAndroidUiStyle(value: unknown): AndroidUiStyle {
  return value === 'material3-expressive' ? value : 'glasmio';
}
export function resolveAndroidAppearance(value: { androidUiStyle?: unknown; materialTheme?: unknown }, supportsM3e: boolean) {
  const androidUiStyle = supportsM3e ? normalizeAndroidUiStyle(value.androidUiStyle) : 'glasmio';
  return { androidUiStyle, materialTheme: supportsM3e ? androidUiStyle === 'material3-expressive' : value.materialTheme === true };
}
export function uiTokens(style: AndroidUiStyle) {
  const material = style === 'material3-expressive';
  return {
    style, material, materials: { backdrop: !material },
    shapes: { card: material ? 20 : 24, button: material ? 24 : 22, field: material ? 12 : 22, sheet: material ? 28 : 32 },
    metrics: { control: material ? 48 : 44, navigation: material ? 80 : 88, row: material ? 64 : 56 },
    typography: { title: material ? 32 : 34, body: 16, label: material ? 14 : 15, lineHeight: 24 },
    motion: { duration: material ? 250 : 345, deform: !material },
  };
}
