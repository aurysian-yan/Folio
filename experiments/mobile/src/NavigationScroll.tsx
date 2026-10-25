import { createContext, useCallback, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import { initialNavigationScroll, trackNavigationScroll } from './navigation-scroll';

export const NavigationScrollContext = createContext<{ enabled: boolean; onCollapse: (collapsed: boolean) => void; setPanelActive: (id: string, active: boolean) => void }>({ enabled: false, onCollapse: () => {}, setPanelActive: () => {} });
const ActiveScrollContext = createContext(true);
export function NavigationScrollScope({ active, children }: { active: boolean; children: ReactNode }) {
  return <ActiveScrollContext.Provider value={active}>{children}</ActiveScrollContext.Provider>;
}
export function useNavigationScroll() {
  const { enabled, onCollapse } = useContext(NavigationScrollContext);
  const active = useContext(ActiveScrollContext);
  const state = useRef(initialNavigationScroll);
  const dragging = useRef(false);
  const begin = useCallback((offset: number) => { dragging.current = true; state.current = { ...initialNavigationScroll, offset: Math.max(0, offset) }; }, []);
  const end = useCallback(() => { dragging.current = false; }, []);
  const scroll = useCallback((offset: number, native = false) => {
    if (!enabled || !active || !dragging.current && !native) { state.current = { ...initialNavigationScroll, offset: Math.max(0, offset) }; return; }
    const next = trackNavigationScroll(state.current, offset);
    state.current = next.state;
    if (next.collapsed !== null) onCollapse(next.collapsed);
  }, [active, enabled, onCollapse]);
  return { begin, end, scroll };
}

export function useNavigationPanel(visible: boolean) {
  const id = useId();
  const { setPanelActive } = useContext(NavigationScrollContext);
  useEffect(() => { setPanelActive(id, visible); return () => setPanelActive(id, false); }, [id, setPanelActive, visible]);
}
