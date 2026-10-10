import { StyleSheet, View } from 'react-native';
import { CloudIcon, HardDriveIcon } from './icons';

export function FontLocationIcons({ local, cloud, color }: { local: boolean; cloud: boolean; color: string }) {
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.icons}>
    {local && <HardDriveIcon size={13} weight="fill" color={color} />}
    {cloud && <CloudIcon size={13} weight="fill" color={color} />}
  </View>;
}

const styles = StyleSheet.create({
  icons: { flexDirection: 'row', alignItems: 'center', flexShrink: 0, gap: 4 },
});
