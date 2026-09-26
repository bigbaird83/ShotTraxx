import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { getStoreEnvironmentNative } from '@/modules/store-environment';
import {
  parseStoreEnvironment,
  proFeatureUnlocked,
  resolveProGating,
  type ProGating,
  type StoreEnvironmentRead,
} from '@/src/domain/proFeature';
import { useIsPro, useProTestOverride } from '@/src/services/purchases';

/**
 * One read of AppTransaction.environment per process.
 *
 * RevenueCat does not expose the StoreKit environment. expo-application's
 * release type reports App Store for both TestFlight and the App Store,
 * because they share this production binary. This module is the distinction:
 * sandbox = TestFlight, production = App Store.
 *
 * Missing module, unknown, or error stays `{ status }` that resolveProGating
 * treats as not gated.
 */
let environment: StoreEnvironmentRead = { status: 'unknown' };
let environmentStarted = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

async function readStoreEnvironment(): Promise<StoreEnvironmentRead> {
  try {
    const native = getStoreEnvironmentNative();
    if (!native) return { status: 'unknown' };
    return parseStoreEnvironment(await native.getEnvironment());
  } catch {
    return { status: 'error' };
  }
}

function ensureEnvironment(): void {
  if (environmentStarted) return;
  environmentStarted = true;
  void readStoreEnvironment().then((next) => {
    environment = next;
    emit();
  });
}

/** Whether Pro gating is in force, and why. Diagnostics and `useProFeature` share this. */
export function useProGating(): ProGating {
  const override = useProTestOverride();
  const [, bump] = useState(0);
  useEffect(() => {
    const listener = () => bump((n) => n + 1);
    listeners.add(listener);
    ensureEnvironment();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return resolveProGating({
    dev: __DEV__,
    override,
    platform: Platform.OS,
    environment,
  });
}

/** True when a Pro-only feature should be shown. */
export function useProFeature(): boolean {
  const isPro = useIsPro();
  const gating = useProGating();
  return proFeatureUnlocked({ gating: gating.inForce, isPro });
}
