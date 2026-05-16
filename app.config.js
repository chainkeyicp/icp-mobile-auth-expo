const baseConfig = require('./app.json');

const authAppLinkHost = process.env.EXPO_PUBLIC_AUTH_APP_LINK_HOST;

const customSchemeFilter = {
  action: 'VIEW',
  autoVerify: false,
  data: [{ scheme: 'icpmobileauth' }],
  category: ['BROWSABLE', 'DEFAULT']
};

const appLinkFilter = authAppLinkHost
  ? {
      action: 'VIEW',
      autoVerify: true,
      data: [
        {
          scheme: 'https',
          host: authAppLinkHost,
          pathPrefix: '/auth-callback'
        }
      ],
      category: ['BROWSABLE', 'DEFAULT']
    }
  : null;

module.exports = () => {
  const expo = {
    ...baseConfig.expo,
    android: {
      ...baseConfig.expo.android,
      usesCleartextTraffic: authAppLinkHost ? false : baseConfig.expo.android.usesCleartextTraffic,
      intentFilters: appLinkFilter ? [customSchemeFilter, appLinkFilter] : [customSchemeFilter]
    }
  };

  return { expo };
};
