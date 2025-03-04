import React, { FC, useEffect } from 'react';  // Add useEffect to imports
import { View, StyleSheet, Image } from 'react-native';
import { Text } from 'react-native-paper';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types/navigation';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList>;
};

const SplashScreen: FC<Props> = ({ navigation }) => {
  useEffect(() => {
    setTimeout(() => {
      navigation.replace('Auth');
    }, 4000);
  }, []);

  return (
    <View style={styles.container}>
      <Image
        source={require('../../assets/lgc-logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <Text style={styles.title}>VoteBox</Text>
      <Text style={styles.subtitle}>
        Made by the LifeGround Community (LGC), with love.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 160,
    height: 160,
    marginBottom: 32,
  },
  title: {
    fontSize: 48,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 18,
    color: 'white',
  },
});

export default SplashScreen;