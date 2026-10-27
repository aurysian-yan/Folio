import { createContext, useContext, useId, type ReactNode } from 'react';

interface GlassScopeValue { sourceId: string; active: boolean }
const GlassScope = createContext<GlassScopeValue>({ sourceId: '', active: true });

// 背景源通过上下文传递，控件身份在重渲染期间保持稳定。
export function GlassControlScope({ sourceId, active = true, children }: GlassScopeValue & { children: ReactNode }) {
  return <GlassScope.Provider value={{ sourceId, active }}>{children}</GlassScope.Provider>;
}

export function useGlassControl(sourceId?: string) {
  const scope = useContext(GlassScope);
  const controlId = useId();
  return { controlId, sourceId: sourceId ?? scope.sourceId, active: scope.active };
}
