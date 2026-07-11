import { Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from '../lib/auth-context';
import { SyncProvider } from '../lib/sync-context';

function RootNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={user !== null}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="enroll" />
        <Stack.Screen name="capture" />
        <Stack.Screen name="corrections" />
      </Stack.Protected>
      <Stack.Protected guard={user === null}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <SyncProvider>
        <RootNavigator />
      </SyncProvider>
    </AuthProvider>
  );
}
