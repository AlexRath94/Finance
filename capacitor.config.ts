import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'de.finanzplaner.app',
  appName: 'Finanzen',
  webDir: 'dist',
  android: {
    // Only local app files plus the HTTPS price services; no cleartext traffic.
    allowMixedContent: false,
  },
};

export default config;
