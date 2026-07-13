import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** When false, skip top inset (stack headers already clear status bar). Default true. */
  edges?: { top?: boolean; bottom?: boolean };
};

/**
 * Full-screen layout that respects Android nav / iOS home indicator.
 * Prefer this over hard-coded bottom margins on footer CTAs.
 */
export function Screen({
  children,
  style,
  edges = { top: true, bottom: true },
}: Props) {
  const insets = useSafeAreaInsets();
  const top = edges.top === false ? 0 : insets.top;
  // Floor of 12 keeps a little breathing room when inset is 0 (some emulators).
  const bottom =
    edges.bottom === false ? 0 : Math.max(insets.bottom, 12);

  return (
    <View
      style={[
        styles.base,
        {
          paddingTop: top,
          paddingBottom: bottom,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flex: 1,
  },
});
