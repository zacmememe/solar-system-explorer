import { expect, it } from 'vitest';
import * as THREE from 'three';
import { BodyPoseProvider } from '../src/astronomy/BodyPoseProvider';
import { BODIES, getNavDisplayRadius, getPlanetNavPosition } from '../src/astronomy/bodies';
import { projectDistantBody } from '../src/astronomy/observerProjection';

it('distant Saturn keeps its true small angular size when observing Earth', () => {
  const provider = new BodyPoseProvider();
  const ref = provider.getPhysicalBodyState('earth',0), saturn = provider.getPhysicalBodyState('saturn',0);
  const origin=new THREE.Vector3(...getPlanetNavPosition('earth',0));
  const scale=getNavDisplayRadius(BODIES.earth.radiusKm,'planet')/ref.meanRadiusKm;
  const observer=origin.clone().add(new THREE.Vector3(4,1,3));
  const result=projectDistantBody(saturn.positionKm,saturn.meanRadiusKm,ref.positionKm,origin,scale);
  const trueDelta=new THREE.Vector3(...saturn.positionKm).sub(new THREE.Vector3(...ref.positionKm))
    .sub(observer.clone().sub(origin).divideScalar(scale));
  const rendered=result.position.clone().sub(observer);
  expect(rendered.length()).toBeCloseTo(trueDelta.length()*scale,6);
  expect(rendered.clone().normalize().distanceTo(trueDelta.clone().normalize())).toBeLessThan(1e-12);
  expect(result.radius/rendered.length()).toBeCloseTo(saturn.meanRadiusKm/trueDelta.length(),12);
  expect(2*Math.asin(result.radius/rendered.length())*180/Math.PI).toBeLessThan(0.02);
});

it('solar angular size depends on the observer planet, not a fixed Earth value', () => {
  const provider=new BodyPoseProvider();
  const angular=[];
  for(const id of ['earth','mars'] as const) {
    const ref=provider.getPhysicalBodyState(id,0), sun=provider.getPhysicalBodyState('sun',0);
    const origin=new THREE.Vector3(...getPlanetNavPosition(id,0));
    const scale=getNavDisplayRadius(BODIES[id].radiusKm,'planet')/ref.meanRadiusKm;
    const p=projectDistantBody(sun.positionKm,sun.meanRadiusKm,ref.positionKm,origin,scale);
    angular.push(2*Math.asin(p.radius/p.position.distanceTo(origin))*180/Math.PI);
  }
  expect(angular[0]).toBeGreaterThan(0.5);
  expect(angular[0]).toBeLessThan(0.55);
  expect(angular[1]).toBeLessThan(angular[0]*0.7);
});

it('a foreground planet stays in front of the Sun instead of sharing a depth shell', () => {
  const origin=new THREE.Vector3();
  const sun=projectDistantBody([0,0,-150e6],696340,[0,0,0],origin,0.001);
  const venus=projectDistantBody([0,0,-50e6],6052,[0,0,0],origin,0.001);
  expect(venus.position.length()+venus.radius).toBeLessThan(sun.position.length()-sun.radius);
});
