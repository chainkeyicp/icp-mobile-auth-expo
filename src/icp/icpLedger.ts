import { Actor, HttpAgent } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { Principal } from '@dfinity/principal';

import { ICP_LEDGER_CANISTER_ID } from '../config/icp';

const E8S_PER_ICP = 100_000_000n;
const ICP_DECIMALS = 8;

type IcrcAccount = {
  owner: Principal;
  subaccount: [] | [Uint8Array];
};

type TransferArg = {
  from_subaccount: [] | [Uint8Array];
  to: IcrcAccount;
  amount: bigint;
  fee: [] | [bigint];
  memo: [] | [Uint8Array];
  created_at_time: [] | [bigint];
};

type TransferError =
  | { BadFee: { expected_fee: bigint } }
  | { BadBurn: { min_burn_amount: bigint } }
  | { InsufficientFunds: { balance: bigint } }
  | { TooOld: null }
  | { CreatedInFuture: { ledger_time: bigint } }
  | { Duplicate: { duplicate_of: bigint } }
  | { TemporarilyUnavailable: null }
  | { GenericError: { error_code: bigint; message: string } };

type TransferResult = { Ok: bigint } | { Err: TransferError };

type IcpLedgerActor = {
  icrc1_balance_of: (account: IcrcAccount) => Promise<bigint>;
  icrc1_fee: () => Promise<bigint>;
  icrc1_transfer: (arg: TransferArg) => Promise<TransferResult>;
};

export interface IcpLedgerSnapshot {
  balanceE8s: bigint;
  feeE8s: bigint;
}

export interface IcpTransferRequest {
  toPrincipal: string;
  amountIcp: string;
}

export interface IcpTransferReceipt {
  blockIndex: bigint;
  amountE8s: bigint;
  feeE8s: bigint;
  toPrincipal: string;
}

export const icpLedgerIdlFactory: IDL.InterfaceFactory = ({ IDL: idl }) => {
  const Account = idl.Record({
    owner: idl.Principal,
    subaccount: idl.Opt(idl.Vec(idl.Nat8))
  });

  const TransferArg = idl.Record({
    from_subaccount: idl.Opt(idl.Vec(idl.Nat8)),
    to: Account,
    amount: idl.Nat,
    fee: idl.Opt(idl.Nat),
    memo: idl.Opt(idl.Vec(idl.Nat8)),
    created_at_time: idl.Opt(idl.Nat64)
  });

  const TransferError = idl.Variant({
    BadFee: idl.Record({ expected_fee: idl.Nat }),
    BadBurn: idl.Record({ min_burn_amount: idl.Nat }),
    InsufficientFunds: idl.Record({ balance: idl.Nat }),
    TooOld: idl.Null,
    CreatedInFuture: idl.Record({ ledger_time: idl.Nat64 }),
    Duplicate: idl.Record({ duplicate_of: idl.Nat }),
    TemporarilyUnavailable: idl.Null,
    GenericError: idl.Record({
      error_code: idl.Nat,
      message: idl.Text
    })
  });

  return idl.Service({
    icrc1_balance_of: idl.Func([Account], [idl.Nat], ['query']),
    icrc1_fee: idl.Func([], [idl.Nat], ['query']),
    icrc1_transfer: idl.Func(
      [TransferArg],
      [idl.Variant({ Ok: idl.Nat, Err: TransferError })],
      []
    )
  });
};

export function createIcpLedgerActor(agent: HttpAgent): IcpLedgerActor {
  return Actor.createActor<IcpLedgerActor>(icpLedgerIdlFactory, {
    agent,
    canisterId: ICP_LEDGER_CANISTER_ID
  });
}

export async function getIcpLedgerSnapshot(
  agent: HttpAgent,
  principalText: string
): Promise<IcpLedgerSnapshot> {
  const actor = createIcpLedgerActor(agent);
  const account = principalToDefaultAccount(principalText);

  const [balanceE8s, feeE8s] = await Promise.all([
    actor.icrc1_balance_of(account),
    actor.icrc1_fee()
  ]);

  return { balanceE8s, feeE8s };
}

export async function sendIcp(
  agent: HttpAgent,
  request: IcpTransferRequest
): Promise<IcpTransferReceipt> {
  const actor = createIcpLedgerActor(agent);
  const toPrincipal = Principal.fromText(request.toPrincipal.trim());
  const amountE8s = parseIcpToE8s(request.amountIcp);
  const feeE8s = await actor.icrc1_fee();

  if (amountE8s <= 0n) {
    throw new Error('Amount must be greater than 0 ICP.');
  }

  // Real ICP mainnet transfer through the ICP Ledger canister. The caller is
  // the authenticated DelegationIdentity, and the destination is the default
  // ICRC-1 account of the recipient principal.
  const result = await actor.icrc1_transfer({
    from_subaccount: [],
    to: {
      owner: toPrincipal,
      subaccount: []
    },
    amount: amountE8s,
    fee: [feeE8s],
    memo: [],
    created_at_time: [BigInt(Date.now()) * 1_000_000n]
  });

  if ('Err' in result) {
    throw new Error(formatTransferError(result.Err));
  }

  return {
    blockIndex: result.Ok,
    amountE8s,
    feeE8s,
    toPrincipal: toPrincipal.toText()
  };
}

export function principalToDefaultAccount(principalText: string): IcrcAccount {
  return {
    owner: Principal.fromText(principalText),
    subaccount: []
  };
}

export function formatIcp(e8s: bigint): string {
  const sign = e8s < 0n ? '-' : '';
  const value = e8s < 0n ? -e8s : e8s;
  const whole = value / E8S_PER_ICP;
  const fraction = (value % E8S_PER_ICP).toString().padStart(ICP_DECIMALS, '0');
  return `${sign}${whole}.${fraction.replace(/0+$/, '') || '0'}`;
}

export function parseIcpToE8s(input: string): bigint {
  const trimmed = input.trim().replace(',', '.');

  if (!/^\d+(\.\d{0,8})?$/.test(trimmed)) {
    throw new Error('Enter a valid ICP amount with up to 8 decimal places.');
  }

  const [wholePart, fractionPart = ''] = trimmed.split('.');
  const whole = BigInt(wholePart || '0');
  const fraction = BigInt(fractionPart.padEnd(ICP_DECIMALS, '0'));
  return whole * E8S_PER_ICP + fraction;
}

function formatTransferError(error: TransferError): string {
  if ('BadFee' in error) {
    return `Bad fee. Expected ${formatIcp(error.BadFee.expected_fee)} ICP.`;
  }

  if ('BadBurn' in error) {
    return `Bad burn amount. Minimum is ${formatIcp(error.BadBurn.min_burn_amount)} ICP.`;
  }

  if ('InsufficientFunds' in error) {
    return `Insufficient funds. Balance is ${formatIcp(error.InsufficientFunds.balance)} ICP.`;
  }

  if ('TooOld' in error) {
    return 'The transaction is too old. Try again.';
  }

  if ('CreatedInFuture' in error) {
    return 'The transaction timestamp is in the future. Check device time and try again.';
  }

  if ('Duplicate' in error) {
    return `Duplicate transaction. Original block index ${error.Duplicate.duplicate_of.toString()}.`;
  }

  if ('TemporarilyUnavailable' in error) {
    return 'The ICP Ledger is temporarily unavailable. Try again.';
  }

  return `Ledger error ${error.GenericError.error_code.toString()}: ${error.GenericError.message}`;
}
