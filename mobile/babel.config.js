module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Unistyles 플러그인: src/ 아래 컴포넌트를 테마 인지형으로 변환한다.
    // (reanimated/worklets 변환은 babel-preset-expo가 자동 처리)
    plugins: [['react-native-unistyles/plugin', { root: 'src' }]],
  };
};
