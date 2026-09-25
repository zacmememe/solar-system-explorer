import {it,expect,vi} from 'vitest';
import {SolarEngine} from '../src/engine/SolarEngine';
import {LANDING_SITES} from '../src/contracts/landing';
import type {BookmarkItemV3} from '../src/contracts/bookmark';
import {upgradeBookmarkToV3} from '../src/contracts/bookmark';
import {isValidBookmarkAnyVersion,PRESET_BOOKMARKS_V3} from '../src/utils/bookmarkStorage';

const surfaceBookmark={surfaceStation:{bodyId:'moon',latDeg:26.1327,lonDeg:3.6331,eyeHeightM:1.7}} as BookmarkItemV3;
it('optional playback state survives V3 persistence; old bookmarks remain valid',()=>{
  const old=PRESET_BOOKMARKS_V3[0];expect(isValidBookmarkAnyVersion(old)).toBe(true);
  const saved={...old,simulation:{isPaused:true,timeScale:10}};
  expect(upgradeBookmarkToV3(JSON.parse(JSON.stringify(saved))).simulation).toEqual(saved.simulation);
  expect(isValidBookmarkAnyVersion(saved)).toBe(true);
  expect(isValidBookmarkAnyVersion({...saved,simulation:{isPaused:true,timeScale:-1}})).toBe(false);
});
function pendingEngine(error: string|null = null) {
  const engine=Object.create(SolarEngine.prototype) as SolarEngine;
  const command=vi.fn();
  Object.assign(engine,{navigationRevision:0,preferredLandingSites:new Map(),cameraController:{getUserInputRevision:()=>0,executeCommand:command},
    moonSiteStacks:new Map([['hadley-rille',{built:false,raster:{error}}]]),ensureMoonSiteAssets:vi.fn(),
    getLandingSiteChoices:()=>[LANDING_SITES['hadley-rille']]});
  return {engine,command};
}
it('failed terrain restores leave the existing camera untouched',async()=>{
  const {engine,command}=pendingEngine('offline');
  await expect(engine.restoreObservationSnapshot(surfaceBookmark)).rejects.toThrow('已保留当前视角');
  expect(command).not.toHaveBeenCalled();
});
it('a later site choice revokes pending restore permission',async()=>{
  vi.useFakeTimers();
  try {
    const {engine,command}=pendingEngine();const restore=engine.restoreObservationSnapshot(surfaceBookmark);
    expect(engine.selectLandingSite('hadley-rille')).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(await restore).toBe(false);expect(command).not.toHaveBeenCalled();
  } finally {vi.useRealTimers();}
});
