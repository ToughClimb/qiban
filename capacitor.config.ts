import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.qiban.mobile",
  appName: "栖伴",
  webDir: "dist/client",
  loggingBehavior: "none",
  server: { androidScheme: "https", cleartext: false },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: { CapacitorHttp: { enabled: false } },
};
export default config;
