import type { HudFrame } from '../../contracts/hud';

/** Engine publishes; only the HUD subscribes. React never advances astronomical time. */
export function createHudStore() {
  let frame: HudFrame | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => frame,
    getServerSnapshot: (): HudFrame | null => null,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    publish(next: HudFrame | null) {
      if (next === frame) return;
      frame = next;
      listeners.forEach(listener => listener());
    },
  };
}
export type HudStore = ReturnType<typeof createHudStore>;
