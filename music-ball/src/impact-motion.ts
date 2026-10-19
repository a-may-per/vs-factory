// 纵向下坠 + 左右反弹的可控物理轨迹。
import type { ImpactLevel, ImpactTarget } from "./impact-level.ts";
export interface ImpactMotionFrame { t:number;x:number;y:number;vx:number;vy:number;cameraX:number;cameraY:number;targetId:number;impact:boolean;impactTier:"strong"|"beat"|"weak"|"none";status:"fall"|"impact"|"settle" }
export interface MotionSegment { from:ImpactTarget;to:ImpactTarget;duration:number;vx:number;vy0:number }
export function planSegments(level:ImpactLevel, gravity=760):MotionSegment[] { const out:MotionSegment[]=[]; const ts=level.mainTargets; for(let i=0;i<ts.length-1;i++){const a=ts[i],b=ts[i+1],d=Math.max(.18,b.tSec-a.tSec); out.push({from:a,to:b,duration:d,vx:(b.x-a.x)/d,vy0:(b.y-a.y-.5*gravity*d*d)/d});} return out; }
function segmentAt(t:number,segs:MotionSegment[]){for(const s of segs)if(t>=s.from.tSec&&t<s.to.tSec)return s;return t<segs[0]?.from.tSec?segs[0]:segs[segs.length-1];}
export function sampleImpactMotion(level:ImpactLevel,t:number,opts:{gravity?:number}={},segments=planSegments(level,opts.gravity??760)):ImpactMotionFrame {
 const g=opts.gravity??760, ts=level.mainTargets, first=ts[0],last=ts[ts.length-1]; let x=first?.x??960,y=first?.y??380,vx=0,vy=0,targetId=first?.id??0; const seg=segments.length?segmentAt(t,segments):undefined;
 if(seg){const dt=Math.max(0,Math.min(seg.duration,t-seg.from.tSec));x=seg.from.x+seg.vx*dt;y=seg.from.y+seg.vy0*dt+.5*g*dt*dt;vx=seg.vx;vy=seg.vy0+g*dt;targetId=seg.to.id;} else if(last&&t>=last.tSec){const dt=t-last.tSec;x=last.x; y=last.y+dt*180; vy=180; targetId=last.id;}
 const hit=ts.find(q=>Math.abs(q.tSec-t)<=1/120); return {t,x,y,vx,vy,cameraX:x-960,cameraY:y-390,targetId,impact:Boolean(hit),impactTier:hit?.tier??"none",status:hit?"impact":last&&t>last.tSec?"settle":"fall"};
}
export function validateImpactPlan(level:ImpactLevel,opts:{gravity?:number}={}):string[]{const errors:string[]=[];const segs=planSegments(level,opts.gravity??760);for(const t of level.mainTargets){const p=sampleImpactMotion(level,t.tSec,opts,segs);if(Math.abs(p.x-t.x)>1.5||Math.abs(p.y-t.y)>1.5)errors.push(`target ${t.id} miss`);}return errors;}
