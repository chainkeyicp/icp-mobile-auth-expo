import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

import { TextDecoder, TextEncoder } from 'text-encoding';
import { Buffer } from '@craftzdog/react-native-buffer';

const globalScope = globalThis as Record<string, unknown>;

if (!globalScope.Buffer) {
  globalScope.Buffer = Buffer;
}

if (!globalScope.TextEncoder) {
  globalScope.TextEncoder = TextEncoder;
}

if (!globalScope.TextDecoder) {
  globalScope.TextDecoder = TextDecoder;
}

if (!globalScope.process) {
  globalScope.process = { env: {} };
}
