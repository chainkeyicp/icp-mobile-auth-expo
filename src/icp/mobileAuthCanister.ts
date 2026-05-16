import { Actor, HttpAgent } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { Principal } from '@dfinity/principal';

import { MOBILE_AUTH_CANISTER_ID } from '../config/icp';

type Optional<T> = [] | [T];

export interface DeviceRecord {
  owner: Principal;
  device: Principal;
  device_name: string;
  created_at: bigint;
  last_seen_at: Optional<bigint>;
  revoked: boolean;
}

export interface DeviceLoginInfo {
  ownerPrincipal: string;
  devicePrincipal: string;
  label: string;
  createdAtMs: number;
  lastSeenAtMs: number | null;
  revoked: boolean;
}

type MobileAuthActor = {
  device_login: () => Promise<Optional<DeviceRecord>>;
  my_devices: () => Promise<DeviceRecord[]>;
  register_device: (device: Principal, label: string) => Promise<Optional<DeviceRecord>>;
  revoke_device: (device: Principal) => Promise<boolean>;
  whoami: () => Promise<Principal>;
};

export const mobileAuthIdlFactory: IDL.InterfaceFactory = ({ IDL: idl }) => {
  const DeviceRecord = idl.Record({
    owner: idl.Principal,
    device: idl.Principal,
    device_name: idl.Text,
    created_at: idl.Int,
    last_seen_at: idl.Opt(idl.Int),
    revoked: idl.Bool
  });

  return idl.Service({
    device_login: idl.Func([], [idl.Opt(DeviceRecord)], []),
    my_devices: idl.Func([], [idl.Vec(DeviceRecord)], ['query']),
    register_device: idl.Func([idl.Principal, idl.Text], [idl.Opt(DeviceRecord)], []),
    revoke_device: idl.Func([idl.Principal], [idl.Bool], []),
    whoami: idl.Func([], [idl.Principal], ['query'])
  });
};

export function createMobileAuthActor(agent: HttpAgent): MobileAuthActor {
  if (!MOBILE_AUTH_CANISTER_ID) {
    throw new Error('Set EXPO_PUBLIC_MOBILE_AUTH_CANISTER_ID or use a canister-based EXPO_PUBLIC_AUTH_FRONTEND_URL.');
  }

  return Actor.createActor<MobileAuthActor>(mobileAuthIdlFactory, {
    agent,
    canisterId: MOBILE_AUTH_CANISTER_ID
  });
}

export async function registerDevice(
  agent: HttpAgent,
  devicePrincipal: string,
  label: string
): Promise<DeviceLoginInfo> {
  const actor = createMobileAuthActor(agent);
  const result = await actor.register_device(Principal.fromText(devicePrincipal), label);

  if (result.length === 0) {
    throw new Error('The auth canister rejected this device registration.');
  }

  return normalizeDeviceRecord(result[0]);
}

export async function loginWithRegisteredDevice(agent: HttpAgent): Promise<DeviceLoginInfo | null> {
  const actor = createMobileAuthActor(agent);
  const result = await actor.device_login();
  return result.length === 0 ? null : normalizeDeviceRecord(result[0]);
}

export async function listRegisteredDevices(agent: HttpAgent): Promise<DeviceLoginInfo[]> {
  const actor = createMobileAuthActor(agent);
  const devices = await actor.my_devices();
  return devices.map(normalizeDeviceRecord);
}

export async function revokeRegisteredDevice(agent: HttpAgent, devicePrincipal: string): Promise<boolean> {
  const actor = createMobileAuthActor(agent);
  return actor.revoke_device(Principal.fromText(devicePrincipal));
}

export async function whoamiOnAuthCanister(agent: HttpAgent): Promise<string> {
  const actor = createMobileAuthActor(agent);
  const principal = await actor.whoami();
  return principal.toText();
}

function normalizeDeviceRecord(record: DeviceRecord): DeviceLoginInfo {
  return {
    ownerPrincipal: record.owner.toText(),
    devicePrincipal: record.device.toText(),
    label: record.device_name,
    createdAtMs: Number(record.created_at / 1_000_000n),
    lastSeenAtMs: record.last_seen_at.length === 0 ? null : Number(record.last_seen_at[0] / 1_000_000n),
    revoked: record.revoked
  };
}
