import { createContext, useContext, useRef, useLayoutEffect, type ReactNode } from 'react';
import type { Theme } from './ui';
const UiTheme = createContext<Theme | null>(null);
export function UiThemeProvider({ theme, children }: { theme: Theme; children: ReactNode }) {
  return <UiTheme.Provider value={theme}>{children}</UiTheme.Provider>;
}
export const useUiTheme = () => useContext(UiTheme);
// 使用最新快照检查排队中的原生事件，不因旧闭包接受过期输入。
export function useUiEventGuard(theme: Theme) {
  const revision = useRef(theme.revision);
  useLayoutEffect(() => { revision.current = theme.revision; }, [theme.revision]);
  return (event: unknown) => {
    const received = (event as { themeRevision?: string } | undefined)?.themeRevision;
    return !received || received === revision.current;
  };
}
