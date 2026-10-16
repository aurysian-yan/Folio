import type { Theme } from './ui';

export interface GlassSliderProps {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  valueText: string;
  theme: Theme;
  onChange: (value: number) => void;
}

// 移动端通过平台文件加载原生滑块。
export { GlassSlider } from './GlassSlider.android';
