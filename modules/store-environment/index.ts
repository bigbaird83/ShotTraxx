import { requireOptionalNativeModule } from 'expo';

export type StoreEnvironmentNative = {
  /** `production`, `sandbox`, `xcode`, `unknown`, or `error`. Never throws. */
  getEnvironment: () => Promise<string>;
};

/** Null when this binary has no StoreKit module (web, Android, Expo Go, an older build). */
export function getStoreEnvironmentNative(): StoreEnvironmentNative | null {
  try {
    return requireOptionalNativeModule<StoreEnvironmentNative>('StoreEnvironment');
  } catch {
    return null;
  }
}
