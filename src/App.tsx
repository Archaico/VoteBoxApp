// App.tsx
import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import SplashScreen from './screens/SplashScreen';
import AuthScreen from './screens/AuthScreen';
import ProposalListScreen from './screens/ProposalListScreen';
import VotingScreen from './screens/VotingScreen';
import CreateProposalScreen from './screens/CreateProposalScreen';

type AppScreen = 'splash' | 'auth' | 'main' | 'voting' | 'create';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('splash');
  const [selectedProposalId, setSelectedProposalId] = useState('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleSplashFinish = () => {
    console.log('Splash finished, navigating to auth');
    setCurrentScreen('auth');
  };

  const handleAuthenticate = () => {
    setCurrentScreen('main');
  };

  const handleCreateProposal = () => {
    console.log('Navigating to Create Proposal screen');
    setCurrentScreen('create');
  };

  const handleVoteProposal = (proposalId: string) => {
    console.log('Navigating to Voting screen for proposal:', proposalId);
    setSelectedProposalId(proposalId);
    setCurrentScreen('voting');
  };

  const handleBackToMain = () => {
    console.log('Navigating back to main');
    setCurrentScreen('main');
  };

  const handleVoteSubmitted = () => {
    console.log('Vote submitted, returning to main');
    setRefreshTrigger(prev => prev + 1);
    setCurrentScreen('main');
  };

  const handleProposalCreated = () => {
    console.log('Proposal created, returning to main');
    setRefreshTrigger(prev => prev + 1);
    setCurrentScreen('main');
  };

  console.log('Current screen:', currentScreen);

  return (
    <SafeAreaProvider>
    <View style={{ flex: 1 }}>
      <StatusBar style="auto" />

      {currentScreen === 'splash' && (
        <SplashScreen onFinish={handleSplashFinish} />
      )}

      {currentScreen === 'auth' && (
        <AuthScreen onAuthenticate={handleAuthenticate} />
      )}

      {currentScreen === 'main' && (
        <ProposalListScreen
          onCreateProposal={handleCreateProposal}
          onVoteProposal={handleVoteProposal}
          refreshTrigger={refreshTrigger}
        />
      )}

      {currentScreen === 'voting' && (
        <VotingScreen
          proposalId={selectedProposalId}
          onBack={handleBackToMain}
          onVoteSubmitted={handleVoteSubmitted}
        />
      )}

      {currentScreen === 'create' && (
        <CreateProposalScreen
          onBack={handleBackToMain}
          onProposalCreated={handleProposalCreated}
        />
      )}
    </View>
    </SafeAreaProvider>
  );
}
