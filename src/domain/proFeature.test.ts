import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  formatProGating,
  parseStoreEnvironment,
  proFeatureUnlocked,
  resolveProGating,
  type StoreEnvironmentRead,
} from './proFeature';

const production: StoreEnvironmentRead = { status: 'production' };
const sandbox: StoreEnvironmentRead = { status: 'sandbox' };
const unknown: StoreEnvironmentRead = { status: 'unknown' };

test('a feature is open unless gating is in force and the user is not Pro', () => {
  assert.equal(proFeatureUnlocked({ gating: false, isPro: false }), true);
  assert.equal(proFeatureUnlocked({ gating: false, isPro: true }), true);
  assert.equal(proFeatureUnlocked({ gating: true, isPro: true }), true);
  assert.equal(proFeatureUnlocked({ gating: true, isPro: false }), false);
});

test('App Store production is the only install that gates', () => {
  assert.deepEqual(resolveProGating({ dev: false, platform: 'ios', environment: production }), {
    inForce: true,
    reason: 'app-store',
  });
  assert.deepEqual(resolveProGating({ dev: false, platform: 'ios', environment: sandbox }), {
    inForce: false,
    reason: 'testflight',
  });
  assert.deepEqual(resolveProGating({ dev: false, platform: 'ios', environment: { status: 'xcode' } }), {
    inForce: false,
    reason: 'xcode',
  });
});

test('dev is never gated, except Force Free which previews the lock', () => {
  assert.deepEqual(
    resolveProGating({ dev: true, override: 'off', platform: 'ios', environment: production }),
    { inForce: false, reason: 'dev' },
  );
  assert.deepEqual(
    resolveProGating({ dev: true, override: 'force-pro', platform: 'ios', environment: production }),
    { inForce: false, reason: 'dev' },
  );
  assert.deepEqual(
    resolveProGating({ dev: true, override: 'force-free', platform: 'ios', environment: sandbox }),
    { inForce: true, reason: 'force-free' },
  );
  assert.equal(
    proFeatureUnlocked({
      gating: resolveProGating({ dev: true, override: 'force-free', platform: 'ios', environment: sandbox }).inForce,
      isPro: false,
    }),
    false,
  );
});

test('a stored Force Free does not gate a release build', () => {
  assert.deepEqual(
    resolveProGating({ dev: false, override: 'force-free', platform: 'ios', environment: sandbox }),
    { inForce: false, reason: 'testflight' },
  );
});

test('unknown, error, a missing module, and non-iOS stay open', () => {
  assert.equal(parseStoreEnvironment('production').status, 'production');
  assert.equal(parseStoreEnvironment('sandbox').status, 'sandbox');
  assert.equal(parseStoreEnvironment('nope').status, 'unknown');
  assert.equal(parseStoreEnvironment(null).status, 'unknown');
  assert.equal(parseStoreEnvironment('error').status, 'error');

  for (const environment of [unknown, { status: 'error' as const }, parseStoreEnvironment(undefined)]) {
    const gating = resolveProGating({ dev: false, platform: 'ios', environment });
    assert.equal(gating.inForce, false);
    assert.equal(proFeatureUnlocked({ gating: gating.inForce, isPro: false }), true);
  }
  assert.equal(resolveProGating({ dev: false, platform: 'ios', environment: { status: 'error' } }).reason, 'error');
  assert.equal(resolveProGating({ dev: false, platform: 'ios', environment: unknown }).reason, 'unknown');
  assert.deepEqual(resolveProGating({ dev: false, platform: 'android', environment: production }), {
    inForce: false,
    reason: 'not-ios',
  });
});

test('diagnostics names whether gating is in force and why', () => {
  assert.equal(
    formatProGating(resolveProGating({ dev: false, platform: 'ios', environment: production })),
    'on · App Store',
  );
  assert.equal(
    formatProGating(resolveProGating({ dev: false, platform: 'ios', environment: sandbox })),
    'off · TestFlight',
  );
  assert.equal(
    formatProGating(resolveProGating({ dev: true, override: 'force-free', platform: 'ios', environment: unknown })),
    'on · Force Free',
  );
  assert.equal(formatProGating(resolveProGating({ dev: true, platform: 'ios', environment: unknown })), 'off · dev');
});

test('strokes gained screens share one gate and still compute lies', () => {
  const screens = [
    new URL('../../app/review/[id]/stats.tsx', import.meta.url),
    new URL('../../app/trends.tsx', import.meta.url),
    new URL('../../app/review/[id]/shots.tsx', import.meta.url),
  ];
  for (const file of screens) {
    const text = readFileSync(file, 'utf8');
    assert.match(text, /useProFeature\(/);
    assert.doesNotMatch(text, /useIsPro\(/);
    assert.match(text, /COPY\.strokesGainedPro/);
  }
  const shots = readFileSync(new URL('../../app/review/[id]/shots.tsx', import.meta.url), 'utf8');
  const hole = readFileSync(new URL('../../app/round/[id]/hole/[number].tsx', import.meta.url), 'utf8');
  assert.match(shots, /fillAutoShotLies\(/);
  assert.match(hole, /fillAutoShotLies\(/);
  assert.doesNotMatch(hole, /useProFeature\(/);
  const diagnostics = readFileSync(new URL('../../app/diagnostics.tsx', import.meta.url), 'utf8');
  assert.match(diagnostics, /label="Pro gating"/);
  assert.match(diagnostics, /formatProGating\(/);
});

test('the native module reads AppTransaction and returns error instead of throwing', () => {
  const swift = readFileSync(
    new URL('../../modules/store-environment/ios/StoreEnvironmentModule.swift', import.meta.url),
    'utf8',
  );
  assert.match(swift, /AppTransaction\.shared/);
  assert.match(swift, /\.production/);
  assert.match(swift, /\.sandbox/);
  assert.match(swift, /\.xcode/);
  assert.match(swift, /return "error"/);
  assert.match(swift, /return "unknown"/);
});
