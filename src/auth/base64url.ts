import { Buffer } from '@craftzdog/react-native-buffer';

export function toUint8Array(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export function base64UrlEncode(value: ArrayBuffer | Uint8Array | string): string {
  const buffer =
    typeof value === 'string'
      ? Buffer.from(value, 'utf8')
      : Buffer.from(toUint8Array(value));

  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function base64UrlDecodeToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(Buffer.from(padded, 'base64'));
}

export function base64UrlDecodeToString(value: string): string {
  return Buffer.from(base64UrlDecodeToBytes(value)).toString('utf8');
}

export function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncode(JSON.stringify(value));
}

export function base64UrlDecodeJson<T>(value: string): T {
  return JSON.parse(base64UrlDecodeToString(value)) as T;
}
