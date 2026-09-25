// src/components/SyncDiagnosticBadge.tsx
//
// Diagnostic badge for the Phase 2 background sync task. Answers the question
// "is the OS actually invoking VOTEBOX_BACKGROUND_SYNC at all while the app
// is closed?" with evidence instead of guesswork — added 2026-08-23 after
// Samsung battery saver was ruled out as the cause of missing cross-user
// notifications and the real background task's execution was still unproven.
//
// Always visible (unlike QueueIndicator) since "no evidence of any run yet"
// is itself the diagnostic signal we're looking for.

import React, { useState, useEffect } from 'react';
import { TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import { getSyncDiagnostics } from '../services/BackgroundSyncService';

function timeAgo(timestamp: number | null): string {
  if (timestamp === null) return 'never';
  const mins = Math.floor((Date.now() - timestamp) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const SyncDiagnosticBadge: React.FC = () => {
  const [hasRun, setHasRun] = useState<boolean | null>(null);

  useEffect(() => {
    getSyncDiagnostics().then(d => setHasRun(d.lastRunAt !== null)).catch(() => {});
  }, []);

  const handlePress = async () => {
    const d = await getSyncDiagnostics();

    const message = [
      '── Registration ──',
      `Registered: ${d.registeredAt ? new Date(d.registeredAt).toLocaleString() : 'never'}`,
      `OS status: ${d.registrationStatus ?? 'unknown'}`,
      '',
      '── Last Background Run ──',
      `Last run: ${d.lastRunAt ? new Date(d.lastRunAt).toLocaleString() : 'NEVER — task has not executed'}`,
      `(${timeAgo(d.lastRunAt)})`,
      d.lastRunAt ? `Result: ${d.lastRunResult}` : '',
      d.lastRunResult === 'failed' ? `Error: ${d.lastRunError}` : '',
      d.lastRunAt ? `Subscriptions checked: ${d.lastRunSubCount}` : '',
      '',
      'Task is scheduled every ~15 min. If "Last run" is more than ~30-45 min old (or never, despite the app being closed that long), the OS is very likely blocking the background task — check battery/background-activity restrictions for VoteBoxApp in device settings.',
    ].filter(Boolean).join('\n');

    Alert.alert('🔄 Background Sync Diagnostic', message, [{ text: 'OK' }]);
    setHasRun(d.lastRunAt !== null);
  };

  return (
    <TouchableOpacity style={styles.badge} onPress={handlePress} activeOpacity={0.7}>
      <Text style={styles.badgeIcon}>{hasRun ? '🔄' : '⚠️'}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  badge: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeIcon: {
    fontSize: 16,
  },
});
