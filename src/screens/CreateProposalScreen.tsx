// src/screens/CreateProposalScreen.tsx
import React, { useState } from 'react';
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
} from 'react-native';
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

// Supported Cardano wallets for mobile
const CARDANO_WALLETS = [
  {
    id: 'eternl',
    name: 'Eternl',
    badge: 'RECOMMENDED',
    badgeColor: '#22c55e',
    description: 'Most powerful Cardano wallet. WalletConnect support.',
    emoji: '🟢',
    playStoreUrl: 'https://play.google.com/store/apps/details?id=io.ccvault.v1.main',
    accentColor: '#1d4ed8',
    accentBg: '#eff6ff',
  },
  {
    id: 'vespr',
    name: 'Vespr',
    badge: 'BEST FOR BEGINNERS',
    badgeColor: '#8b5cf6',
    description: 'Mobile-native, fast, and easy to set up.',
    emoji: '🟣',
    playStoreUrl: 'https://play.google.com/store/apps/details?id=art.nft_craze.gallery.main',
    accentColor: '#7c3aed',
    accentBg: '#f5f3ff',
  },
  {
    id: 'lace',
    name: 'Lace',
    badge: 'OFFICIAL IOG',
    badgeColor: '#0891b2',
    description: "Built by Cardano's founders. All-in-one Web3 hub.",
    emoji: '🔵',
    playStoreUrl: 'https://play.google.com/store/apps/details?id=io.lace.mobilewallet',
    accentColor: '#0e7490',
    accentBg: '#ecfeff',
  },
];

type WalletFlowState = 'select' | 'no-wallet-guide' | 'manual-entry' | 'connected';

// Separate from WalletFlowState — that answers "do we have an address",
// this answers "has that address's payment been proved". Conflating them
// would make walletFlow === 'connected' ambiguous.
type PaymentFlowState = 'not-started' | 'awaiting-payment' | 'verifying' | 'verify-failed';

const VERIFY_FAILURE_MESSAGES: Record<string, string> = {
  malformed_hash: 'That doesn\'t look like a valid transaction hash. It should be 64 hex characters — check what you pasted.',
  not_found_or_pending: 'Not found on-chain yet. If you just sent it, wait 30-60 seconds for confirmation and try again.',
  wrong_recipient: 'This transaction doesn\'t pay the Foundation wallet address shown above.',
  insufficient_amount: 'The amount sent is less than required — see the amount above.',
  already_used: 'This transaction has already been used for another proposal.',
  network_error: 'Could not reach the network to verify — check your connection and try again.',
};

export default function CreateProposalScreen({
  onBack,
  onProposalCreated,
}: CreateProposalScreenProps) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState('7');
  const [walletAddress, setWalletAddress] = useState('');
  const [manualAddressInput, setManualAddressInput] = useState('');
  const [expectedVoters, setExpectedVoters] = useState(2);
  const [customVoters, setCustomVoters] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [isPickingAttachment, setIsPickingAttachment] = useState(false);
  const [feeEstimate, setFeeEstimate] = useState<FeeCalculation | null>(null);

  // Wallet connection flow state
  const [walletFlow, setWalletFlow] = useState<WalletFlowState>('select');
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [showManualAfterWallet, setShowManualAfterWallet] = useState(false);

  // Payment flow state — see PaymentFlowState comment above
  const [paymentFlow, setPaymentFlow] = useState<PaymentFlowState>('not-started');
  const [lockedFees, setLockedFees] = useState<FeeCalculation | null>(null);
  const [paymentTxHashInput, setPaymentTxHashInput] = useState('');
  const [paymentVerifyError, setPaymentVerifyError] = useState<string | null>(null);

  // ─── Wallet Flow Handlers ────────────────────────────────────────────
  // Real WalletConnect integration exists (see WalletConnectService.ts,
  // App.tsx's <WalletConnectModal> mount) but is deliberately not wired up
  // here — tested 2026-08-13, none of the 3 recommended wallets connected
  // reliably (WalletConnect's Cardano registry is currently empty; see
  // memory). Kept dormant rather than deleted so it's ready to re-enable
  // once wallet support matures. This screen uses the original
  // Play-Store-then-manual-paste flow.

  const handleWalletSelect = async (wallet: typeof CARDANO_WALLETS[0]) => {
    setSelectedWallet(wallet.id);
    Alert.alert(
      `Open ${wallet.name}?`,
      `This will open the ${wallet.name} wallet app (or take you to download it).\n\nAfter connecting, copy your Cardano address (starts with addr_test1...) and come back here to paste it.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setSelectedWallet(null) },
        {
          text: `Open ${wallet.name}`,
          onPress: async () => {
            try {
              await Linking.openURL(wallet.playStoreUrl);
            } catch {
              Alert.alert('Could not open link', 'Please search for the wallet in the Play Store manually.');
            }
            // After returning, show manual entry to paste their address
            setShowManualAfterWallet(true);
            setWalletFlow('manual-entry');
          },
        },
      ]
    );
  };

  const handleConfirmManualAddress = () => {
    const cleaned = manualAddressInput.trim();
    // The app runs entirely on Cardano preprod testnet (addr_test1...), not
    // mainnet (addr1...) — this only ever checked for the mainnet prefix,
    // which silently rejected every real testnet address a user could paste.
    const hasValidPrefix = cleaned.startsWith('addr1') || cleaned.startsWith('addr_test1');
    if (!hasValidPrefix || cleaned.length < 50) {
      Alert.alert(
        'Invalid Address',
        'Please enter a valid Cardano address. It should start with "addr_test1" (testnet) and be at least 50 characters long.'
      );
      return;
    }
    setWalletAddress(cleaned);
    setWalletFlow('connected');
  };

  const handleDisconnectWallet = () => {
    Alert.alert(
      'Remove Wallet',
      'Are you sure you want to remove your wallet address?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setWalletAddress('');
            setManualAddressInput('');
            setSelectedWallet(null);
            setShowManualAfterWallet(false);
            setWalletFlow('select');
          },
        },
      ]
    );
  };

  const truncateAddress = (addr: string) =>
    addr.length > 20 ? addr.slice(0, 10) + '...' + addr.slice(-8) : addr;

  // ─── Attachment Handlers ───────────────────────────────────────────────
  // MVP scope: images only, capped at 2 per proposal, compressed client-side
  // before upload to keep Pinata storage/bandwidth cost predictable.

  const handleAddAttachment = async () => {
    if (attachments.length >= MAX_ATTACHMENTS) {
      Alert.alert('Limit Reached', `You can attach up to ${MAX_ATTACHMENTS} images per proposal.`);
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Needed', 'Allow photo library access to attach an image.');
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
      Alert.alert('Could not add image', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsPickingAttachment(false);
    }
  };

  const handleRemoveAttachment = (uri: string) => {
    setAttachments(prev => prev.filter(a => a !== uri));
  };

  // ─── Fee & Publish Handlers ──────────────────────────────────────────

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

  const handleEstimateFee = () => {
    if (!title.trim() || !description.trim() || !walletAddress.trim()) {
      Alert.alert('Missing Information', 'Please fill in all required fields first, including your wallet address');
      return;
    }
    if (expectedVoters < 2) {
      Alert.alert('Invalid Voter Count', 'Minimum expected voters is 2');
      return;
    }

    const fees = treasuryService.calculateProposalFees(expectedVoters);
    setFeeEstimate(fees);

    const batchCount = Math.ceil(expectedVoters / 100);
    const batchWord = batchCount > 1 ? 'batches' : 'batch';
    const message = [
      'Expected voters: ' + expectedVoters.toLocaleString(),
      '',
      'Gas costs (' + batchCount + ' ' + batchWord + '): ' + fees.gasCostADA + ' ADA',
      'Foundation fee: ' + fees.foundationFeeADA + ' ADA',
      '---',
      'TOTAL: ' + fees.grandTotalADA + ' ADA (~$' + fees.grandTotalUSD + ' USD)',
      fees.isMinimumApplied ? '(platform minimum of 1.2 ADA applied)' : '',
      '',
      'Foundation fee supports VoteBoxApp open-source development.',
      'Voting is FREE for all participants!',
    ].filter(Boolean).join('\n');

    Alert.alert('Complete Fee Breakdown', message, [{ text: 'OK' }]);
  };

  // Step 1: validate the form, freeze a fee quote, reveal the payment card.
  // No network calls yet.
  const handleBeginPublish = () => {
    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please enter a proposal title');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Missing Description', 'Please enter a proposal description');
      return;
    }
    if (!duration || parseInt(duration) < 1) {
      Alert.alert('Invalid Duration', 'Duration must be at least 1 day');
      return;
    }
    if (!walletAddress.trim()) {
      Alert.alert('Wallet Required', 'Please connect your Cardano wallet to pay the creation fee');
      return;
    }
    if (expectedVoters < 2) {
      Alert.alert('Invalid Voter Count', 'Expected voters must be at least 2');
      return;
    }

    const fees = treasuryService.calculateProposalFees(expectedVoters);
    setLockedFees(fees);
    setPaymentTxHashInput('');
    setPaymentVerifyError(null);
    setPaymentFlow('awaiting-payment');
  };

  // Step 2: user pastes their payment's tx hash, we verify it on-chain.
  const handleVerifyAndPublish = async () => {
    if (!lockedFees) return;
    setPaymentFlow('verifying');
    setPaymentVerifyError(null);

    const result = await treasuryService.verifyPaymentTransaction(paymentTxHashInput, lockedFees.grandTotal);
    if (!result.ok) {
      setPaymentFlow('verify-failed');
      setPaymentVerifyError(VERIFY_FAILURE_MESSAGES[result.reason ?? 'network_error'] ?? 'Verification failed — please try again.');
      return;
    }

    // Soft guard against likely unit-confusion (e.g. pasting a tx sized for
    // 1000 ADA instead of 1.2) — informational only, doesn't block.
    if (result.paidLovelace! > lockedFees.grandTotal * 10) {
      const proceed = await new Promise<boolean>(resolve => {
        Alert.alert(
          'Amount much higher than required',
          `You sent ${(result.paidLovelace! / 1_000_000).toFixed(4)} ADA, but only ${lockedFees.grandTotalADA} ADA was required. This can't be refunded — continue anyway?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Continue', onPress: () => resolve(true) },
          ]
        );
      });
      if (!proceed) {
        setPaymentFlow('awaiting-payment');
        return;
      }
    }

    await executePublish(paymentTxHashInput.trim().toLowerCase(), lockedFees.grandTotal);
  };

  // Step 3: the actual publish, now given an already-verified payment.
  const executePublish = async (paymentTxHash: string, requiredLovelace: number) => {
    setIsSubmitting(true);
    setUploadStatus('Initializing blockchain service...');

    try {
      setUploadStatus('Connecting to Cardano network...');
      await blockchainService.initialize();

      setUploadStatus('Uploading to IPFS...');
      const result = await blockchainService.createProposal({
        title: title.trim(),
        description: description.trim(),
        creator: walletAddress.trim(),
        duration: parseInt(duration),
        expectedVoters,
        attachmentUris: attachments,
        paymentTxHash,
        requiredLovelace,
      });

      setUploadStatus('Recording on blockchain...');

      if (!result || !result.cid || !result.metadataTxHash) {
        throw new Error('Incomplete response from blockchain service');
      }

      const proposalDeadline = Date.now() + (parseInt(duration) * 24 * 60 * 60 * 1000);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      notificationService.subscribeToProposal(result.proposalId, 'creator', proposalDeadline, title.trim()).catch(() => {});
      notificationService.notifyProposalLive(result.proposalId, title.trim()).catch(() => {});

      const fees = treasuryService.calculateProposalFees(expectedVoters);

      setIsSubmitting(false);
      setUploadStatus('');
      setPaymentFlow('not-started');
      setLockedFees(null);
      setPaymentTxHashInput('');

      const successMessage = [
        'Your proposal is now live!',
        '',
        'IPFS: ' + result.cid.slice(0, 24) + '...',
        'TX:   ' + result.metadataTxHash.slice(0, 24) + '...',
        '',
        'Verify on preprod.cardanoscan.io',
        '',
        'Total paid: ' + fees.grandTotalADA + ' ADA (~$' + fees.grandTotalUSD + ' USD)',
        '',
        'Configured for ' + expectedVoters.toLocaleString() + ' voters',
        '',
        'Voting is FREE for all participants!',
      ].join('\n');

      Alert.alert('🎉 Proposal Published!', successMessage, [
        {
          text: '📋 Copy TX Hash',
          onPress: async () => {
            await Clipboard.setStringAsync(result.metadataTxHash);
            onProposalCreated();
          },
        },
        {
          text: '📢 Share',
          onPress: () => {
            shareService.shareProposalInvite({
              id: result.cid,
              title: title.trim(),
              description: description.trim(),
              deadline: Date.now() + (parseInt(duration) * 24 * 60 * 60 * 1000),
              totalVotes: 0,
            });
            onProposalCreated();
          },
        },
        {
          text: 'Done',
          onPress: onProposalCreated,
          style: 'cancel',
        },
      ]);
    } catch (error) {
      setIsSubmitting(false);
      setUploadStatus('');

      if (isNetworkError(error)) {
        await offlineQueueService.queueProposal({
          title: title.trim(),
          description: description.trim(),
          creator: walletAddress.trim(),
          duration: parseInt(duration),
          expectedVoters,
          attachmentUris: attachments,
          paymentTxHash,
          requiredLovelace,
        });
        toastService.warning('⏳ No connection — proposal queued, will publish when back online');
        setPaymentFlow('not-started');
        setLockedFees(null);
        return;
      }

      // Terminal payment failures (wrong recipient/insufficient/already used)
      // surface here via BlockchainService's defensive re-verify — don't queue
      // those, retrying later won't fix a bad payment. Send the user back to
      // the payment step so they can paste a different hash.
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setPaymentFlow('verify-failed');
      setPaymentVerifyError(errorMessage);
      Alert.alert(
        'Publication Failed',
        errorMessage + '\n\nCheck console for detailed logs.',
        [{ text: 'OK' }]
      );
    }
  };

  const handleEditProposal = () => {
    setPaymentFlow('not-started');
    setLockedFees(null);
    setPaymentTxHashInput('');
    setPaymentVerifyError(null);
  };

  // ─── Payment Section Renderer ───────────────────────────────────────

  const renderPaymentSection = () => {
    if (paymentFlow === 'not-started' || !lockedFees) return null;

    return (
      <View style={styles.paymentBox}>
        <Text style={styles.paymentTitle}>Send Payment to Publish</Text>
        <Text style={styles.paymentInstructions}>
          Send exactly this amount from your own wallet app, then paste the transaction hash below.
        </Text>

        <View style={styles.paymentField}>
          <Text style={styles.paymentFieldLabel}>Send to</Text>
          <View style={styles.paymentCopyRow}>
            <Text style={styles.paymentFieldValue} numberOfLines={1}>
              {truncateAddress(TREASURY_CONFIG.FOUNDATION_WALLET)}
            </Text>
            <TouchableOpacity
              style={styles.paymentCopyBtn}
              onPress={() => Clipboard.setStringAsync(TREASURY_CONFIG.FOUNDATION_WALLET)}
            >
              <Text style={styles.paymentCopyBtnText}>Copy</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.paymentField}>
          <Text style={styles.paymentFieldLabel}>Amount</Text>
          <View style={styles.paymentCopyRow}>
            <Text style={styles.paymentFieldValue}>{lockedFees.grandTotalADA} ADA</Text>
            <TouchableOpacity
              style={styles.paymentCopyBtn}
              onPress={() => Clipboard.setStringAsync(lockedFees.grandTotalADA)}
            >
              <Text style={styles.paymentCopyBtnText}>Copy</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.label}>Transaction Hash</Text>
        <TextInput
          style={styles.walletManualInput}
          placeholder="Paste the tx hash from your wallet app"
          placeholderTextColor="#9ca3af"
          value={paymentTxHashInput}
          onChangeText={text => { setPaymentTxHashInput(text); setPaymentVerifyError(null); }}
          autoCapitalize="none"
          autoCorrect={false}
          multiline={false}
          editable={paymentFlow !== 'verifying'}
        />

        {paymentVerifyError && (
          <Text style={styles.paymentErrorText}>{paymentVerifyError}</Text>
        )}

        <TouchableOpacity
          style={[
            styles.paymentVerifyBtn,
            (paymentFlow === 'verifying' || !paymentTxHashInput.trim()) && styles.paymentVerifyBtnDisabled,
          ]}
          onPress={handleVerifyAndPublish}
          disabled={paymentFlow === 'verifying' || !paymentTxHashInput.trim()}
        >
          {paymentFlow === 'verifying' ? (
            <>
              <ActivityIndicator size="small" color="white" />
              <Text style={styles.paymentVerifyBtnText}>Verifying payment...</Text>
            </>
          ) : (
            <Text style={styles.paymentVerifyBtnText}>Verify & Publish</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={handleEditProposal} disabled={paymentFlow === 'verifying' || isSubmitting}>
          <Text style={styles.paymentEditLink}>← Edit Proposal</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // ─── Wallet Section Renderers ────────────────────────────────────────

  const renderWalletSection = () => {
    // STATE: Connected
    if (walletFlow === 'connected') {
      return (
        <View style={styles.walletConnectedBox}>
          <View style={styles.walletConnectedHeader}>
            <View style={styles.walletConnectedDot} />
            <Text style={styles.walletConnectedLabel}>Wallet Connected</Text>
          </View>
          <Text style={styles.walletConnectedAddress}>
            {truncateAddress(walletAddress)}
          </Text>
          <TouchableOpacity onPress={handleDisconnectWallet} style={styles.walletDisconnectBtn}>
            <Text style={styles.walletDisconnectText}>Remove & Change Wallet</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // STATE: Manual address entry
    if (walletFlow === 'manual-entry') {
      return (
        <View style={styles.walletManualContainer}>
          {showManualAfterWallet && (
            <View style={styles.walletReturnHint}>
              <Text style={styles.walletReturnHintText}>
                👋 Welcome back! Open your wallet app, copy your address (addr_test1...), and paste it below.
              </Text>
            </View>
          )}
          <Text style={styles.label}>Your Cardano Address</Text>
          <TextInput
            style={styles.walletManualInput}
            placeholder="addr_test1..."
            placeholderTextColor="#9ca3af"
            value={manualAddressInput}
            onChangeText={setManualAddressInput}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={true}
            multiline={false}
          />
          <Text style={styles.helperText}>
            Starts with "addr_test1" · Found in your wallet under "Receive" or "Address"
          </Text>
          <View style={styles.walletManualButtons}>
            <TouchableOpacity
              style={styles.walletManualBack}
              onPress={() => {
                setWalletFlow('select');
                setShowManualAfterWallet(false);
                setManualAddressInput('');
                setSelectedWallet(null);
              }}
            >
              <Text style={styles.walletManualBackText}>← Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.walletManualConfirm,
                !manualAddressInput.trim() && styles.walletManualConfirmDisabled,
              ]}
              onPress={handleConfirmManualAddress}
              disabled={!manualAddressInput.trim()}
            >
              <Text style={styles.walletManualConfirmText}>Confirm Address</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    // STATE: No wallet guidance
    if (walletFlow === 'no-wallet-guide') {
      return (
        <View style={styles.noWalletGuide}>
          <Text style={styles.noWalletGuideTitle}>
            Getting a Cardano Wallet
          </Text>
          <Text style={styles.noWalletGuideBody}>
            A Cardano wallet lets you hold ADA (Cardano's currency) and pay
            the small fee to publish a proposal. Voters never need one — only
            proposal creators do.
          </Text>

          <View style={styles.noWalletStep}>
            <View style={styles.noWalletStepNum}><Text style={styles.noWalletStepNumText}>1</Text></View>
            <Text style={styles.noWalletStepText}>
              Download <Text style={{ fontWeight: '700' }}>Vespr</Text> — it's the easiest Cardano wallet for beginners, built for mobile.
            </Text>
          </View>

          <View style={styles.noWalletStep}>
            <View style={styles.noWalletStepNum}><Text style={styles.noWalletStepNumText}>2</Text></View>
            <Text style={styles.noWalletStepText}>
              Create your wallet and safely write down your recovery phrase.
            </Text>
          </View>

          <View style={styles.noWalletStep}>
            <View style={styles.noWalletStepNum}><Text style={styles.noWalletStepNumText}>3</Text></View>
            <Text style={styles.noWalletStepText}>
              Add some ADA — a few dollars worth is enough to publish proposals.
            </Text>
          </View>

          <View style={styles.noWalletStep}>
            <View style={styles.noWalletStepNum}><Text style={styles.noWalletStepNumText}>4</Text></View>
            <Text style={styles.noWalletStepText}>
              Come back here, tap Vespr, and paste your address.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.noWalletDownloadBtn}
            onPress={async () => {
              try {
                await Linking.openURL('https://play.google.com/store/apps/details?id=art.nft_craze.gallery.main');
              } catch {
                Alert.alert('Could not open link', 'Search for "Vespr Wallet" in the Play Store.');
              }
            }}
          >
            <Text style={styles.noWalletDownloadText}>⬇️  Download Vespr Wallet</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.noWalletBack}
            onPress={() => setWalletFlow('select')}
          >
            <Text style={styles.noWalletBackText}>← Back to wallet options</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // STATE: Select wallet (default)
    return (
      <View>
        <Text style={styles.walletSectionTitle}>Connect Your Wallet</Text>
        <Text style={styles.walletSectionSubtitle}>
          Required to pay the proposal creation fee. Voters never need a wallet.
        </Text>

        {/* Wallet Options */}
        {CARDANO_WALLETS.map((wallet) => (
          <TouchableOpacity
            key={wallet.id}
            style={[
              styles.walletOption,
              selectedWallet === wallet.id && { borderColor: wallet.accentColor, backgroundColor: wallet.accentBg },
            ]}
            onPress={() => handleWalletSelect(wallet)}
            activeOpacity={0.8}
          >
            <View style={styles.walletOptionLeft}>
              <Text style={styles.walletOptionEmoji}>{wallet.emoji}</Text>
              <View style={styles.walletOptionInfo}>
                <View style={styles.walletOptionNameRow}>
                  <Text style={styles.walletOptionName}>{wallet.name}</Text>
                  <View style={[styles.walletBadge, { backgroundColor: wallet.badgeColor }]}>
                    <Text style={styles.walletBadgeText}>{wallet.badge}</Text>
                  </View>
                </View>
                <Text style={styles.walletOptionDesc}>{wallet.description}</Text>
              </View>
            </View>
            <Text style={[styles.walletOptionArrow, { color: wallet.accentColor }]}>›</Text>
          </TouchableOpacity>
        ))}

        {/* Divider */}
        <View style={styles.walletDivider}>
          <View style={styles.walletDividerLine} />
          <Text style={styles.walletDividerText}>or</Text>
          <View style={styles.walletDividerLine} />
        </View>

        {/* Secondary options */}
        <TouchableOpacity
          style={styles.walletSecondaryBtn}
          onPress={() => {
            setShowManualAfterWallet(false);
            setWalletFlow('manual-entry');
          }}
        >
          <Text style={styles.walletSecondaryText}>📋  Enter address manually</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.walletSecondaryBtn, { marginTop: 8 }]}
          onPress={() => setWalletFlow('no-wallet-guide')}
        >
          <Text style={styles.walletSecondaryText}>❓  I don't have a wallet yet</Text>
        </TouchableOpacity>

        {/* Future WalletConnect note */}
        <View style={styles.walletFutureNote}>
          <Text style={styles.walletFutureText}>
            🔗 WalletConnect support coming soon — one-tap connection across 600+ wallets
          </Text>
        </View>
      </View>
    );
  };

  // ─── Main Render ─────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={onBack} style={styles.backButton} disabled={isSubmitting}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Proposal</Text>
        <QueueIndicator />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            Cardano secured · 80% gas savings · Free for voters
          </Text>
        </View>

        {isSubmitting && (
          <View style={styles.statusBox}>
            <ActivityIndicator size="small" color="#22c55e" />
            <Text style={styles.statusText}>{uploadStatus}</Text>
          </View>
        )}

        <View style={styles.formCard}>

          {/* ── WALLET SECTION ── */}
          <View style={styles.inputGroup}>
            {renderWalletSection()}
          </View>

          {/* ── PROPOSAL TITLE ── */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Proposal Title *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter a clear, concise title"
              placeholderTextColor="#9ca3af"
              value={title}
              onChangeText={setTitle}
              maxLength={100}
              editable={!isSubmitting}
            />
            <Text style={styles.helperText}>{title.length}/100 characters</Text>
          </View>

          {/* ── DESCRIPTION ── */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Description *</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Explain your proposal in detail..."
              placeholderTextColor="#9ca3af"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              maxLength={1000}
              editable={!isSubmitting}
            />
            <Text style={styles.helperText}>{description.length}/1000 characters</Text>
          </View>

          {/* ── ATTACHMENTS ── */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Attachments (optional)</Text>
            <Text style={styles.helperText}>
              Up to {MAX_ATTACHMENTS} images to accompany your proposal
            </Text>
            <View style={styles.attachmentRow}>
              {attachments.map((uri) => (
                <View key={uri} style={styles.attachmentThumbWrap}>
                  <Image source={{ uri }} style={styles.attachmentThumb} />
                  <TouchableOpacity
                    style={styles.attachmentRemoveBtn}
                    onPress={() => handleRemoveAttachment(uri)}
                    disabled={isSubmitting}
                  >
                    <Text style={styles.attachmentRemoveText}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {attachments.length < MAX_ATTACHMENTS && (
                <TouchableOpacity
                  style={styles.attachmentAddBtn}
                  onPress={handleAddAttachment}
                  disabled={isSubmitting || isPickingAttachment}
                >
                  {isPickingAttachment ? (
                    <ActivityIndicator size="small" color="#22c55e" />
                  ) : (
                    <Text style={styles.attachmentAddText}>+{'\n'}Photo</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* ── DURATION ── */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Voting Duration (days) *</Text>
            <TextInput
              style={styles.input}
              placeholder="7"
              placeholderTextColor="#9ca3af"
              value={duration}
              onChangeText={setDuration}
              keyboardType="number-pad"
              maxLength={3}
              editable={!isSubmitting && paymentFlow === 'not-started'}
            />
            <Text style={styles.helperText}>Recommended: 7–14 days</Text>
          </View>

          {/* ── EXPECTED VOTERS ── */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Expected Voters *</Text>
            <Text style={[styles.helperText, { marginBottom: 12 }]}>
              Estimate participant count (minimum 2)
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
                  disabled={isSubmitting || paymentFlow !== 'not-started'}
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
              placeholder="Or enter custom amount (min 2)"
              placeholderTextColor="#9ca3af"
              value={customVoters}
              onChangeText={handleCustomVotersChange}
              keyboardType="number-pad"
              editable={!isSubmitting && paymentFlow === 'not-started'}
            />
            <Text style={styles.helperText}>
              Selected: {expectedVoters.toLocaleString()} voters
            </Text>
          </View>

          {/* ── FEE ESTIMATOR ── */}
          <TouchableOpacity
            style={styles.estimateButton}
            onPress={handleEstimateFee}
            disabled={isSubmitting || paymentFlow !== 'not-started'}
          >
            <Text style={styles.estimateButtonText}>Calculate Total Cost</Text>
          </TouchableOpacity>

          {/* ── FEE BREAKDOWN ── */}
          {feeEstimate && (
            <View style={styles.feeBox}>
              <Text style={styles.feeTitle}>Total Cost Breakdown</Text>
              <Text style={styles.feeAmount}>
                {feeEstimate.grandTotalADA} ADA
              </Text>
              <Text style={styles.feeAmountUSD}>
                (${feeEstimate.grandTotalUSD} USD)
              </Text>
              <View style={styles.feeBreakdownContainer}>
                <View style={styles.feeBreakdownRow}>
                  <Text style={styles.feeBreakdownLabel}>Gas costs:</Text>
                  <Text style={styles.feeBreakdownValue}>
                    {feeEstimate.gasCostADA} ADA
                  </Text>
                </View>
                <View style={[styles.feeBreakdownRow, { paddingTop: 8, borderTopWidth: 1, borderTopColor: '#fde047' }]}>
                  <Text style={styles.feeBreakdownLabel}>Foundation fee:</Text>
                  <Text style={styles.feeBreakdownValue}>
                    {feeEstimate.foundationFeeADA} ADA
                  </Text>
                </View>
                <View style={[styles.feeBreakdownRow, { marginTop: 8, paddingTop: 8, borderTopWidth: 2, borderTopColor: '#fbbf24' }]}>
                  <Text style={[styles.feeBreakdownLabel, { fontWeight: 'bold' }]}>Total:</Text>
                  <Text style={[styles.feeBreakdownValue, { fontWeight: 'bold', fontSize: 14 }]}>
                    {feeEstimate.grandTotalADA} ADA
                  </Text>
                </View>
              </View>
              {feeEstimate.isMinimumApplied && (
                <Text style={styles.feeMinimumNote}>Platform minimum of 1.2 ADA applied</Text>
              )}
              <View style={styles.foundationInfoBox}>
                <Text style={styles.foundationInfoText}>
                  Foundation fee supports VoteBoxApp open-source development
                </Text>
              </View>
            </View>
          )}

          {/* ── PAYMENT ── */}
          {renderPaymentSection()}

          {/* ── BATCH INFO ── */}
          <View style={styles.optimizationBox}>
            <Text style={styles.optimizationTitle}>Vote Batching System</Text>
            <Text style={styles.optimizationText}>
              Votes batched up to 100 for gas optimization{'\n'}
              Smaller batches auto-submit every 10 min{'\n'}
              All votes recorded when proposal ends{'\n'}
              80% cost reduction vs individual votes{'\n'}
              Voting is completely FREE for participants
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* ── PUBLISH BUTTON ── */}
      {paymentFlow === 'not-started' && (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[
              styles.publishButton,
              (isSubmitting || walletFlow !== 'connected') && styles.publishButtonDisabled,
            ]}
            onPress={handleBeginPublish}
            disabled={isSubmitting || walletFlow !== 'connected'}
          >
            <Text style={styles.publishButtonText}>
              {walletFlow !== 'connected' ? 'Connect Wallet to Publish' : 'Continue to Payment'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

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
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#111827' },
  placeholder: { width: 80 },
  content: { flex: 1, padding: 16 },
  infoBox: {
    backgroundColor: '#dbeafe',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#93c5fd',
    marginBottom: 16,
  },
  infoText: { fontSize: 12, color: '#1e40af', textAlign: 'center', fontWeight: '500' },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0fdf4',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    marginBottom: 16,
    gap: 8,
  },
  statusText: { fontSize: 14, color: '#15803d', fontWeight: '500' },
  formCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 100,
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

  // ── Wallet Select State ──
  walletSectionTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 4, letterSpacing: -0.2 },
  walletSectionSubtitle: { fontSize: 12.5, color: '#6b7280', marginBottom: 18, lineHeight: 18 },
  walletOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#eef1f4',
    marginBottom: 10,
    backgroundColor: 'white',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  walletOptionLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  walletOptionEmoji: { fontSize: 24, marginRight: 12 },
  walletOptionInfo: { flex: 1 },
  walletOptionNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' },
  walletOptionName: { fontSize: 16, fontWeight: '700', color: '#111827' },
  walletBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  walletBadgeText: { fontSize: 9, fontWeight: '800', color: 'white', letterSpacing: 0.5 },
  walletOptionDesc: { fontSize: 12, color: '#6b7280', lineHeight: 17 },
  walletOptionArrow: { fontSize: 22, fontWeight: '300', marginLeft: 8 },
  walletDivider: { flexDirection: 'row', alignItems: 'center', marginVertical: 18, gap: 12 },
  walletDividerLine: { flex: 1, height: 1, backgroundColor: '#e5e7eb' },
  walletDividerText: { fontSize: 11, color: '#9ca3af', fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  walletSecondaryBtn: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
    alignItems: 'center',
  },
  walletSecondaryText: { fontSize: 14, color: '#374151', fontWeight: '500' },
  walletFutureNote: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  walletFutureText: { fontSize: 11, color: '#15803d', textAlign: 'center', lineHeight: 16, fontWeight: '500' },

  // ── Wallet Connected State ──
  walletConnectedBox: {
    padding: 18,
    borderRadius: 14,
    backgroundColor: '#f0fdf4',
    borderWidth: 1.5,
    borderColor: '#86efac',
    shadowColor: '#15803d',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 1,
  },
  walletConnectedHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  walletConnectedDot: {
    width: 9, height: 9, borderRadius: 5,
    backgroundColor: '#22c55e', marginRight: 9,
    shadowColor: '#22c55e', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5, shadowRadius: 4, elevation: 2,
  },
  walletConnectedLabel: { fontSize: 13, fontWeight: '700', color: '#15803d', letterSpacing: 0.1 },
  walletConnectedAddress: {
    fontSize: 15, fontWeight: '600', color: '#111827',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 14,
  },
  walletDisconnectBtn: { alignSelf: 'flex-start' },
  walletDisconnectText: { fontSize: 13, color: '#ef4444', fontWeight: '500' },

  // ── Manual Entry State ──
  walletManualContainer: {},
  walletReturnHint: {
    backgroundColor: '#f0fdf4',
    padding: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    marginBottom: 16,
  },
  walletReturnHintText: { fontSize: 13, color: '#15803d', lineHeight: 20 },
  walletManualInput: {
    backgroundColor: '#f9fafb',
    borderWidth: 1.5,
    borderColor: '#22c55e',
    borderRadius: 10,
    padding: 13,
    fontSize: 14,
    color: '#111827',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 4,
  },
  walletManualButtons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  walletManualBack: {
    flex: 1, padding: 13, borderRadius: 10,
    borderWidth: 1, borderColor: '#e5e7eb',
    alignItems: 'center',
  },
  walletManualBackText: { fontSize: 14, color: '#6b7280', fontWeight: '500' },
  walletManualConfirm: {
    flex: 2, padding: 13, borderRadius: 10,
    backgroundColor: '#22c55e', alignItems: 'center',
    shadowColor: '#22c55e', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18, shadowRadius: 5, elevation: 2,
  },
  walletManualConfirmDisabled: { backgroundColor: '#d1d5db', shadowOpacity: 0 },
  walletManualConfirmText: { fontSize: 14, color: 'white', fontWeight: '700' },

  // ── No Wallet Guide State ──
  noWalletGuide: {
    backgroundColor: '#fafafa',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#eef1f4',
    padding: 18,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  noWalletGuideTitle: {
    fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 10, letterSpacing: -0.2,
  },
  noWalletGuideBody: {
    fontSize: 13, color: '#4b5563', lineHeight: 20, marginBottom: 18,
  },
  noWalletStep: {
    flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14, gap: 12,
  },
  noWalletStepNum: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#8b5cf6', justifyContent: 'center', alignItems: 'center',
    flexShrink: 0, marginTop: 1,
  },
  noWalletStepNumText: { fontSize: 13, fontWeight: '700', color: 'white' },
  noWalletStepText: { fontSize: 13, color: '#374151', lineHeight: 20, flex: 1 },
  noWalletDownloadBtn: {
    backgroundColor: '#8b5cf6',
    padding: 15, borderRadius: 12,
    alignItems: 'center', marginTop: 6, marginBottom: 12,
    shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16, shadowRadius: 5, elevation: 2,
  },
  noWalletDownloadText: { fontSize: 15, fontWeight: '700', color: 'white' },
  noWalletBack: { alignItems: 'center', padding: 8 },
  noWalletBackText: { fontSize: 13, color: '#6b7280' },

  // ── Fee & Other ──
  presetsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  presetButton: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 8, borderWidth: 2, borderColor: '#e5e7eb',
    backgroundColor: 'white', minWidth: 70, alignItems: 'center',
  },
  presetButtonSelected: { borderColor: '#22c55e', backgroundColor: '#f0fdf4' },
  presetButtonText: { fontSize: 14, fontWeight: '600', color: '#6b7280' },
  presetButtonTextSelected: { color: '#15803d' },
  estimateButton: {
    flexDirection: 'row', backgroundColor: '#f0fdf4',
    padding: 14, borderRadius: 8, borderWidth: 2, borderColor: '#22c55e',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 8, marginBottom: 16, gap: 8,
  },
  estimateButtonLoading: { opacity: 0.7 },
  estimateButtonText: { fontSize: 15, color: '#15803d', fontWeight: '700' },
  feeBox: {
    backgroundColor: '#fef3c7', padding: 16, borderRadius: 12,
    borderWidth: 2, borderColor: '#fde047', marginBottom: 16,
  },
  feeTitle: { fontSize: 13, fontWeight: '600', color: '#92400e', marginBottom: 8, textAlign: 'center' },
  feeAmount: { fontSize: 32, fontWeight: 'bold', color: '#78350f', textAlign: 'center' },
  feeAmountUSD: { fontSize: 16, color: '#92400e', textAlign: 'center', marginTop: 4, marginBottom: 12 },
  feeBreakdownContainer: { backgroundColor: '#fffbeb', padding: 12, borderRadius: 8, marginBottom: 12 },
  feeBreakdownRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  feeBreakdownLabel: { fontSize: 12, color: '#92400e' },
  feeBreakdownValue: { fontSize: 12, color: '#78350f', fontWeight: '600' },
  foundationInfoBox: {
    backgroundColor: '#dbeafe', padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#93c5fd',
  },
  foundationInfoText: { fontSize: 11, color: '#1e40af', textAlign: 'center', lineHeight: 16 },
  feeMinimumNote: { fontSize: 11, color: '#92400e', textAlign: 'center', fontStyle: 'italic', marginBottom: 8 },

  // ── Payment Section ──
  paymentBox: {
    backgroundColor: '#eff6ff', padding: 16, borderRadius: 12,
    borderWidth: 2, borderColor: '#93c5fd', marginBottom: 16,
  },
  paymentTitle: { fontSize: 15, fontWeight: '700', color: '#1e40af', marginBottom: 6, textAlign: 'center' },
  paymentInstructions: { fontSize: 12.5, color: '#1e3a8a', lineHeight: 18, marginBottom: 14, textAlign: 'center' },
  paymentField: { marginBottom: 12 },
  paymentFieldLabel: { fontSize: 11, fontWeight: '600', color: '#1e40af', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3 },
  paymentCopyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'white', borderRadius: 8, borderWidth: 1, borderColor: '#bfdbfe',
    paddingVertical: 10, paddingHorizontal: 12,
  },
  paymentFieldValue: {
    fontSize: 14, fontWeight: '600', color: '#111827', flex: 1, marginRight: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  paymentCopyBtn: { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#dbeafe', borderRadius: 6 },
  paymentCopyBtnText: { fontSize: 12, fontWeight: '700', color: '#1e40af' },
  paymentErrorText: { fontSize: 12.5, color: '#dc2626', marginTop: 8, marginBottom: 4, lineHeight: 18 },
  paymentVerifyBtn: {
    flexDirection: 'row', backgroundColor: '#1d4ed8', padding: 14, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginTop: 14, gap: 8,
  },
  paymentVerifyBtnDisabled: { backgroundColor: '#9ca3af' },
  paymentVerifyBtnText: { fontSize: 15, color: 'white', fontWeight: '700' },
  paymentEditLink: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: 14, fontWeight: '500' },
  optimizationBox: {
    marginTop: 8, padding: 14, backgroundColor: '#f0fdf4',
    borderRadius: 8, borderWidth: 1, borderColor: '#bbf7d0',
  },
  optimizationTitle: { fontSize: 14, fontWeight: '600', color: '#15803d', marginBottom: 8 },
  optimizationText: { fontSize: 12, color: '#15803d', lineHeight: 18 },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, backgroundColor: 'white',
    borderTopWidth: 1, borderTopColor: '#e5e7eb',
  },
  publishButton: { backgroundColor: '#22c55e', padding: 16, borderRadius: 12, alignItems: 'center' },
  publishButtonDisabled: { backgroundColor: '#9ca3af' },
  publishButtonText: { color: 'white', fontSize: 16, fontWeight: '700' },
});
