// Falling Ball 直角空间：由水平平台、竖直墙、矩形房间和直角台阶组成。
// 音乐只负责碰撞后的强调，不参与几何体生成。
export interface AxisEvent { t_ms:number; strength:number; band:string; beat:boolean; downbeat:boolean; tier?:"strong"|"beat"|"weak" }
export type PlatformKind="ledge"|"gate";
export interface Wall{side:"left"|"right";x:number;y:number;width:number;height:number}
export interface Platform{id:number;x:number;y:number;width:number;height:number;angle:0;support:"left"|"right"|"full";kind:PlatformKind;strong:boolean;guideDir:-1|1}
export interface NaturalLevel{duration:number;seed:number;shaftLeft:number;shaftRight:number;worldHeight:number;walls:Wall[];platforms:Platform[];events:AxisEvent[]}
function rng(seed:number){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296}}
export function buildNaturalLevel(events:AxisEvent[],duration:number,seed=71):NaturalLevel{
 const r=rng(seed),left=300,right=1620,worldHeight=duration*330+1800,walls:Wall[]=[{side:"left",x:left-86,y:0,width:86,height:worldHeight},{side:"right",x:right,y:0,width:86,height:worldHeight}],platforms:Platform[]=[];
 let id=0, y=420, room=0;
 while(y<worldHeight-500){
  const mode=room%5;
  // 每个房间只使用直角几何，平台始终从墙边伸出或横跨空间。
  if(mode===0){
   const w=420+r()*180; platforms.push({id:id++,x:left,y,width:w,height:54,angle:0,support:"left",kind:"ledge",strong:room%3===0,guideDir:1});
   platforms.push({id:id++,x:right-w,y:y+480,width:w,height:54,angle:0,support:"right",kind:"ledge",strong:false,guideDir:-1});
  }else if(mode===1){
   platforms.push({id:id++,x:left+120,y,width:right-left-240,height:62,angle:0,support:"full",kind:"gate",strong:true,guideDir:room%2?1:-1});
   platforms.push({id:id++,x:left,y:y+550,width:380,height:54,angle:0,support:"left",kind:"ledge",strong:false,guideDir:1});
  }else if(mode===2){
   const w=360+r()*180; platforms.push({id:id++,x:right-w,y,width:w,height:54,angle:0,support:"right",kind:"ledge",strong:room%3===0,guideDir:-1});
   platforms.push({id:id++,x:left,y:y+520,width:w,height:54,angle:0,support:"left",kind:"ledge",strong:false,guideDir:1});
  }else if(mode===3){
   // 直角交错台阶：左、右、左，形成可读的矩形穿梭路线。
   for(let step=0;step<3;step++){
    const side=step%2===0?"left":"right"; const w=330+r()*120; const yy=y+step*300;
    platforms.push({id:id++,x:side==="left"?left:right-w,y:yy,width:w,height:50,angle:0,support:side,kind:"ledge",strong:step===2,guideDir:side==="left"?1:-1});
   }
  }else{
   // 矩形房间横梁：两侧留出可见的下落开口。
   const gap=360+r()*160; platforms.push({id:id++,x:left+80,y,width:gap,height:60,angle:0,support:"left",kind:"gate",strong:false,guideDir:1});
   platforms.push({id:id++,x:right-gap-80,y:y+430,width:gap,height:60,angle:0,support:"right",kind:"gate",strong:true,guideDir:-1});
  }
  y+=1180+r()*260; room++;
 }
 return{duration,seed,shaftLeft:left,shaftRight:right,worldHeight,walls,platforms,events};
}
