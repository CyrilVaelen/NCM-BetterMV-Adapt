// A DJ opening can contain a loud drum/bass groove without beginning the song's
// main release. Require the opening to return in the closing frame, while the
// body has its own different, returning release family. A quiet thematic restart
// between them ends the prelude; loudness alone cannot establish this form.
import { quantile } from './util.ts';
import type { Hit, Section } from '../types.ts';

export interface PreludeInput {
  time: number[];
  end: number;
  db: Float64Array;
  bass: Float64Array;
  drive: Float64Array;
  similarity: Float64Array;
}

export interface Prelude {
  endBar: number;
  opening: [number, number];
  closing: [number, number];
  core: [number, number];
  releases: Array<[number,number]>;
  edgeSimilarity: number;
  coreSimilarity: number;
}

const mean=(x:ArrayLike<number>,a:number,b:number)=>{let s=0;for(let i=Math.max(0,a);i<Math.min(x.length,b);i++)s+=x[i];return s/Math.max(1,Math.min(x.length,b)-Math.max(0,a));};

export function findPrelude(x:PreludeInput):Prelude|undefined {
  const n=x.time.length;
  if(n<16 || x.similarity.length!==n*n)return;
  const barLength=quantile(x.time.slice(1).map((t,i)=>t-x.time[i]),.5);
  if(!(barLength>0))return;
  // Evidence windows are measured in seconds so the same recording survives
  // a tracker choosing the half/double tempo octave.
  const phrase=Math.max(2,Math.ceil(6/barLength)),reset=Math.max(1,Math.round(3/barLength));
  const time=(j:number)=>x.time[j]??x.end;
  const bassRef=quantile(x.bass,.9),levelRef=quantile(x.db,.9);
  if(bassRef < -70 || levelRef < -70)return;
  const active=new Uint8Array(n);
  for(let j=0;j<n;j++)active[j]=+(x.drive[j]>=.9 && x.bass[j]>=bassRef-6 && x.db[j]>=levelRef-8);
  // A short filtered/fill passage can sit inside a groove. Only bridge a gap
  // bounded by actual drive, never extend a groove into a quiet restart.
  for(let j=1;j+1<n;j++)if(!active[j]&&active[j-1]){
    let end=j;while(end<n&&!active[end]&&time(end)-time(j)<=4)end++;
    if(end<n&&active[end]&&time(end)-time(j)<=4)for(let k=j;k<end;k++)active[k]=1;
  }
  const runs:Array<[number,number]>=[];
  for(let j=0;j<n;){if(!active[j]){j++;continue;}const a=j;while(j<n&&active[j])j++;if(j-a>=phrase)runs.push([a,j]);}
  if(runs.length<4)return;
  const opening=runs[0],closing=runs[runs.length-1];
  if(time(opening[0])>.25*x.end || time(closing[0])<.7*x.end || time(closing[1])<x.end-16 || time(opening[1])-time(opening[0])<10)return;
  const score=(a:[number,number],b:[number,number])=>{
    // A sustained phrase must agree in order; isolated timbral matches do not suffice.
    let best=-1;
    for(let p=a[0];p+phrase<=a[1];p++)for(let q=b[0];q+phrase<=b[1];q++){
      let v=0;for(let k=0;k<phrase;k++)v+=x.similarity[(p+k)*n+q+k]/phrase;
      best=Math.max(best,v);
    }
    return best;
  };
  const edgeSimilarity=score(opening,closing);
  if(edgeSimilarity<.72)return;
  const body=runs.slice(1,-1);
  let core: [number,number]|undefined,coreSimilarity=-1;
  for(let p=0;p<body.length;p++)for(let q=p+1;q<body.length;q++){
    if(time(body[q][0])-time(body[p][1])<6)continue;
    const repeated=score(body[p],body[q]);
    if(repeated<.72)continue;
    // The opening may preview the melody, but its groove must be a different
    // family from the main body. A genuine first drop that returns stays a drop.
    if(score(opening,body[p])>edgeSimilarity-.18 || score(opening,body[q])>edgeSimilarity-.18)continue;
    if(!core || body[p][0]<core[0]){core=body[p];coreSimilarity=repeated;}
  }
  if(!core || time(core[0])-time(opening[1])<10)return;
  const a=opening[1],b=core[0];
  // A brief reset must not disappear in a long preparation's quantiles. Demand
  // sustained quiet support, rather than a single-frame minimum.
  let trough=Infinity;for(let j=a;j+reset<=b;j++)trough=Math.min(trough,mean(x.db,j,j+reset));
  if(trough>levelRef-12)return;
  // The new theme begins after the deep reset, with a sustained, sparse
  // recovery. This is independent of tempo octave and of any fixed timestamp.
  for(let j=a+reset;j+phrase<=b;j++){
    const before=mean(x.db,j-reset,j),after=mean(x.db,j,j+phrase);
    if(before>trough+4 || x.db[j]-before<5 || after-before<5 || after>levelRef-5)continue;
    if(mean(x.drive,j,j+phrase)>.5 || mean(x.bass,j,j+phrase)>bassRef-12)continue;
    const releases=body.filter(r=>score(core!,r)>=.72);
    return {endBar:j,opening,closing,core,releases,edgeSimilarity,coreSimilarity};
  }
}

/** Confirm a phrase-grid exit with a regular kick train that actually stops.
 * Only used after the enclosing instrumental form has been established. A
 * continuous bass line, an isolated missed kick, or a fill cannot move it. */
export function refinePreludeDropExits(sections:Section[],beats:number[],kicks:Hit[],low:Float32Array,fps:number,barLength:number):void {
  if(beats.length<8 || !low.length || !kicks.length)return;
  const ref=quantile(low,.9),period=quantile(beats.slice(1).map((t,i)=>t-beats[i]),.5),tol=Math.min(.1,.2*period);
  const power=(a:number,b:number)=>{
    let sum=0,count=0;for(let j=Math.max(0,Math.floor(a*fps));j<Math.min(low.length,Math.ceil(b*fps));j++){sum+=low[j];count++;}
    return sum/Math.max(1,count);
  };
  for(let k=0;k+1<sections.length;k++){
    const current=sections[k],next=sections[k+1];
    if(current.label!=='drop'||next.label==='drop')continue;
    const original=current.end,candidates:number[]=[];
    for(let j=4;j+2<beats.length;j++){
      const at=beats[j];if(Math.abs(at-original)>1.25*barLength||at<=current.start+2*barLength||at>=next.end-period)continue;
      let hits=0;for(let q=j-4;q<j;q++)if(kicks.some(([t,v])=>v>=.45&&Math.abs(t-beats[q])<=tol))hits++;
      if(hits<3 || !kicks.some(([t,v])=>v>=.45&&Math.abs(t-beats[j-1])<=tol) || kicks.some(([t,v])=>v>=.45&&t>=at-tol&&t<at+2*period))continue;
      const before=power(at-2*period,at-.1*period),after=power(at+.1*period,at+2*period);
      if(before<ref*.12 || 10*Math.log10((before+1e-12)/(after+1e-12))<5)continue;
      candidates.push(at);
    }
    const at=candidates.sort((a,b)=>Math.abs(a-original)-Math.abs(b-original))[0];
    if(at!==undefined){current.end=at;next.start=at;}
  }
}

/** Returning groove entries can sit several beats before a coarse bar cut.
 * Confirm their first bass attack even if a later kick happens to coincide with
 * that bar. The softer DJ closing frame uses the same test at its own level. */
export function refinePreludeRhythmEntries(sections:Section[],beats:number[],kicks:Hit[],low:Float32Array,rms:Float32Array,fps:number,barLength:number):void {
  if(beats.length<4 || !low.length || !kicks.length)return;
  const period=quantile(beats.slice(1).map((t,i)=>t-beats[i]),.5),ref=quantile(low,.9),level=quantile(rms,.9);
  const mean=(x:Float32Array,a:number,b:number)=>{let s=0,n=0;for(let i=Math.max(0,Math.floor(a*fps));i<Math.min(x.length,Math.ceil(b*fps));i++){s+=x[i];n++;}return s/Math.max(1,n);};
  for(let k=1;k<sections.length;k++){
    const section=sections[k],previous=sections[k-1];
    if(section.label!=='drop'&&!(section.label==='outro'&&previous.label!=='outro'))continue;
    const threshold=section.label==='outro'?.25:.45;
    const candidates=kicks.filter(([t,v])=>v>=threshold&&Math.abs(t-section.start)<=barLength&&t>previous.start+period&&t<section.end-period).filter(([t])=>{
      const before=mean(low,t-.4*period,t-.08*period),after=mean(low,t+.04*period,t+.3*period);
      // A continuous kick train has an 8 dB jump on almost every beat. Its
      // ordinary between-kick trough cannot establish a new groove entry.
      const ongoing=kicks.some(([at,v])=>v>=threshold&&at>=t-2*period&&at<t-.08*period);
      const preparation=mean(low,t-2*period,t-.1*period);
      return !ongoing && 10*Math.log10((after+1e-12)/(preparation+1e-12))>=6 && after>=ref*.08 && mean(rms,t+.04*period,t+.3*period)>=level*.15 && 10*Math.log10((after+1e-12)/(before+1e-12))>=8;
    }).sort((a,b)=>a[0]-b[0]);
    const first=candidates[0]?.[0];
    if(first!==undefined){previous.end=first;section.start=first;}
  }
}

/** The semantic reset is first located in bars, then confirmed on the original
 * envelope. A rising noise sweep alone has no bass-note attack and leaves the
 * bar boundary alone. No beat or playback clock is changed. */
export function refinePreludeEntry(sections:Section[],beats:number[],low:Float32Array,rms:Float32Array,fps:number):void {
  if(sections.length<2 || !low.length || beats.length<4)return;
  const at=sections[0].end,period=quantile(beats.slice(1).map((t,i)=>t-beats[i]),.5);
  const from=Math.max(1,Math.floor((at-period)*fps)),to=Math.min(low.length-1,Math.ceil((at+period)*fps));
  let peak=from,delta=0;
  for(let i=from;i<=to;i++){const d=low[i]-low[i-1];if(d>delta){peak=i;delta=d;}}
  if(!(delta>0) || delta<quantile(low,.9)*.015 || rms[peak]<quantile(rms,.9)*.12)return;
  const earlier=Math.max(0,peak-Math.ceil(.12*period*fps));
  if(rms[peak]<rms[earlier]*1.3)return;
  let onset=peak;
  while(onset>from && peak-onset<.15*period*fps && low[onset-1]-low[Math.max(0,onset-2)]>=.2*delta)onset--;
  const confirmed=onset/fps;
  if(confirmed>sections[0].start && confirmed<sections[1].end){sections[0].end=confirmed;sections[1].start=confirmed;}
}
