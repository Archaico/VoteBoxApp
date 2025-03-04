import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const App = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>TEST CHANGE</Text>
      <Text style={styles.subtitle}>{new Date().toLocaleTimeString()}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'red',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 30,
    color: 'white',
  },
  subtitle: {
    fontSize: 20,
    color: 'white',
    marginTop: 10,
  },
});

export default App;