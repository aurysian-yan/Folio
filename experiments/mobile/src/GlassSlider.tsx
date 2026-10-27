import type { Theme } from './ui';

export interface GlassSliderProps {
  sourceId?: string;
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  valueText: string;
  theme: Theme;
  onChange: (value: number) => void;
  onEditingChanged?: (editing: boolean) => void;
}

// 移动端通过平台文件加载原生滑块。
export { GlassSlider } from './GlassSlider.android';
