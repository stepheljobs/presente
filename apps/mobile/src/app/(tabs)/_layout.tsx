import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import type { ColorValue } from 'react-native';
import { SyncPill } from '../../components/SyncPill';

function tabIcon(glyph: string) {
  return function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ fontSize: 18, color }}>{glyph}</Text>;
  };
}

export default function TabsLayout() {
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingTop: 4 }}>
        <SyncPill />
      </View>
      <Tabs screenOptions={{ tabBarActiveTintColor: '#14532d' }}>
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
    </View>
  );
}
