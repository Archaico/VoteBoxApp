// src/components/ShareButton.tsx
//
// Reusable share button used across all VoteBox screens.
// Pass in the proposal and the "moment" — the component handles the rest.
//
// Usage examples:
//   <ShareButton proposal={proposal} moment="invite" />        ← after creation
//   <ShareButton proposal={proposal} moment="voted" choice="Yes" />
//   <ShareButton proposal={proposal} moment="results" />
//   <ShareButton proposal={proposal} moment="urgency" />
//   <ShareButton proposal={proposal} moment="discovery" variant="icon" />

import React, { useState } from 'react';
import {
  TouchableOpacity,
  Text,
  View,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { shareService, ShareableProposal } from '../services/ShareService';

type ShareMoment = 'invite' | 'voted' | 'results' | 'urgency' | 'discovery';
type ButtonVariant = 'full' | 'outline' | 'icon';

interface ShareButtonProps {
  proposal: ShareableProposal;
  moment: ShareMoment;
  choice?: string;        // required when moment === 'voted'
  variant?: ButtonVariant;
  label?: string;         // override default label
  onShareComplete?: () => void;
}

const MOMENT_CONFIG: Record<ShareMoment, {
  icon: string;
  color: string;
  bg: string;
  borderColor: string;
}> = {
  invite: {
    icon: '📢',
    color: '#15803d',
    bg: '#f0fdf4',
    borderColor: '#22c55e',
  },
  voted: {
    icon: '✊',
    color: '#1d4ed8',
    bg: '#eff6ff',
    borderColor: '#3b82f6',
  },
  results: {
    icon: '📊',
    color: '#7c3aed',
    bg: '#f5f3ff',
    borderColor: '#8b5cf6',
  },
  urgency: {
    icon: '⚡',
    color: '#b45309',
    bg: '#fffbeb',
    borderColor: '#f59e0b',
  },
  discovery: {
    icon: '⤴️',
    color: '#374151',
    bg: '#f9fafb',
    borderColor: '#e5e7eb',
  },
};

export const ShareButton: React.FC<ShareButtonProps> = ({
  proposal,
  moment,
  choice,
  variant = 'outline',
  label,
  onShareComplete,
}) => {
  const { t } = useTranslation('voting');
  const [sharing, setSharing] = useState(false);
  const config = MOMENT_CONFIG[moment];

  const handleShare = async () => {
    setSharing(true);
    try {
      let result;

      switch (moment) {
        case 'invite':
          result = await shareService.shareProposalInvite(proposal);
          break;
        case 'voted':
          result = await shareService.shareVoteConfirmation(proposal, choice || '');
          break;
        case 'results':
          result = await shareService.shareResults(proposal);
          break;
        case 'urgency':
          result = await shareService.shareUrgentVote(proposal);
          break;
        case 'discovery':
        default:
          result = await shareService.shareProposalDiscovery(proposal);
          break;
      }

      if (result.success && onShareComplete) {
        onShareComplete();
      }

      if (!result.success && result.error) {
        Alert.alert(t('shareButton.shareFailedTitle'), result.error);
      }
    } catch (error) {
      console.error('[ShareButton] error:', error);
    } finally {
      setSharing(false);
    }
  };

  const displayLabel = label || t(`shareButton.moments.${moment}`);

  // Icon-only variant — for proposal list cards
  if (variant === 'icon') {
    return (
      <TouchableOpacity
        style={[styles.iconBtn, { borderColor: config.borderColor }]}
        onPress={handleShare}
        disabled={sharing}
        activeOpacity={0.7}
      >
        {sharing
          ? <ActivityIndicator size="small" color={config.color} />
          : <Text style={styles.iconBtnText}>{config.icon}</Text>
        }
      </TouchableOpacity>
    );
  }

  // Full (filled) variant — primary CTA after proposal creation
  if (variant === 'full') {
    return (
      <TouchableOpacity
        style={[styles.fullBtn, { backgroundColor: config.color }]}
        onPress={handleShare}
        disabled={sharing}
        activeOpacity={0.8}
      >
        {sharing ? (
          <ActivityIndicator size="small" color="white" />
        ) : (
          <View style={styles.btnInner}>
            <Text style={styles.fullBtnIcon}>{config.icon}</Text>
            <Text style={styles.fullBtnText}>{displayLabel}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  // Outline variant — default, secondary action
  return (
    <TouchableOpacity
      style={[styles.outlineBtn, {
        backgroundColor: config.bg,
        borderColor: config.borderColor,
      }]}
      onPress={handleShare}
      disabled={sharing}
      activeOpacity={0.7}
    >
      {sharing ? (
        <ActivityIndicator size="small" color={config.color} />
      ) : (
        <View style={styles.btnInner}>
          <Text style={styles.outlineBtnIcon}>{config.icon}</Text>
          <Text style={[styles.outlineBtnText, { color: config.color }]}>
            {displayLabel}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  // Full variant
  fullBtn: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  fullBtnIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  fullBtnText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },

  // Outline variant
  outlineBtn: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  outlineBtnIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  outlineBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },

  // Icon variant
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
  },
  iconBtnText: {
    fontSize: 16,
  },

  // Shared
  btnInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
