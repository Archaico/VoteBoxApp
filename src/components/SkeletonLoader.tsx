// src/components/SkeletonLoader.tsx
//
// Animated skeleton placeholders for loading states
// Shows pulsing gray boxes where content will appear — much more professional
// than a bare spinner

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';

interface SkeletonLoaderProps {
  count?: number;
  variant?: 'proposal' | 'list-item' | 'text';
}

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  count = 3,
  variant = 'proposal',
}) => {
  return (
    <View>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonItem key={index} variant={variant} />
      ))}
    </View>
  );
};

const SkeletonItem: React.FC<{ variant: 'proposal' | 'list-item' | 'text' }> = ({ variant }) => {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    // Pulsing animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [opacity]);

  if (variant === 'proposal') {
    return (
      <Animated.View style={[styles.proposalCard, { opacity }]}>
        <View style={styles.proposalHeader}>
          <View style={[styles.skeletonBox, { width: 100, height: 12 }]} />
          <View style={[styles.skeletonBox, { width: 80, height: 12 }]} />
        </View>
        <View style={[styles.skeletonBox, { width: '85%', height: 20, marginBottom: 8 }]} />
        <View style={[styles.skeletonBox, { width: '100%', height: 14, marginBottom: 4 }]} />
        <View style={[styles.skeletonBox, { width: '90%', height: 14, marginBottom: 4 }]} />
        <View style={[styles.skeletonBox, { width: '70%', height: 14 }]} />
        <View style={styles.proposalFooter}>
          <View style={[styles.skeletonBox, { width: 60, height: 12 }]} />
          <View style={[styles.skeletonBox, { width: 100, height: 12 }]} />
        </View>
      </Animated.View>
    );
  }

  if (variant === 'list-item') {
    return (
      <Animated.View style={[styles.listItem, { opacity }]}>
        <View style={[styles.skeletonBox, { width: '70%', height: 16, marginBottom: 6 }]} />
        <View style={[styles.skeletonBox, { width: '50%', height: 12 }]} />
      </Animated.View>
    );
  }

  // text variant
  return (
    <Animated.View style={{ opacity, marginBottom: 8 }}>
      <View style={[styles.skeletonBox, { width: '90%', height: 14, marginBottom: 4 }]} />
      <View style={[styles.skeletonBox, { width: '75%', height: 14 }]} />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  skeletonBox: {
    backgroundColor: '#e5e7eb',
    borderRadius: 4,
  },
  proposalCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#f3f4f6',
  },
  proposalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  proposalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  listItem: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
});
