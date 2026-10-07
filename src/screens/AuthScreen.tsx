import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LanguagePicker } from '../components/LanguagePicker';

interface AuthScreenProps {
  onAuthenticate: () => void;
}

const AuthScreen = ({ onAuthenticate }: AuthScreenProps) => {
  const { t } = useTranslation('auth');
  const insets = useSafeAreaInsets();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkBiometricSupport();
  }, []);

  const checkBiometricSupport = async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      setBiometricAvailable(hasHardware && isEnrolled);
    } catch (error) {
      console.error('Biometric check error:', error);
      setBiometricAvailable(false);
    } finally {
      setChecking(false);
    }
  };

  const handleBiometricAuth = async () => {
    try {
      setIsAuthenticating(true);

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t('biometricPrompt.message'),
        fallbackLabel: t('biometricPrompt.fallbackLabel'),
        cancelLabel: t('biometricPrompt.cancelLabel'),
        disableDeviceFallback: false,
      });

      if (result.success) {
        onAuthenticate();
      } else {
        Alert.alert(
          t('alerts.authFailedTitle'),
          t('alerts.authFailedMessage'),
        );
      }
    } catch (error) {
      console.error('Authentication error:', error);
      Alert.alert(t('alerts.errorTitle'), t('alerts.errorMessage'));
    } finally {
      setIsAuthenticating(false);
    }
  };

  if (checking) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#22c55e" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Language choice before login — the phone's language may not be one we offer */}
      <View style={[styles.languageCorner, { top: insets.top + 12 }]}>
        <LanguagePicker />
      </View>

      {/* Logo / Brand Area */}
      <View style={styles.brandArea}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoText}>V</Text>
        </View>
        <Text style={styles.appName}>VoteBoxApp</Text>
        <Text style={styles.tagline}>{t('tagline')}</Text>
      </View>

      {/* Auth Area */}
      <View style={styles.authArea}>
        {biometricAvailable ? (
          <>
            <TouchableOpacity
              style={[styles.button, isAuthenticating && styles.buttonDisabled]}
              onPress={handleBiometricAuth}
              disabled={isAuthenticating}
              activeOpacity={0.8}
            >
              {isAuthenticating ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Text style={styles.buttonText}>{t('buttons.authenticateToVote')}</Text>
              )}
            </TouchableOpacity>

            <Text style={styles.hint}>
              {t('hints.useBiometric')}
            </Text>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.button, isAuthenticating && styles.buttonDisabled]}
              onPress={handleBiometricAuth}
              disabled={isAuthenticating}
              activeOpacity={0.8}
            >
              {isAuthenticating ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Text style={styles.buttonText}>{t('buttons.enterWithPasscode')}</Text>
              )}
            </TouchableOpacity>

            <Text style={styles.hint}>
              {t('hints.setUpBiometric')}
            </Text>
          </>
        )}
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {t('footer.madeWithLove')}
        </Text>
        <Text style={styles.footerSub}>
          {t('footer.noWalletRequired')}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    justifyContent: 'space-between',
    padding: 32,
  },
  languageCorner: {
    position: 'absolute',
    end: 16,
    zIndex: 1,
  },
  brandArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#22c55e',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  logoText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: 'white',
  },
  appName: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 10,
  },
  tagline: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 24,
  },
  authArea: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  button: {
    backgroundColor: '#22c55e',
    paddingVertical: 18,
    paddingHorizontal: 40,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
    marginBottom: 16,
  },
  buttonDisabled: {
    backgroundColor: '#9ca3af',
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  hint: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 4,
  },
  footer: {
    alignItems: 'center',
    paddingBottom: 16,
  },
  footerText: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 4,
  },
  footerSub: {
    fontSize: 12,
    color: '#22c55e',
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default AuthScreen;
