import { Stack } from 'expo-router';

export default function EnrollLayout() {
  return (
    <Stack>
      <Stack.Screen name="form" options={{ title: 'Enroll worker' }} />
      <Stack.Screen name="consent" options={{ title: 'Biometric consent' }} />
      <Stack.Screen name="signature" options={{ title: 'Signature' }} />
      <Stack.Screen name="paper" options={{ title: 'Paper consent' }} />
      <Stack.Screen name="faces" options={{ title: 'Face enrollment' }} />
    </Stack>
  );
}
