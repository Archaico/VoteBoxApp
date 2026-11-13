// src/screens/CreateProposalScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Linking,
  Image,
  AppState,
  AppStateStatus,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { blockchainService } from '../services/BlockchainService';
import { treasuryService, TREASURY_CONFIG, FeeCalculation } from '../services/TreasuryService';
import { notificationService } from '../services/NotificationService';
import { shareService } from '../services/ShareService';
import { offlineQueueService, isNetworkError } from '../services/OfflineQueueService';
import { toastService } from '../services/ToastService';
import { QueueIndicator } from '../components/QueueIndicator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation, Trans } from 'react-i18next';

interface CreateProposalScreenProps {
  onBack: () => void;
  onProposalCreated: () => void;
}

const VOTER_PRESETS = [
  { label: '2', value: 2 },
  { label: '10', value: 10 },
  { label: '50', value: 50 },
  { label: '100', value: 100 },
  { label: '10K', value: 10000 },
  { label: '1M', value: 1000000 },
];

const MAX_ATTACHMENTS = 2;
const ATTACHMENT_MAX_DIMENSION = 1280;
const ATTACHMENT_COMPRESSION = 0.7;

// Wallet connection (WalletConnect) exists but stays dormant — see
// WalletConnectService.ts and memory: no Cardano wallet supports it publicly
// yet (checked 2026-10-09). Creators pay from their own wallet app instead,
// and the paying address becomes the proposal's creator (BlockchainService).

const VESPR_PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=art.nft_craze.gallery.main';
const TEST_ADA_FAUCET_URL = 'https://docs.cardano.org/cardano-testnets/tools/faucet';

// Unfinished proposals survive the app being closed — Android often kills
// background apps while the creator is in their wallet app paying.
const DRAFT_KEY = 'voteboxapp.createProposalDraft.v1';

// After a transaction ID is entered, keep checking until the payment confirms.
const PAYMENT_POLL_INTERVAL_MS = 10_000;
const PAYMENT_POLL_MAX_ATTEMPTS = 30; // ~5 minutes

type Step = 'write' | 'pay' | 'published';
type PaymentState = 'idle' | 'waiting' | 'failed' | 'publishing';

interface Draft {
  title: string;
  description: string;
  duration: string;
  expectedVoters: number;
  customVoters: string;
  attachments: string[];
  step: 'write' | 'pay';
  paymentTxHashInput: string;
}

interface PublishedProposal {
  cid: string;
  metadataTxHash: string;
}

// Failure reasons from treasuryService.verifyPaymentTransaction → create.json keys.
const VERIFY_FAILURE_KEYS: Record<string, string> = {
  malformed_hash: 'payment.verifyErrors.malformed_hash',
  not_found_or_pending: 'payment.verifyErrors.not_found_or_pending',
  wrong_recipient: 'payment.verifyErrors.wrong_recipient',
  insufficient_amount: 'payment.verifyErrors.insufficient_amount',
  already_used: 'payment.verifyErrors.already_used',
  network_error: 'payment.verifyErrors.network_error',
};

// Pulls a 64-character transaction ID out of whatever was copied — a bare ID
// or a cardanoscan link. Returns null if there isn't one.
const extractTxId = (text: string): string | null => {
  const match = text.match(/[0-9a-f]{64}/i);
  return match ? match[0].toLowerCase() : null;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default function CreateProposalScreen({
  onBack,
  onProposalCreated,
}: CreateProposalScreenProps) {
  const { t } = useTranslation('create');
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('write');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState('7');
  const [expectedVoters, setExpectedVoters] = useState(2);
  const [customVoters, setCustomVoters] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [isPickingAttachment, setIsPickingAttachment] = useState(false);
  const [showFeeDetails, setShowFeeDetails] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  // Payment step
  const [lockedFees, setLockedFees] = useState<FeeCalculation | null>(null);
  const [paymentTxHashInput, setPaymentTxHashInput] = useState('');
  const [paymentState, setPaymentState] = useState<PaymentState>('idle');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [foundOnClipboard, setFoundOnClipboard] = useState(false);
  const [copiedField, setCopiedField] = useState<'address' | 'amount' | null>(null);
  const [showWalletHelp, setShowWalletHelp] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [published, setPublished] = useState<PublishedProposal | null>(null);

  // Bumped to cancel a running payment check (edit, new ID, leaving the screen).
  const verifyRunRef = useRef(0);
  const lastClipboardTxIdRef = useRef<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const fees = useMemo(
    () => treasuryService.calculateProposalFees(Math.max(expectedVoters, 2)),
    [expectedVoters]
  );
  const isBusy = paymentState === 'waiting' || paymentState === 'publishing';

  useEffect(() => () => { verifyRunRef.current++; }, []);

  // ─── Draft ─────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DRAFT_KEY);
        if (!raw) return;
        const draft: Draft = JSON.parse(raw);
        setTitle(draft.title ?? '');
        setDescription(draft.description ?? '');
        setDuration(draft.duration ?? '7');
        setExpectedVoters(draft.expectedVoters ?? 2);
        setCustomVoters(draft.customVoters ?? '');
        setAttachments(draft.attachments ?? []);
        setPaymentTxHashInput(draft.paymentTxHashInput ?? '');
        if (draft.step === 'pay') {
          setLockedFees(treasuryService.calculateProposalFees(Math.max(draft.expectedVoters ?? 2, 2)));
          setStep('pay');
        }
        toastService.info(t('draft.restored'));
      } catch {
        // A corrupt draft just means starting fresh.
      } finally {
        setDraftLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftLoaded || step === 'published') return;
    const timer = setTimeout(() => {
      const isEmpty = !title.trim() && !description.trim() && attachments.length === 0;
      if (isEmpty && step === 'write') {
        AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
        return;
      }
      const draft: Draft = {
        title, description, duration, expectedVoters, customVoters, attachments,
        step, paymentTxHashInput,
      };
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft)).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [draftLoaded, step, title, description, duration, expectedVoters, customVoters, attachments, paymentTxHashInput]);

  const clearDraft = () => AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});

  const handleDiscardDraft = () => {
    Alert.alert(t('draft.discardTitle'), t('draft.discardMessage'), [
      { text: t('buttons.cancel'), style: 'cancel' },
      {
        text: t('draft.discard'),
        style: 'destructive',
        onPress: () => {
          setTitle('');
          setDescription('');
          setDuration('7');
          setExpectedVoters(2);
          setCustomVoters('');
          setAttachments([]);
          setPaymentTxHashInput('');
          clearDraft();
        },
      },
    ]);
  };

  // ─── Attachment Handlers ───────────────────────────────────────────────
  // MVP scope: images only, capped at 2 per proposal, compressed client-side
  // before upload to keep Pinata storage/bandwidth cost predictable.

  const handleAddAttachment = async () => {
    if (attachments.length >= MAX_ATTACHMENTS) {
      Alert.alert(t('attachments.limitTitle'), t('attachments.limitMessage', { max: MAX_ATTACHMENTS }));
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('attachments.permissionTitle'), t('attachments.permissionMessage'));
      return;
    }

    setIsPickingAttachment(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const actions = asset.width && asset.width > ATTACHMENT_MAX_DIMENSION
        ? [{ resize: { width: ATTACHMENT_MAX_DIMENSION } }]
        : [];

      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        actions,
        { compress: ATTACHMENT_COMPRESSION, format: ImageManipulator.SaveFormat.JPEG }
      );

      setAttachments(prev => [...prev, manipulated.uri]);
    } catch (error) {
      Alert.alert(t('attachments.errorTitle'), error instanceof Error ? error.message : t('publish.unknownError'));
    } finally {
      setIsPickingAttachment(false);
    }
  };

  const handleRemoveAttachment = (uri: string) => {
    setAttachments(prev => prev.filter(a => a !== uri));
  };

  // ─── Write Step ─────────────────────────────────────────────────────────

  const handleVoterPresetSelect = (value: number) => {
    setExpectedVoters(value);
    setCustomVoters('');
  };

  const handleCustomVotersChange = (text: string) => {
    setCustomVoters(text);
    const num = parseInt(text);
    if (!isNaN(num) && num >= 2) {
      setExpectedVoters(num);
    }
  };

  // Validate the form, freeze the fee quote, move to the payment step.
  const handleContinueToPayment = () => {
    if (!title.trim()) {
      Alert.alert(t('validation.missingTitleTitle'), t('validation.missingTitleMessage'));
      return;
    }
    if (!description.trim()) {
      Alert.alert(t('validation.missingDescriptionTitle'), t('validation.missingDescriptionMessage'));
      return;
    }
    if (!duration || parseInt(duration) < 1) {
      Alert.alert(t('validation.invalidDurationTitle'), t('validation.invalidDurationMessage'));
      return;
    }
    if (expectedVoters < 2) {
      Alert.alert(t('validation.invalidVotersTitle'), t('validation.votersAtLeastMessage'));
      return;
    }

    setLockedFees(treasuryService.calculateProposalFees(expectedVoters));
    setPaymentError(null);
    setPaymentState('idle');
    setStep('pay');
  };

  // ─── Pay Step ───────────────────────────────────────────────────────────

  const handleCopy = async (field: 'address' | 'amount', value: string) => {
    await Clipboard.setStringAsync(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(current => (current === field ? null : current)), 2000);
  };

  // Opens whichever Cardano wallet handles payment links (CIP-13). Most
  // wallets open without filling in the amount, so the copy fields stay
  // the main path.
  const handleOpenWallet = async () => {
    if (!lockedFees) return;
    try {
      await Linking.openURL(`web+cardano:${TREASURY_CONFIG.FOUNDATION_WALLET}?amount=${lockedFees.grandTotalADA}`);
    } catch {
      Alert.alert(t('payment.openWalletFailedTitle'), t('payment.openWalletFailedMessage'));
    }
  };

  const cancelPaymentCheck = () => {
    verifyRunRef.current++;
    setPaymentState('idle');
  };

  const handleEditProposal = () => {
    cancelPaymentCheck();
    setPaymentError(null);
    setFoundOnClipboard(false);
    setStep('write');
  };

  const failPayment = (message: string) => {
    setPaymentState('failed');
    setPaymentError(message);
  };

  // Checks the payment, waiting for it to confirm if needed, then publishes.
  const checkPaymentAndPublish = async (rawInput: string) => {
    if (!lockedFees) return;
    const txId = extractTxId(rawInput) ?? rawInput.trim();
    const run = ++verifyRunRef.current;
    setPaymentState('waiting');
    setPaymentError(null);

    for (let attempt = 0; attempt < PAYMENT_POLL_MAX_ATTEMPTS; attempt++) {
      const result = await treasuryService.verifyPaymentTransaction(txId, lockedFees.grandTotal);
      if (run !== verifyRunRef.current) return;

      if (result.ok) {
        // Soft guard against likely unit-confusion (e.g. a tx sized for
        // 1000 ADA instead of 1.2) — informational only, doesn't block.
        if (result.paidLovelace! > lockedFees.grandTotal * 10) {
          const proceed = await new Promise<boolean>(resolve => {
            Alert.alert(
              t('payment.overpayTitle'),
              t('payment.overpayMessage', {
                sent: (result.paidLovelace! / 1_000_000).toFixed(4),
                required: lockedFees.grandTotalADA,
              }),
              [
                { text: t('buttons.cancel'), style: 'cancel', onPress: () => resolve(false) },
                { text: t('buttons.continue'), onPress: () => resolve(true) },
              ]
            );
          });
          if (!proceed) {
            setPaymentState('idle');
            return;
          }
        }
        await executePublish(txId, lockedFees.grandTotal);
        return;
      }

      if (result.reason !== 'not_found_or_pending') {
        const failureKey = VERIFY_FAILURE_KEYS[result.reason ?? 'network_error'];
        failPayment(failureKey ? t(failureKey) : t('payment.verifyErrors.generic'));
        return;
      }

      await sleep(PAYMENT_POLL_INTERVAL_MS);
      if (run !== verifyRunRef.current) return;
    }

    failPayment(t('payment.verifyErrors.not_found_or_pending'));
  };

  const handlePasteTxId = async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) return;
    setPaymentTxHashInput(extractTxId(text) ?? text.trim());
    setPaymentError(null);
    setFoundOnClipboard(false);
  };

  // When the creator comes back from their wallet app with the transaction ID
  // copied, pick it up and start checking without them having to paste.
  const checkClipboardForTxId = useCallback(async () => {
    if (step !== 'pay' || isBusy) return;
    try {
      const txId = extractTxId(await Clipboard.getStringAsync());
      if (!txId || txId === lastClipboardTxIdRef.current) return;
      lastClipboardTxIdRef.current = txId;
      setPaymentTxHashInput(txId);
      setFoundOnClipboard(true);
      checkPaymentAndPublish(txId);
    } catch {
      // Clipboard unavailable — the Paste button still works.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, isBusy, lockedFees]);

  useEffect(() => {
    if (step !== 'pay') return;
    const subscription = AppState.addEventListener('change', nextState => {
      const cameBack = /inactive|background/.test(appStateRef.current) && nextState === 'active';
      appStateRef.current = nextState;
      // Android only allows clipboard reads once the app has focus again.
      if (cameBack) setTimeout(checkClipboardForTxId, 500);
    });
    return () => subscription.remove();
  }, [step, checkClipboardForTxId]);

  // The actual publish, given an already-verified payment.
  const executePublish = async (paymentTxHash: string, requiredLovelace: number) => {
    setPaymentState('publishing');
    setUploadStatus(t('publish.statusConnecting'));

    try {
      await blockchainService.initialize();

      setUploadStatus(t('publish.statusUploading'));
      const result = await blockchainService.createProposal({
        title: title.trim(),
        description: description.trim(),
        duration: parseInt(duration),
        expectedVoters,
        attachmentUris: attachments,
        paymentTxHash,
        requiredLovelace,
      });

      setUploadStatus(t('publish.statusRecording'));

      if (!result || !result.cid || !result.metadataTxHash) {
        throw new Error(t('publish.incompleteResponse'));
      }

      const proposalDeadline = Date.now() + (parseInt(duration) * 24 * 60 * 60 * 1000);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      notificationService.subscribeToProposal(result.proposalId, 'creator', proposalDeadline, title.trim()).catch(() => {});
      notificationService.notifyProposalLive(result.proposalId, title.trim()).catch(() => {});

      clearDraft();
      setUploadStatus('');
      setPaymentState('idle');
      setPublished({ cid: result.cid, metadataTxHash: result.metadataTxHash });
      setStep('published');
    } catch (error) {
      setUploadStatus('');

      if (isNetworkError(error)) {
        await offlineQueueService.queueProposal({
          title: title.trim(),
          description: description.trim(),
          duration: parseInt(duration),
          expectedVoters,
          attachmentUris: attachments,
          paymentTxHash,
          requiredLovelace,
        });
        clearDraft();
        toastService.warning(t('publish.queuedToast'));
        onProposalCreated();
        return;
      }

      // Terminal payment failures (wrong recipient/insufficient/already used)
      // surface here via BlockchainService's defensive re-verify — don't queue
      // those, retrying later won't fix a bad payment.
      const errorMessage = error instanceof Error ? error.message : t('publish.unknownError');
      failPayment(t('publish.failedMessage', { error: errorMessage }));
    }
  };

  const handleHeaderBack = () => {
    if (step === 'pay') handleEditProposal();
    else if (step === 'published') onProposalCreated();
    else onBack();
  };

  // ─── Renderers ──────────────────────────────────────────────────────────

  const renderWriteStep = () => (
    <>
      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} showsVerticalScrollIndicator={false}>
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>{t('infoBanner')}</Text>
        </View>

        <View style={styles.formCard}>
          {/* ── PROPOSAL TITLE ── */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('form.titleLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('form.titlePlaceholder')}
              placeholderTextColor="#9ca3af"
              value={title}
              onChangeText={setTitle}
              maxLength={100}
            />
            <Text style={styles.helperText}>{t('form.characterCount', { current: title.length, max: 100 })}</Text>
          </View>

          {/* ── DESCRIPTION ── */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('form.descriptionLabel')}</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder={t('form.descriptionPlaceholder')}
              placeholderTextColor="#9ca3af"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              maxLength={1000}
            />
            <Text style={styles.helperText}>{t('form.characterCount', { current: description.length, max: 1000 })}</Text>
          </View>

          {/* ── ATTACHMENTS ── */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('attachments.label')}</Text>
            <Text style={styles.helperText}>
              {t('attachments.helper', { max: MAX_ATTACHMENTS })}
            </Text>
            <View style={styles.attachmentRow}>
              {attachments.map((uri) => (
                <View key={uri} style={styles.attachmentThumbWrap}>
                  <Image source={{ uri }} style={styles.attachmentThumb} />
                  <TouchableOpacity
                    style={styles.attachmentRemoveBtn}
                    onPress={() => handleRemoveAttachment(uri)}
                  >
                    <Text style={styles.attachmentRemoveText}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {attachments.length < MAX_ATTACHMENTS && (
                <TouchableOpacity
                  style={styles.attachmentAddBtn}
                  onPress={handleAddAttachment}
                  disabled={isPickingAttachment}
                >
                  {isPickingAttachment ? (
                    <ActivityIndicator size="small" color="#22c55e" />
                  ) : (
                    <Text style={styles.attachmentAddText}>{t('attachments.addPhoto')}</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* ── DURATION ── */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('form.durationLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder="7"
              placeholderTextColor="#9ca3af"
              value={duration}
              onChangeText={setDuration}
              keyboardType="number-pad"
              maxLength={3}
            />
            <Text style={styles.helperText}>{t('form.durationHelper')}</Text>
          </View>

          {/* ── EXPECTED VOTERS ── */}
          <View style={[styles.inputGroup, { marginBottom: 0 }]}>
            <Text style={styles.label}>{t('form.votersLabel')}</Text>
            <Text style={[styles.helperText, { marginBottom: 12 }]}>
              {t('form.votersHelper')}
            </Text>
            <View style={styles.presetsGrid}>
              {VOTER_PRESETS.map((preset) => (
                <TouchableOpacity
                  key={preset.value}
                  style={[
                    styles.presetButton,
                    expectedVoters === preset.value && styles.presetButtonSelected,
                  ]}
                  onPress={() => handleVoterPresetSelect(preset.value)}
                >
                  <Text
                    style={[
                      styles.presetButtonText,
                      expectedVoters === preset.value && styles.presetButtonTextSelected,
                    ]}
                  >
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.input, { marginTop: 12 }]}
              placeholder={t('form.customVotersPlaceholder')}
              placeholderTextColor="#9ca3af"
              value={customVoters}
              onChangeText={handleCustomVotersChange}
              keyboardType="number-pad"
            />
            <Text style={styles.helperText}>
              {t('form.selectedVoters', { count: expectedVoters, voters: expectedVoters.toLocaleString() })}
            </Text>
            <Text style={styles.votingFreeText}>{t('fees.votingFree')}</Text>
          </View>
        </View>

        {(title.trim() || description.trim() || attachments.length > 0) && (
          <TouchableOpacity onPress={handleDiscardDraft} style={styles.discardLink}>
            <Text style={styles.discardLinkText}>{t('draft.discard')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* ── COST + CONTINUE ── */}
      <View style={[styles.footer, { paddingBottom: 16 + insets.bottom }]}>
        <TouchableOpacity
          style={styles.costRow}
          onPress={() => setShowFeeDetails(v => !v)}
          activeOpacity={0.7}
        >
          <View style={styles.costLabelBlock}>
            <Text style={styles.costLabel}>{t('cost.label')}</Text>
            <Text style={styles.costDetailsToggle}>
              {showFeeDetails ? t('cost.hideBreakdown') : t('cost.showBreakdown')}
            </Text>
          </View>
          <View style={styles.costAmountBlock}>
            <Text style={styles.costAmount}>{fees.grandTotalADA} ADA</Text>
            <Text style={styles.costUsd}>{t('cost.usd', { usd: fees.grandTotalUSD })}</Text>
          </View>
        </TouchableOpacity>

        {showFeeDetails && (
          <View style={styles.feeBreakdown}>
            <View style={styles.feeBreakdownRow}>
              <Text style={styles.feeBreakdownLabel}>{t('fees.gasCosts')}</Text>
              <Text style={styles.feeBreakdownValue}>{fees.gasCostADA} ADA</Text>
            </View>
            <View style={styles.feeBreakdownRow}>
              <Text style={styles.feeBreakdownLabel}>{t('fees.foundationFee')}</Text>
              <Text style={styles.feeBreakdownValue}>{fees.foundationFeeADA} ADA</Text>
            </View>
            {fees.isMinimumApplied && (
              <Text style={styles.feeNote}>{t('fees.minimumApplied')}</Text>
            )}
            <Text style={styles.feeNote}>{t('fees.foundationInfo')}</Text>
          </View>
        )}

        <TouchableOpacity style={styles.primaryButton} onPress={handleContinueToPayment}>
          <Text style={styles.primaryButtonText}>{t('publish.continueButton')}</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  const renderPayStep = () => {
    if (!lockedFees) return null;
    return (
      <ScrollView
        style={styles.content}
        contentContainerStyle={[styles.contentInner, { paddingBottom: 32 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.payTitle}>{t('payment.title', { amount: lockedFees.grandTotalADA })}</Text>

        {/* Step 1 — copy address and amount */}
        <View style={styles.payCard}>
          <View style={styles.payStepHeader}>
            <View style={styles.payStepNum}><Text style={styles.payStepNumText}>1</Text></View>
            <Text style={styles.payStepTitle}>{t('payment.step1')}</Text>
          </View>

          <Text style={styles.payFieldLabel}>{t('payment.sendTo')}</Text>
          <View style={styles.payCopyRow}>
            <Text style={styles.payFieldValue} numberOfLines={1} ellipsizeMode="middle">
              {TREASURY_CONFIG.FOUNDATION_WALLET}
            </Text>
            <TouchableOpacity
              style={styles.payCopyBtn}
              onPress={() => handleCopy('address', TREASURY_CONFIG.FOUNDATION_WALLET)}
            >
              <Text style={styles.payCopyBtnText}>
                {copiedField === 'address' ? t('payment.copied') : t('payment.copy')}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.payFieldLabel}>{t('payment.amount')}</Text>
          <View style={styles.payCopyRow}>
            <Text style={styles.payFieldValue}>{lockedFees.grandTotalADA} ADA</Text>
            <TouchableOpacity
              style={styles.payCopyBtn}
              onPress={() => handleCopy('amount', lockedFees.grandTotalADA)}
            >
              <Text style={styles.payCopyBtnText}>
                {copiedField === 'amount' ? t('payment.copied') : t('payment.copy')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Step 2 — pay from own wallet */}
        <View style={styles.payCard}>
          <View style={styles.payStepHeader}>
            <View style={styles.payStepNum}><Text style={styles.payStepNumText}>2</Text></View>
            <Text style={styles.payStepTitle}>{t('payment.step2')}</Text>
          </View>
          <TouchableOpacity style={styles.primaryButton} onPress={handleOpenWallet}>
            <Text style={styles.primaryButtonText}>{t('payment.openWallet')}</Text>
          </TouchableOpacity>
          <Text style={styles.payNote}>{t('payment.prefillNote')}</Text>
          <Text style={styles.payNote}>{t('payment.ownWalletNote')}</Text>
        </View>

        {/* Step 3 — transaction ID */}
        <View style={styles.payCard}>
          <View style={styles.payStepHeader}>
            <View style={styles.payStepNum}><Text style={styles.payStepNumText}>3</Text></View>
            <Text style={styles.payStepTitle}>{t('payment.step3')}</Text>
          </View>
          <Text style={styles.payNote}>{t('payment.step3Helper')}</Text>

          {foundOnClipboard && (
            <Text style={styles.payFoundText}>✓ {t('payment.foundOnClipboard')}</Text>
          )}

          <Text style={styles.payFieldLabel}>{t('payment.txHashLabel')}</Text>
          <View style={styles.payInputRow}>
            <TextInput
              style={styles.payInput}
              placeholder={t('payment.txHashPlaceholder')}
              placeholderTextColor="#9ca3af"
              value={paymentTxHashInput}
              onChangeText={text => {
                setPaymentTxHashInput(text);
                setPaymentError(null);
                setFoundOnClipboard(false);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isBusy}
            />
            <TouchableOpacity style={styles.payCopyBtn} onPress={handlePasteTxId} disabled={isBusy}>
              <Text style={styles.payCopyBtnText}>{t('payment.paste')}</Text>
            </TouchableOpacity>
          </View>

          {paymentState === 'waiting' && (
            <View style={styles.payStatusBox}>
              <ActivityIndicator size="small" color="#22c55e" />
              <View style={{ flex: 1 }}>
                <Text style={styles.payStatusTitle}>{t('payment.waitingTitle')}</Text>
                <Text style={styles.payStatusBody}>{t('payment.waitingBody')}</Text>
              </View>
            </View>
          )}

          {paymentState === 'publishing' && (
            <View style={styles.payStatusBox}>
              <ActivityIndicator size="small" color="#22c55e" />
              <Text style={[styles.payStatusTitle, { flex: 1 }]}>{uploadStatus}</Text>
            </View>
          )}

          {paymentError && paymentState === 'failed' && (
            <Text style={styles.payErrorText}>{paymentError}</Text>
          )}

          {paymentState === 'waiting' ? (
            <TouchableOpacity style={styles.secondaryButton} onPress={cancelPaymentCheck}>
              <Text style={styles.secondaryButtonText}>{t('payment.cancelWaiting')}</Text>
            </TouchableOpacity>
          ) : paymentState !== 'publishing' && (
            <TouchableOpacity
              style={[styles.primaryButton, !paymentTxHashInput.trim() && styles.primaryButtonDisabled]}
              onPress={() => checkPaymentAndPublish(paymentTxHashInput)}
              disabled={!paymentTxHashInput.trim()}
            >
              <Text style={styles.primaryButtonText}>{t('payment.verifyButton')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* First-timer help */}
        <View style={styles.helpCard}>
          <TouchableOpacity onPress={() => setShowWalletHelp(v => !v)} style={styles.helpToggle}>
            <Text style={styles.helpToggleText}>{t('payment.newToWallets')}</Text>
            <Text style={styles.helpToggleArrow}>{showWalletHelp ? '−' : '+'}</Text>
          </TouchableOpacity>
          {showWalletHelp && (
            <View style={styles.helpBody}>
              <Text style={styles.helpText}>{t('noWallet.body')}</Text>
              <Text style={styles.helpText}>
                <Trans t={t} i18nKey="noWallet.step1" components={{ bold: <Text style={{ fontWeight: '700' }} /> }} />
              </Text>
              <Text style={styles.helpText}>{t('noWallet.step2')}</Text>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => Linking.openURL(VESPR_PLAY_STORE_URL).catch(() =>
                  Alert.alert(t('noWallet.linkErrorTitle'), t('noWallet.linkErrorMessage')))}
              >
                <Text style={styles.secondaryButtonText}>{t('noWallet.downloadButton')}</Text>
              </TouchableOpacity>
              <Text style={styles.helpText}>{t('payment.faucetNote')}</Text>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => Linking.openURL(TEST_ADA_FAUCET_URL).catch(() => {})}
              >
                <Text style={styles.secondaryButtonText}>{t('payment.faucetLink')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <TouchableOpacity onPress={handleEditProposal} disabled={paymentState === 'publishing'}>
          <Text style={styles.editLink}>{t('payment.editProposal')}</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  };

  const renderPublishedStep = () => {
    if (!published) return null;
    const days = parseInt(duration);
    return (
      <ScrollView style={styles.content} contentContainerStyle={[styles.contentInner, styles.publishedInner]}>
        <View style={styles.publishedCheck}>
          <Text style={styles.publishedCheckText}>✓</Text>
        </View>
        <Text style={styles.publishedTitle}>{t('success.live')}</Text>
        <Text style={styles.publishedBody}>{t('success.votingOpen', { count: days })}</Text>
        <Text style={styles.publishedMeta}>
          {t('success.totalPaid', { ada: lockedFees?.grandTotalADA ?? fees.grandTotalADA, usd: lockedFees?.grandTotalUSD ?? fees.grandTotalUSD })}
        </Text>

        <TouchableOpacity
          style={[styles.primaryButton, styles.publishedButton]}
          onPress={() => shareService.shareProposalInvite({
            id: published.cid,
            title: title.trim(),
            description: description.trim(),
            deadline: Date.now() + (days * 24 * 60 * 60 * 1000),
            totalVotes: 0,
          })}
        >
          <Text style={styles.primaryButtonText}>{t('success.share')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryButton, styles.publishedButton]}
          onPress={async () => {
            await Clipboard.setStringAsync(published.metadataTxHash);
            toastService.success(t('payment.copied'));
          }}
        >
          <Text style={styles.secondaryButtonText}>{t('success.copyTxHash')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.secondaryButton, styles.publishedButton]} onPress={onProposalCreated}>
          <Text style={styles.secondaryButtonText}>{t('buttons.done')}</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  };

  // ─── Main Render ─────────────────────────────────────────────────────

  const headerTitle = step === 'published' ? t('success.title') : t('header.title');

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          onPress={handleHeaderBack}
          style={styles.backButton}
          disabled={paymentState === 'publishing'}
        >
          <Text style={styles.backText}>{t('header.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{headerTitle}</Text>
        <QueueIndicator />
      </View>

      {step === 'write' && renderWriteStep()}
      {step === 'pay' && renderPayStep()}
      {step === 'published' && renderPublishedStep()}
    </KeyboardAvoidingView>
  );
}

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  backButton: { padding: 8 },
  backText: { fontSize: 16, color: '#22c55e', fontWeight: '600' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#111827', flexShrink: 1, marginHorizontal: 8 },
  content: { flex: 1 },
  contentInner: { padding: 16 },
  infoBox: {
    backgroundColor: '#f0fdf4',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    marginBottom: 16,
  },
  infoText: { fontSize: 12, color: '#15803d', textAlign: 'center', fontWeight: '500' },
  formCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
  },
  inputGroup: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  input: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#111827',
  },
  textArea: { height: 100, paddingTop: 12 },
  helperText: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  votingFreeText: { fontSize: 12, color: '#15803d', fontWeight: '600', marginTop: 10 },
  discardLink: { alignItems: 'center', padding: 14 },
  discardLinkText: { fontSize: 13, color: '#ef4444', fontWeight: '500' },

  // ── Attachments ──
  attachmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  attachmentThumbWrap: { width: 80, height: 80, position: 'relative' },
  attachmentThumb: { width: 80, height: 80, borderRadius: 8, backgroundColor: '#f3f4f6' },
  attachmentRemoveBtn: {
    position: 'absolute', top: -6, right: -6,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'white',
  },
  attachmentRemoveText: { color: 'white', fontSize: 13, fontWeight: '700', lineHeight: 15 },
  attachmentAddBtn: {
    width: 80, height: 80, borderRadius: 8,
    borderWidth: 2, borderColor: '#e5e7eb', borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb',
  },
  attachmentAddText: { fontSize: 12, color: '#22c55e', fontWeight: '700', textAlign: 'center' },

  // ── Voters ──
  presetsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  presetButton: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 8, borderWidth: 2, borderColor: '#e5e7eb',
    backgroundColor: 'white', minWidth: 70, alignItems: 'center',
  },
  presetButtonSelected: { borderColor: '#22c55e', backgroundColor: '#f0fdf4' },
  presetButtonText: { fontSize: 14, fontWeight: '600', color: '#6b7280' },
  presetButtonTextSelected: { color: '#15803d' },

  // ── Footer: live cost + continue ──
  footer: {
    paddingHorizontal: 16, paddingTop: 12, backgroundColor: 'white',
    borderTopWidth: 1, borderTopColor: '#e5e7eb', gap: 10,
  },
  costRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  costLabelBlock: { flexShrink: 1 },
  costLabel: { fontSize: 14, fontWeight: '600', color: '#374151' },
  costDetailsToggle: { fontSize: 12, color: '#22c55e', fontWeight: '600', marginTop: 2 },
  costAmountBlock: { alignItems: 'flex-end' },
  costAmount: { fontSize: 20, fontWeight: '700', color: '#111827' },
  costUsd: { fontSize: 12, color: '#6b7280' },
  feeBreakdown: { backgroundColor: '#f9fafb', borderRadius: 8, padding: 12, gap: 6 },
  feeBreakdownRow: { flexDirection: 'row', justifyContent: 'space-between' },
  feeBreakdownLabel: { fontSize: 12, color: '#4b5563' },
  feeBreakdownValue: { fontSize: 12, color: '#111827', fontWeight: '600' },
  feeNote: { fontSize: 11, color: '#6b7280', lineHeight: 16 },

  // ── Buttons ──
  primaryButton: {
    flexDirection: 'row', backgroundColor: '#22c55e', padding: 15, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  primaryButtonDisabled: { backgroundColor: '#9ca3af' },
  primaryButtonText: { color: 'white', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  secondaryButton: {
    padding: 13, borderRadius: 12, borderWidth: 1, borderColor: '#d1d5db',
    alignItems: 'center', backgroundColor: 'white',
  },
  secondaryButtonText: { fontSize: 15, color: '#374151', fontWeight: '600', textAlign: 'center' },

  // ── Pay step ──
  payTitle: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 14, marginTop: 4 },
  payCard: { backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 12, gap: 10 },
  payStepHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  payStepNum: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: '#22c55e',
    alignItems: 'center', justifyContent: 'center',
  },
  payStepNumText: { color: 'white', fontSize: 13, fontWeight: '700' },
  payStepTitle: { fontSize: 15, fontWeight: '700', color: '#111827', flex: 1, lineHeight: 21 },
  payFieldLabel: {
    fontSize: 11, fontWeight: '600', color: '#6b7280',
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: -4,
  },
  payCopyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f9fafb', borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb',
    paddingVertical: 8, paddingLeft: 12, paddingRight: 8,
  },
  payFieldValue: { fontSize: 14, fontWeight: '600', color: '#111827', flex: 1, fontFamily: MONO },
  payCopyBtn: { paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#dcfce7', borderRadius: 6 },
  payCopyBtnText: { fontSize: 13, fontWeight: '700', color: '#15803d' },
  payNote: { fontSize: 13, color: '#6b7280', lineHeight: 19 },
  payFoundText: { fontSize: 13, color: '#15803d', fontWeight: '600' },
  payInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  payInput: {
    flex: 1, backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 8, padding: 11, fontSize: 13, color: '#111827', fontFamily: MONO,
  },
  payStatusBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#f0fdf4', borderRadius: 8, padding: 12,
    borderWidth: 1, borderColor: '#bbf7d0',
  },
  payStatusTitle: { fontSize: 14, fontWeight: '600', color: '#15803d' },
  payStatusBody: { fontSize: 12.5, color: '#15803d', marginTop: 2, lineHeight: 18 },
  payErrorText: { fontSize: 13, color: '#dc2626', lineHeight: 19 },
  helpCard: { backgroundColor: 'white', borderRadius: 12, marginBottom: 12, overflow: 'hidden' },
  helpToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  helpToggleText: { fontSize: 15, fontWeight: '600', color: '#374151', flex: 1 },
  helpToggleArrow: { fontSize: 20, color: '#22c55e', fontWeight: '600', marginLeft: 12 },
  helpBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  helpText: { fontSize: 13, color: '#4b5563', lineHeight: 20 },
  editLink: { fontSize: 14, color: '#6b7280', textAlign: 'center', padding: 12, fontWeight: '500' },

  // ── Published step ──
  publishedInner: { alignItems: 'center', paddingTop: 40 },
  publishedCheck: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#dcfce7',
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  publishedCheckText: { fontSize: 36, color: '#15803d', fontWeight: '700' },
  publishedTitle: { fontSize: 22, fontWeight: '700', color: '#111827', textAlign: 'center' },
  publishedBody: { fontSize: 15, color: '#4b5563', textAlign: 'center', marginTop: 8, lineHeight: 22 },
  publishedMeta: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: 6, marginBottom: 28 },
  publishedButton: { alignSelf: 'stretch', marginBottom: 10 },
});
