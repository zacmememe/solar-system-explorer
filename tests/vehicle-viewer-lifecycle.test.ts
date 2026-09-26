import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { VehicleLoader } from '../src/vehicles/VehicleLoader';
import { VehicleViewer3D } from '../src/vehicles/VehicleViewer3D';
import type { VehicleId } from '../src/contracts/vehicle';

// Exercise the actual effects and Three scene graph without a GPU or new DOM dependency.
const hooks = vi.hoisted(() => ({ refs: [] as any[], index: 0, effects: [] as (() => void | (() => void))[], container: null as any, camera: null as any }));
vi.mock('react', async importOriginal => ({ ...(await importOriginal<any>()),
  useRef: (initial: any) => { const i = hooks.index++; return hooks.refs[i] ??= { current: i === 0 ? hooks.container : initial }; },
  useState: (initial: any) => [initial, vi.fn()],
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));
vi.mock('three', async importOriginal => ({ ...(await importOriginal<any>()), WebGLRenderer: class {
  domElement = { addEventListener: vi.fn(), removeEventListener: vi.fn(), parentElement: null };
  setSize() {} setPixelRatio() {} render(_scene: unknown, camera: unknown) { hooks.camera = camera; } dispose() {}
} }));
function render(id: VehicleId, publish = vi.fn()) {
  hooks.index = 0; hooks.effects = [];
  VehicleViewer3D({ vehicleId: id, onLoadState: publish });
  return hooks.effects.slice();
}
function mount() {
  hooks.refs = []; hooks.container = { clientWidth: 400, clientHeight: 340, appendChild: vi.fn() };
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const published = vi.fn(), effects = render('hubble', published);
  effects[0](); const cleanupScene = effects[1]()!; const cleanupLoad = effects[2]()!;
  return { published, cleanupScene, cleanupLoad };
}
function delayed() { let resolve!: (g: T.Group) => void; const promise = new Promise<T.Group>(r => { resolve = r; }); return { resolve, promise }; }
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('hangar request ownership', () => {
  it('keeps a large native-unit asset inside the far plane during camera framing', async () => {
    const request = delayed(), model = new T.Group();
    model.userData = { maxDim: 1000, size: new T.Vector3(1000, 500, 500) };
    vi.spyOn(VehicleLoader, 'loadVehicle').mockReturnValue(request.promise);
    const { cleanupLoad, cleanupScene } = mount();
    request.resolve(model); await flush();
    vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0](0);
    expect(hooks.camera.far).toBeGreaterThan(hooks.camera.position.length() + 1000);
    cleanupLoad(); cleanupScene();
  });
  it('releases late results after unmount and disposes viewer helpers', async () => {
    const request = delayed(), model = new T.Group(); vi.spyOn(VehicleLoader, 'loadVehicle').mockReturnValue(request.promise);
    const dispose = vi.spyOn(VehicleLoader, 'disposeVehicleObject');
    const { published, cleanupScene, cleanupLoad } = mount();
    const marker = hooks.refs.map(ref => ref.current).find(value => value?.isMesh);
    const grid = hooks.refs.map(ref => ref.current).find(value => value instanceof T.GridHelper);
    const markerDisposed = vi.spyOn(marker.geometry, 'dispose'), gridDisposed = vi.spyOn(grid!.geometry, 'dispose');
    cleanupScene(); cleanupLoad(); request.resolve(model); await flush();
    expect(dispose).toHaveBeenCalledWith(model); expect(model.parent).toBeNull(); expect(published).toHaveBeenCalledTimes(1);
    expect(published).toHaveBeenCalledWith('hubble', 'loading'); expect(markerDisposed).toHaveBeenCalledOnce(); expect(gridDisposed).toHaveBeenCalledOnce();
  });
  it('keeps the latest model and ignores another consumer changing legacy generations', async () => {
    const old = delayed(), next = delayed(), staleModel = new T.Group(), newModel = new T.Group();
    newModel.userData = { maxDim: 4, size: new T.Vector3(4, 2, 1) };
    vi.spyOn(VehicleLoader, 'loadVehicle').mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const dispose = vi.spyOn(VehicleLoader, 'disposeVehicleObject');
    const { cleanupLoad, cleanupScene } = mount(); cleanupLoad();
    const published = vi.fn(), effects = render('iss', published), cleanupNext = effects[2]()!;
    VehicleLoader.nextGeneration(); VehicleLoader.nextGeneration();
    next.resolve(newModel); await flush(); const parent = newModel.parent;
    expect(parent).not.toBeNull(); expect(published).toHaveBeenLastCalledWith('iss', 'ready');
    old.resolve(staleModel); await flush();
    expect(staleModel.parent).toBeNull(); expect(dispose).toHaveBeenCalledWith(staleModel); expect(newModel.parent).toBe(parent);
    cleanupNext(); cleanupScene();
  });
});
