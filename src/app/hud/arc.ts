import type {HudFrame} from '../../contracts/hud';
import {clamp01} from './model';
import {hudPhase} from './phase';

export function journeyArc(frame: HudFrame) {
  const phase=hudPhase(frame), prep=frame.landing?.preparation;
  const progress=clamp01(frame.landing?.telemetry.progress??0);
  if(phase==='transfer'||phase==='site_travel')return {kind:'transfer',progress:clamp01(frame.camera.transitionProgress??0),
    cursor:clamp01(frame.camera.transitionProgress??0),labels:phase==='site_travel'?['当前机位','绕行','落区上空']:['当前机位','转场','目标机位'],positions:[0,.5,1],caption:'当前转场段'};
  if(phase==='ascending')return {kind:'ascent',progress,cursor:progress,labels:['离开落区','升空','观星机位'],positions:[0,.5,1],caption:'升空导览'};
  if(phase==='preparing')return {kind:'preparation',progress:null,cursor:prep?.phase==='approach' ? .16 : 0,
    labels:['准备','下降','抵达'],positions:[0,.35,1],caption:prep?.phase==='approach'?'绕行至落区上空':'等待就绪'};
  return {kind:'descent',progress,cursor:.35+.65*progress,labels:['准备',phase==='hold'?'悬停':'下降','抵达'],positions:[0,.35,1],caption:phase==='hold'?'位置保持':'下降导览'};
}

/** Continuous relative ticks: the 359° -> 0° wrap never moves the whole tape. */
export function compassTicks(yaw: number, width: number) {
  if(!Number.isFinite(yaw))return [];
  const angle=((yaw%360)+360)%360, base=Math.floor(angle/15)*15;
  const cardinal:Record<number,string>={0:'N',45:'NE',90:'E',135:'SE',180:'S',225:'SW',270:'W',315:'NW'};
  const scale=(width-48)/150;
  return Array.from({length:13},(_,i)=>base+(i-6)*15).map(a=>{
    const bearing=((a%360)+360)%360;
    return {x:width/2+(a-angle)*scale,bearing,label:cardinal[bearing]??'',major:bearing%45===0};
  }).filter(t=>t.x>=24&&t.x<=width-24);
}
