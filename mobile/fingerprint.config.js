// runtimeVersion(fingerprint) 계산 설정 — @expo/fingerprint 가 빌드·eas update 때 읽는다.
// package.json 의 scripts 는 기본으로 지문에 들어가서, npm 스크립트만 고쳐도 runtimeVersion 이 바뀌어
// 설치된 APK 가 그 뒤 OTA 를 조용히 받지 못했다(2026-10-31, ota:*:activate 추가로 00c918ae → 02c3a3f3).
// 스크립트는 네이티브 바이너리와 무관하므로 지문에서 뺀다. 의존성·플러그인·app.config 는 그대로 지문에 남는다.
const { SourceSkips } = require('expo/fingerprint');

/** @type {import('expo/fingerprint').Config} */
const config = {
  sourceSkips: SourceSkips.PackageJsonScriptsAll,
  // 로컬 Gradle 빌드가 node_modules 라이브러리 매니페스트를 직접 고친다(2026-11-23 확인: @react-native-masked-view 의
  // AndroidManifest.xml 에서 package 속성이 지워짐). 그 파일이 지문에 들어가면 로컬(빌드한 적 있음) 지문과
  // 깨끗한 설치(EAS 빌드·npm ci) 지문이 달라져 스토어 빌드가 "Runtime version … not equal" 로 멈추고,
  // 로컬 빌드 여부에 따라 지문이 흔들린다 → 라이브러리 매니페스트만 뺀다. 라이브러리 버전이 바뀌면 같은 폴더의
  // package.json·소스가 지문에 잡히므로 실제 네이티브 변경은 그대로 감지된다.
  ignorePaths: ['node_modules/**/android/src/main/AndroidManifest.xml'],
};

module.exports = config;
