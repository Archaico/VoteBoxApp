// App.tsx
import React, { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { WalletConnectModal } from '@walletconnect/modal-react-native';
import { notificationService } from './services/NotificationService';
import { registerBackgroundSync } from './services/BackgroundSyncService';
import { offlineQueueService } from './services/OfflineQueueService';
import { discussionService } from './services/DiscussionService';
import { CIP34_NAMESPACE } from './services/WalletConnectService';
import SplashScreen from './screens/SplashScreen';
import AuthScreen from './screens/AuthScreen';
import ProposalListScreen from './screens/ProposalListScreen';
import VotingScreen from './screens/VotingScreen';
import CreateProposalScreen from './screens/CreateProposalScreen';

type AppScreen = 'splash' | 'auth' | 'main' | 'voting' | 'create';

const WALLETCONNECT_PROJECT_ID = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

// Extract proposalId from https://vote.voteboxapp.org/proposal/{id}
function extractProposalId(url: string): string | null {
  try {
    const match = url.match(/\/proposal\/(prop_[^/?#]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// Extract proposalId from a notification's data payload (see NotificationService.ts's `send()`)
function extractProposalIdFromNotification(
  response: Notifications.NotificationResponse | null
): string | null {
  const proposalId = response?.notification.request.content.data?.proposalId;
  return typeof proposalId === 'string' ? proposalId : null;
}

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('splash');
  const [selectedProposalId, setSelectedProposalId] = useState('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const pendingDeepLink = useRef<string | null>(null);

  // Shared by both the Linking 'url' listener and the notification-tap
  // listener below: if already past auth, navigate straight there;
  // otherwise queue it for handleAuthenticate to pick up.
  const queueOrNavigateToProposal = (proposalId: string, source: string) => {
    setCurrentScreen(screen => {
      console.log(`[DeepLink][${source}] handling, currentScreen was:`, screen);
      if (screen === 'main' || screen === 'voting' || screen === 'create') {
        setSelectedProposalId(proposalId);
        return 'voting';
      }
      pendingDeepLink.current = proposalId;
      return screen;
    });
  };

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
      console.log('[DeepLink][url-event] fired:', url);
      const proposalId = extractProposalId(url);
      console.log('[DeepLink][url-event] extracted proposalId:', proposalId);
      if (!proposalId) return;
      queueOrNavigateToProposal(proposalId, 'url-event');
    });

    // Cold-start: app launched via tapped link
    console.log('[DeepLink][url-cold] mount — calling getInitialURL()');
    Linking.getInitialURL().then(url => {
      console.log('[DeepLink][url-cold] getInitialURL() resolved:', url);
      if (!url) return;
      const proposalId = extractProposalId(url);
      console.log('[DeepLink][url-cold] extracted proposalId:', proposalId);
      if (proposalId) {
        pendingDeepLink.current = proposalId;
        console.log('[DeepLink][url-cold] pendingDeepLink.current set to:', proposalId);
      }
    }).catch(e => console.warn('[DeepLink][url-cold] getInitialURL() threw:', e));

    return () => subscription.remove();
  }, []);

  // Listen for tapped notifications (app already open or backgrounded, not killed)
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('[DeepLink][notif-event] response received:', JSON.stringify(response.notification.request.content.data));
      const proposalId = extractProposalIdFromNotification(response);
      console.log('[DeepLink][notif-event] extracted proposalId:', proposalId);
      if (!proposalId) return;
      queueOrNavigateToProposal(proposalId, 'notif-event');
    });

    // Cold-start: app launched by tapping a notification
    console.log('[DeepLink][notif-cold] mount — calling getLastNotificationResponseAsync()');
    Notifications.getLastNotificationResponseAsync().then(response => {
      console.log('[DeepLink][notif-cold] getLastNotificationResponseAsync() resolved:', response ? JSON.stringify(response.notification.request.content.data) : null);
      const proposalId = extractProposalIdFromNotification(response);
      console.log('[DeepLink][notif-cold] extracted proposalId:', proposalId);
      if (proposalId) {
        pendingDeepLink.current = proposalId;
        console.log('[DeepLink][notif-cold] pendingDeepLink.current set to:', proposalId);
      }
    }).catch(e => console.warn('[DeepLink][notif-cold] getLastNotificationResponseAsync() threw:', e));

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
    console.log('[DeepLink] handleAuthenticate — pendingDeepLink.current is:', pendingDeepLink.current);
    let proposalId = pendingDeepLink.current;
    if (!proposalId) {
      const url = await Linking.getInitialURL();
      console.log('[DeepLink] handleAuthenticate — fallback getInitialURL() returned:', url);
      if (url) proposalId = extractProposalId(url);
      console.log('[DeepLink] handleAuthenticate — fallback extracted proposalId (url):', proposalId);
    }
    if (!proposalId) {
      const response = await Notifications.getLastNotificationResponseAsync();
      console.log('[DeepLink] handleAuthenticate — fallback getLastNotificationResponseAsync() returned:', response ? JSON.stringify(response.notification.request.content.data) : null);
      proposalId = extractProposalIdFromNotification(response);
      console.log('[DeepLink] handleAuthenticate — fallback extracted proposalId (notif):', proposalId);
    }

    if (proposalId) {
      console.log('[DeepLink] handleAuthenticate — navigating to voting screen for:', proposalId);
      setSelectedProposalId(proposalId);
      pendingDeepLink.current = null;
      setCurrentScreen('voting');
    } else {
      console.log('[DeepLink] handleAuthenticate — no proposalId found, falling back to main screen');
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

      {WALLETCONNECT_PROJECT_ID !== '' && (
        <WalletConnectModal
          projectId={WALLETCONNECT_PROJECT_ID}
          providerMetadata={{
            name: 'VoteBoxApp',
            description: 'Direct democracy on Cardano',
            url: 'https://voteboxapp.org',
            icons: ['https://voteboxapp.org/images/voteboxapp-logo.png'],
            redirect: { native: 'voteboxapp://' },
          }}
          sessionParams={{ namespaces: CIP34_NAMESPACE }}
        />
      )}
    </View>
    </SafeAreaProvider>
  );
}
