import { Stack } from 'expo-router';

export default function CaptureLayout() {
  return (
    <Stack>
      <Stack.Screen name="site" options={{ title: 'Select site' }} />
      <Stack.Screen name="camera" options={{ title: 'Capture' }} />
      <Stack.Screen name="tag" options={{ title: 'Tag workers' }} />
      <Stack.Screen name="summary" options={{ title: 'Session summary' }} />
    </Stack>
  );
}
