import { Stack } from 'expo-router';

export default function WorkersStackLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="[id]"
        options={{ title: 'Assign sites', headerBackTitle: 'Workers' }}
      />
    </Stack>
  );
}
