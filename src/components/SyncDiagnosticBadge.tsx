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
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { getSyncDiagnostics } from '../services/BackgroundSyncService';

function timeAgo(timestamp: number | null): string {
  if (timestamp === null) return i18n.t('list:syncDiagnostic.timeAgo.never');
  const mins = Math.floor((Date.now() - timestamp) / 60000);
  if (mins < 1) return i18n.t('list:syncDiagnostic.timeAgo.justNow');
  if (mins < 60) return i18n.t('list:syncDiagnostic.timeAgo.minutes', { minutes: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return i18n.t('list:syncDiagnostic.timeAgo.hoursMinutes', { hours, minutes: mins % 60 });
  const days = Math.floor(hours / 24);
  return i18n.t('list:syncDiagnostic.timeAgo.days', { days });
}

export const SyncDiagnosticBadge: React.FC = () => {
  const { t } = useTranslation('list');
  const [hasRun, setHasRun] = useState<boolean | null>(null);

  useEffect(() => {
    getSyncDiagnostics().then(d => setHasRun(d.lastRunAt !== null)).catch(() => {});
  }, []);

  const handlePress = async () => {
    const d = await getSyncDiagnostics();

    const message = [
      t('syncDiagnostic.registrationHeading'),
      t('syncDiagnostic.registered', {
        time: d.registeredAt ? new Date(d.registeredAt).toLocaleString() : t('syncDiagnostic.never'),
      }),
      t('syncDiagnostic.osStatus', { status: d.registrationStatus ?? t('syncDiagnostic.unknown') }),
      '',
      t('syncDiagnostic.lastRunHeading'),
      t('syncDiagnostic.lastRun', {
        time: d.lastRunAt ? new Date(d.lastRunAt).toLocaleString() : t('syncDiagnostic.lastRunNever'),
      }),
      t('syncDiagnostic.timeAgoParenthetical', { ago: timeAgo(d.lastRunAt) }),
      d.lastRunAt ? t('syncDiagnostic.result', { result: d.lastRunResult }) : '',
      d.lastRunResult === 'failed' ? t('syncDiagnostic.error', { error: d.lastRunError }) : '',
      d.lastRunAt ? t('syncDiagnostic.subscriptionsChecked', { count: d.lastRunSubCount }) : '',
      '',
      t('syncDiagnostic.explanation'),
    ].filter(Boolean).join('\n');

    Alert.alert(t('syncDiagnostic.title'), message, [{ text: t('syncDiagnostic.ok') }]);
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
