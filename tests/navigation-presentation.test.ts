import {it,expect} from 'vitest';
import * as THREE from 'three';
import {SolarEngine} from '../src/engine/SolarEngine';
import {BodyPoseProvider} from '../src/astronomy/BodyPoseProvider';
import {BODIES,getNavDisplayRadius} from '../src/astronomy/bodies';

// Exercise the actual render hierarchy without a WebGL context. Prediction must
// match the world-space meshes and camera pivot AFTER advancing the same clock.
it.each([0,.04,.15,.7,1.2,2.5])('预测与实际显示层在 %ss 同源，无坐标系/缩放漂移',seconds=>{
  const engine:any=Object.create(SolarEngine.prototype);
  const provider=new BodyPoseProvider('NAV_SCHEMATIC');
  const nodes=new Map<string,any>();
  for(const body of Object.values(BODIES)) {
    const systemGroup=new THREE.Group(),mesh=new THREE.Mesh();systemGroup.add(mesh);
    nodes.set(body.id,{data:body,systemGroup,mesh,displayRadius:getNavDisplayRadius(body.radiusKm,body.type)});
  }
  for(const n of nodes.values())if(n.data.type==='moon')nodes.get(n.data.parentId).systemGroup.add(n.systemGroup);
  Object.assign(engine,{bodyPoseProvider:provider,bodyNodes:nodes,simTimeHours:123,timeScale:86400,isPaused:false,
    navigationClockRevision:0,camera:new THREE.PerspectiveCamera(45,16/9),
    sunPointLight:new THREE.PointLight(),cameraController:{getSnapshot:()=>({isTransitioning:true})}});
  engine.updateCelestialPresentation(0);
  const from=new Map([...nodes].map(([id])=>{const p=engine.getBodyWorldPose(id);return[id,{position:p.pos,radius:p.surfaceRadius}];}));
  provider.setPhysicalReferenceBody('mars');provider.setPolicy('PHYSICAL_OBSERVATION',1.2);
  engine.presentationTravel={from,elapsed:0,duration:1.2};
  const expected=engine.getNavigationScene().sample(seconds);
  expect(provider.getTransitionProgress()).toBe(0);expect(engine.presentationTravel.elapsed).toBe(0);
  provider.update(seconds);engine.simTimeHours+=seconds*86400/3600;engine.updateCelestialPresentation(seconds);
  for(const body of expected) {
    const world=engine.getBodyWorldPose(body.id),focus=engine.getCameraBodyPose(body.id);
    expect(world.pos.distanceTo(body.position),body.id).toBeLessThan(1e-6);
    expect(focus.pos.distanceTo(body.focusPosition),body.id+' focus').toBeLessThan(1e-6);
    const data=BODIES[body.id],shape=data.dimensionsKm?Math.max(...data.dimensionsKm)/(2*data.radiusKm):1;
    expect(body.radius).toBeCloseTo(world.surfaceRadius*Math.max(1,shape,data.ringConfig?.outerRadiusRatio??1),8);
  }
});

it('拒航回退恢复尚未结束的展示过渡，后续推进仍与原状态一致',()=>{
  const provider=new BodyPoseProvider('NAV_SCHEMATIC');
  provider.setPolicy('PHYSICAL_OBSERVATION',1.2);provider.update(.3);
  const rollback=provider.capturePresentationRollback(),before=provider.getBodyPose('moon',12);
  provider.setPhysicalReferenceBody('saturn');provider.setPolicy('NAV_SCHEMATIC',.15);
  rollback();
  expect(provider.getPhysicalReferenceBody()).toBe('earth');
  expect(provider.getBodyPose('moon',12).position.distanceTo(before.position)).toBe(0);
  provider.update(.3);expect(provider.getTransitionProgress()).toBeCloseTo(.5);
});
