const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

/**
 * Real `expo-notifications` throws at import time on Android Expo Go (SDK 53+).
 * Stub it during normal Metro dev so Expo Go can load the app.
 * Use the real package when:
 *  - bundling for production (NODE_ENV=production), or
 *  - EXPO_PUBLIC_ENABLE_PUSH=true (native dev client push testing)
 */
const useRealNotifications =
  process.env.EXPO_PUBLIC_ENABLE_PUSH === 'true' ||
  process.env.NODE_ENV === 'production';

const stubPath = path.resolve(
  projectRoot,
  'src/lib/expo-notifications.stub.ts',
);

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'expo-notifications' && !useRealNotifications) {
    return { type: 'sourceFile', filePath: stubPath };
  }
  if (upstreamResolveRequest) {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
