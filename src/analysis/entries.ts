// Confirm bar-based Drop boundaries against the actual instrumental attack.
// A harmonic pickup may precede it by a beat; media time must stay unchanged.
import type { Hit, Section } from '../types.ts';
import { quantile } from './util.ts';

interface EntryInput {
  sections:Section[]; beats:number[]; fps:number; low?:Float32Array; high?:Float32Array; rms:Float32Array; kicks?:Hit[];
  /** Positive lyric evidence that an adjacent refrain is a sparse repeated pickup, not an established chorus. */
  canExtendBuild?: (section:Section)=>boolean;
}
const bandMean=(x:Float32Array,fps:number,from:number,to:number,square=false):number=>{
  const a=Math.max(0,Math.floor(from*fps)),b=Math.min(x.length,Math.ceil(to*fps));let sum=0;
  for(let i=a;i<b;i++)sum+=square?x[i]*x[i]:x[i];
  return sum/Math.max(1,b-a);
};
const db=(x:number)=>10*Math.log10(x+1e-12);

/** Verify a release inside a coarse Drop block before doing the beat-sized entry correction below.
 * A loud vocal pickup / snare roll can pass the section-average classifier. Require a full-band, sustained
 * return after a bass valley, supported by a strong kick; an isolated fill or a later louder note is insufficient.
 * Reference levels come from this block, not a song-wide loudness assumption or the presence of lyrics. */
export function refineDropPreparations({sections,beats,fps,low,high,rms,kicks=[],canExtendBuild}:EntryInput):boolean {
  const debug=(globalThis as {__bmvDropEntryDebug?:(detail:Record<string,unknown>)=>void}).__bmvDropEntryDebug;
  if(!low?.length||!high?.length||!rms.length||beats.length<4){
    debug?.({stage:'drop-preparation',status:'inputs-unavailable',hasLow:!!low?.length,hasHigh:!!high?.length,hasRms:!!rms.length,beatCount:beats.length,kickCount:kicks.length});
    return false;
  }
  let changed=false;
  const beat=quantile(Float64Array.from(beats.slice(1),(t,i)=>t-beats[i]),.5);
  const window=Math.max(1.2,Math.min(2.4,4*beat));
  for(let i=1;i<sections.length;i++){
    const section=sections[i];
    if(section.label!=='drop'||sections[i-1].label==='drop')continue;
    let end=section.end;
    for(let j=i+1;j<sections.length&&sections[j].label==='drop';j++)end=sections[j].end;
    const at=section.start,stop=Math.min(end-window,at+24);
    const trace:Record<string,unknown>={stage:'drop-preparation',coarseStart:at,coarseEnd:end,previousLabel:sections[i-1].label,kickCount:kicks.length,beat,window};
    const report=(status:string,extra:Record<string,unknown>={})=>debug?.({...trace,status,...extra});
    if(stop<=at+.3){report('skip-short-range');continue;}
    const levels=(band:Float32Array,square=false)=>{
      const values:number[]=[];
      for(let t=at;t+window<=end;t+=window/2)values.push(bandMean(band,fps,t,t+window,square));
      return quantile(values,.65);
    };
    const bassRef=levels(low),highRef=levels(high),powerRef=levels(rms,true);
    Object.assign(trace,{bassRef,highRef,powerRef,lookback:Math.min(5,Math.max(window,4*beat+.1))});
    if(bassRef<1e-8||highRef<1e-10||powerRef<1e-8){report('skip-reference-floor');continue;}
    let entry:number|undefined,method:string|undefined,selected:Record<string,unknown>|undefined;
    // The coarse structural cut can land after the musical attack: if the first
    // beat at `at` is already fully active, the forward-only check below used to
    // accept that late cut without looking back. Search up to one bar before it
    // for the sustained bass/RMS release first. A local attack plus a complete
    // phrase check avoids mistaking an isolated fill for the earlier entry.
    const lookback=trace.lookback as number;
    const previous=sections[i-1];
    let best:Record<string,unknown>|undefined,bestRank=-Infinity,tested=0;
    const checkAt=(t:number):{time:number;rank:number;detail:Record<string,unknown>}|undefined=>{
      if(t<=previous.start+.3||t>=end-.3)return;
      const before=bandMean(low,fps,t-.16,t-.03),after=bandMean(low,fps,t+.02,t+.14);
      const bassJumpDb=db(after)-db(before),afterBassRatio=after/bassRef,onsetBassRatio=bandMean(low,fps,t,t+.02)/bassRef;
      const powerBefore=bandMean(rms,fps,t-.16,t-.03,true),powerAfter=bandMean(rms,fps,t+.02,t+.14,true);
      const rmsJumpDb=db(powerAfter)-db(powerBefore);
      const sustainedLowRatio=bandMean(low,fps,t,t+window)/bassRef;
      const sustainedHighRatio=bandMean(high,fps,t,t+window)/highRef;
      const sustainedPowerRatio=bandMean(rms,fps,t,t+window,true)/powerRef;
      // 若前导区间 [at, t] 全程处于高频被低通压暗的闷音滚奏铺垫（未打开全频段高潮），则考核紧邻冲击点前的临门留白谷窗口
      const valleyWindow=Math.max(1,Math.min(window,2*beat));
      const prefixHighRatio=t>at?bandMean(high,fps,at,t)/highRef:0;
      const prefixStart=t<at?Math.max(previous.start,t-window):(t-at>valleyWindow&&prefixHighRatio<.48?t-valleyWindow:at);
      const prefixBassRatio=bandMean(low,fps,prefixStart,t)/bassRef;
      const prefixPowerRatio=bandMean(rms,fps,prefixStart,t,true)/powerRef;
      const failed:string[]=[];
      if(bassJumpDb<12)failed.push('bass-jump');
      if(afterBassRatio<.6)failed.push('bass-after-level');
      if(onsetBassRatio<.2)failed.push('bass-onset-level');
      if(rmsJumpDb<3)failed.push('rms-jump');
      if(sustainedLowRatio<.55)failed.push('sustained-bass');
      if(sustainedHighRatio<.5)failed.push('sustained-high');
      if(sustainedPowerRatio<.7)failed.push('sustained-rms');
      if(prefixBassRatio>.65)failed.push('prefix-bass');
      if(prefixPowerRatio>.8)failed.push('prefix-rms');
      const rank=9-failed.length+Math.min(2,Math.max(-2,(bassJumpDb-12)/12));
      const detail={time:t,bassJumpDb,afterBassRatio,onsetBassRatio,rmsJumpDb,sustainedLowRatio,sustainedHighRatio,sustainedPowerRatio,prefixBassRatio,prefixPowerRatio,nearKick:kicks.some(([kick,strength])=>strength>=.25&&Math.abs(kick-t)<=.22),failed};
      tested++;
      if(rank>bestRank){bestRank=rank;best=detail;}
      return failed.length?undefined:{time:t,rank,detail};
    };
    const scan=(from:number,to:number):number|undefined=>{
      const step=Math.max(1,Math.floor(fps*.02));
      for(let frame=Math.max(1,Math.ceil(from*fps));frame<=Math.floor(to*fps);frame+=step){
        const candidate=checkAt(frame/fps);
        if(candidate){selected=candidate.detail;return candidate.time;}
      }
      return undefined;
    };
    const scanKickCandidates=(from:number,to:number):number|undefined=>{
      const candidates=kicks.filter(([kick,strength])=>strength>=.45&&kick>=from-.2&&kick<=to).sort((a,b)=>a[0]-b[0]);
      for(const [kick] of candidates)for(let frame=Math.max(1,Math.floor((kick-.18)*fps));frame<=Math.ceil((kick+.04)*fps);frame++){
        const candidate=checkAt(frame/fps);
        if(candidate){selected=candidate.detail;return candidate.time;}
      }
      return undefined;
    };
    // Search the signal itself, not just the hit detector's event list. On compressed or low-bitrate streams a real
    // bass attack may be present in the decoded bands while its kick confidence falls below the old hard cutoff.
    entry=scan(Math.max(previous.start+.31,at-lookback),at-.2);
    if(entry!==undefined)method='envelope-backscan';
    const openHighRatio=bandMean(high,fps,at,at+window)/highRef;
    // 粗切点首窗若高频被低通严重压暗（openHighRatio < 0.4），说明仅是闷音底鼓滚奏铺垫而非全频段高潮已开启
    const alreadySupported=openHighRatio>=.4&&(kicks.some(([t,s])=>s>=.65&&Math.abs(t-at)<=.2)||
      (bandMean(low,fps,at,at+window)>=bassRef*.5&&kicks.some(([t,s])=>s>=.45&&Math.abs(t-at)<=Math.max(.2,.9*beat))));
    Object.assign(trace,{backscanFrames:tested,openHighRatio,alreadySupported,bestBackscanCandidate:best});
    // Already supported at its first beat: later accents must never replace it. This guard follows the signal backscan.
    if(entry===undefined&&alreadySupported){report('kept-supported-coarse-entry');continue;}
    if(entry===undefined&&kicks.length){
      entry=scanKickCandidates(at,stop);
      if(entry!==undefined)method='kick-forward-scan';
    }
    Object.assign(trace,{forwardScanFrames:tested-(trace.backscanFrames as number),selectedMethod:method,selectedEntry:entry,selectedCandidate:selected,bestCandidate:best});
    if(entry===undefined){report('no-sustained-entry');continue;}
    changed=true;
    while(sections[i].end<=entry){sections[i].label='build';i++;}
    const release=sections[i];
    if(release.end-entry<.3&&sections[i+1]?.label==='drop'){
      release.label='build';release.end=entry;sections[i+1].start=entry;
    }else{
      if(entry-release.start>.2){
        const preparation:Section={...release,end:entry,label:'build'};
        release.start=entry;
        sections.splice(i,0,preparation);i++;
      }else{
        release.start=entry;sections[i-1].end=entry;
      }
    }
    // 相邻短单句预热段若缺失全频段支撑（低频抽空，或高频严重低通且无密集底鼓驱动），并入同一铺垫段
    const prevDur=previous?Math.max(1e-6,previous.end-previous.start):1;
    const prevHigh=previous?bandMean(high,fps,previous.start,previous.end):0;
    const prevKickRate=previous?kicks.filter(([t,s])=>t>=previous.start&&t<previous.end&&s>=.35).length/prevDur:0;
    if(previous&&previous.label==='chorus'&&canExtendBuild?.(previous)&&prevDur<=16&&prevHigh<highRef*.4&&
      (bandMean(low,fps,previous.start,previous.end)<bassRef*.4||(prevHigh<highRef*.2&&prevKickRate<.35))){
      previous.label='build';
    }
    report('entry-refined',{finalEntry:entry,selectedMethod:method,selectedCandidate:selected});
  }
  if(!changed&&sections.every(section=>section.label!=='drop'))debug?.({stage:'drop-preparation',status:'no-drop-section',kickCount:kicks.length});
  return changed;
}

export function refineDropEntries({sections,beats,fps,low,rms,kicks=[]}:EntryInput):void {
  if(!low?.length||!rms.length||beats.length<4||!kicks.length)return;
  const bassRef=quantile(low,.9),rmsRef=quantile(rms,.9)**2;
  if(bassRef<1e-8||rmsRef<1e-8)return;
  const beat=quantile(Float64Array.from(beats.slice(1),(t,i)=>t-beats[i]),.5);
  const radius=Math.min(1.2,beat*1.25);
  for(let i=1;i<sections.length;i++){
    const section=sections[i],previous=sections[i-1],at=section.start;
    if(section.label!=='drop'||previous.label==='drop')continue;
    // Prefer an existing tight entry to a louder note later in the phrase.
    if(kicks.some(h=>h[1]>=.45&&Math.abs(h[0]-at)<=.12))continue;
    if(bandMean(low,fps,at+.02,at+.14)>=bassRef*.16)continue;
    const candidates=kicks.filter(([t,strength])=>strength>=.45&&Math.abs(t-at)<=radius&&t>previous.start+.3&&t<section.end-.3)
      .filter(([t])=>{
        const before=bandMean(low,fps,t-.2,t-.04),after=bandMean(low,fps,t+.02,t+.14);
        const power=bandMean(rms,fps,t+.02,t+.14,true);
        return after>=bassRef*.16&&power>=rmsRef*.16&&db(after)-db(before)>=8;
      }).sort((a,b)=>Math.abs(a[0]-at)-Math.abs(b[0]-at));
    const entry=candidates[0]?.[0];
    if(entry!==undefined&&Math.abs(entry-at)>.12){section.start=entry;previous.end=entry;}
  }
}

/** Phrase cuts and bar-based body motion follow the confirmed entry's beat. */
export function alignDropBars(beats:number[],beatInBar:number[],sections:Section[],meter:number):void {
  for(const section of sections){
    if(section.label!=='drop')continue;
    let anchor=0;
    for(let i=1;i<beats.length;i++)if(Math.abs(beats[i]-section.start)<Math.abs(beats[anchor]-section.start))anchor=i;
    const period=anchor+1<beats.length?beats[anchor+1]-beats[anchor]:beats[anchor]-beats[anchor-1];
    if(Math.abs(beats[anchor]-section.start)>period*.2||beatInBar[anchor]===0)continue;
    for(let i=anchor;i<beats.length&&beats[i]<section.end;i++)beatInBar[i]=(i-anchor)%meter;
  }
}
