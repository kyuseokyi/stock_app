// APP_ENV(빌드/실행 환경)에 따라 앱 이름·번들ID를 분리해
// 개발용/상용 앱이 한 기기에 동시 설치될 수 있게 한다.
const APP_ENV = process.env.APP_ENV ?? 'development';
const isDev = APP_ENV === 'development';

export default {
  expo: {
    name: isDev ? 'StockApp Dev' : 'StockApp',
    slug: 'stockapp',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'stockapp',
    userInterfaceStyle: 'automatic',
    ios: {
      icon: './assets/expo.icon',
      supportsTablet: true,
      bundleIdentifier: isDev ? 'com.stockapp.dev' : 'com.stockapp',
    },
    android: {
      package: isDev ? 'com.stockapp.dev' : 'com.stockapp',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#208AEF',
          image: './assets/images/splash-icon.png',
          imageWidth: 76,
        },
      ],
      'react-native-edge-to-edge',
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      appEnv: APP_ENV,
    },
  },
};
