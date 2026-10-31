// runtimeVersion(fingerprint) 계산 설정 — @expo/fingerprint 가 빌드·eas update 때 읽는다.
// package.json 의 scripts 는 기본으로 지문에 들어가서, npm 스크립트만 고쳐도 runtimeVersion 이 바뀌어
// 설치된 APK 가 그 뒤 OTA 를 조용히 받지 못했다(2026-10-31, ota:*:activate 추가로 00c918ae → 02c3a3f3).
// 스크립트는 네이티브 바이너리와 무관하므로 지문에서 뺀다. 의존성·플러그인·app.config 는 그대로 지문에 남는다.
const { SourceSkips } = require('expo/fingerprint');

/** @type {import('expo/fingerprint').Config} */
const config = {
  sourceSkips: SourceSkips.PackageJsonScriptsAll,
};

module.exports = config;
