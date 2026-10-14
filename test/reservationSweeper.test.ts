import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../src/lib/logger.js';
import { ReservationSweeper } from '../src/jobs/reservationSweeper.js';
import type { InventoryService } from '../src/services/inventoryService.js';

function fakeInventory(sweep: () => Promise<number>): InventoryService {
  return { sweepExpired: vi.fn(sweep) } as unknown as InventoryService;
}

describe('ReservationSweeper', () => {
  it('returns the number of reservations processed', async () => {
    const sweeper = new ReservationSweeper(fakeInventory(async () => 3), silentLogger, 1000);
    expect(await sweeper.tick()).toBe(3);
  });

  it('does not run overlapping sweeps', async () => {
    let finish: (count: number) => void = () => undefined;
    const inventory = fakeInventory(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    const sweeper = new ReservationSweeper(inventory, silentLogger, 1000);

    const first = sweeper.tick();
    expect(await sweeper.tick()).toBe(0);
    finish(2);
    expect(await first).toBe(2);
    expect(inventory.sweepExpired).toHaveBeenCalledTimes(1);
  });

  it('swallows and logs sweep failures', async () => {
    const sweeper = new ReservationSweeper(
      fakeInventory(async () => {
        throw new Error('boom');
      }),
      silentLogger,
      1000,
    );
    await expect(sweeper.tick()).resolves.toBe(0);
  });
});
