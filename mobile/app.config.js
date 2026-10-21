// APP_ENV(빌드/실행 환경)에 따라 앱 이름·번들ID를 분리해
// 개발용/상용 앱이 한 기기에 동시 설치될 수 있게 한다.
const APP_ENV = process.env.APP_ENV ?? 'development';
const isDev = APP_ENV === 'development';

// 푸시(expo-notifications) — 값이 없으면 푸시만 꺼진다(isPushConfigured). docs/push_notification_setup.md 5장
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID || undefined;
const GOOGLE_SERVICES_JSON = process.env.GOOGLE_SERVICES_JSON || undefined;

export default {
  expo: {
    name: isDev ? 'StockApp Dev' : 'StockApp',
    slug: 'stockapp',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    // 딥링크 스킴도 dev/prod 분리 — 간편 로그인 복귀(stockapp[-dev]://auth)가 같은 기기의 다른 앱으로 가지 않게
    scheme: isDev ? 'stockapp-dev' : 'stockapp',
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
      ...(GOOGLE_SERVICES_JSON ? { googleServicesFile: GOOGLE_SERVICES_JSON } : {}),
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
      'expo-secure-store',
      ['expo-notifications', { enableBackgroundRemoteNotifications: true }], // 무음 push 로 앱 깨우기(iOS remote-notification)
      'expo-background-task', // 정기 백그라운드 기록(Android WorkManager · iOS BGTaskScheduler)
      // iOS 출시(애플 로그인과 함께) 전에 실제 값으로
      [
        '@react-native-google-signin/google-signin',
        { iosUrlScheme: process.env.GOOGLE_IOS_URL_SCHEME ?? 'com.googleusercontent.apps.unset' },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      appEnv: APP_ENV,
      ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
    },
  },
};
