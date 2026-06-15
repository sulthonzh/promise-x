# promise-x

Zero-dependency promise utilities for JavaScript/TypeScript. Concurrency-limited map, defer, timeout, waterfall, promisify, memoize, retry, queue, and more.

## Why

`Promise.all` is great until you have 10,000 items and don't want to fire them all at once. This library gives you the control primitives that Node's built-in `Promise` API is missing — without pulling in a 50kb dependency.

## Install

```bash
npm install promise-x
```

## Quick Start

```js
import { map, defer, timeout, retry, waterfall } from 'promise-x';

// Concurrency-limited map — process 1000 items 50 at a time
const results = await map(urls, url => fetch(url).then(r => r.json()), 50);

// Defer — create a promise you control externally
const { promise, resolve } = defer();
button.onclick = () => resolve('clicked!');
await promise; // resolves when button is clicked

// Timeout — reject if too slow
const data = await timeout(fetch('/api/slow'), 5000);

// Waterfall — chain transforms
const total = await waterfall([
  async () => await getUsers(),
  users => users.filter(u => u.active),
  active => active.reduce((sum, u) => sum + u.balance, 0)
]);
```

## API

### Concurrency Control

#### `map(items, mapper, concurrency?)`
Map over an array with an async mapper, limiting concurrent operations. Preserves order.
```js
// Fetch 200 URLs, 20 at a time
const bodies = await map(urls, async url => {
  const res = await fetch(url);
  return res.text();
}, 20);
```

#### `each(items, fn, concurrency?)`
Like `map` but doesn't collect results. For side-effect operations.
```js
await each(files, async file => await process(file), 5);
```

#### `filter(items, predicate, concurrency?)`
Async filter with concurrency limit.
```js
const valid = await filter(urls, async url => {
  const res = await fetch(url);
  return res.ok;
}, 10);
```

#### `reduce(items, reducer, initialValue)`
Sequential async reduce (no concurrency — reduce is inherently sequential).
```js
const total = await reduce(items, async (sum, item) => sum + await getPrice(item), 0);
```

#### `find(items, predicate)`
Sequential async find — returns first matching item, short-circuits.
```js
const user = await find(users, async u => await checkActive(u.id));
```

#### `all(fns, concurrency?)`
Like `Promise.all` but with optional concurrency limit. Items can be functions (called lazily) or promises.
```js
const results = await all(tasks, 3); // max 3 at a time
```

#### `allSettled(fns, concurrency?)`
Like `Promise.allSettled` with concurrency limit. Always resolves, never rejects.

### Flow Control

#### `waterfall(fns, initial?)`
Run functions in sequence, passing each result to the next.
```js
const result = await waterfall([
  async () => await fetchUsers(),
  users => users.length,
  count => `${count} users found`
]);
```

#### `series(fns)`
Run async functions sequentially. Returns array of results.
```js
const [a, b, c] = await series([taskA, taskB, taskC]);
```

### Promise Utilities

#### `defer()`
Create a `{ promise, resolve, reject }` triple. Perfect for bridging event systems.
```js
const d = defer();
emitter.on('ready', d.resolve);
emitter.on('error', d.reject);
await d.promise;
```

#### `delay(ms, value?)`
Resolve after `ms` with optional value. Like `setTimeout` but promisified.
```js
await delay(1000); // wait 1s
await delay(500, 'hello'); // wait 500ms, return 'hello'
```

#### `timeout(promise, ms, options?)`
Reject if promise doesn't settle within `ms`.
```js
const result = await timeout(fetch(url), 5000);
// With fallback instead of error:
const cached = await timeout(fetch(url), 1000, { fallback: cache.get(key) });
// Custom error message:
await timeout(fn(), 5000, { message: 'API timed out' });
```

#### `poll(fn, options?)`
Poll an async function until it returns truthy or limits are hit.
```js
const status = await poll(async () => {
  const res = await fetch('/api/status');
  const data = await res.json();
  return data.ready ? data : null;
}, { interval: 2000, timeout: 60000 });
```

#### `tryify(promiseOrFn)`
Go-style error handling — never throws, returns `[error, value]` tuple.
```js
const [err, data] = await tryify(fetchJson(url));
if (err) handle(err);
else use(data);
```

### Callback Bridge

#### `promisify(fn)`
Convert a callback-style function to return a promise.
```js
const readFile = promisify(fs.readFile);
const content = await readFile('file.txt', 'utf8');
```

#### `callbackify(asyncFn)`
Convert a promise-returning function to callback-style.

### Caching & Memoization

#### `memoize(asyncFn, keyFn?)`
Cache async results by argument signature. Deduplicates concurrent calls.
```js
const fetchUser = memoize(async (id) => {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
});
await fetchUser(1); // fetches
await fetchUser(1); // cached (no new fetch)
fetchUser.clear();  // clear cache
fetchUser.cache;    // Map of cached results
```

#### `once(asyncFn)`
Ensure an async function only executes once. Subsequent calls return the same promise.

### Retry

#### `retry(fn, options?)`
Retry a failing async function with configurable backoff.
```js
const result = await retry(async () => {
  return await fetch(url);
}, {
  times: 5,
  delay: 1000,
  backoff: 'exponential', // or 'linear' or 'constant'
  factor: 2,
  onRetry: (err, attempt) => console.log(`Retry ${attempt}: ${err.message}`)
});
```

### Queue

#### `queue(worker, concurrency)`
Create a persistent queue with fixed concurrency. Items processed as workers free up.
```js
const q = queue(async (item) => {
  return await processItem(item);
}, 3); // 3 concurrent workers

// Push items anytime
q.push(item1).then(result1 => console.log(result1));
q.push(item2).then(result2 => console.log(result2));

// Wait for all to complete
await q.onIdle();

// Pause/resume
q.pause();
q.resume();
```

## CLI

```bash
# Interactive demo
npx promise-x demo

# Map over JSON array with concurrency
npx promise-x map '[1,2,3,4,5]' --concurrency=2

# Retry a function
npx promise-x retry "throw new Error('test')" --times=3 --delay=100

# Timeout demo
npx promise-x timeout --ms=1000 --wait=2000
```

## Zero Dependencies

No runtime dependencies. Works in Node.js 18+ and modern browsers (anything with `Promise` support).

## License

MIT
