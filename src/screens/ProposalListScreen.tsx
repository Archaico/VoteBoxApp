import React, { useState, useEffect, FC } from 'react';
import { View, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { Card, Title, Paragraph, FAB, ActivityIndicator } from 'react-native-paper';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types/navigation';
import { Proposal } from '../../types/services';
import { blockchainService } from '../services/BlockchainService';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList>;
};

const ProposalListScreen: FC<Props> = ({ navigation }) => {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchProposals = async () => {
    try {
      const fetchedProposals = await blockchainService.getProposals();
      setProposals(fetchedProposals);
    } catch (error) {
      console.error('Error fetching proposals:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchProposals();
  }, []);

  const renderProposal = ({ item }: { item: Proposal }) => (
    <Card 
      style={styles.card}
      onPress={() => navigation.navigate('Voting', { proposalId: item.id })}
    >
      <Card.Content>
        <Title>{item.title}</Title>
        <Paragraph>{item.description}</Paragraph>
      </Card.Content>
    </Card>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={proposals}
        renderItem={renderProposal}
        keyExtractor={item => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={fetchProposals} />
        }
      />
      <FAB
        style={styles.fab}
        icon="plus"
        onPress={() => navigation.navigate('CreateProposal')}
        label="Create Proposal"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    margin: 8,
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
  },
});

export default ProposalListScreen;