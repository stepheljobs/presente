import { StyleSheet, Text, View } from 'react-native';

export default function AttendanceScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.hint}>
        Capture flow (camera, tagging, sync) arrives with E4/E5.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  hint: { color: '#666' },
});
