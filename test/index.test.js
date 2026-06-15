import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defer, delay, timeout, map, each, filter, reduce, find,
  waterfall, series, all, allSettled, promisify, callbackify,
  memoize, once, retry, queue, poll, tryify
} from '../src/index.js';

test('defer creates a controllable promise', async () => {
  const d = defer();
  assert.equal(typeof d.resolve, 'function');
  assert.equal(typeof d.reject, 'function');
  d.resolve(42);
  assert.equal(await d.promise, 42);
});

test('defer can reject', async () => {
  const d = defer();
  d.reject(new Error('nope'));
  await assert.rejects(() => d.promise, { message: 'nope' });
});

test('delay resolves after specified time', async () => {
  const start = Date.now();
  await delay(50);
  assert.ok(Date.now() - start >= 45); // small margin
});

test('delay passes through value', async () => {
  assert.equal(await delay(10, 'hello'), 'hello');
});

test('timeout rejects slow promise', async () => {
  const slow = delay(200, 'late');
  await assert.rejects(() => timeout(slow, 50), { message: /timed out/ });
});

test('timeout allows fast promise', async () => {
  const fast = delay(10, 'fast');
  assert.equal(await timeout(fast, 100), 'fast');
});

test('timeout with fallback resolves instead of rejecting', async () => {
  const slow = delay(200, 'late');
  assert.equal(await timeout(slow, 50, { fallback: 'default' }), 'default');
});

test('timeout with custom message', async () => {
  const slow = delay(200);
  await assert.rejects(() => timeout(slow, 50, { message: 'custom timeout' }), { message: 'custom timeout' });
});

test('map preserves order with concurrency', async () => {
  const items = [1, 2, 3, 4, 5];
  const results = await map(items, async (x) => {
    await delay(x * 10);
    return x * 2;
  }, 2);
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
});

test('map with empty array', async () => {
  assert.deepEqual(await map([], async x => x), []);
});

test('map handles concurrency 1 (sequential)', async () => {
  const order = [];
  await map([1, 2, 3], async (x) => {
    order.push(x);
    await delay(10);
    order.push(`done-${x}`);
  }, 1);
  assert.deepEqual(order, [1, 'done-1', 2, 'done-2', 3, 'done-3']);
});

test('map concurrency limits parallelism', async () => {
  let active = 0;
  let maxActive = 0;
  const items = Array.from({ length: 10 }, (_, i) => i);
  await map(items, async (x) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await delay(20);
    active--;
  }, 3);
  assert.ok(maxActive <= 3, `max active was ${maxActive}`);
});

test('each calls fn for all items', async () => {
  let sum = 0;
  await each([1, 2, 3], async (x) => { sum += x; }, 2);
  assert.equal(sum, 6);
});

test('filter returns matching items', async () => {
  const result = await filter([1, 2, 3, 4, 5, 6], async (x) => x % 2 === 0, 2);
  assert.deepEqual(result, [2, 4, 6]);
});

test('reduce accumulates sequentially', async () => {
  const result = await reduce([1, 2, 3, 4], async (acc, x) => acc + x, 0);
  assert.equal(result, 10);
});

test('find returns first match', async () => {
  const result = await find([1, 2, 3, 4], async (x) => x > 2);
  assert.equal(result, 3);
});

test('find returns undefined if no match', async () => {
  const result = await find([1, 2, 3], async (x) => x > 10);
  assert.equal(result, undefined);
});

test('waterfall passes results through chain', async () => {
  const result = await waterfall([
    async () => 1,
    async (prev) => prev + 2,
    async (prev) => prev * 3
  ]);
  assert.equal(result, 9);
});

test('waterfall with initial value', async () => {
  const result = await waterfall([
    async (prev) => prev + 1,
    async (prev) => prev + 1
  ], 10);
  assert.equal(result, 12);
});

test('series runs functions sequentially', async () => {
  const order = [];
  await series([
    async () => { order.push('a'); return 1; },
    async () => { order.push('b'); return 2; }
  ]);
  assert.deepEqual(order, ['a', 'b']);
});

test('series returns results array', async () => {
  const results = await series([
    async () => 'x',
    async () => 'y'
  ]);
  assert.deepEqual(results, ['x', 'y']);
});

test('all with concurrency limit', async () => {
  const fns = [1, 2, 3, 4].map(n => async () => {
    await delay(10);
    return n * n;
  });
  const results = await all(fns, 2);
  assert.deepEqual(results, [1, 4, 9, 16]);
});

test('all with raw promises', async () => {
  const results = await all([Promise.resolve(1), Promise.resolve(2)]);
  assert.deepEqual(results, [1, 2]);
});

test('allSettled returns status for each', async () => {
  const fns = [
    async () => 'ok',
    async () => { throw new Error('bad'); }
  ];
  const results = await allSettled(fns);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[0].value, 'ok');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.message, 'bad');
});

test('promisify converts callback fn', async () => {
  function callbackStyle(x, cb) {
    setTimeout(() => cb(null, x * 2), 10);
  }
  const promised = promisify(callbackStyle);
  assert.equal(await promised(21), 42);
});

test('promisify handles errors', async () => {
  function errorCallback(cb) {
    setTimeout(() => cb(new Error('fail')), 10);
  }
  await assert.rejects(() => promisify(errorCallback)(), { message: 'fail' });
});

test('callbackify wraps async fn', async () => {
  const asyncFn = async (x) => x + 1;
  const cbFn = callbackify(asyncFn);
  const result = await new Promise(resolve => cbFn(5, (err, val) => resolve({ err, val })));
  assert.equal(result.err, null);
  assert.equal(result.val, 6);
});

test('memoize caches results', async () => {
  let calls = 0;
  const fn = memoize(async (x) => { calls++; return x * 2; });
  assert.equal(await fn(5), 10);
  assert.equal(await fn(5), 10);
  assert.equal(calls, 1);
  assert.equal(await fn(6), 12);
  assert.equal(calls, 2);
});

test('memoize handles concurrent calls (dedup inflight)', async () => {
  let calls = 0;
  const fn = memoize(async (x) => {
    calls++;
    await delay(20);
    return x;
  });
  // Fire two concurrent calls with same arg
  const [a, b] = await Promise.all([fn(1), fn(1)]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(calls, 1); // only one underlying call
});

test('memoize clear works', async () => {
  let calls = 0;
  const fn = memoize(async (x) => { calls++; return x; });
  await fn(1);
  fn.clear();
  await fn(1);
  assert.equal(calls, 2);
});

test('memoize custom key function', async () => {
  let calls = 0;
  const fn = memoize(
    async (a, b) => { calls++; return a + b; },
    (a, b) => `sum:${a}:${b}`
  );
  await fn(1, 2);
  await fn(1, 2);
  assert.equal(calls, 1);
});

test('once ensures single execution', async () => {
  let calls = 0;
  const fn = once(async () => { calls++; return 'result'; });
  const r1 = await fn();
  const r2 = await fn();
  assert.equal(r1, 'result');
  assert.equal(r2, 'result');
  assert.equal(calls, 1);
});

test('retry succeeds on first try', async () => {
  let calls = 0;
  const result = await retry(async () => { calls++; return 'ok'; });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('retry retries on failure', async () => {
  let calls = 0;
  const result = await retry(async () => {
    calls++;
    if (calls < 3) throw new Error('retry');
    return 'success';
  }, { times: 3, delay: 10 });
  assert.equal(result, 'success');
  assert.equal(calls, 3);
});

test('retry exhausts attempts', async () => {
  let calls = 0;
  await assert.rejects(
    () => retry(async () => { calls++; throw new Error('always'); }, { times: 2, delay: 5 }),
    { message: 'always' }
  );
  assert.equal(calls, 3); // initial + 2 retries
});

test('retry calls onRetry callback', async () => {
  const retries = [];
  await retry(async () => {
    throw new Error('fail');
  }, { times: 2, delay: 5, onRetry: (err, n) => retries.push({ err: err.message, n }) })
    .catch(() => {});
  assert.equal(retries.length, 2);
  assert.deepEqual(retries.map(r => r.n), [1, 2]);
});

test('queue processes items with concurrency', async () => {
  const q = queue(async (x) => x * 2, 2);
  const results = await Promise.all([
    q.push(1),
    q.push(2),
    q.push(3),
    q.push(4)
  ]);
  assert.deepEqual(results, [2, 4, 6, 8]);
});

test('queue onIdle resolves when empty', async () => {
  const q = queue(async (x) => delay(10, x), 1);
  q.push(1);
  q.push(2);
  await q.onIdle();
  assert.equal(q.size, 0);
});

test('queue pause/resume', async () => {
  const q = queue(async (x) => x, 1);
  q.pause();
  const p = q.push(1);
  // Should not resolve while paused
  let resolved = false;
  p.then(() => { resolved = true; });
  await delay(30);
  assert.equal(resolved, false);
  q.resume();
  assert.equal(await p, 1);
});

test('poll finds result', async () => {
  let attempts = 0;
  const result = await poll(async () => {
    attempts++;
    return attempts >= 3 ? 'found' : null;
  }, { interval: 10, maxAttempts: 5 });
  assert.equal(result, 'found');
  assert.equal(attempts, 3);
});

test('poll throws on maxAttempts', async () => {
  await assert.rejects(
    () => poll(async () => null, { interval: 5, maxAttempts: 3 }),
    { message: /max attempts/ }
  );
});

test('poll throws on timeout', async () => {
  await assert.rejects(
    () => poll(async () => null, { interval: 10, timeout: 50 }),
    { message: /timed out/ }
  );
});

test('tryify returns [null, value] on success', async () => {
  const [err, val] = await tryify(Promise.resolve(42));
  assert.equal(err, null);
  assert.equal(val, 42);
});

test('tryify returns [error, undefined] on failure', async () => {
  const [err, val] = await tryify(Promise.reject(new Error('boom')));
  assert.ok(err instanceof Error);
  assert.equal(err.message, 'boom');
  assert.equal(val, undefined);
});

test('tryify works with function', async () => {
  const [err, val] = await tryify(async () => 'hello');
  assert.equal(err, null);
  assert.equal(val, 'hello');
});
