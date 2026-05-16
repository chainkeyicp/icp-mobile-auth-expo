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
import {
  createAuthenticatedAgent,
  enableDeviceLogin,
  forgetDeviceLogin,
  hasStoredDeviceLogin,
  loginWithIcp,
  logout,
  restoreDeviceSession,
  restoreSession,
  type AuthSession
} from '../auth/icpAuthService';
import { callSampleCanister } from '../icp/sampleActor';
import { whoamiOnAuthCanister, type DeviceLoginInfo } from '../icp/mobileAuthCanister';
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
  const [deviceLogin, setDeviceLogin] = useState<DeviceLoginInfo | null>(null);
  const [deviceLoginAvailable, setDeviceLoginAvailable] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<string | null>(null);

  const expirationLabel = useMemo(() => {
    if (!session?.expirationMs) {
      return null;
    }

    return new Date(session.expirationMs).toLocaleString();
  }, [session]);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const restored = await restoreSession();
        if (!mounted) {
          return;
        }

        setSession(restored);
        if (restored) {
          const deviceMeta = await hasStoredDeviceLogin();
          if (!mounted) {
            return;
          }
          setDeviceLoginAvailable(Boolean(deviceMeta));
          setStatus('Authenticated');
          setCheckingSession(false);
          if (deviceMeta) {
            setDeviceStatus('Device login is available on this phone.');
          } else {
            void handleEnableDeviceLogin(restored);
          }
          void refreshLedger(restored);
          return;
        }

        const deviceMeta = await hasStoredDeviceLogin();
        if (!mounted) {
          return;
        }

        setDeviceLoginAvailable(Boolean(deviceMeta));
        if (deviceMeta) {
          setStatus('Unlocking device login...');
          let restoredDevice: AuthSession | null = null;
          try {
            restoredDevice = await restoreDeviceSession();
          } catch (reason) {
            if (!mounted) {
              return;
            }
            setError(reason instanceof Error ? reason.message : String(reason));
            setStatus('Device unlock cancelled');
            setCheckingSession(false);
            return;
          }

          if (!mounted) {
            return;
          }

          if (restoredDevice) {
            setSession(restoredDevice);
            setDeviceLogin(restoredDevice.device ?? null);
            setDeviceStatus('Unlocked with this phone. Internet Identity was not opened.');
            setStatus('Device authenticated');
            setCheckingSession(false);
            return;
          }

          setStatus('Device login unavailable');
          setCheckingSession(false);
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
      } catch (reason) {
        if (!mounted) {
          return;
        }
        setError(reason instanceof Error ? reason.message : String(reason));
        setStatus('Not authenticated');
        setCheckingSession(false);
      }
    }

    void bootstrap();

    return () => {
      mounted = false;
    };
  }, []);

  async function refreshLedger(nextSession = session) {
    if (!nextSession || nextSession.kind !== 'delegation') {
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
      await handleEnableDeviceLogin(nextSession);
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

  async function handleCallAuthCanister() {
    if (!session) {
      return;
    }

    setBusy(true);
    setError(null);
    setCanisterResult(null);

    try {
      const agent = await createAuthenticatedAgent(session.identity);
      const principal = await whoamiOnAuthCanister(agent);
      setCanisterResult(`mobile_auth whoami: ${principal}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlockDeviceLogin() {
    setBusy(true);
    setError(null);
    setStatus('Unlocking device login...');

    try {
      const restoredDevice = await restoreDeviceSession();
      if (!restoredDevice) {
        throw new Error('This phone is not registered or the device login was revoked.');
      }

      setSession(restoredDevice);
      setDeviceLogin(restoredDevice.device ?? null);
      setDeviceLoginAvailable(true);
      setDeviceStatus('Unlocked with this phone. Internet Identity was not opened.');
      setStatus('Device authenticated');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus('Device unlock failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleEnableDeviceLogin(nextSession = session) {
    if (!nextSession || nextSession.kind !== 'delegation') {
      return;
    }

    try {
      const device = await enableDeviceLogin(nextSession, 'This phone');
      setDeviceLogin(device);
      setDeviceLoginAvailable(true);
      setDeviceStatus('Device login enabled for this phone.');
    } catch (reason) {
      setDeviceStatus(
        `Device login setup failed: ${reason instanceof Error ? reason.message : String(reason)}`
      );
    }
  }

  async function handleForgetDeviceLogin() {
    setBusy(true);
    setError(null);

    try {
      await forgetDeviceLogin(session);
      setDeviceLogin(null);
      setDeviceLoginAvailable(false);
      setDeviceStatus('Device login removed from this phone.');
      if (session?.kind === 'device') {
        setSession(null);
        setStatus('Not authenticated');
      }
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
      setCanisterResult(null);
      setStatus('Not authenticated');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  function confirmSendIcp() {
    if (!session || session.kind !== 'delegation') {
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
    if (!session || session.kind !== 'delegation') {
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
              <Text style={styles.label}>Session type</Text>
              <Text style={styles.value}>
                {session.kind === 'delegation' ? 'Internet Identity delegation' : 'Device login'}
              </Text>

              <Text style={styles.label}>Principal</Text>
              <Text selectable style={styles.value}>
                {session.principal}
              </Text>

              <Text style={styles.label}>Current caller</Text>
              <Text selectable style={styles.value}>
                {session.callerPrincipal}
              </Text>

              {session.kind === 'delegation' ? (
                <>
                  <Text style={styles.label}>Delegation expiration</Text>
                  <Text style={styles.value}>{expirationLabel}</Text>
                </>
              ) : (
                <Text style={styles.helpText}>
                  This phone is recognized by the auth canister. Internet Identity was not opened for this session.
                </Text>
              )}

              {deviceLogin || session.device ? (
                <>
                  <Text style={styles.label}>Registered device</Text>
                  <Text selectable style={styles.value}>
                    {(deviceLogin ?? session.device)?.devicePrincipal}
                  </Text>
                </>
              ) : null}

              {deviceStatus ? <Text style={styles.helpText}>{deviceStatus}</Text> : null}

              <View style={styles.buttonGroup}>
                <Button title="Call auth canister" onPress={handleCallAuthCanister} disabled={busy} />
                <Button title="Call sample canister" onPress={handleCallCanister} disabled={busy || !SAMPLE_CANISTER_ID} />
                {session.kind === 'delegation' ? (
                  <Button title="Enable device login" onPress={() => handleEnableDeviceLogin()} disabled={busy} />
                ) : (
                  <Button title="Login with Internet Identity" onPress={handleLogin} disabled={busy || !AUTH_FRONTEND_URL} />
                )}
                {deviceLoginAvailable || session.device ? (
                  <Button title="Forget this device" onPress={handleForgetDeviceLogin} disabled={busy} />
                ) : null}
                <Button title="Logout" onPress={handleLogout} disabled={busy} />
              </View>
            </View>

            {session.kind === 'delegation' ? (
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
            ) : (
              <View style={styles.panel}>
                <Text style={styles.sectionTitle}>ICP Ledger</Text>
                <Text style={styles.helpText}>
                  Device login can identify this phone to your own canister, but it cannot spend ICP from the Internet
                  Identity principal. Use Internet Identity when you want real Ledger transfers.
                </Text>
                <Button title="Login with Internet Identity" onPress={handleLogin} disabled={busy || !AUTH_FRONTEND_URL} />
              </View>
            )}
          </>
        ) : (
          <View style={styles.buttonGroup}>
            {deviceLoginAvailable ? (
              <Button title="Unlock device login" onPress={handleUnlockDeviceLogin} disabled={busy} />
            ) : null}
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
