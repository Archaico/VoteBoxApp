// App.tsx
import React, { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import { notificationService } from './services/NotificationService';
import { registerBackgroundSync } from './services/BackgroundSyncService';
import { offlineQueueService } from './services/OfflineQueueService';
import { discussionService } from './services/DiscussionService';
import SplashScreen from './screens/SplashScreen';
import AuthScreen from './screens/AuthScreen';
import ProposalListScreen from './screens/ProposalListScreen';
import VotingScreen from './screens/VotingScreen';
import CreateProposalScreen from './screens/CreateProposalScreen';

type AppScreen = 'splash' | 'auth' | 'main' | 'voting' | 'create';

// Extract proposalId from https://voteboxapp.com/proposal/{id}
function extractProposalId(url: string): string | null {
  try {
    const match = url.match(/\/proposal\/(prop_[^/?#]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('splash');
  const [selectedProposalId, setSelectedProposalId] = useState('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const pendingDeepLink = useRef<string | null>(null);

  // Request notification permissions + register background sync + start offline queue on mount
  useEffect(() => {
    notificationService.requestPermissions().catch(() => {});
    registerBackgroundSync().catch(() => {});
    offlineQueueService.initialize().catch(() => {});
    discussionService.initializeOfflineRetry();
  }, []);

  // Listen for incoming deep links (app already open)
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      const proposalId = extractProposalId(url);
      if (!proposalId) return;
      // If authenticated, go straight to voting; otherwise queue it
      setCurrentScreen(screen => {
        if (screen === 'main' || screen === 'voting' || screen === 'create') {
          setSelectedProposalId(proposalId);
          return 'voting';
        }
        pendingDeepLink.current = proposalId;
        return screen;
      });
    });

    // Cold-start: app launched via tapped link
    Linking.getInitialURL().then(url => {
      if (!url) return;
      const proposalId = extractProposalId(url);
      if (proposalId) pendingDeepLink.current = proposalId;
    });

    return () => subscription.remove();
  }, []);

  const handleSplashFinish = () => {
    console.log('Splash finished, navigating to auth');
    setCurrentScreen('auth');
  };

  const handleAuthenticate = async () => {
    // pendingDeepLink is set by the 'url' event listener, but on a cold start
    // Linking.getInitialURL() resolves asynchronously and can still be pending
    // when biometric auth completes — re-check it directly rather than trusting
    // a ref that may not be set yet.
    let proposalId = pendingDeepLink.current;
    if (!proposalId) {
      const url = await Linking.getInitialURL();
      if (url) proposalId = extractProposalId(url);
    }

    if (proposalId) {
      setSelectedProposalId(proposalId);
      pendingDeepLink.current = null;
      setCurrentScreen('voting');
    } else {
      setCurrentScreen('main');
    }
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
