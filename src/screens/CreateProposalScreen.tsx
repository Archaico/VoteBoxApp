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
} from 'react-native';
import { blockchainService, FeeEstimate } from '../services/BlockchainService';
import { shareService } from '../services/ShareService';
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

const FOUNDATION_FEE_PERCENTAGE = 0.25;
const ADA_TO_USD_RATE = 0.35;

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
    playStoreUrl: 'https://play.google.com/store/apps/details?id=io.lacewallet',
    accentColor: '#0e7490',
    accentBg: '#ecfeff',
  },
];

type WalletFlowState = 'select' | 'no-wallet-guide' | 'manual-entry' | 'connected';

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
  const [feeEstimate, setFeeEstimate] = useState<{
    creation: FeeEstimate;
    voting: FeeEstimate;
    gasCosts: number;
    foundationFee: number;
    total: number;
  } | null>(null);
  const [isEstimatingFee, setIsEstimatingFee] = useState(false);

  // Wallet connection flow state
  const [walletFlow, setWalletFlow] = useState<WalletFlowState>('select');
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [showManualAfterWallet, setShowManualAfterWallet] = useState(false);

  // ─── Wallet Flow Handlers ────────────────────────────────────────────

  const handleWalletSelect = async (wallet: typeof CARDANO_WALLETS[0]) => {
    setSelectedWallet(wallet.id);
    Alert.alert(
      `Open ${wallet.name}?`,
      `This will open the ${wallet.name} wallet app (or take you to download it).\n\nAfter connecting, copy your Cardano address (starts with addr1...) and come back here to paste it.`,
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
    if (!cleaned.startsWith('addr1') || cleaned.length < 50) {
      Alert.alert(
        'Invalid Address',
        'Please enter a valid Cardano address. It should start with "addr1" and be at least 50 characters long.'
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

  const handleEstimateFee = async () => {
    if (!title.trim() || !description.trim() || !walletAddress.trim()) {
      Alert.alert('Missing Information', 'Please fill in all required fields first, including your wallet address');
      return;
    }
    if (expectedVoters < 2) {
      Alert.alert('Invalid Voter Count', 'Minimum expected voters is 2');
      return;
    }

    setIsEstimatingFee(true);
    try {
      const minFeeA = 44;
      const minFeeB = 155381;
      const proposalMetadataSize = 500;
      const creationFee = minFeeB + (proposalMetadataSize * minFeeA);
      const batchCount = Math.ceil(expectedVoters / 100);
      const batchMetadataSize = 300;
      const votingFeePerBatch = minFeeB + (batchMetadataSize * minFeeA);
      const totalVotingCost = batchCount * votingFeePerBatch;
      const totalGasCosts = creationFee + totalVotingCost;
      const foundationFee = Math.floor(totalGasCosts * FOUNDATION_FEE_PERCENTAGE);
      const grandTotal = totalGasCosts + foundationFee;

      setFeeEstimate({
        creation: {
          fee: creationFee.toString(),
          total: creationFee.toString(),
          breakdown: {
            basicFee: minFeeB.toString(),
            metadataFee: (proposalMetadataSize * minFeeA).toString(),
          },
        },
        voting: {
          fee: totalVotingCost.toString(),
          total: totalVotingCost.toString(),
          breakdown: {
            basicFee: (minFeeB * batchCount).toString(),
            metadataFee: (batchMetadataSize * minFeeA * batchCount).toString(),
          },
        },
        gasCosts: totalGasCosts,
        foundationFee,
        total: grandTotal,
      });

      const creationADA = (creationFee / 1000000).toFixed(2);
      const votingADA = (totalVotingCost / 1000000).toFixed(2);
      const gasADA = (totalGasCosts / 1000000).toFixed(2);
      const foundationADA = (foundationFee / 1000000).toFixed(2);
      const totalADA = (grandTotal / 1000000).toFixed(2);
      const totalUSD = (parseFloat(totalADA) * ADA_TO_USD_RATE).toFixed(2);
      const batchWord = batchCount > 1 ? 'batches' : 'batch';

      const message = [
        'Expected voters: ' + expectedVoters.toLocaleString(),
        '',
        'Proposal creation: ' + creationADA + ' ADA',
        'Voting (' + batchCount + ' ' + batchWord + '): ' + votingADA + ' ADA',
        '---',
        'Gas costs: ' + gasADA + ' ADA',
        'Foundation fee (25%): ' + foundationADA + ' ADA',
        '---',
        'TOTAL: ' + totalADA + ' ADA (~$' + totalUSD + ' USD)',
        '',
        'Foundation fee supports VoteBox open-source development.',
        'Voting is FREE for all participants!',
      ].join('\n');

      Alert.alert('Complete Fee Breakdown', message, [{ text: 'OK' }]);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      Alert.alert('Estimation Failed', 'Error: ' + errorMsg);
    } finally {
      setIsEstimatingFee(false);
    }
  };

  const handlePublish = async () => {
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
      });

      setUploadStatus('Recording on blockchain...');

      if (!result || !result.cid || !result.txHash) {
        throw new Error('Incomplete response from blockchain service');
      }

      const minFeeA = 44;
      const minFeeB = 155381;
      const proposalMetadataSize = 500;
      const gasCost = minFeeB + (proposalMetadataSize * minFeeA);
      const foundationFee = Math.floor(gasCost * FOUNDATION_FEE_PERCENTAGE);
      const totalCost = gasCost + foundationFee;
      const totalADA = (totalCost / 1000000).toFixed(2);
      const totalUSD = (parseFloat(totalADA) * ADA_TO_USD_RATE).toFixed(2);
      const batchCount = Math.ceil(expectedVoters / 100);
      const batchWord = batchCount > 1 ? 'batches' : 'batch';

      setIsSubmitting(false);
      setUploadStatus('');

      const successMessage = [
        'Your proposal is now live!',
        '',
        'IPFS: ' + result.cid.slice(0, 20) + '...',
        'TX: ' + result.txHash.slice(0, 20) + '...',
        'Total: ' + totalADA + ' ADA (~$' + totalUSD + ' USD)',
        '   (includes 25% foundation fee)',
        '',
        'Configured for ' + expectedVoters.toLocaleString() + ' voters',
        'Gas-optimized with ' + batchCount + ' ' + batchWord,
        '',
        'Voting is FREE for all participants!',
      ].join('\n');

      Alert.alert('🎉 Proposal Published!', successMessage, [
        {
          text: '📢 Invite Voters',
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
          text: 'View Proposals',
          onPress: onProposalCreated,
          style: 'cancel',
        },
      ]);
    } catch (error) {
      setIsSubmitting(false);
      setUploadStatus('');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert(
        'Publication Failed',
        errorMessage + '\n\nCheck console for detailed logs.',
        [{ text: 'OK' }]
      );
    }
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
                👋 Welcome back! Open your wallet app, copy your address (addr1...), and paste it below.
              </Text>
            </View>
          )}
          <Text style={styles.label}>Your Cardano Address</Text>
          <TextInput
            style={styles.walletManualInput}
            placeholder="addr1..."
            placeholderTextColor="#9ca3af"
            value={manualAddressInput}
            onChangeText={setManualAddressInput}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={true}
            multiline={false}
          />
          <Text style={styles.helperText}>
            Starts with "addr1" · Found in your wallet under "Receive" or "Address"
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
        <View style={styles.placeholder} />
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
              editable={!isSubmitting}
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
                  disabled={isSubmitting}
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
              editable={!isSubmitting}
            />
            <Text style={styles.helperText}>
              Selected: {expectedVoters.toLocaleString()} voters
            </Text>
          </View>

          {/* ── FEE ESTIMATOR ── */}
          <TouchableOpacity
            style={[styles.estimateButton, isEstimatingFee && styles.estimateButtonLoading]}
            onPress={handleEstimateFee}
            disabled={isSubmitting || isEstimatingFee}
          >
            {isEstimatingFee ? (
              <>
                <ActivityIndicator size="small" color="#15803d" />
                <Text style={styles.estimateButtonText}>Calculating...</Text>
              </>
            ) : (
              <Text style={styles.estimateButtonText}>Calculate Total Cost</Text>
            )}
          </TouchableOpacity>

          {/* ── FEE BREAKDOWN ── */}
          {feeEstimate && (
            <View style={styles.feeBox}>
              <Text style={styles.feeTitle}>Total Cost Breakdown</Text>
              <Text style={styles.feeAmount}>
                {(feeEstimate.total / 1000000).toFixed(2)} ADA
              </Text>
              <Text style={styles.feeAmountUSD}>
                (${((feeEstimate.total / 1000000) * ADA_TO_USD_RATE).toFixed(2)} USD)
              </Text>
              <View style={styles.feeBreakdownContainer}>
                <View style={styles.feeBreakdownRow}>
                  <Text style={styles.feeBreakdownLabel}>Gas costs:</Text>
                  <Text style={styles.feeBreakdownValue}>
                    {(feeEstimate.gasCosts / 1000000).toFixed(2)} ADA
                  </Text>
                </View>
                <View style={[styles.feeBreakdownRow, { paddingTop: 8, borderTopWidth: 1, borderTopColor: '#fde047' }]}>
                  <Text style={styles.feeBreakdownLabel}>Foundation fee (25%):</Text>
                  <Text style={styles.feeBreakdownValue}>
                    {(feeEstimate.foundationFee / 1000000).toFixed(2)} ADA
                  </Text>
                </View>
                <View style={[styles.feeBreakdownRow, { marginTop: 8, paddingTop: 8, borderTopWidth: 2, borderTopColor: '#fbbf24' }]}>
                  <Text style={[styles.feeBreakdownLabel, { fontWeight: 'bold' }]}>Total:</Text>
                  <Text style={[styles.feeBreakdownValue, { fontWeight: 'bold', fontSize: 14 }]}>
                    {(feeEstimate.total / 1000000).toFixed(2)} ADA
                  </Text>
                </View>
              </View>
              <View style={styles.foundationInfoBox}>
                <Text style={styles.foundationInfoText}>
                  Foundation fee supports VoteBox open-source development
                </Text>
              </View>
            </View>
          )}

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
      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.publishButton,
            (isSubmitting || walletFlow !== 'connected') && styles.publishButtonDisabled,
          ]}
          onPress={handlePublish}
          disabled={isSubmitting || walletFlow !== 'connected'}
        >
          <Text style={styles.publishButtonText}>
            {isSubmitting
              ? 'Publishing...'
              : walletFlow !== 'connected'
              ? 'Connect Wallet to Publish'
              : 'Publish Proposal'}
          </Text>
        </TouchableOpacity>
      </View>
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

  // ── Wallet Select State ──
  walletSectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 4 },
  walletSectionSubtitle: { fontSize: 12, color: '#6b7280', marginBottom: 16, lineHeight: 18 },
  walletOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    marginBottom: 10,
    backgroundColor: 'white',
  },
  walletOptionLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  walletOptionEmoji: { fontSize: 24, marginRight: 12 },
  walletOptionInfo: { flex: 1 },
  walletOptionNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' },
  walletOptionName: { fontSize: 16, fontWeight: '700', color: '#111827' },
  walletBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  walletBadgeText: { fontSize: 9, fontWeight: '800', color: 'white', letterSpacing: 0.5 },
  walletOptionDesc: { fontSize: 12, color: '#6b7280', lineHeight: 17 },
  walletOptionArrow: { fontSize: 24, fontWeight: '300', marginLeft: 8 },
  walletDivider: { flexDirection: 'row', alignItems: 'center', marginVertical: 16, gap: 10 },
  walletDividerLine: { flex: 1, height: 1, backgroundColor: '#e5e7eb' },
  walletDividerText: { fontSize: 13, color: '#9ca3af' },
  walletSecondaryBtn: {
    padding: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
    alignItems: 'center',
  },
  walletSecondaryText: { fontSize: 14, color: '#374151', fontWeight: '500' },
  walletFutureNote: {
    marginTop: 14,
    padding: 10,
    backgroundColor: '#f0f9ff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  walletFutureText: { fontSize: 11, color: '#0369a1', textAlign: 'center', lineHeight: 16 },

  // ── Wallet Connected State ──
  walletConnectedBox: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f0fdf4',
    borderWidth: 2,
    borderColor: '#22c55e',
  },
  walletConnectedHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  walletConnectedDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#22c55e', marginRight: 8,
  },
  walletConnectedLabel: { fontSize: 13, fontWeight: '700', color: '#15803d' },
  walletConnectedAddress: {
    fontSize: 15, fontWeight: '600', color: '#111827',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 12,
  },
  walletDisconnectBtn: { alignSelf: 'flex-start' },
  walletDisconnectText: { fontSize: 13, color: '#ef4444', fontWeight: '500' },

  // ── Manual Entry State ──
  walletManualContainer: {},
  walletReturnHint: {
    backgroundColor: '#fefce8',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fde047',
    marginBottom: 16,
  },
  walletReturnHintText: { fontSize: 13, color: '#713f12', lineHeight: 20 },
  walletManualInput: {
    backgroundColor: '#f9fafb',
    borderWidth: 2,
    borderColor: '#22c55e',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 4,
  },
  walletManualButtons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  walletManualBack: {
    flex: 1, padding: 12, borderRadius: 8,
    borderWidth: 1, borderColor: '#e5e7eb',
    alignItems: 'center',
  },
  walletManualBackText: { fontSize: 14, color: '#6b7280', fontWeight: '500' },
  walletManualConfirm: {
    flex: 2, padding: 12, borderRadius: 8,
    backgroundColor: '#22c55e', alignItems: 'center',
  },
  walletManualConfirmDisabled: { backgroundColor: '#d1d5db' },
  walletManualConfirmText: { fontSize: 14, color: 'white', fontWeight: '700' },

  // ── No Wallet Guide State ──
  noWalletGuide: {
    backgroundColor: '#fafafa',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 16,
  },
  noWalletGuideTitle: {
    fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 10,
  },
  noWalletGuideBody: {
    fontSize: 13, color: '#4b5563', lineHeight: 20, marginBottom: 16,
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
    padding: 14, borderRadius: 10,
    alignItems: 'center', marginTop: 6, marginBottom: 12,
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
