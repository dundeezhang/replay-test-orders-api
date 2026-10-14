import type { Logger } from '../lib/logger.js';
import type { InventoryService } from '../services/inventoryService.js';

/**
 * Periodically releases reservations whose TTL has elapsed so abandoned
 * checkouts stop holding stock. Ticks never overlap.
 */
export class ReservationSweeper {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly inventory: InventoryService,
    private readonly logger: Logger,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<number> {
    if (this.running) {
      return 0;
    }
    this.running = true;
    try {
      const processed = await this.inventory.sweepExpired();
      if (processed > 0) {
        this.logger.info('released expired reservations', { count: processed });
      }
      return processed;
    } catch (err) {
      this.logger.error('reservation sweep failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    } finally {
      this.running = false;
    }
  }
}
