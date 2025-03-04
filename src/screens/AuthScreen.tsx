// src/screens/AuthScreen.tsx
import React, { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { Button, Text } from 'react-native-paper';
import * as LocalAuthentication from 'expo-local-authentication';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types/navigation';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList>;
};

const AuthScreen: React.FC<Props> = ({ navigation }) => {
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const handleAuth = async () => {
    try {
      setIsAuthenticating(true);
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to access VoteBox',
        fallbackLabel: 'Use passcode',
      });

      if (result.success) {
        navigation.replace('ProposalList');
      } else {
        Alert.alert('Authentication Failed', 'Please try again');
      }
    } catch (error) {
      Alert.alert('Error', 'Authentication error occurred');
    } finally {
      setIsAuthenticating(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to VoteBox</Text>
      <Button
        mode="contained"
        onPress={handleAuth}
        loading={isAuthenticating}
        style={styles.button}
      >
        Authenticate
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 24,
    marginBottom: 30,
  },
  button: {
    width: '80%',
    padding: 8,
  },
});

export default AuthScreen;