// APP_ENV(빌드/실행 환경)에 따라 앱 이름·번들ID를 분리해
// 개발용/상용 앱이 한 기기에 동시 설치될 수 있게 한다.
const APP_ENV = process.env.APP_ENV ?? 'development';
const isDev = APP_ENV === 'development';

// 푸시(expo-notifications) — docs/push_notification_setup.md 5장
// projectId 는 비밀이 아닌 공개 식별자(앱 바이너리에 그대로 들어감, Expo 도 eas init 시 app.json 에 커밋)라 기본값으로 둔다.
//   env 로만 받으면 운영 빌드(.env.production·eas.json 에 없음)·expo-constants 의 빌드 중 설정 생성에서 빠져 푸시가 꺼진 채 나갔다.
// google-services.json 은 git 제외(secrets/) — 파일이 있으면 자동으로 쓴다. 둘 다 env 로 덮어쓸 수 있다.
const fs = require('fs');
const path = require('path');
const DEFAULT_EAS_PROJECT_ID = 'fc55bccf-9c18-4cf5-bb8d-b9b5373c31cb'; // @kyuseokyi/stockapp
const DEFAULT_GOOGLE_SERVICES_JSON = './secrets/google-services.json';
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID || DEFAULT_EAS_PROJECT_ID;

// OTA(EAS Update) 채널 — docs/app_update_management_spec.md 5-1.
// eas.json 의 build.<profile>.channel 은 EAS 빌드에만 적용되고, 로컬 Gradle 빌드(scripts/build-dev-apk.sh·expo run)는
// prebuild 때 이 requestHeaders 가 네이티브 설정(AndroidManifest·Expo.plist)에 들어가야 채널이 붙는다.
// 기본은 APP_ENV(development→development, 그 외→production). preview 처럼 APP_ENV=production 이지만 채널이 다른 프로필은
// EXPO_UPDATES_CHANNEL 로 덮는다 — eas.json 각 프로필의 channel 과 반드시 같은 값이어야 한다.
const UPDATES_CHANNEL = process.env.EXPO_UPDATES_CHANNEL || (isDev ? 'development' : 'production');
const GOOGLE_SERVICES_JSON =
  process.env.GOOGLE_SERVICES_JSON ||
  (fs.existsSync(path.join(__dirname, DEFAULT_GOOGLE_SERVICES_JSON)) ? DEFAULT_GOOGLE_SERVICES_JSON : undefined);

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
      // 앱 삭제 후 재설치 때 Google 자동 백업이 펀드 파일(캐시·기록)·설정을 되살리지 않게(2026-10-23 계정별 저장 설계 '앱 삭제').
      //   expo-secure-store 플러그인이 넣는 fullBackupContent·dataExtractionRules 는 그대로 남지만 충돌하지 않는다
      //   (백업 자체가 꺼지면 규칙은 클라우드 백업에 쓰이지 않음). 네이티브 변경 → 새 APK 필요(OTA 불가).
      allowBackup: false,
      ...(GOOGLE_SERVICES_JSON ? { googleServicesFile: GOOGLE_SERVICES_JSON } : {}),
    },
    // OTA: 확인·다운로드 시점은 앱 코드(src/features/app-update)가 정한다 — 서버 정책(점검·스토어 강제면 OTA 생략,
    //   SILENT/OPTIONAL/MANDATORY)을 먼저 받은 뒤 check→fetch 하므로 네이티브 자동 확인은 끈다('NEVER').
    //   ON_LOAD_* 로 두면 정책과 무관하게 기동 시 네이티브가 먼저 내려받아(다음 실행 적용) 점검·강제 업데이트 중에도 번들이 바뀐다.
    // fallbackToCacheTimeout 0: 기동 때 새 번들을 기다리지 않고 내장/캐시 번들로 바로 뜬다.
    updates: {
      url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
      checkAutomatically: 'NEVER',
      fallbackToCacheTimeout: 0,
      requestHeaders: { 'expo-channel-name': UPDATES_CHANNEL },
    },
    // 네이티브 구성(라이브러리·플러그인·권한 등)의 지문 — 바뀌면 runtimeVersion 이 달라져 옛 바이너리는 새 OTA 를 받지 않는다(크래시 방지).
    //   즉 네이티브가 바뀐 변경은 OTA 가 아니라 새 빌드(스토어/APK)로 배포해야 한다.
    runtimeVersion: { policy: 'fingerprint' },
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
