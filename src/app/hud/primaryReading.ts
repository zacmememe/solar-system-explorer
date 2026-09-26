import {BODIES} from '../../astronomy/bodies';
import type {BodyId} from '../../contracts/body';
import type {HudFrame} from '../../contracts/hud';
import {bearingLabel,formatAltitude,hudPhase,isSurfacePhase,observedAltitude} from './phase';

/** Presentation only: one right-side reading from the same published frame as the central arc. */
export function primaryReading(frame:HudFrame|null,bodyId:BodyId) {
  const phase=hudPhase(frame);
  if(!frame)return {value:'—',unit:'',label:'等待机位',text:false};
  if(phase==='preparing')return {value:'准备中',unit:'',label:frame.landing?.preparation.phase==='approach'?'绕行至落区上空':'正在准备当地观察',text:true};
  if(phase==='surface_look'){
    const yaw=frame.surface?.yawDeg;
    const valid=yaw!=null&&Number.isFinite(yaw);
    return {value:valid?String(Math.round(((yaw%360)+360)%360)%360):'—',unit:valid?`° ${bearingLabel(yaw)}`:'',label:'视线方位',text:false};
  }
  if(isSurfacePhase(phase)){
    const altitude=formatAltitude(observedAltitude(frame));
    const [value,unit='']=altitude.split(' ');
    return {value,unit,label:'离地高度',text:false};
  }
  if(phase==='transfer'||phase==='site_travel'){
    const progress=frame.camera.transitionProgress;
    return {value:progress!=null&&Number.isFinite(progress)?String(Math.round(Math.max(0,Math.min(1,progress))*100)):'—',unit:'%',label:'当前转场段',text:false};
  }
  if(phase==='overview')return {value:'全景',unit:'',label:'示意比例',text:true};
  if(phase==='free')return {value:'环顾',unit:'',label:'自由观察机位',text:true};
  return {value:BODIES[bodyId].radiusKm.toLocaleString('en-US',{maximumFractionDigits:1}),unit:'km',label:'平均半径',text:false};
}
