// APK 파일 이름 — android/app/build.gradle 에서 Gradle 이 처음부터
//   stockapp-<dev|prod>-<브랜치>-<YYYYMMDD-HHmm(KST)>[-debug].apk 로 만든다(outputs/apk/<buildType>/ 안).
// android/ 는 git 제외·prebuild --clean 때마다 다시 생성되므로 build.gradle 을 직접 고치면 커밋도 안 되고 사라진다
//   → 이 플러그인이 prebuild 때 build.gradle 끝에 설정을 넣는다(app.config.js plugins).
// env 는 prebuild 시점 APP_ENV(development→dev, 그 외→prod), 브랜치·시각은 Gradle 설정 시점 값. git 이 없으면 브랜치는 nobranch.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// stockapp:with-apk-name';

function gradleSnippet(envName) {
  return `
${MARK}
def stockappApkEnv = "${envName}"
def stockappApkBranch = {
    try {
        def out = ["git", "rev-parse", "--abbrev-ref", "HEAD"].execute(null, rootProject.projectDir).text.trim()
        return (out && out != "HEAD") ? out.replaceAll(/[^A-Za-z0-9._-]+/, "-") : "nobranch"
    } catch (ignored) {
        return "nobranch"
    }
}()
def stockappApkStamp = new Date().format("yyyyMMdd-HHmm", TimeZone.getTimeZone("Asia/Seoul"))
android.applicationVariants.all { variant ->
    variant.outputs.all {
        def suffix = variant.buildType.name == "release" ? "" : "-\${variant.buildType.name}"
        outputFileName = "stockapp-\${stockappApkEnv}-\${stockappApkBranch}-\${stockappApkStamp}\${suffix}.apk"
    }
}
`;
}

module.exports = function withApkName(config, { env } = {}) {
  const envName = env === 'development' ? 'dev' : 'prod';
  return withAppBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes(MARK)) c.modResults.contents += gradleSnippet(envName);
    return c;
  });
};
