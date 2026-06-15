#!/usr/bin/env node
/**
 * promise-x CLI — demonstrate and test promise utilities
 */
import { defer, delay, timeout, map, each, filter, waterfall, series, all, allSettled, memoize, retry, queue, poll, tryify } from './index.js';

const [, , command, ...args] = process.argv;
const opts = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => {
  const [k, v] = a.slice(2).split('=');
  return [k, isNaN(v) ? v : Number(v)];
}));

async function demo() {
  console.log('=== promise-x demo ===\n');

  // 1. Concurrency-limited map
  console.log('1. map with concurrency=2');
  const numbers = [1, 2, 3, 4, 5];
  const doubled = await map(numbers, async (x) => {
    await delay(50);
    return x * 2;
  }, 2);
  console.log('  results:', doubled);

  // 2. Waterfall
  console.log('\n2. waterfall (chained transforms)');
  const result = await waterfall([
    async () => 10,
    async (prev) => prev + 5,
    async (prev) => prev * 2
  ]);
  console.log('  result:', result);

  // 3. Queue
  console.log('\n3. queue (concurrency=2)');
  const q = queue(async (x) => {
    await delay(30);
    return x ** 2;
  }, 2);
  const qResults = await Promise.all([q.push(3), q.push(4), q.push(5)]);
  console.log('  results:', qResults);

  // 4. tryify (Go-style error handling)
  console.log('\n4. tryify (Go-style)');
  const [err, val] = await tryify(Promise.resolve('success'));
  console.log('  success:', err, val);
  const [err2] = await tryify(Promise.reject(new Error('oops')));
  console.log('  error:', err2.message);

  // 5. retry
  console.log('\n5. retry with backoff');
  let attempts = 0;
  const retryResult = await retry(async () => {
    attempts++;
    console.log(`  attempt ${attempts}...`);
    if (attempts < 3) throw new Error('not yet');
    return 'finally!';
  }, { times: 3, delay: 50, backoff: 'exponential' });
  console.log('  result:', retryResult);

  console.log('\n✓ All demos completed');
}

async function runMap() {
  const input = args.find(a => !a.startsWith('-'));
  const items = input ? JSON.parse(input) : [1, 2, 3];
  const concurrency = opts.concurrency || Infinity;
  const results = await map(items, async (x) => x * 2, concurrency);
  console.log(results);
}

async function runRetry() {
  const fn = new Function(`return async () => { ${args.find(a => !a.startsWith('-')) || 'return 42'} }`);
  const times = opts.times || 3;
  const wait = opts.delay || 100;
  try {
    const result = await retry(fn(), { times, delay: wait, onRetry: (e, n) => console.error(`retry ${n}: ${e.message}`) });
    console.log('result:', result);
  } catch (e) {
    console.error('failed:', e.message);
    process.exit(1);
  }
}

async function runTimeout() {
  const ms = opts.ms || 1000;
  const wait = opts.wait || 2000;
  console.log(`waiting ${wait}ms with ${ms}ms timeout...`);
  try {
    const result = await timeout(delay(wait, 'done'), ms);
    console.log('result:', result);
  } catch (e) {
    console.error('timed out:', e.message);
    process.exit(1);
  }
}

const commands = {
  demo,
  map: runMap,
  retry: runRetry,
  timeout: runTimeout,
};

if (commands[command]) {
  commands[command]().catch(e => { console.error(e.message); process.exit(1); });
} else {
  console.log(`promise-x CLI

Commands:
  demo          Run interactive demo
  map <json>    Map over JSON array (--concurrency=N)
  retry <code>  Retry an async function (--times=N --delay=ms)
  timeout       Demo timeout (--ms=N --wait=ms)

Options:
  --concurrency=N   Concurrency limit for map
  --times=N         Number of retry attempts
  --delay=ms        Base delay between retries
  --wait=ms         How long to wait (timeout demo)
  --ms=ms           Timeout threshold (timeout demo)`);
}
