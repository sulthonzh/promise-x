/**
 * promise-x — Zero-dependency promise utilities
 * Concurrency-limited map, defer, timeout, waterfall, promisify, memoize, and more.
 */

/**
 * Create a deferred promise — { promise, resolve, reject }.
 * @returns {{ promise: Promise, resolve: Function, reject: Function }}
 */
export function defer() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Resolve with a value after `ms` milliseconds.
 * @param {number} ms
 * @param {*} [value]
 * @returns {Promise}
 */
export function delay(ms, value) {
  return new Promise(resolve => setTimeout(() => resolve(value), ms));
}

/**
 * Reject a promise if it doesn't settle within `ms` milliseconds.
 * @param {Promise} promise
 * @param {number} ms
 * @param {{ message?: string, fallback?: any }} [options]
 * @returns {Promise}
 */
export function timeout(promise, ms, options = {}) {
  let timerId;
  const timer = new Promise((resolve) => {
    timerId = setTimeout(() => {
      if (options.fallback !== undefined) {
        resolve(options.fallback);
      } else {
        // Force rejection by racing with a rejecting promise
        resolve(PROMISE_TIMEOUT_TOKEN);
      }
    }, ms);
  });

  return Promise.race([
    promise.then(v => { clearTimeout(timerId); return v; }),
    timer.then(token => {
      if (token === PROMISE_TIMEOUT_TOKEN) {
        throw new Error(options.message || `Promise timed out after ${ms}ms`);
      }
      return token;
    })
  ]);
}

const PROMISE_TIMEOUT_TOKEN = Symbol('promise-x-timeout');

/**
 * Map over an array with an async mapper, limiting concurrency.
 * Preserves order of results.
 * @param {Array} items
 * @param {Function} mapper — async(item, index) => result
 * @param {number} [concurrency=Infinity]
 * @returns {Promise<Array>}
 */
export async function map(items, mapper, concurrency = Infinity) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = [];
  const numWorkers = Math.min(concurrency, items.length);
  for (let i = 0; i < numWorkers; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

/**
 * Run an async function over each item with concurrency limit.
 * @param {Array} items
 * @param {Function} fn — async(item, index)
 * @param {number} [concurrency=Infinity]
 */
export async function each(items, fn, concurrency = Infinity) {
  await map(items, fn, concurrency);
}

/**
 * Filter items through an async predicate with concurrency limit.
 * @param {Array} items
 * @param {Function} predicate — async(item, index) => boolean
 * @param {number} [concurrency=Infinity]
 * @returns {Promise<Array>}
 */
export async function filter(items, predicate, concurrency = Infinity) {
  const keep = await map(items, predicate, concurrency);
  return items.filter((_, i) => keep[i]);
}

/**
 * Reduce items through an async reducer sequentially.
 * @param {Array} items
 * @param {Function} reducer — async(acc, item, index) => newAcc
 * @param {*} initialValue
 * @returns {Promise<*>}
 */
export async function reduce(items, reducer, initialValue) {
  let acc = initialValue;
  for (let i = 0; i < items.length; i++) {
    acc = await reducer(acc, items[i], i);
  }
  return acc;
}

/**
 * Find the first item that passes an async predicate (sequential).
 * @param {Array} items
 * @param {Function} predicate — async(item, index) => boolean
 * @returns {Promise<*>} the first matching item, or undefined
 */
export async function find(items, predicate) {
  for (let i = 0; i < items.length; i++) {
    if (await predicate(items[i], i)) return items[i];
  }
  return undefined;
}

/**
 * Run async functions in sequence, passing the result of each to the next.
 * @param {Array<Function>} fns — array of async(prev) => next functions
 * @param {*} [initial]
 * @returns {Promise<*>}
 */
export async function waterfall(fns, initial) {
  let result = initial;
  for (const fn of fns) {
    result = await fn(result);
  }
  return result;
}

/**
 * Run async functions in sequence (no result passing).
 * @param {Array<Function>} fns — array of () => Promise functions
 * @returns {Promise<Array>}
 */
export async function series(fns) {
  const results = [];
  for (const fn of fns) {
    results.push(await fn());
  }
  return results;
}

/**
 * Run all promises with a concurrency limit (like Promise.all but batched).
 * @param {Array<Promise|Function>} items — if functions, they're called lazily
 * @param {number} concurrency
 * @returns {Promise<Array>}
 */
export async function all(items, concurrency = Infinity) {
  const fns = items.map(item => typeof item === 'function' ? item : () => item);
  return map(fns, fn => fn(), concurrency);
}

/**
 * allSettled with concurrency limit.
 * @param {Array<Function>} fns — array of () => Promise functions
 * @param {number} concurrency
 * @returns {Promise<Array<{ status: string, value?: *, reason?: * }>>}
 */
export async function allSettled(fns, concurrency = Infinity) {
  const mapper = async (fn) => {
    try {
      const value = await fn();
      return { status: 'fulfilled', value };
    } catch (reason) {
      return { status: 'rejected', reason };
    }
  };
  return map(fns, mapper, concurrency);
}

/**
 * Promisify a callback-style function.
 * Assumes node-style (err, result) callback as last argument.
 * @param {Function} fn
 * @returns {Function} — returns a Promise
 */
export function promisify(fn) {
  return function (...args) {
    return new Promise((resolve, reject) => {
      fn.call(this, ...args, (err, ...results) => {
        if (err) return reject(err);
        resolve(results.length > 1 ? results : results[0]);
      });
    });
  };
}

/**
 * Convert a promise-returning function to a callback-style function.
 * @param {Function} asyncFn
 * @returns {Function}
 */
export function callbackify(asyncFn) {
  return function (...args) {
    const cb = args[args.length - 1];
    Promise.resolve(asyncFn.apply(this, args.slice(0, -1)))
      .then(result => cb(null, result))
      .catch(err => cb(err));
  };
}

/**
 * Memoize an async function — caches results by argument signature.
 * Supports manual cache control via .clear(), .cache (Map).
 * @param {Function} asyncFn
 * @param {Function} [keyFn] — custom key serializer (default: JSON.stringify args)
 * @returns {Function} with .cache (Map) and .clear() attached
 */
export function memoize(asyncFn, keyFn) {
  const cache = new Map();
  const inflight = new Map();

  const memoized = function (...args) {
    const key = keyFn ? keyFn(...args) : JSON.stringify(args);

    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (inflight.has(key)) return inflight.get(key);

    const p = Promise.resolve(asyncFn.apply(this, args)).then(result => {
      cache.set(key, result);
      inflight.delete(key);
      return result;
    }).catch(err => {
      inflight.delete(key);
      throw err;
    });

    inflight.set(key, p);
    return p;
  };

  memoized.cache = cache;
  memoized.clear = () => { cache.clear(); };
  return memoized;
}

/**
 * Ensure an async function is only called once.
 * Subsequent calls return the first promise.
 * @param {Function} asyncFn
 * @returns {Function}
 */
export function once(asyncFn) {
  let promise = null;
  return function (...args) {
    if (!promise) {
      promise = Promise.resolve(asyncFn.apply(this, args));
    }
    return promise;
  };
}

/**
 * Retry an async function on failure.
 * @param {Function} fn — () => Promise
 * @param {{ times?: number, delay?: number, backoff?: 'constant'|'exponential'|'linear', factor?: number, onRetry?: Function }} [options]
 * @returns {Promise}
 */
export async function retry(fn, options = {}) {
  const {
    times = 3,
    delay: baseDelay = 0,
    backoff = 'constant',
    factor = 2,
    onRetry = null
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= times; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= times) break;

      if (onRetry) onRetry(err, attempt + 1);

      if (baseDelay > 0) {
        let waitTime;
        switch (backoff) {
          case 'exponential': waitTime = baseDelay * Math.pow(factor, attempt); break;
          case 'linear': waitTime = baseDelay * (attempt + 1); break;
          default: waitTime = baseDelay;
        }
        await delay(waitTime);
      }
    }
  }
  throw lastError;
}

/**
 * Create a queue with fixed concurrency.
 * Items are processed as workers become available.
 * Returns a controller with push(), onIdle(), and size.
 * @param {Function} worker — async(item) => result
 * @param {number} concurrency
 * @returns {{ push: Function, onIdle: Function, size: number, pause: Function, resume: Function }}
 */
export function queue(worker, concurrency = 1) {
  const items = [];
  const results = [];
  let pending = 0;
  let paused = false;
  let idleResolvers = [];

  function process() {
    if (paused || pending >= concurrency || items.length === 0) {
      if (pending === 0 && items.length === 0) {
        idleResolvers.forEach(r => r());
        idleResolvers = [];
      }
      return;
    }

    const { item, resolve, reject } = items.shift();
    pending++;
    Promise.resolve(worker(item))
      .then(result => {
        resolve(result);
        pending--;
        process();
      })
      .catch(err => {
        reject(err);
        pending--;
        process();
      });
  }

  return {
    push(item) {
      return new Promise((resolve, reject) => {
        items.push({ item, resolve, reject });
        process();
      });
    },
    onIdle() {
      if (pending === 0 && items.length === 0) return Promise.resolve();
      return new Promise(r => idleResolvers.push(r));
    },
    get size() { return items.length + pending; },
    pause() { paused = true; },
    resume() { paused = false; process(); }
  };
}

/**
 * Poll an async function until it returns a truthy value or times out.
 * @param {Function} fn — async() => value (truthy = done)
 * @param {{ interval?: number, timeout?: number, maxAttempts?: number }} [options]
 * @returns {Promise<*>} the truthy result
 */
export async function poll(fn, options = {}) {
  const { interval = 1000, timeout: maxTimeout = 0, maxAttempts = 0 } = options;
  const start = Date.now();
  let attempts = 0;

  while (true) {
    const result = await fn();
    if (result) return result;

    attempts++;
    if (maxAttempts > 0 && attempts >= maxAttempts) {
      throw new Error(`Polling exceeded max attempts (${maxAttempts})`);
    }
    if (maxTimeout > 0 && Date.now() - start >= maxTimeout) {
      throw new Error(`Polling timed out after ${maxTimeout}ms`);
    }

    await delay(interval);
  }
}

/**
 * Run an async function and get a { value, error } tuple (Go-style).
 * Never throws — errors are returned in the tuple.
 * @param {Promise|Function} promiseOrFn
 * @returns {Promise<[Error|null, *]>}
 */
export async function tryify(promiseOrFn) {
  try {
    const p = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;
    const value = await p;
    return [null, value];
  } catch (err) {
    return [err, undefined];
  }
}

export default {
  defer,
  delay,
  timeout,
  map,
  each,
  filter,
  reduce,
  find,
  waterfall,
  series,
  all,
  allSettled,
  promisify,
  callbackify,
  memoize,
  once,
  retry,
  queue,
  poll,
  tryify
};
