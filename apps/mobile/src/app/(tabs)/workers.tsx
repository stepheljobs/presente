import { StyleSheet, Text, View } from 'react-native';

export default function WorkersScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.hint}>
        Worker enrollment and roster arrive with E3.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  hint: { color: '#666' },
});
