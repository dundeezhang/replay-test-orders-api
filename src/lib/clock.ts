export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface ManualClock extends Clock {
  set(at: Date): void;
  advance(ms: number): void;
}

export function manualClock(start: Date = new Date('2024-01-01T00:00:00.000Z')): ManualClock {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    set: (at) => {
      current = at.getTime();
    },
    advance: (ms) => {
      current += ms;
    },
  };
}
