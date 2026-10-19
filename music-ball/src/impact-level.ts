// 纵向下坠关卡：左右连续墙 + 接墙平台。
export type ImpactTier = "strong" | "beat" | "weak";
export type ImpactKind = "wall" | "pad" | "block";
export type SupportSide = "left" | "right" | "full";
export interface AxisEvent { t_ms: number; strength: number; band: string; beat: boolean; downbeat: boolean; tier?: ImpactTier }
export interface ShaftSection { id: number; yStart: number; yEnd: number; centerX: number; halfWidth: number }
export interface ImpactTarget {
  id: number; eventId: number; tSec: number; x: number; y: number; strength: number; band: string;
  tier: ImpactTier; kind: ImpactKind; normalAngle: number; hue: [number, number, number];
  radius: number; length: number; thickness: number; sectionId: number; supportSide: SupportSide;
}
export interface ShaftWall { id: number; sectionId: number; side: "left" | "right"; x: number; yStart: number; yEnd: number; thickness: number; hue: [number, number, number] }
export interface ImpactLevel { duration: number; seed: number; worldEnd: number; mainTargets: ImpactTarget[]; accents: ImpactTarget[]; walls: ShaftWall[]; sections: ShaftSection[] }

function seeded(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function classify(e: AxisEvent, cut: number): ImpactTier { return e.tier ?? (e.downbeat || e.strength >= cut ? "strong" : e.beat ? "beat" : "weak"); }
function hueFor(t: ImpactTier, band: string): [number, number, number] { return t === "strong" ? [255,198,64] : band === "perc" ? [255,108,92] : t === "beat" ? [96,214,255] : [172,132,255]; }

export function buildImpactLevel(events: AxisEvent[], duration: number, seed = 23): ImpactLevel {
  const rand = seeded(seed);
  const ordered = events.map((event, eventId) => ({event, eventId})).sort((a,b) => a.event.t_ms-b.event.t_ms);
  const values = ordered.map(x=>x.event.strength).sort((a,b)=>a-b);
  const cut = values.length ? values[Math.floor(values.length*0.68)] : .5;
  const classified = ordered.map(x=>({...x,tier:classify(x.event,cut)}));
  const fallSpeed = 285;
  const sectionSpan = 4.8 * fallSpeed;
  const sections: ShaftSection[] = [];
  const walls: ShaftWall[] = [];
  const sectionCount = Math.max(1, Math.ceil(duration / 4.8));
  for(let s=0;s<sectionCount;s++) {
    const yStart=s*sectionSpan-200, yEnd=(s+1)*sectionSpan+180;
    const centerX=960 + Math.sin(s*1.7+seed)*150;
    const halfWidth=360 + ((s*37+seed)%120)-60;
    sections.push({id:s,yStart,yEnd,centerX,halfWidth});
    walls.push({id:s*2,sectionId:s,side:"left",x:centerX-halfWidth,yStart,yEnd,thickness:92,hue:[39,62,106]});
    walls.push({id:s*2+1,sectionId:s,side:"right",x:centerX+halfWidth,yStart,yEnd,thickness:92,hue:[39,62,106]});
  }
  const main: ImpactTarget[]=[]; let last=-Infinity; let id=0;
  for(const item of classified) {
    if(item.tier === "weak") continue;
    const t=item.event.t_ms/1000;
    if(t-last<.24) continue;
    last=t;
    const s=Math.min(sectionCount-1,Math.floor(t/4.8)); const section=sections[s];
    const y=220+t*fallSpeed;
    const side: SupportSide = id%3===0 ? "full" : id%2 ? "right" : "left";
    const x=side === "left" ? section.centerX-section.halfWidth+105 : side === "right" ? section.centerX+section.halfWidth-105 : section.centerX;
    main.push({id,eventId:item.eventId,tSec:t,x,y,strength:Math.max(0,Math.min(1,item.event.strength)),band:item.event.band,tier:item.tier,kind:item.tier === "strong" ? "pad":"wall",normalAngle:side === "left" ? .10 : side === "right" ? -.10 : 0,hue:hueFor(item.tier,item.event.band),radius:item.tier === "strong"?52:32,length:item.tier === "strong"?Math.min(section.halfWidth*1.6,620):Math.min(section.halfWidth*0.75,300),thickness:item.tier === "strong"?46:30,sectionId:s,supportSide:side});
    id++;
  }
  if(!main.length || main[0].tSec>.7) main.unshift({id:0,eventId:-1,tSec:.55,x:sections[0].centerX,y:380,strength:1,band:"intro",tier:"strong",kind:"pad",normalAngle:0,hue:[255,198,64],radius:52,length:Math.min(sections[0].halfWidth*1.6,620),thickness:46,sectionId:0,supportSide:"full"});
  main.forEach((t,i)=>t.id=i);
  const mainIds=new Set(main.map(t=>t.eventId)); const accents:ImpactTarget[]=[]; let aid=0;
  for(const item of classified) if(item.tier === "weak" && !mainIds.has(item.eventId)) {
    const t=item.event.t_ms/1000, s=Math.min(sectionCount-1,Math.floor(t/4.8)), sec=sections[s];
    accents.push({id:aid++,eventId:item.eventId,tSec:t,x:sec.centerX+(rand()-.5)*sec.halfWidth*1.4,y:220+t*fallSpeed+80+rand()*100,strength:item.event.strength,band:item.event.band,tier:"weak",kind:"block",normalAngle:0,hue:hueFor("weak",item.event.band),radius:14+item.event.strength*9,length:30,thickness:12,sectionId:s,supportSide:"full"});
  }
  return {duration,seed,worldEnd:220+duration*fallSpeed+500,mainTargets:main,accents,walls,sections};
}
