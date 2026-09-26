import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { courseSearchResponseIsCurrent, nextCourseSearchRequest } from './courseSearchRequest';

test('course search request ids increase and only the latest response may apply', () => {
  assert.equal(nextCourseSearchRequest(0), 1);
  assert.equal(nextCourseSearchRequest(1), 2);
  assert.ok(nextCourseSearchRequest(2) > 2);

  let latestId = 0;
  let latestQuery = '';
  const start = (query: string) => {
    latestId = nextCourseSearchRequest(latestId);
    latestQuery = query;
    const requestId = latestId;
    const startedQuery = query;
    return (gpsNearby = false) =>
      courseSearchResponseIsCurrent({
        requestId,
        latestRequestId: latestId,
        startedQuery,
        latestQuery,
        gpsNearby,
      });
  };

  const nearby = start('');
  latestQuery = '32218';
  assert.equal(nearby(true), false);

  const zip = start('32218');
  const partialName = start('3');
  assert.equal(zip(false), false);
  assert.equal(partialName(false), true);

  const zipAgain = start('32218');
  assert.equal(nearby(true), false);
  assert.equal(zip(false), false);
  assert.equal(partialName(false), false);
  assert.equal(zipAgain(false), true);
});

test('a nearby answer is ignored while the field has text, even if it is still the latest id', () => {
  assert.equal(
    courseSearchResponseIsCurrent({
      requestId: 4,
      latestRequestId: 4,
      startedQuery: '',
      latestQuery: '322',
      gpsNearby: true,
    }),
    false,
  );
  assert.equal(
    courseSearchResponseIsCurrent({
      requestId: 4,
      latestRequestId: 5,
      startedQuery: '',
      latestQuery: '',
      gpsNearby: true,
    }),
    false,
  );
  assert.equal(
    courseSearchResponseIsCurrent({
      requestId: 4,
      latestRequestId: 4,
      startedQuery: '',
      latestQuery: '',
      gpsNearby: true,
    }),
    true,
  );
  assert.equal(
    courseSearchResponseIsCurrent({
      requestId: 6,
      latestRequestId: 6,
      startedQuery: 'Jacksonville FL',
      latestQuery: 'Jacksonville FL',
    }),
    true,
  );
  assert.equal(
    courseSearchResponseIsCurrent({
      requestId: 6,
      latestRequestId: 6,
      startedQuery: 'Jacksonville FL',
      latestQuery: 'Jacksonville',
    }),
    false,
  );
});

test('picker drops a stale course search before it touches state', () => {
  const picker = readFileSync(new URL('../ui/CoursePicker.tsx', import.meta.url), 'utf8');
  const home = readFileSync(new URL('../../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  const findFn = picker.slice(picker.indexOf('const onFind'), picker.indexOf('useEffect(() => {\n    onRefreshReady'));
  assert.match(findFn, /courseSearchResponseIsCurrent/);
  assert.match(findFn, /AbortController/);
  assert.match(findFn, /if \(!apply\(\)\) return;/);
  assert.match(findFn, /if \(!apply\(gpsNearby\)\) return;/);
  assert.match(findFn, /if \(apply\(\)\) setBusy\(false\)/);
  assert.match(findFn, /deferCourseSearchLayout\(\(\) => \{\n\s*if \(!apply\(\)\) return;\n\s*setResults/);
  assert.match(findFn, /nearbyCourses\(from, undefined, signal\)/);
  assert.match(findFn, /searchCourses\(q, signal\)/);
  assert.match(findFn, /plan\.mode === 'too_short'/);
  assert.doesNotMatch(findFn, /finally \{\s*setBusy\(false\)/);
  assert.match(picker, /courseListHeading\(query\)/);
  assert.match(picker, /COPY\.searchBusy/);
  assert.match(picker, /COPY\.nearbyHint/);
  assert.match(home, /COPY\.coursesNearYou/);
});
