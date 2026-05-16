import { DelegationChain } from '@dfinity/identity';

export type JsonDelegationChain = ReturnType<DelegationChain['toJSON']>;

const NANOS_PER_MILLI = BigInt(1_000_000);

export function chainFromJson(json: JsonDelegationChain | string): DelegationChain {
  return DelegationChain.fromJSON(typeof json === 'string' ? json : JSON.stringify(json));
}

export function normalizeDelegationJson(value: unknown): JsonDelegationChain {
  if (typeof value === 'string') {
    return JSON.parse(value) as JsonDelegationChain;
  }

  return value as JsonDelegationChain;
}

export function getDelegationExpirationMs(chainJson: JsonDelegationChain): number {
  const expirations = chainJson.delegations.map(({ delegation }) =>
    bigintTimestampToMillis(delegation.expiration)
  );

  if (expirations.length === 0) {
    throw new Error('Delegation chain did not contain any delegations.');
  }

  return Math.min(...expirations);
}

export function isDelegationExpired(expirationMs: number, skewMs = 60_000): boolean {
  return expirationMs <= Date.now() + skewMs;
}

function bigintTimestampToMillis(value: string | number | bigint): number {
  const timestamp =
    typeof value === 'bigint'
      ? value
      : typeof value === 'string'
        ? BigInt(value.startsWith('0x') ? value : `0x${value}`)
        : BigInt(value);
  return Number(timestamp / NANOS_PER_MILLI);
}
