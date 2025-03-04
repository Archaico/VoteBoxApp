// src/screens/CreateProposalScreen.tsx
import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { TextInput, Button, Title, Chip } from 'react-native-paper';
import DateTimePicker from '@react-native-community/datetimepicker';
import { NavigationProp } from '@react-navigation/native';
import { blockchainService } from '../services/BlockchainService';
import { notificationService } from '../services/NotificationService';
import { discussionService } from '../services/DiscussionService';
import { RootStackParamList } from '../../types/navigation';
import { Proposal } from '../../types/services';

type Props = {
  navigation: NavigationProp<RootStackParamList>;
};

const CreateProposalScreen: React.FC<Props> = ({ navigation }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [deadline, setDeadline] = useState(new Date(Date.now() + 86400000));
  const [submitting, setSubmitting] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);


  const handleSubmit = async () => {
    if (!validateForm()) return;

    try {
      setSubmitting(true);

      // Create proposal on blockchain
      const proposalId = await blockchainService.createProposal({
        title,
        description,
        options: options.filter(opt => opt.trim()),
        deadline: deadline.getTime(),
      });

      // Create discussion thread
      await discussionService.createDiscussionThread({
        id: proposalId,
        title,
        description,
        options: options.filter(opt => opt.trim()),
        deadline: deadline.getTime(),
        totalVotes: 0,
        results: {},
      });

      // Schedule notifications
      await notificationService.scheduleProposalDeadlineReminder({
        id: proposalId,
        title,
        deadline: deadline.getTime(),
      });

      // Notify users of new proposal
      await notificationService.notifyNewProposal({
        id: proposalId,
        title,
        description,
      });

      Alert.alert('Success', 'Proposal created successfully', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (error) {
      console.error('Error creating proposal:', error);
      Alert.alert('Error', 'Failed to create proposal. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const validateForm = () => {
    if (!title.trim()) {
      Alert.alert('Error', 'Please enter a title');
      return false;
    }
    if (!description.trim()) {
      Alert.alert('Error', 'Please enter a description');
      return false;
    }
    if (options.filter(opt => opt.trim()).length < 2) {
      Alert.alert('Error', 'Please add at least 2 options');
      return false;
    }
    if (deadline.getTime() <= Date.now()) {
      Alert.alert('Error', 'Deadline must be in the future');
      return false;
    }
    return true;
  };

  return (
    <ScrollView style={styles.container}>
      <Title style={styles.title}>Create New Proposal</Title>

      <TextInput
        label="Title"
        value={title}
        onChangeText={setTitle}
        style={styles.input}
        mode="outlined"
      />

      <TextInput
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={4}
        style={styles.input}
        mode="outlined"
      />

      {options.map((option, index) => (
        <TextInput
          key={index}
          label={`Option ${index + 1}`}
          value={option}
          onChangeText={(text) => {
            const newOptions = [...options];
            newOptions[index] = text;
            setOptions(newOptions);
          }}
          style={styles.input}
          mode="outlined"
        />
      ))}

      <Button
        mode="outlined"
        onPress={() => setOptions([...options, ''])}
        style={styles.button}
      >
        Add Option
      </Button>

      <Button
        mode="outlined"
        onPress={() => setShowDatePicker(true)}
        style={styles.button}
      >
        Set Deadline: {deadline.toLocaleDateString()}
      </Button>

      {showDatePicker && (
        <DateTimePicker
          value={deadline}
          mode="datetime"
          minimumDate={new Date()}
          onChange={(event, selectedDate) => {
            setShowDatePicker(false);
            if (selectedDate) setDeadline(selectedDate);
          }}
        />
      )}

      <Button
        mode="contained"
        onPress={handleSubmit}
        loading={submitting}
        disabled={submitting}
        style={styles.submitButton}
      >
        Create Proposal
      </Button>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    marginBottom: 20,
  },
  input: {
    marginBottom: 16,
  },
  button: {
    marginBottom: 16,
  },
  submitButton: {
    marginTop: 8,
    marginBottom: 32,
  },
});

export default CreateProposalScreen;