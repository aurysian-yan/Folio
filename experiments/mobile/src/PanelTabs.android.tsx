import { PanelTabs as SharedPanelTabs, type PanelTabsProps } from './PanelTabs.shared';
import { CloudPanelTabs } from './CloudPanelTabs.android';
export function PanelTabs(props: PanelTabsProps) {
  return props.theme.ui?.material ? <CloudPanelTabs {...props} /> : <SharedPanelTabs {...props} />;
}
