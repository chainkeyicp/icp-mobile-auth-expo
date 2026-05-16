import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';

import { AUTH_FRONTEND_URL, SAMPLE_CANISTER_ID } from '../config/icp';
import { createAuthenticatedAgent, loginWithIcp, logout, restoreSession, type AuthSession } from '../auth/icpAuthService';
import { callSampleCanister } from '../icp/sampleActor';
import {
  formatIcp,
  getIcpLedgerSnapshot,
  sendIcp,
  type IcpLedgerSnapshot,
  type IcpTransferReceipt
} from '../icp/icpLedger';

export function LoginScreen() {
  const autoLoginAttemptedRef = useRef(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const [status, setStatus] = useState('Not authenticated');
  const [error, setError] = useState<string | null>(null);
  const [canisterResult, setCanisterResult] = useState<string | null>(null);
  const [ledgerSnapshot, setLedgerSnapshot] = useState<IcpLedgerSnapshot | null>(null);
  const [recipientPrincipal, setRecipientPrincipal] = useState('');
  const [amountIcp, setAmountIcp] = useState('');
  const [transferReceipt, setTransferReceipt] = useState<IcpTransferReceipt | null>(null);

  const expirationLabel = useMemo(() => {
    if (!session) {
      return null;
    }

    return new Date(session.expirationMs).toLocaleString();
  }, [session]);

  useEffect(() => {
    let mounted = true;

    restoreSession()
      .then(restored => {
        if (!mounted) {
          return;
        }
        setSession(restored);
        if (restored) {
          setStatus('Authenticated');
          setCheckingSession(false);
          void refreshLedger(restored);
          return;
        }

        if (AUTH_FRONTEND_URL && !autoLoginAttemptedRef.current) {
          autoLoginAttemptedRef.current = true;
          setStatus('Opening Internet Identity...');
          setCheckingSession(false);
          void handleLogin();
          return;
        }

        setStatus('Not authenticated');
        setCheckingSession(false);
      })
      .catch(reason => {
        if (!mounted) {
          return;
        }
        setError(reason instanceof Error ? reason.message : String(reason));
        setStatus('Not authenticated');
        setCheckingSession(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function refreshLedger(nextSession = session) {
    if (!nextSession) {
      return;
    }

    setLedgerBusy(true);
    setError(null);

    try {
      const agent = await createAuthenticatedAgent(nextSession.identity);
      const snapshot = await getIcpLedgerSnapshot(agent, nextSession.principal);
      setLedgerSnapshot(snapshot);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLedgerBusy(false);
    }
  }

  async function handleLogin() {
    setCheckingSession(false);
    setBusy(true);
    setError(null);
    setCanisterResult(null);
    setStatus('Opening Internet Identity...');

    try {
      const nextSession = await loginWithIcp('ii');
      setSession(nextSession);
      setStatus('Authenticated');
      await refreshLedger(nextSession);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus('Not authenticated');
    } finally {
      setBusy(false);
    }
  }

  async function handleCallCanister() {
    if (!session) {
      return;
    }

    setBusy(true);
    setError(null);
    setCanisterResult(null);

    try {
      const agent = await createAuthenticatedAgent(session.identity);
      const result = await callSampleCanister(agent);
      setCanisterResult(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    setError(null);
    setCanisterResult(null);

    try {
      await logout();
      setSession(null);
      setLedgerSnapshot(null);
      setStatus('Not authenticated');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  function confirmSendIcp() {
    if (!session) {
      return;
    }

    const trimmedRecipient = recipientPrincipal.trim();
    const trimmedAmount = amountIcp.trim();

    if (!trimmedRecipient || !trimmedAmount) {
      setError('Enter recipient principal and ICP amount before sending.');
      return;
    }

    const feeLabel = ledgerSnapshot ? `${formatIcp(ledgerSnapshot.feeE8s)} ICP` : 'the current ledger fee';

    Alert.alert(
      'Send real ICP?',
      `This will submit a real ICP Ledger transaction.\n\nAmount: ${trimmedAmount} ICP\nFee: ${feeLabel}\nTo: ${trimmedRecipient}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send ICP',
          style: 'destructive',
          onPress: () => {
            void handleSendIcp(trimmedRecipient, trimmedAmount);
          }
        }
      ]
    );
  }

  async function handleSendIcp(trimmedRecipient: string, trimmedAmount: string) {
    if (!session) {
      return;
    }

    setLedgerBusy(true);
    setError(null);
    setTransferReceipt(null);

    try {
      const agent = await createAuthenticatedAgent(session.identity);
      const receipt = await sendIcp(agent, {
        toPrincipal: trimmedRecipient,
        amountIcp: trimmedAmount
      });
      setTransferReceipt(receipt);
      setAmountIcp('');
      setRecipientPrincipal('');
      await refreshLedger(session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLedgerBusy(false);
    }
  }

  if (checkingSession) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>ICP Mobile Auth</Text>
          <Text style={styles.status}>{status}</Text>
        </View>

        {!AUTH_FRONTEND_URL ? (
          <Text style={styles.warning}>Set EXPO_PUBLIC_AUTH_FRONTEND_URL before login.</Text>
        ) : null}

        {session ? (
          <>
            <View style={styles.panel}>
              <Text style={styles.label}>Principal</Text>
              <Text selectable style={styles.value}>
                {session.principal}
              </Text>

              <Text style={styles.label}>Delegation expiration</Text>
              <Text style={styles.value}>{expirationLabel}</Text>

              <View style={styles.buttonGroup}>
                <Button title="Call canister" onPress={handleCallCanister} disabled={busy || !SAMPLE_CANISTER_ID} />
                <Button title="Logout" onPress={handleLogout} disabled={busy} />
              </View>
            </View>

            <View style={styles.panel}>
              <Text style={styles.sectionTitle}>ICP Ledger</Text>
              <Text style={styles.label}>Receive ICP</Text>
              <Text style={styles.helpText}>Send ICP to this ICRC-1 account owner principal.</Text>
              <Text selectable style={styles.value}>
                {session.principal}
              </Text>

              <View style={styles.row}>
                <View style={styles.rowItem}>
                  <Text style={styles.label}>Balance</Text>
                  <Text style={styles.value}>
                    {ledgerSnapshot ? `${formatIcp(ledgerSnapshot.balanceE8s)} ICP` : 'Not loaded'}
                  </Text>
                </View>
                <View style={styles.rowItem}>
                  <Text style={styles.label}>Fee</Text>
                  <Text style={styles.value}>
                    {ledgerSnapshot ? `${formatIcp(ledgerSnapshot.feeE8s)} ICP` : 'Not loaded'}
                  </Text>
                </View>
              </View>

              <Button title="Refresh balance" onPress={() => refreshLedger()} disabled={ledgerBusy} />

              <Text style={styles.label}>Recipient principal</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                editable={!ledgerBusy}
                multiline
                onChangeText={setRecipientPrincipal}
                placeholder="aaaaa-aa..."
                style={styles.input}
                value={recipientPrincipal}
              />

              <Text style={styles.label}>Amount ICP</Text>
              <TextInput
                editable={!ledgerBusy}
                keyboardType="decimal-pad"
                onChangeText={setAmountIcp}
                placeholder="0.001"
                style={styles.input}
                value={amountIcp}
              />

              <Text style={styles.warningText}>
                Sends real mainnet ICP through the ICP Ledger canister. Check the recipient carefully.
              </Text>

              <Button
                title="Send ICP"
                onPress={confirmSendIcp}
                disabled={ledgerBusy || !recipientPrincipal.trim() || !amountIcp.trim()}
              />
            </View>
          </>
        ) : (
          <View style={styles.buttonGroup}>
            <Button title="Login with Internet Identity" onPress={handleLogin} disabled={busy || !AUTH_FRONTEND_URL} />
            {/* TODO: Add NFID once its mobile delegation protocol is implemented for the hosted auth page. */}
          </View>
        )}

        {busy ? <ActivityIndicator style={styles.spinner} /> : null}

        {canisterResult ? (
          <View style={styles.resultPanel}>
            <Text style={styles.label}>Canister response</Text>
            <Text selectable style={styles.value}>
              {canisterResult}
            </Text>
          </View>
        ) : null}

        {transferReceipt ? (
          <View style={styles.resultPanel}>
            <Text style={styles.label}>Transfer sent</Text>
            <Text selectable style={styles.value}>
              Block {transferReceipt.blockIndex.toString()}
            </Text>
            <Text style={styles.value}>
              {formatIcp(transferReceipt.amountE8s)} ICP + {formatIcp(transferReceipt.feeE8s)} ICP fee
            </Text>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f7f7f4'
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#f7f7f4'
  },
  container: {
    flexGrow: 1,
    padding: 24,
    gap: 18,
    justifyContent: 'center'
  },
  header: {
    gap: 8
  },
  title: {
    color: '#151515',
    fontSize: 30,
    fontWeight: '700'
  },
  status: {
    color: '#494949',
    fontSize: 18
  },
  panel: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 18,
    gap: 10,
    borderColor: '#deded8',
    borderWidth: 1
  },
  resultPanel: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 18,
    gap: 10,
    borderColor: '#d6e0d4',
    borderWidth: 1
  },
  label: {
    color: '#62625c',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  sectionTitle: {
    color: '#151515',
    fontSize: 20,
    fontWeight: '700'
  },
  value: {
    color: '#171717',
    fontSize: 15,
    lineHeight: 22
  },
  helpText: {
    color: '#62625c',
    fontSize: 14,
    lineHeight: 20
  },
  warningText: {
    color: '#7a4d00',
    fontSize: 14,
    lineHeight: 20
  },
  row: {
    flexDirection: 'row',
    gap: 12
  },
  rowItem: {
    flex: 1,
    gap: 4
  },
  input: {
    minHeight: 48,
    borderColor: '#cfcfca',
    borderRadius: 8,
    borderWidth: 1,
    color: '#171717',
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#ffffff'
  },
  buttonGroup: {
    gap: 12,
    marginTop: 8
  },
  spinner: {
    marginTop: 8
  },
  warning: {
    color: '#7a4d00',
    backgroundColor: '#fff2cc',
    borderColor: '#e2c46f',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12
  },
  error: {
    color: '#8a1f1f',
    backgroundColor: '#fde8e8',
    borderColor: '#efb8b8',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12
  }
});
