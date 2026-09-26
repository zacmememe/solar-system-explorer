import {describe,it,expect} from 'vitest';
import * as T from 'three';
import {LandingController} from '../src/surface/LandingController';
import {CameraController} from '../src/camera/CameraController';
import {surfaceArcOffset} from '../src/camera/NavigationPath';

describe('下降中止与局部绕行的连续性反例',()=>{
  for(const site of ['taurus-littrow','jezero'])for(const height of [2,500,50000,1000000,12000000]){
    it(`${site} ${height}m 中止只升高，结束仍是中止点，不回跳落区`,()=>{
      const c=new LandingController(site);
      c.startDescent();c.completePreparation(undefined,undefined,{latDeg:15,lonDeg:22,clearanceM:15000000});c.update(5);
      c.returnToOrbit({latDeg:16.25,lonDeg:-35.75,clearanceM:height});
      expect(c.evaluateTrajectory().datumAltitudeM).toBeCloseTo(height,6);
      let last=height;
      for(let i=0;i<1200;i++){
        c.update(1/60);const p=c.evaluateTrajectory();
        expect(p.datumAltitudeM).toBeGreaterThanOrEqual(last-1e-6);
        expect(p.lat).toBe(16.25);expect(p.lon).toBe(-35.75);
        last=p.datumAltitudeM;
      }
      expect(c.getState()).toBe('ORBIT');expect(last).toBeGreaterThan(height);
      c.update(100);expect(c.evaluateTrajectory().datumAltitudeM).toBe(last);
    });
  }
  it('准备绕行提前获取1x，取消恢复原速度；用户新选择优先',()=>{
    const c=new LandingController();let speed=50;
    const set=(s:number)=>{speed=s;};
    c.startDescent();c.acquireTimeScaleOverride(()=>speed,set);expect(speed).toBe(1);
    c.cancelPreparation(set);expect(speed).toBe(50);
    c.startDescent();c.acquireTimeScaleOverride(()=>speed,set);c.releaseTimeScaleOverride();speed=10;
    c.completePreparation(()=>speed,set,{latDeg:15,lonDeg:22,clearanceM:1000000});expect(speed).toBe(10);
    c.cancel(set);expect(speed).toBe(10);
    c.startDescent();c.acquireTimeScaleOverride(()=>speed,set);c.releaseTimeScaleOverride();speed=10;
    c.cancelPreparation(set);expect(speed).toBe(10);
  });
  function rig(){const camera=new T.PerspectiveCamera(45,16/9,.0001,2000), controller=new CameraController({camera});
    const get=(id:string)=>({pos:new T.Vector3(id==='moon'?100:0,0,0),radius:id==='moon'?1:2,quaternion:new T.Quaternion()});
    controller.update(0,get);return {camera,controller,get};}
  it('exact跨天体终点以目标中心计算，不能额外叠加旧中心距离',()=>{
    const {camera,controller,get}=rig();controller.executeCommand({type:'flyTo',bodyId:'moon',exact:true,targetPos:[110,0,0],durationSec:2});controller.update(2,get);
    expect(camera.position.distanceTo(new T.Vector3(110,0,0))).toBeLessThan(1e-8);
  });
  it('exact跨经度缝走短弧，半程不绕到星球另一侧',()=>{
    const {camera,controller,get}=rig();controller.setSphericalDirect(6,Math.PI/2,Math.PI-.01);
    const end=new T.Vector3().setFromSpherical(new T.Spherical(6,Math.PI/2,-Math.PI+.01));
    controller.executeCommand({type:'flyTo',bodyId:'earth',exact:true,targetPos:end.toArray() as [number,number,number],durationSec:2});controller.update(1,get);
    expect(camera.position.z).toBeLessThan(-5.99);
  });
  it('局部区域绕行跨极区/经度缝/对侧仍在球外，保持半径且命中端点',()=>{
    for(const [a,b] of [[new T.Vector3(0,0,-6),new T.Vector3(.01,0,-6)],[new T.Vector3(0,6,.01),new T.Vector3(.01,6,0)],[new T.Vector3(6,0,0),new T.Vector3(-6,0,0)]]){
      for(let i=0;i<=500;i++)expect(surfaceArcOffset(a,b,i/500).length()).toBeGreaterThanOrEqual(6-1e-10);
      expect(surfaceArcOffset(a,b,0).distanceTo(a)).toBeLessThan(1e-9);expect(surfaceArcOffset(a,b,1).distanceTo(b)).toBeLessThan(1e-9);
    }
  });
  it('focusRegion跨天体使用目标半径，不沿用旧星球尺寸',()=>{
    const {camera,controller,get}=rig();controller.executeCommand({type:'focusRegion',bodyId:'moon',lat:0,lon:0,altitude:.5,durationSec:2});controller.update(2,get);
    expect(camera.position.distanceTo(get('moon').pos)).toBeCloseTo(1.5,9);
  });
  it.each([false,true])('升空终点切回观察模式无位置和姿态跳变 preserveView=%s',preserveView=>{
    const {camera,controller,get}=rig();controller.executeCommand({type:'enterSurfaceLook',bodyId:'moon',lat:15,lon:20,eyeHeightM:600000});controller.update(0,get);
    if(!preserveView){camera.up.set(0,1,0);camera.lookAt(get('moon').pos);}
    const p=camera.position.clone(),q=camera.quaternion.clone();
    controller.executeCommand({type:'finishSurfaceReturn',bodyId:'moon',preserveView});controller.update(0,get);
    expect(camera.position.distanceTo(p)).toBeLessThan(1e-9);expect(camera.quaternion.angleTo(q)).toBeLessThan(1e-7);expect(controller.getSnapshot().mode).toBe('ORBIT_TARGET');
    expect(camera.near).toBeLessThan((camera.position.distanceTo(get('moon').pos)-1)*.26);
  });
  it('地表忽略滚轮时不撤销现有导引姿态',()=>{
    const {camera,controller,get}=rig();const q=new T.Quaternion().setFromEuler(new T.Euler(.7,-2,.4));
    controller.executeCommand({type:'enterSurfaceLook',bodyId:'moon',lat:15,lon:20,eyeHeightM:60000,orientationQuat:q.toArray() as [number,number,number,number]});controller.update(0,get);
    const revision=controller.getUserInputRevision();controller.executeCommand({type:'zoomInput',logDelta:.2});controller.executeCommand({type:'zoom',deltaDist:1});
    expect(controller.getUserInputRevision()).toBe(revision);expect(camera.quaternion.angleTo(q)).toBeLessThan(1e-7);
  });
});
