import { bandFor } from './banding';

const T = { high: 0.9, confirm: 0.7 };

describe('E4-S10 confidence banding', () => {
  it('bands exactly at the high boundary as high', () => {
    expect(bandFor(0.9, T)).toBe('high');
    expect(bandFor(0.900001, T)).toBe('high');
    expect(bandFor(1, T)).toBe('high');
  });

  it('bands just under high as confirm', () => {
    expect(bandFor(0.899999, T)).toBe('confirm');
  });

  it('bands exactly at the confirm boundary as confirm', () => {
    expect(bandFor(0.7, T)).toBe('confirm');
  });

  it('bands just under confirm as unrecognized', () => {
    expect(bandFor(0.699999, T)).toBe('unrecognized');
    expect(bandFor(0, T)).toBe('unrecognized');
  });

  it('respects tenant-tuned thresholds', () => {
    const strict = { high: 0.98, confirm: 0.85 };
    expect(bandFor(0.95, strict)).toBe('confirm');
    expect(bandFor(0.95, T)).toBe('high');
  });
});
