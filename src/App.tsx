import * as WebBrowser from 'expo-web-browser';
import { StatusBar } from 'expo-status-bar';

import { LoginScreen } from './screens/LoginScreen';

WebBrowser.maybeCompleteAuthSession();

export default function App() {
  return (
    <>
      <StatusBar style="auto" />
      <LoginScreen />
    </>
  );
}
