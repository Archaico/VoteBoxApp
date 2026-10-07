// src/screens/SplashScreen.tsx
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useTranslation } from 'react-i18next';

interface SplashScreenProps {
  onFinish: () => void;
}

const SplashScreen = ({ onFinish }: SplashScreenProps) => {
  const { t } = useTranslation('auth');
  useEffect(() => {
    const timer = setTimeout(() => {
      onFinish();
    }, 3000);
    return () => clearTimeout(timer);
  }, [onFinish]);

  return (
    <View style={styles.container}>
      <Image
        source={require('../assets/icon.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <Text style={styles.title}>VoteBoxApp</Text>
      <Text style={styles.subtitle}>
        {t('splash.subtitle')}
      </Text>
      <Text style={styles.footer}>
        {t('splash.footer')}
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
    width: 120,
    height: 120,
    marginBottom: 24,
  },
  title: {
    fontSize: 48,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: 'white',
    opacity: 0.95,
    marginBottom: 40,
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    fontSize: 14,
    color: 'white',
    opacity: 0.9,
  },
});

export default SplashScreen;
