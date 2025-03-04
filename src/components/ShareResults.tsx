// src/components/ShareResults.tsx
import React, { useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Portal,
  Modal,
  Button,
  List,
  IconButton,
  Surface,
  Text,
  Divider,
  ActivityIndicator,
} from 'react-native-paper';
import { ShareService } from '../services/ShareService';
import { VotingAnalytics } from '../services/EnhancedAnalyticsService';

interface ShareResultsProps {
  proposal: any;
  resultsRef: React.RefObject<any>;
}

export const ShareResults: React.FC<ShareResultsProps> = ({
  proposal,
  resultsRef,
}) => {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleShare = async (format: 'text' | 'image' | 'pdf' | 'csv', social?: string) => {
    try {
      setLoading(true);
      setError(null);

      await ShareService.shareResults(proposal, resultsRef, {
        format,
        includeChart: true,
        includeDetails: true,
        social: social as any,
      });

      setVisible(false);
    } catch (error) {
      setError('Failed to share results. Please try again.');
      console.error('Share error:', error);
    } finally {
      setLoading(false);
    }
  };

  const socialPlatforms = [
    { icon: 'twitter', name: 'Twitter', key: 'twitter' },
    { icon: 'telegram', name: 'Telegram', key: 'telegram' },
    { icon: 'whatsapp', name: 'WhatsApp', key: 'whatsapp' },
  ];

  return (
    <>
      <IconButton
        icon="share"
        size={24}
        onPress={() => setVisible(true)}
      />

      <Portal>
        <Modal
          visible={visible}
          onDismiss={() => setVisible(false)}
          contentContainerStyle={styles.modalContainer}
        >
          <Surface style={styles.surface}>
            <Text style={styles.title}>Share Results</Text>

            {error && (
              <Text style={styles.error}>{error}</Text>
            )}

            <Text style={styles.subtitle}>Share as Format</Text>
            <View style={styles.formatButtons}>
              <Button
                mode="outlined"
                onPress={() => handleShare('text')}
                style={styles.formatButton}
                disabled={loading}
              >
                Text
              </Button>
              <Button
                mode="outlined"
                onPress={() => handleShare('image')}
                style={styles.formatButton}
                disabled={loading}
              >
                Image
              </Button>
              <Button
                mode="outlined"
                onPress={() => handleShare('csv')}
                style={styles.formatButton}
                disabled={loading}
              >
                CSV
              </Button>
            </View>

            <Divider style={styles.divider} />

            <Text style={styles.subtitle}>Share on Social Media</Text>
            <View style={styles.socialButtons}>
              {socialPlatforms.map((platform) => (
                <IconButton
                  key={platform.key}
                  icon={platform.icon}
                  size={32}
                  onPress={() => handleShare('text', platform.key)}
                  disabled={loading}
                  style={styles.socialButton}
                />
              ))}
            </View>

            {loading && (
              <View style={styles.loading}>
                <ActivityIndicator size="small" />
                <Text>Preparing share...</Text>
              </View>
            )}

            <Button
              mode="contained"
              onPress={() => setVisible(false)}
              style={styles.closeButton}
            >
              Close
            </Button>
          </Surface>
        </Modal>
      </Portal>
    </>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    padding: 20,
  },
  surface: {
    padding: 20,
    borderRadius: 8,
    elevation: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginVertical: 10,
  },
  formatButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 10,
  },
  formatButton: {
    flex: 1,
    marginHorizontal: 5,
  },
  socialButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 10,
  },
  socialButton: {
    margin: 5,
  },
  divider: {
    marginVertical: 15,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
  error: {
    color: 'red',
    textAlign: 'center',
    marginBottom: 10,
  },
  closeButton: {
    marginTop: 20,
  },
});