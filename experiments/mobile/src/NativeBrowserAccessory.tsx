import { createContext } from 'react';

export interface BrowserAccessory {
  title: string;
  address: string;
  label: string;
  start: boolean;
  badge: number;
  attention: boolean;
  onPress: () => void;
}

export const NativeBrowserAccessoryContext = createContext<{
  enabled: boolean;
  setAccessory: (accessory: BrowserAccessory | null) => void;
}>({ enabled: false, setAccessory: () => {} });
