// Pin the simulated browser locale for unit tests. jsdom defaults to
// "en-US", but the web console's historical first-run default is
// Simplified Chinese and most component tests assert zh-CN copy.
// System-locale behavior itself is covered by
// src/hooks/use-language.test.tsx, which stubs navigator.languages
// directly. Guarded because the setup file also runs for
// node-environment test files where window does not exist.
if (typeof window !== "undefined" && window.navigator) {
  Object.defineProperty(window.navigator, "languages", {
    value: ["zh-CN"],
    configurable: true,
  });
}
