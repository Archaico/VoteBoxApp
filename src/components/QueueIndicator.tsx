// src/components/QueueIndicator.tsx
//
// Visual indicator showing queued items waiting for network connection
// Appears as a small badge in the header, tapping it shows queue status

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { offlineQueueService } from '../services/OfflineQueueService';

export const QueueIndicator: React.FC = () => {
  const [queueCount, setQueueCount] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    checkQueue();
    const interval = setInterval(checkQueue, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const checkQueue = async () => {
    const status = await offlineQueueService.getQueueStatus();
    const totalCount = status.votes + status.proposals;
    setQueueCount(totalCount);
    setIsVisible(totalCount > 0);
  };

  const handlePress = async () => {
    const status = await offlineQueueService.getQueueStatus();
    const message = [
      `${status.votes} vote${status.votes !== 1 ? 's' : ''} queued`,
      `${status.proposals} proposal${status.proposals !== 1 ? 's' : ''} queued`,
      '',
      'These will be submitted automatically when you have a stable connection.',
      '',
      status.oldestTimestamp
        ? `Oldest item: ${new Date(status.oldestTimestamp).toLocaleString()}`
        : '',
    ].filter(Boolean).join('\n');

    Alert.alert('📤 Queued Items', message, [
      {
        text: 'Retry Now',
        onPress: () => offlineQueueService.processQueue(),
      },
      { text: 'OK', style: 'cancel' },
    ]);
  };

  if (!isVisible) return null;

  return (
    <TouchableOpacity
      style={styles.badge}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <Text style={styles.badgeIcon}>📤</Text>
      <View style={styles.badgeCount}>
        <Text style={styles.badgeCountText}>{queueCount}</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  badge: {
    position: 'relative',
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fbbf24',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeIcon: {
    fontSize: 16,
  },
  badgeCount: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  badgeCountText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '700',
  },
});
