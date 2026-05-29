// src/config/ProposalDiscussion.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { discussionService, Comment } from '../services/DiscussionService';

interface ProposalDiscussionProps {
  proposalId: string;
  userAddress?: string; // Optional - for future use
}

export default function ProposalDiscussion({ proposalId, userAddress }: ProposalDiscussionProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadComments();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(loadComments, 30000);
    return () => clearInterval(interval);
  }, [proposalId]);

  const loadComments = async () => {
    try {
      // Sync from IPFS first — merges any remote comments into local store
      await discussionService.syncFromIPFS(proposalId);
      const loaded = await discussionService.getComments(proposalId);
      setComments(loaded);
    } catch (error) {
      console.error('Failed to load comments:', error);
    }
  };

  const handleSubmitComment = async () => {
    if (!newComment.trim()) return;

    setIsLoading(true);
    try {
      await discussionService.addComment({
        proposalId,
        author: userAddress || 'Anonymous User', // Use userAddress if provided
        content: newComment.trim(),
        timestamp: Date.now(),
        replyTo: replyingTo,
      });
      setNewComment('');
      setReplyingTo(undefined);
      await loadComments();
    } catch (error) {
      console.error('Failed to post comment:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getTopLevelComments = () => {
    return comments.filter(c => !c.replyTo);
  };

  const getReplies = (parentId: string) => {
    return comments.filter(c => c.replyTo === parentId);
  };

  const renderComment = (comment: Comment, isReply = false) => (
    <View key={comment.id} style={[styles.comment, isReply && styles.commentReply]}>
      <View style={styles.commentHeader}>
        <Text style={styles.commentAuthor}>
          {comment.author}
        </Text>
        <Text style={styles.commentTime}>
          {new Date(comment.timestamp).toLocaleTimeString()}
        </Text>
      </View>
      
      <Text style={styles.commentText}>{comment.content}</Text>
      
      {!isReply && (
        <View style={styles.commentActions}>
          <TouchableOpacity
            style={styles.replyButton}
            onPress={() => setReplyingTo(comment.id)}
          >
            <Text style={styles.replyButtonText}>Reply</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Render replies */}
      {!isReply && getReplies(comment.id).map(reply => renderComment(reply, true))}
    </View>
  );

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={100}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Discussion ({comments.length})</Text>
      </View>

      {/* Comments List */}
      <ScrollView style={styles.commentsList} contentContainerStyle={styles.commentsListContent}>
        {getTopLevelComments().length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No comments yet.</Text>
            <Text style={styles.emptySubtext}>Be the first to discuss this proposal!</Text>
          </View>
        ) : (
          getTopLevelComments().map(comment => renderComment(comment))
        )}
      </ScrollView>

      {/* Replying Indicator */}
      {replyingTo && (
        <View style={styles.replyingIndicator}>
          <Text style={styles.replyingText}>
            Replying to comment...
          </Text>
          <TouchableOpacity onPress={() => setReplyingTo(undefined)}>
            <Text style={styles.cancelReplyText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Input Section - WITH EXTRA BOTTOM PADDING */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Add a comment..."
          placeholderTextColor="#999"
          value={newComment}
          onChangeText={setNewComment}
          multiline
          maxLength={500}
        />
        <TouchableOpacity
          style={[styles.submitButton, !newComment.trim() && styles.submitButtonDisabled]}
          onPress={handleSubmitComment}
          disabled={!newComment.trim() || isLoading}
        >
          <Text style={styles.submitButtonText}>
            {isLoading ? '...' : 'Post'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  commentsList: {
    flex: 1,
  },
  commentsListContent: {
    padding: 16,
    paddingBottom: 100,
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9ca3af',
  },
  comment: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  commentReply: {
    marginLeft: 24,
    marginTop: 8,
    backgroundColor: '#f9fafb',
  },
  commentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  commentAuthor: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  commentTime: {
    fontSize: 11,
    color: '#9ca3af',
  },
  commentText: {
    fontSize: 14,
    color: '#1f2937',
    lineHeight: 20,
    marginBottom: 8,
  },
  commentActions: {
    flexDirection: 'row',
    gap: 12,
  },
  replyButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  replyButtonText: {
    fontSize: 12,
    color: '#22c55e',
    fontWeight: '600',
  },
  replyingIndicator: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 8,
    backgroundColor: '#fef3c7',
    borderTopWidth: 1,
    borderTopColor: '#fde68a',
  },
  replyingText: {
    fontSize: 12,
    color: '#856404',
  },
  cancelReplyText: {
    fontSize: 12,
    color: '#dc3545',
    fontWeight: '600',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    paddingBottom: 80, // CRITICAL: Extra padding to clear Android nav bar
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#f9fafb',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  submitButton: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#d1d5db',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
