import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCourseDataClient } from './client';
import {
  mapGolfApiCourseToHydrate,
  resetGolfApiCacheForTests,
  saveCachedHydrate,
} from './golfapi';
import { fetchOsmOverlay } from './osmOverlay';
import { getSharedCoursePaintCache, resetCoursePaintCacheForTests } from './paintCache';

test('client is unconfigured without the share-sync Worker and does not call the network', async () => {
  let calls = 0;
  const client = createCourseDataClient({
    getBaseUrl: () => null,
    fetch: async () => {
      calls += 1;
      throw new Error('network should not run');
    },
  });
  assert.equal(client.isConfigured(), false);
  const nearby = await client.nearbyCourses({ lat: 0.2, lng: 0.2 });
  const searched = await client.searchCourses('pebble');
  const course = await client.getCourse('4');
  const catalog = await client.searchCourses('thunderbird heber springs');
  assert.deepEqual(nearby, []);
  assert.equal(searched.some((row) => /pebble/i.test(row.name)), true);
  assert.equal(course, null);
  assert.equal(catalog.some((row) => row.name === 'Thunderbird Country Club' && row.city === 'Heber Springs'), true);
  assert.equal(calls, 0);
});

test('nearbyCourses sends lat/lng/radius through the Worker with no vendor key and parses data', async () => {
  const client = createCourseDataClient({
    getBaseUrl: () => 'https://share.test/gca/v1',
    fetch: async (input, init) => {
      const url = String(input);
      assert.ok(url.startsWith('https://share.test/gca/v1/courses?'));
      assert.match(url, /lat=37/);
      assert.match(url, /lng=-122/);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Authorization'), null);
      return new Response(
        JSON.stringify({
          data: [
            {
              id: '4',
              name: 'Nearby CC',
              latitude: 37.01,
              longitude: -122.1,
              distance_km: 1.2,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
  });
  assert.equal(client.isConfigured(), true);
  const nearby = await client.nearbyCourses({ lat: 37, lng: -122 });
  assert.equal(nearby[0].name, 'Nearby CC');
  assert.equal(nearby[0].distanceMeters, 1200);
  assert.equal(nearby.some((row) => row.id === '4' || row.name === 'Nearby CC'), true);
});

test('nearbyCourses asks the Worker for a 40 mi radius (64.4 km) and filters past it', async () => {
  const urls: string[] = [];
  const client = createCourseDataClient({
    getBaseUrl: () => 'https://share.test/gca/v1',
    fetch: async (input) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          data: [
            { id: 'in', name: 'Inside GC', latitude: 37.1, longitude: -122, distance_km: 40 },
            { id: 'out', name: 'Outside GC', latitude: 37.9, longitude: -122, distance_km: 90 },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
  });
  const nearby = await client.nearbyCourses({ lat: 37, lng: -122 });
  assert.equal(urls.length, 1);
  assert.equal(new URL(urls[0]).searchParams.get('radius'), '64.4');
  assert.equal(nearby.some((row) => row.id === 'in'), true);
  assert.equal(nearby.some((row) => row.id === 'out'), false);
});

test('searchCourses sends q= for name, city, state, or zip and never invents a course', async () => {
  const urls: string[] = [];
  const client = createCourseDataClient({
    getBaseUrl: () => 'https://share.test/gca/v1',
    fetch: async (input) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          data: [{ id: '4', name: 'Bowling Green Country Club', city: 'Bowling Green', state: 'Kentucky' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
  });
  const found = await client.searchCourses('  bowling  ');
  assert.equal(found[0].name, 'Bowling Green Country Club');
  assert.equal(found.some((row) => row.id === '4' || row.name === 'Bowling Green Country Club'), true);
  assert.match(urls[0] ?? '', /\/courses\?/);
  assert.match(urls[0] ?? '', /q=bowling/);
  assert.doesNotMatch(urls[0] ?? '', /lat=/);
  const empty = await client.searchCourses('   ');
  assert.deepEqual(empty, []);
  assert.equal(urls.length, 1);
});

test('nearby and search pass AbortSignal through to fetch', async () => {
  const signals: Array<AbortSignal | null | undefined> = [];
  const client = createCourseDataClient({
    getBaseUrl: () => 'https://share.test/gca/v1',
    fetch: async (_input, init) => {
      signals.push(init?.signal);
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    },
  });
  const controller = new AbortController();
  await client.searchCourses('pebble', controller.signal);
  await client.nearbyCourses({ lat: 37, lng: -122 }, undefined, controller.signal);
  assert.equal(signals.length, 2);
  assert.equal(signals[0], controller.signal);
  assert.equal(signals[1], controller.signal);
});

test('getCourse loads scorecard then Pro green-centers', async () => {
  resetCoursePaintCacheForTests();
  const urls: string[] = [];
  const client = createCourseDataClient({
    getBaseUrl: () => 'https://share.test/gca/v1',
    fetch: async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/courses/4')) {
        return new Response(
          JSON.stringify({
            data: {
              id: 4,
              name: 'Bowling Green Country Club',
              coordinates: { latitude: 37.0132, longitude: -86.43378 },
              scorecard: {
                hole_count: 18,
                teeboxes: [{ name: 'Gold', holes: [{ hole: 1, par: 4, yards: 437, handicap: 7 }, { hole: 2, par: 5 }] }],
              },
              green_centers_available: true,
            },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/green-centers')) {
        return new Response(
          JSON.stringify({
            data: {
              course_id: 4,
              holes: [{ hole: 1, lat: 37.01744, lng: -86.43135 }],
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  const detail = await client.getCourse('4');
  assert.ok(detail);
  assert.equal(detail?.holes[0].par, 4);
  assert.equal(detail?.paintResult?.ok, true);
  assert.equal(detail?.paintResult?.source, 'gca');
  assert.equal(detail?.paintResult?.fromCache, false);
  assert.equal(detail?.holes[0].yards, 437);
  assert.equal(detail?.holes[0].handicap, 7);
  assert.deepEqual(detail?.holes[0].greenCentroid, { lat: 37.01744, lng: -86.43135 });
  assert.equal(detail?.tees[0].name, 'Gold');
  assert.equal(detail?.tees[0].holes[0].handicap, 7);
  assert.deepEqual(detail?.tees[0].holes[0].greenCentroid, { lat: 37.01744, lng: -86.43135 });
  assert.equal(detail?.holes[1].par, 5);
  assert.equal(detail?.holes[1].greenCentroid, null);
  assert.ok(urls[0]?.startsWith('https://share.test/gca/v1/'));
  assert.match(urls[1] ?? '', /green-centers/);
  assert.equal(urls.some((url) => url.includes('/golfapi/')), false);
});

test('getCourse keeps greens blank on 403 Pro-only green-centers — never invents', async () => {
  resetCoursePaintCacheForTests();
  const names = ['EXPO_PUBLIC_SHARE_SYNC_URL'];
  const prev = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    const client = createCourseDataClient({
      getBaseUrl: () => 'https://share.test/gca/v1',
      fetch: async (input) => {
        const url = String(input);
        if (url.includes('green-centers')) {
          return new Response(
            JSON.stringify({ message: 'Green-center data requires a Pro or Max plan.' }),
            { status: 403 },
          );
        }
        return new Response(
          JSON.stringify({
            data: {
              id: 4,
              name: 'Free Plan CC',
              scorecard: { teeboxes: [{ holes: [{ hole: 1, par: 4 }] }] },
            },
          }),
          { status: 200 },
        );
      },
    });
    const detail = await client.getCourse('4');
    assert.equal(detail?.holes[0].par, 4);
    assert.equal(detail?.paintResult?.ok, false);
    assert.equal(detail?.paintResult?.source, null);
    assert.equal(detail?.paintResult?.fromCache, false);
    assert.equal(detail?.holes[0].greenCentroid, null);
    assert.equal(detail?.holes[0].teeCentroid, null);
  } finally {
    for (const name of names) {
      if (prev[name] == null) delete process.env[name];
      else process.env[name] = prev[name];
    }
  }
});

test('getCourse fills a miss from the golfapi cache and does not invent', async () => {
  resetCoursePaintCacheForTests();
  resetGolfApiCacheForTests();
  const names = ['EXPO_PUBLIC_SHARE_SYNC_URL'];
  const prev = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.EXPO_PUBLIC_SHARE_SYNC_URL = 'https://share.test';
    const seeded = mapGolfApiCourseToHydrate({
      course: {
        courseID: '99',
        clubName: 'Cache Hit CC',
        city: 'Conway',
        state: 'AR',
        latitude: '35.1',
        longitude: '-92.4',
        parsMen: [4],
        tees: [{ teeName: 'Blue', length1: 267 }],
      },
      coordinates: {
        coordinates: [
          { poi: 1, location: 2, hole: 1, latitude: 35.522655, longitude: -92.0393088 },
          { poi: 12, location: 2, hole: 1, latitude: 35.5250149, longitude: -92.0393432 },
        ],
      },
    });
    assert.ok(seeded);
    saveCachedHydrate(seeded!, ['88', 'namecity:cache hit cc|conway']);
    const client = createCourseDataClient({
      getBaseUrl: () => 'https://share.test/gca/v1',
      fetch: async (input) => {
        const url = String(input);
        if (url.includes('/golfapi/')) {
          throw new Error('cache should skip golfapi');
        }
        if (url.includes('green-centers')) {
          return new Response(JSON.stringify({ message: 'Pro only' }), { status: 403 });
        }
        return new Response(
          JSON.stringify({
            data: {
              id: 88,
              name: 'Cache Hit CC',
              city: 'Conway',
              state: 'AR',
              scorecard: { teeboxes: [{ holes: [{ hole: 1, par: 4 }] }] },
            },
          }),
          { status: 200 },
        );
      },
    });
    const detail = await client.getCourse('88');
    assert.equal(detail?.holes[0]?.par, 4);
    assert.equal(detail?.paintResult?.ok, true);
    assert.equal(detail?.paintResult?.source, 'golfapi');
    assert.equal(detail?.paintResult?.fromCache, true);
    assert.deepEqual(detail?.holes[0]?.teeCentroid, { lat: 35.5250149, lng: -92.0393432 });
    assert.deepEqual(detail?.holes[0]?.greenCentroid, { lat: 35.522655, lng: -92.0393088 });
  } finally {
    resetGolfApiCacheForTests();
    for (const name of names) {
      if (prev[name] == null) delete process.env[name];
      else process.env[name] = prev[name];
    }
  }
});

test('OSM overlay is skipped without a real location — no invented polygons', async () => {
  let calls = 0;
  const overlay = await fetchOsmOverlay(
    { courseId: '4' },
    {
      fetch: async () => {
        calls += 1;
        throw new Error('network should not run');
      },
    },
  );
  assert.equal(overlay, null);
  assert.equal(calls, 0);
});

const CACHED_TEE = { lat: 35.5250149, lng: -92.0393432 };
const CACHED_GREEN = { lat: 35.522655, lng: -92.0393088 };

test('worker down uses the last sane paint cache and does not invent par or yards', async () => {
  resetCoursePaintCacheForTests();
  let calls = 0;
  await getSharedCoursePaintCache().put({
    v: 1,
    key: 'id:55',
    aliases: [],
    source: 'golfapi',
    name: 'Cached Only CC',
    city: 'Conway',
    numHoles: 18,
    nineByTwo: false,
    fetchedAt: '2026-09-21T00:00:00Z',
    holes: [{ hole: 1, tee: CACHED_TEE, green: CACHED_GREEN }],
  });
  const offline = createCourseDataClient({
    getBaseUrl: () => null,
    fetch: async () => {
      calls += 1;
      throw new Error('worker is down');
    },
  });
  const detail = await offline.getCourse('55');
  assert.equal(calls, 0);
  assert.equal(detail?.paintResult?.ok, true);
  assert.equal(detail?.paintResult?.fromCache, true);
  assert.equal(detail?.paintResult?.source, 'golfapi');
  assert.equal(detail?.holes.length, 1);
  assert.deepEqual(detail?.holes[0]?.teeCentroid, CACHED_TEE);
  assert.deepEqual(detail?.holes[0]?.greenCentroid, CACHED_GREEN);
  assert.equal(detail?.holes[0]?.par, null);
  assert.equal(detail?.holes[0]?.yards, null);
  assert.equal(detail?.location, null);

  let workerCalls = 0;
  const down = createCourseDataClient({
    getBaseUrl: () => 'https://share.test/gca/v1',
    fetch: async () => {
      workerCalls += 1;
      throw new Error('network down');
    },
  });
  const again = await down.getCourse('55');
  assert.equal(workerCalls, 1);
  assert.deepEqual(again?.holes[0]?.greenCentroid, CACHED_GREEN);
  assert.equal(again?.paintResult?.fromCache, true);
  resetCoursePaintCacheForTests();
});

test('worker down does not paint a cache row that fails the sanity gates', async () => {
  resetCoursePaintCacheForTests();
  await getSharedCoursePaintCache().put({
    v: 1,
    key: 'id:56',
    aliases: [],
    source: 'golfapi',
    name: 'Thin CC',
    city: 'Cabot',
    numHoles: 18,
    nineByTwo: false,
    fetchedAt: '2026-09-21T00:00:00Z',
    holes: [{ hole: 1, tee: null, green: CACHED_GREEN, par: 4, yards: 400 }],
  });
  const offline = createCourseDataClient({
    getBaseUrl: () => null,
    fetch: async () => {
      throw new Error('worker is down');
    },
  });
  assert.equal(await offline.getCourse('56'), null);

  const down = createCourseDataClient({
    getBaseUrl: () => 'https://share.test/gca/v1',
    fetch: async () => new Response('nope', { status: 503 }),
  });
  await assert.rejects(() => down.getCourse('56'), /Couldn’t load that course/);
  resetCoursePaintCacheForTests();
});

test('Thunderbird stays HARD-MISS when the worker is down — poisoned cache does not paint', async () => {
  resetCoursePaintCacheForTests();
  await getSharedCoursePaintCache().put({
    v: 1,
    key: 'id:local:thunderbird-heber-springs-ar',
    aliases: ['name:thunderbird country club|heber springs|ar'],
    source: 'golfapi',
    name: 'Thunderbird Country Club',
    city: 'Heber Springs',
    numHoles: 9,
    nineByTwo: true,
    fetchedAt: '2026-09-21T00:00:00Z',
    holes: [{ hole: 1, tee: CACHED_TEE, green: CACHED_GREEN, par: 4, yards: 320 }],
  });
  const client = createCourseDataClient({
    getBaseUrl: () => null,
    fetch: async () => {
      throw new Error('worker is down');
    },
  });
  const detail = await client.getCourse('local:thunderbird-heber-springs-ar');
  assert.equal(detail?.paintResult?.ok, false);
  assert.equal(detail?.holes[0]?.teeCentroid, null);
  assert.equal(detail?.holes[0]?.greenCentroid, null);
  assert.equal(detail?.holes[0]?.par, null);
  assert.equal(detail?.holes[0]?.yards, null);
  assert.equal(await getSharedCoursePaintCache().get('id:local:thunderbird-heber-springs-ar'), null);
  resetCoursePaintCacheForTests();
});
