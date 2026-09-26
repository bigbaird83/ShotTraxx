/**
 * Whether a Pro-only feature is shown.
 *
 * Gating is in force only on an App Store production install. TestFlight is
 * StoreKit sandbox, Xcode and dev builds are not gated, and an unknown or
 * failed environment read stays open so a tester is never locked out.
 * Dev Force Free is the one exception: it turns gating on so the locked
 * screen can be previewed. A release build ignores that override.
 *
 * `proFeatureUnlocked` is the only check the UI uses: open when gating is
 * off, otherwise only when the user is Pro.
 */

export type StoreEnvironmentStatus = 'production' | 'sandbox' | 'xcode' | 'unknown' | 'error';

export type StoreEnvironmentRead = {
  status: StoreEnvironmentStatus;
};

export type ProGatingReason =
  | 'dev'
  | 'force-free'
  | 'app-store'
  | 'testflight'
  | 'xcode'
  | 'not-ios'
  | 'unknown'
  | 'error';

export type ProGating = {
  inForce: boolean;
  reason: ProGatingReason;
};

/** Map a native AppTransaction environment string. Anything else is unknown, not an error. */
export function parseStoreEnvironment(raw: unknown): StoreEnvironmentRead {
  if (raw === 'production' || raw === 'sandbox' || raw === 'xcode' || raw === 'unknown') {
    return { status: raw };
  }
  if (raw === 'error') return { status: 'error' };
  return { status: 'unknown' };
}

/**
 * Pro gating is in force only for App Store production, or in dev when Force
 * Free is selected. `__DEV__` is otherwise never gated, including when the
 * environment read says production. A stored Force Free on a release build
 * is ignored.
 */
export function resolveProGating(args: {
  dev: boolean;
  override?: string | null;
  platform: string;
  environment: StoreEnvironmentRead;
}): ProGating {
  if (args.dev === true && args.override === 'force-free') {
    return { inForce: true, reason: 'force-free' };
  }
  if (args.dev === true) {
    return { inForce: false, reason: 'dev' };
  }
  if (args.platform !== 'ios') {
    return { inForce: false, reason: 'not-ios' };
  }
  switch (args.environment.status) {
    case 'production':
      return { inForce: true, reason: 'app-store' };
    case 'sandbox':
      return { inForce: false, reason: 'testflight' };
    case 'xcode':
      return { inForce: false, reason: 'xcode' };
    case 'error':
      return { inForce: false, reason: 'error' };
    default:
      return { inForce: false, reason: 'unknown' };
  }
}

/** True when the feature is shown. Gating off unlocks everyone; gating on needs Pro. */
export function proFeatureUnlocked(args: { gating: boolean; isPro: boolean }): boolean {
  return args.gating !== true || args.isPro === true;
}

/** Diagnostics line: whether gating is in force, and why. */
export function formatProGating(gating: ProGating): string {
  const why: Record<ProGatingReason, string> = {
    dev: 'dev',
    'force-free': 'Force Free',
    'app-store': 'App Store',
    testflight: 'TestFlight',
    xcode: 'Xcode',
    'not-ios': 'not iOS',
    unknown: 'unknown',
    error: 'error',
  };
  return `${gating.inForce ? 'on' : 'off'} · ${why[gating.reason]}`;
}
