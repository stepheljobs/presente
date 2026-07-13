import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function tabIcon(glyph: string) {
  return function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ fontSize: 18, color }}>{glyph}</Text>;
  };
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  // Only pad the tab bar for the system nav. Do NOT pad the top of this
  // wrapper — React Navigation already insets the stack/tab headers.
  const tabPad = Math.max(insets.bottom, 4);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#14532d',
        tabBarStyle: {
          paddingBottom: tabPad,
          height: 49 + tabPad,
        },
        headerStatusBarHeight: insets.top,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: tabIcon('⌂') }}
      />
      <Tabs.Screen
        name="workers"
        options={{ title: 'Workers', tabBarIcon: tabIcon('👷') }}
      />
      <Tabs.Screen
        name="attendance"
        options={{ title: 'Attendance', tabBarIcon: tabIcon('📸') }}
      />
    </Tabs>
  );
}
