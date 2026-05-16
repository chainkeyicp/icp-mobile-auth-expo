declare const __DEV__: boolean;
declare const process: {
  env: Record<string, string | undefined>;
};

declare module 'text-encoding' {
  export const TextEncoder: typeof globalThis.TextEncoder;
  export const TextDecoder: typeof globalThis.TextDecoder;
}

interface ImportMetaEnv {
  readonly VITE_II_AUTHORIZE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
