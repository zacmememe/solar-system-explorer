import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SolarEngine } from '../src/engine/SolarEngine';
import { VehicleLoader } from '../src/vehicles/VehicleLoader';
import { VehicleMeshBuilder } from '../src/vehicles/VehicleMeshBuilder';
import { getSolarPanelTexture } from '../src/vehicles/VehicleTextures';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function deferred() { let resolve!: (g: T.Group) => void, reject!: (e: Error) => void; const promise = new Promise<T.Group>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture() {
  const snapshot = { mode: 'ORBIT_TARGET', isTransitioning: false };
  let landing = 'ORBIT';
  const engine: any = Object.create(SolarEngine.prototype);
  Object.assign(engine, { vehicleLoadGeneration: 0, currentVehicleId: null, currentVehicleMesh: null, vehicleGroup: new T.Group(), vehicleDisposed: false,
    viewCameraMode: 'PLANET_OBSERVE', vehicleLightingMode: 'PLANET_OBSERVE', callbacks: { onVehicleLoadError: vi.fn() },
    cameraController: { getSnapshot: () => snapshot }, landingController: { getState: () => landing, getSite: () => ({ bodyId: 'moon' }) },
    cameraHeadlight: new T.DirectionalLight(), ambientLight: new T.AmbientLight(), teachingLight: false,
    canvas: { removeEventListener: vi.fn() }, assetManager: { disposeAll: vi.fn() }, renderer: { dispose: vi.fn() }, bodyNodes: new Map(),
  });
  return { engine: engine as SolarEngine, raw: engine, snapshot, descend: () => { landing = 'DESCENDING'; } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('vehicle request outcomes', () => {
  it('publishes only installed IDs and preserves the requested mode through a normal transfer', async () => {
    const { engine, snapshot, raw } = fixture(), request = deferred(), ready = vi.fn();
    vi.spyOn(VehicleLoader, 'loadVehicle').mockReturnValue(request.promise);
    engine.setVehicle('cassini', ready); engine.setViewCameraMode('VEHICLE_FORMATION');
    expect(engine.getCurrentVehicle()).toBeNull(); expect(engine.getPendingVehicle()).toBe('cassini'); expect(engine.getViewCameraMode()).toBe('PLANET_OBSERVE'); expect(ready).not.toHaveBeenCalled();
    snapshot.mode = 'TRANSITION'; snapshot.isTransitioning = true;
    request.resolve(new T.Group()); await flush();
    expect(engine.getCurrentVehicle()).toBe('cassini'); expect(ready).toHaveBeenCalledOnce(); expect(engine.getViewCameraMode()).toBe('PLANET_OBSERVE');
    snapshot.mode = 'ORBIT_TARGET'; snapshot.isTransitioning = false;
    expect(engine.getViewCameraMode()).toBe('VEHICLE_FORMATION'); expect(raw.currentVehicleMesh).toBeTruthy();
  });
  it('clears a rejected load and permits retry without a false success notification', async () => {
    const { engine, raw } = fixture(), ready = vi.fn();
    const load = vi.spyOn(VehicleLoader, 'loadVehicle').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new T.Group());
    engine.setVehicle('cassini', ready); engine.setViewCameraMode('VEHICLE_FORMATION'); await flush();
    expect(ready).not.toHaveBeenCalled(); expect(engine.getCurrentVehicle()).toBeNull(); expect(engine.getPendingVehicle()).toBeNull(); expect(raw.vehicleGroup.visible).toBe(false);
    expect(raw.callbacks.onVehicleLoadError).toHaveBeenCalledOnce(); expect(engine.getViewCameraMode()).toBe('PLANET_OBSERVE');
    engine.setVehicle('cassini', ready); await flush(); expect(ready).toHaveBeenCalledOnce(); expect(load).toHaveBeenCalledTimes(2);
  });
  it.each(['resolve', 'reject'] as const)('ignores an old %s after another selection', async outcome => {
    const { engine, raw } = fixture(), old = deferred(), next = new T.Group(), oldModel = new T.Group(), ready = vi.fn();
    vi.spyOn(VehicleLoader, 'loadVehicle').mockReturnValueOnce(old.promise).mockResolvedValueOnce(next);
    const dispose = vi.spyOn(VehicleLoader, 'disposeVehicleObject');
    engine.setVehicle('cassini', ready); engine.setVehicle('iss'); await flush();
    if (outcome === 'resolve') old.resolve(oldModel); else old.reject(new Error('old failure')); await flush();
    expect(engine.getCurrentVehicle()).toBe('iss'); expect(raw.currentVehicleMesh).toBe(next); expect(ready).not.toHaveBeenCalled(); expect(raw.callbacks.onVehicleLoadError).not.toHaveBeenCalled();
    if (outcome === 'resolve') expect(dispose).toHaveBeenCalledWith(oldModel);
  });
  it.each(['clear', 'descent', 'dispose'] as const)('discards late completion after %s', async action => {
    const { engine, raw, descend } = fixture(), request = deferred(), model = new T.Group(), ready = vi.fn();
    vi.spyOn(VehicleLoader, 'loadVehicle').mockReturnValue(request.promise);
    const dispose = vi.spyOn(VehicleLoader, 'disposeVehicleObject');
    engine.setVehicle('cassini', ready);
    if (action === 'clear') engine.setVehicle(null);
    if (action === 'descent') descend();
    if (action === 'dispose') {
      vi.stubGlobal('window', { removeEventListener: vi.fn() }); vi.stubGlobal('document', { removeEventListener: vi.fn() }); vi.stubGlobal('cancelAnimationFrame', vi.fn());
      engine.dispose(); expect(engine.setVehicle('iss')).toBe(false);
      raw.cameraController.getSnapshot = () => { throw new Error('dead camera accessed'); };
    }
    request.resolve(model); await flush();
    expect(ready).not.toHaveBeenCalled(); expect(engine.getCurrentVehicle()).toBeNull(); expect(raw.vehicleGroup.children).toHaveLength(0); expect(dispose).toHaveBeenCalledWith(model); expect(raw.callbacks.onVehicleLoadError).not.toHaveBeenCalled();
  });
});

describe('strict assets and resource ownership', () => {
  it('gives simultaneous ISS consumers independent texture wrappers over shared image data', async () => {
    const first = await VehicleLoader.loadVehicle('iss'), second = await VehicleLoader.loadVehicle('iss');
    const findTexture = (group: T.Group) => {
      let found!: T.Texture;
      group.traverse(child => { if (child instanceof T.Mesh && child.material.name === 'iss-solar-cells') found = child.material.map; });
      return found;
    };
    const a = findTexture(first!), b = findTexture(second!), cached = getSolarPanelTexture();
    expect(a).not.toBe(b); expect(a).not.toBe(cached); expect(a.source).toBe(cached.source); expect(b.source).toBe(cached.source);
    const releaseA = vi.fn(), releaseB = vi.fn(); a.addEventListener('dispose', releaseA); b.addEventListener('dispose', releaseB);
    VehicleLoader.disposeVehicleObject(first); expect(releaseA).toHaveBeenCalledOnce(); expect(releaseB).not.toHaveBeenCalled();
    VehicleLoader.disposeVehicleObject(second); expect(releaseB).toHaveBeenCalledOnce();
  });
  it('rejects GLB failures without substituting a procedural model', async () => {
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockRejectedValue(new Error('404'));
    const build = vi.spyOn(VehicleMeshBuilder, 'buildVehicle');
    await expect(VehicleLoader.loadVehicle('cassini')).rejects.toThrow('未能加载'); expect(build).not.toHaveBeenCalled();
  });
  it('rejects incomplete textures and keeps concurrent managers isolated', async () => {
    const bad = new T.Group(), good = new T.Group(); good.add(new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial()));
    const managers: T.LoadingManager[] = [];
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async function(this: GLTFLoader) {
      managers.push(this.manager);
      if (managers.length === 1) { this.manager.itemError('missing.png'); return { scene: bad } as any; }
      return { scene: good } as any;
    });
    const dispose = vi.spyOn(VehicleLoader, 'disposeVehicleObject');
    const [failed, succeeded] = await Promise.allSettled([VehicleLoader.loadVehicle('cassini'), VehicleLoader.loadVehicle('cassini')]);
    expect(failed.status).toBe('rejected'); expect(succeeded.status).toBe('fulfilled'); expect(managers[0]).not.toBe(managers[1]); expect(dispose).toHaveBeenCalledWith(bad);
  });
  it('disposes shared instance resources once and preserves the procedural texture cache', () => {
    const cached = getSolarPanelTexture(), owned = new T.Texture(), geo = new T.BoxGeometry(), material = new T.MeshStandardMaterial({ map: cached, normalMap: owned, roughnessMap: owned });
    const cachedDispose = vi.spyOn(cached, 'dispose'), ownedDispose = vi.spyOn(owned, 'dispose'), geoDispose = vi.spyOn(geo, 'dispose'), matDispose = vi.spyOn(material, 'dispose');
    const group = new T.Group(); group.add(new T.Mesh(geo, material), new T.Mesh(geo, material));
    VehicleLoader.disposeVehicleObject(group);
    expect(cachedDispose).not.toHaveBeenCalled(); expect(ownedDispose).toHaveBeenCalledOnce(); expect(geoDispose).toHaveBeenCalledOnce(); expect(matDispose).toHaveBeenCalledOnce(); expect(group.children).toHaveLength(0);
  });
});
