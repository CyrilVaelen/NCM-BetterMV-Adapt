import type { LineBatch } from './lines.ts';

interface LeadCue { level:number;attack:number;brightness:number }
interface Color { r:number;g:number;b:number }

/** Flowing edges leave the lyric area clear. Note attacks open them; held harmonics keep them alive. */
export function drawLeadRibbons(lines:LineBatch,aspect:number,beatPosition:number,cue:LeadCue,color:Color,visibility:number):void {
  const strength=(0.6*cue.level+0.85*cue.attack)*visibility;
  if(strength<0.025)return;
  const reach=aspect*(0.58+0.2*cue.level+0.06*cue.attack);
  const wave=0.045+0.16*cue.level+0.11*cue.attack;
  const phase=beatPosition*Math.PI*0.4+cue.brightness*Math.PI*2;
  const thickness=1.8+3.6*cue.attack+0.7*cue.level;
  const steps=48;
  for(const side of [-1,1])for(let strand=0;strand<2;strand++) {
    let px=0,py=0;
    for(let i=0;i<=steps;i++) {
      const p=i/steps,y=-0.86+p*1.72;
      const taper=Math.sin(p*Math.PI);
      const x=side*(reach+(strand-0.5)*0.08+wave*taper*Math.sin(p*Math.PI*(2.1+cue.brightness)+phase+strand*0.8));
      if(i){
        const ink=strength*taper*(strand?0.55:1);
        lines.seg(px,py,0,x,y,0,thickness+6,color.r*ink*0.1,color.g*ink*0.1,color.b*ink*0.1);
        lines.seg(px,py,0,x,y,0,thickness,color.r*ink,color.g*ink,color.b*ink);
      }
      px=x;py=y;
    }
  }
}
