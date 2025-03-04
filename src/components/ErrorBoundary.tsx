import React from 'react';
import { View, Text } from 'react-native';

export default function ErrorBoundary({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}