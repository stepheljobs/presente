import { Stack } from 'expo-router';
import { View } from 'react-native';
import { SyncPill } from '../../components/SyncPill';

export default function CaptureLayout() {
  return (
    <View style={{ flex: 1 }}>
      <SyncPill />
      <Stack>
        <Stack.Screen name="site" options={{ title: 'Select site' }} />
        <Stack.Screen name="camera" options={{ title: 'Capture' }} />
        <Stack.Screen name="tag" options={{ title: 'Tag workers' }} />
        <Stack.Screen name="summary" options={{ title: 'Session summary' }} />
      </Stack>
    </View>
  );
}
