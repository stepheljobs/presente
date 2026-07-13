import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  ConsentNotice,
  getConsentNotice,
  loadDraft,
  saveDraft,
} from '../../lib/enrollment';

import { Screen } from '../../components/Screen';
/**
 * E3-S03: RA 10173 biometric notice, EN/TL toggle, copy served from the
 * backend so counsel can revise without a release. Accept stays disabled
 * until the worker has scrolled to the end.
 */
export default function ConsentScreen() {
  const [notice, setNotice] = useState<ConsentNotice | null>(null);
  const [language, setLanguage] = useState<'en' | 'tl'>('tl');
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getConsentNotice()
      .then(setNotice)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load'),
      );
  }, []);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 32) {
      setScrolledToEnd(true);
    }
  }

  async function choose(path: '/enroll/signature' | '/enroll/paper') {
    const draft = await loadDraft();
    await saveDraft({ ...draft!, consentLanguage: language });
    router.push(path);
  }

  if (error) return <Text style={styles.error}>{error}</Text>;
  if (!notice) return <Text style={styles.loading}>Loading notice…</Text>;

  return (
    <Screen style={styles.container} edges={{ top: false, bottom: true }}>
      <View style={styles.langRow}>
        <Pressable
          style={[styles.langChip, language === 'tl' && styles.langActive]}
          onPress={() => setLanguage('tl')}
        >
          <Text style={language === 'tl' ? styles.langActiveText : undefined}>
            Tagalog
          </Text>
        </Pressable>
        <Pressable
          style={[styles.langChip, language === 'en' && styles.langActive]}
          onPress={() => setLanguage('en')}
        >
          <Text style={language === 'en' ? styles.langActiveText : undefined}>
            English
          </Text>
        </Pressable>
      </View>
      <ScrollView
        style={styles.notice}
        onScroll={onScroll}
        scrollEventThrottle={100}
      >
        <Text style={styles.noticeText}>{notice[language]}</Text>
      </ScrollView>
      {!scrolledToEnd && (
        <Text style={styles.hint}>
          {language === 'tl'
            ? 'Basahin hanggang dulo para makapagpatuloy'
            : 'Read to the end to continue'}
        </Text>
      )}
      <Pressable
        style={[styles.button, !scrolledToEnd && styles.disabled]}
        disabled={!scrolledToEnd}
        onPress={() => choose('/enroll/signature')}
      >
        <Text style={styles.buttonText}>
          {language === 'tl' ? 'Sumasang-ayon — pumirma' : 'Agree — sign now'}
        </Text>
      </Pressable>
      <Pressable
        style={[styles.buttonSecondary, !scrolledToEnd && styles.disabled]}
        disabled={!scrolledToEnd}
        onPress={() => choose('/enroll/paper')}
      >
        <Text style={styles.buttonSecondaryText}>
          {language === 'tl'
            ? 'Kuhanan ang pirmadong papel'
            : 'Photograph signed paper form'}
        </Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 10 },
  langRow: { flexDirection: 'row', gap: 8 },
  langChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#bbb',
  },
  langActive: { backgroundColor: '#14532d', borderColor: '#14532d' },
  langActiveText: { color: '#fff' },
  notice: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
  },
  noticeText: { fontSize: 15, lineHeight: 22 },
  hint: { color: '#946200', fontSize: 13, textAlign: 'center' },
  loading: { padding: 24, color: '#666' },
  error: { padding: 24, color: '#b91c1c' },
  button: {
    backgroundColor: '#14532d',
    borderRadius: 6,
    padding: 14,
    alignItems: 'center',
  },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: '#14532d',
    borderRadius: 6,
    padding: 13,
    alignItems: 'center',
  },
  buttonSecondaryText: { color: '#14532d', fontWeight: '600' },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
