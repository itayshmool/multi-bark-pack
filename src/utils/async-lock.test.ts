import { describe, it, expect } from 'vitest';
import { withLock } from './async-lock.js';

describe('withLock', () => {
  it('executes the function and returns its result', async () => {
    const result = await withLock('test-1', () => 42);
    expect(result).toBe(42);
  });

  it('executes async functions', async () => {
    const result = await withLock('test-2', async () => {
      await new Promise(r => setTimeout(r, 10));
      return 'done';
    });
    expect(result).toBe('done');
  });

  it('serializes calls with the same key', async () => {
    const order: number[] = [];

    const p1 = withLock('serial', async () => {
      order.push(1);
      await new Promise(r => setTimeout(r, 50));
      order.push(2);
      return 'first';
    });

    const p2 = withLock('serial', async () => {
      order.push(3);
      return 'second';
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('first');
    expect(r2).toBe('second');
    expect(order).toEqual([1, 2, 3]);
  });

  it('allows parallel execution for different keys', async () => {
    const order: string[] = [];

    const p1 = withLock('key-a', async () => {
      order.push('a-start');
      await new Promise(r => setTimeout(r, 50));
      order.push('a-end');
    });

    const p2 = withLock('key-b', async () => {
      order.push('b-start');
      await new Promise(r => setTimeout(r, 10));
      order.push('b-end');
    });

    await Promise.all([p1, p2]);
    expect(order[0]).toBe('a-start');
    expect(order[1]).toBe('b-start');
  });

  it('releases lock even if function throws', async () => {
    await expect(
      withLock('throw-key', () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');

    const result = await withLock('throw-key', () => 'recovered');
    expect(result).toBe('recovered');
  });

  it('queues multiple waiters in order', async () => {
    const order: number[] = [];

    const promises = [1, 2, 3, 4, 5].map(n =>
      withLock('queue', async () => {
        order.push(n);
        await new Promise(r => setTimeout(r, 5));
      }),
    );

    await Promise.all(promises);
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });
});
