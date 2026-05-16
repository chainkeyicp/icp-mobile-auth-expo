import { Actor, HttpAgent } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { Principal } from '@dfinity/principal';

import { SAMPLE_CANISTER_ID } from '../config/icp';

export const sampleIdlFactory: IDL.InterfaceFactory = ({ IDL: idl }) =>
  idl.Service({
    whoami: idl.Func([], [idl.Principal], ['query']),
    getPrincipal: idl.Func([], [idl.Principal], ['query']),
    greet: idl.Func([idl.Text], [idl.Text], ['query'])
  });

type SampleActor = {
  whoami: () => Promise<Principal>;
  getPrincipal: () => Promise<Principal>;
  greet: (name: string) => Promise<string>;
};

export function createSampleActor(agent: HttpAgent): SampleActor {
  if (!SAMPLE_CANISTER_ID) {
    throw new Error('Set EXPO_PUBLIC_SAMPLE_CANISTER_ID before calling the sample canister.');
  }

  return Actor.createActor<SampleActor>(sampleIdlFactory, {
    agent,
    canisterId: SAMPLE_CANISTER_ID
  });
}

export async function callSampleCanister(agent: HttpAgent): Promise<string> {
  const actor = createSampleActor(agent);

  try {
    const principal = await actor.whoami();
    return `whoami: ${principal.toText()}`;
  } catch (whoamiError) {
    try {
      const principal = await actor.getPrincipal();
      return `getPrincipal: ${principal.toText()}`;
    } catch (principalError) {
      const greeting = await actor.greet('ICP mobile');
      return `greet: ${greeting}`;
    }
  }
}
