// Error handler instalado ANTES de cargar cualquier módulo
if (!__DEV__) {
  const prev = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    const { Alert } = require('react-native');
    Alert.alert(
      isFatal ? 'CRASH FATAL' : 'Error JS',
      String(error?.stack || error?.message || error).slice(0, 800),
      [{ text: 'OK' }]
    );
    prev?.(error, isFatal);
  });
}

require('react-native-url-polyfill/auto');
const { registerRootComponent } = require('expo');
const App = require('./App').default;

registerRootComponent(App);
