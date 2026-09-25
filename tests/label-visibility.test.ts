import {it,expect} from 'vitest';
import {Vector3} from 'three';
import {discIsOccluded} from '../src/astronomy/observerProjection';

it('occlusion applies to planets behind the sun, not only moons behind parents',()=>{
  const observer=new Vector3(), sun={pos:new Vector3(0,0,-10),surfaceRadius:2};
  expect(discIsOccluded(observer,{pos:new Vector3(0,0,-100),surfaceRadius:1},sun)).toBe(true);
  expect(discIsOccluded(observer,{pos:new Vector3(0,0,-5),surfaceRadius:0.1},sun)).toBe(false);
});
it('off-disc and partially visible targets retain labels',()=>{
  const observer=new Vector3(), blocker={pos:new Vector3(0,0,-10),surfaceRadius:2};
  expect(discIsOccluded(observer,{pos:new Vector3(30,0,-100),surfaceRadius:1},blocker)).toBe(false);
  expect(discIsOccluded(observer,{pos:new Vector3(20,0,-100),surfaceRadius:5},blocker)).toBe(false);
});
