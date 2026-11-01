// Foreground voice estimates from harmonic peak families, pitch persistence and articulation. These are acoustic
// roles, not isolated stems or a trained synthesizer-brand classifier. Drums/noise cannot win merely by being loud.
import { RealFFT, hann } from './fft.ts';
import { attackRelease, quantile, Slicer } from './util.ts';
import { localReference } from './lead.ts';

export interface Timbre {
  fps: number;
  bands: number;
  hz: Float32Array;
  /** Foreground-only light per log-frequency band, nFrames × bands; no raw drum spectrum. */
  spectrum: Float32Array;
  synthStab: Float32Array;
  bassStab: Float32Array;
  lead: Float32Array;
  leadAttack: Float32Array;
  /** All upper melodic attacks, including short/plucked lead notes (articulation does not change voice identity). */
  melodyAttack?: Float32Array;
  /** Brightness of the accepted upper voice only; bass harmonics do not set it. */
  leadBrightness?: Float32Array;
  /** Continuous pitched-melody ownership (bright lead or darker keys), with note-gap hold and a soft release. */
  leadPresence?: Float32Array;
  confidence: Float32Array;
  brightness: Float32Array;
}

const unit = (v: number) => Math.max(0, Math.min(1, v));
const median5 = (values: Float32Array, i: number) => quantile(values.subarray(Math.max(0,i-2),Math.min(values.length,i+3)),.5);
const peakFloor=(power:Float64Array,k:number)=>{
  // Adjacent chord notes are peaks, not the noise floor. A mean of six neighbouring bins treated a close third
  // as noise and erased the piano fundamental; trim the two loudest neighbours before estimating the floor.
  const values=[power[Math.max(1,k-5)],power[Math.max(1,k-4)],power[Math.max(1,k-3)],power[k+3],power[k+4],power[k+5]];
  let sum=0,a=0,b=0;for(const value of values){sum+=value;if(value>a){b=a;a=value;}else b=Math.max(b,value);}
  return (sum-a-b)/4;
};

export function* analyzeTimbreSteps(samples: Float32Array, sampleRate: number, slicer = new Slicer(Infinity), p0=0, p1=1): Generator<number,Timbre,void> {
  const fps=60, bands=64, n=Math.floor(samples.length/sampleRate*fps)+1;
  const hz=Float32Array.from({length:bands},(_,b)=>30*Math.pow(Math.min(14000,sampleRate*.45)/30,b/(bands-1)));
  const zero=()=>new Float32Array(n);
  const result:Timbre={fps,bands,hz,spectrum:new Float32Array(n*bands),synthStab:zero(),bassStab:zero(),lead:zero(),leadAttack:zero(),confidence:zero(),brightness:new Float32Array(n).fill(.5)};
  if(!samples.length || sampleRate<8000) return result;
  const size=1<<Math.max(10,Math.round(Math.log2(sampleRate/11))), df=sampleRate/size;
  const fft=new RealFFT(size), win=hann(size), frame=new Float64Array(size), power=new Float64Array(size/2+1);
  const lastBin=Math.min(power.length-6,Math.floor(6200/df));
  const peakBin=new Int16Array(lastBin+4).fill(-1), rootSeen=new Uint8Array(320), selected=new Float32Array(power.length), selectedUpper=new Float32Array(power.length);
  const bassRaw=zero(), upperRaw=zero(), bassPitch=zero(), upperPitch=zero(), bassQ=zero(), upperQ=zero();
  const rawBands=new Float32Array(n*bands),upperBands=new Float32Array(n*bands);
  // Keep a small sparse peak history for a polyphonic voice. A Rhodes/FM keyboard need not have one winning
  // fundamental or exact integer overtones; the *individual residual partials* must stay narrow and pitched.
  const slots=32,partialHz=new Float32Array(n*slots),partialEnergy=new Float32Array(n*slots),partialQuality=new Float32Array(n*slots),partialShared=new Uint8Array(n*slots),partialIndependent=new Uint8Array(n*slots),upperPower=zero();
  const bandLo=Int32Array.from(hz,f=>Math.max(1,Math.floor(f/df)));
  let winSq=0;for(const v of win)winSq+=v*v;
  const scale=2/(size*winSq);
  // Only a persistent low fundamental may explain away an upper partial. A kick's briefly pitched sweep can
  // share a piano note's subharmonic at one instant; it must not swallow that note's whole harmonic family.
  const lowSlots=12,lowHz=new Float32Array(n*lowSlots);
  for(let i=0;i<n;i++) {
    if((i&63)===0&&slicer.due()){yield p0+(p1-p0)*.15*i/n;slicer.resume();}
    const start=Math.round(i/fps*sampleRate)-(size>>1);
    for(let k=0;k<size;k++)frame[k]=(samples[start+k]??0)*win[k];fft.power(frame,power);
    let slot=0;
    for(let k=3;k<=Math.min(lastBin,Math.ceil(170/df));k++) {
      if(power[k]<=power[k-1]||power[k]<power[k+1]||power[k]/(peakFloor(power,k)+1e-20)<5.2)continue;
      const a=Math.log(power[k-1]+1e-20),b=Math.log(power[k]+1e-20),c=Math.log(power[k+1]+1e-20);
      const offset=Math.max(-.5,Math.min(.5,.5*(a-c)/(a-2*b+c||1))),f=(k+offset)*df;
      if(f<45||f>=170)continue;
      lowHz[i*lowSlots+slot++]=f;if(slot===lowSlots)break;
    }
  }
  const stableLow=(i:number,f:number)=>{
    let count=0;
    for(let j=Math.max(0,i-2);j<=Math.min(n-1,i+2);j++)for(let p=0;p<lowSlots;p++){
      const other=lowHz[j*lowSlots+p];if(!other)break;
      if(Math.abs(f-other)<Math.max(df*.15,f*.025)){count++;break;}
    }
    return count>=4;
  };
  for(let i=0;i<n;i++) {
    if((i&31)===0&&slicer.due()){yield p0+(p1-p0)*(.15+.6*i/n);slicer.resume();}
    const start=Math.round(i/fps*sampleRate)-(size>>1);
    for(let k=0;k<size;k++)frame[k]=(samples[start+k]??0)*win[k];
    fft.power(frame,power);
    peakBin.fill(-1);selected.fill(0);selectedUpper.fill(0);rootSeen.fill(0);
    const peaks:Array<{bin:number;hz:number;energy:number;quality:number}>=[];
    const keyPeaks:Array<{bin:number;hz:number;energy:number;quality:number}>=[];
    let total=0, upperTotal=0;
    for(let k=3;k<=lastBin;k++){total+=power[k];if(k*df>=170)upperTotal+=power[k];}
    upperPower[i]=upperTotal;
    if(total*scale<1e-9)continue;
    for(let k=3;k<=lastBin;k++) {
      if(power[k]<=power[k-1] || power[k]<power[k+1])continue;
      const chordFloor=peakFloor(power,k),keyProminence=power[k]/(chordFloor+1e-20);
      if(keyProminence>=6.8&&power[k]>=total*.0005) {
        const a=Math.log(power[k-1]+1e-20),b=Math.log(power[k]+1e-20),c=Math.log(power[k+1]+1e-20);
        const offset=Math.max(-.5,Math.min(.5,.5*(a-c)/(a-2*b+c||1)));
        keyPeaks.push({bin:k,hz:(k+offset)*df,energy:Math.max(0,power[k-1]+power[k]+power[k+1]-3*chordFloor),quality:unit((keyProminence-2)/8)});
      }
      const floor=(power[Math.max(1,k-5)]+power[Math.max(1,k-4)]+power[Math.max(1,k-3)]+power[k+3]+power[k+4]+power[k+5])/6;
      const prominence=power[k]/(floor+1e-20);
      if(prominence<3 || power[k]<total*.0005)continue;
      const a=Math.log(power[k-1]+1e-20),b=Math.log(power[k]+1e-20),c=Math.log(power[k+1]+1e-20);
      const offset=Math.max(-.5,Math.min(.5,.5*(a-c)/(a-2*b+c||1)));
      peaks.push({bin:k,hz:(k+offset)*df,energy:Math.max(0,power[k-1]+power[k]+power[k+1]-3*floor),quality:unit((prominence-2)/8)});
    }
    peaks.sort((a,b)=>b.energy-a.energy);peaks.length=Math.min(48,peaks.length);
    for(let p=0;p<peaks.length;p++) {
      const peak=peaks[p];
      for(let k=Math.max(0,peak.bin-1);k<=Math.min(lastBin+3,peak.bin+1);k++)if(peakBin[k]<0)peakBin[k]=p;
    }
    const roots:number[]=[];
    for(const peak of peaks.slice(0,20))for(let div=1;div<=4;div++) {
      const root=peak.hz/div;if(root<45 || root>1800)continue;
      const bucket=Math.round(Math.log2(root/45)*48);if(rootSeen[bucket])continue;rootSeen[bucket]=1;
      roots.push(root);
    }
    roots.sort((a,b)=>a-b);
    // A bass family explains a bounded amount of power in each partial. A coincident bright melody may add
    // energy to the same FFT peak; claiming that whole peak would erase its first note (e.g. C2 bass + E5 lead).
    const bassExplained=new Float64Array(peaks.length);
    const bassModels:Array<{root:number;slope:number;intercept:number;stable:boolean}>=[];
    let bestBass=0,bestUpper=0;
    for(const root of roots) {
      const matched:number[]=[];let energy=0,quality=0;
      for(let h=1;h<=10 && root*h<6200;h++) {
        const expected=root*h,k=Math.round(expected/df),p=peakBin[k];
        if(p<0 || p===undefined || Math.abs(peaks[p].hz-expected)>Math.max(df*.85,expected*.022) || matched.includes(p))continue;
        matched.push(p);energy+=peaks[p].energy;quality+=peaks[p].quality;
      }
      if(!matched.length)continue;
      // A high synth chord's subharmonic is not a bass instrument. Conversely, an octave of an already explained
      // bass fundamental must not claim the higher partials again with a fresh, larger low-order allowance.
      const fundamental=matched.find(p=>Math.abs(peaks[p].hz-root)<Math.max(df*.85,root*.022));
      const residual=(p:number)=>Math.max(0,peaks[p].energy-bassExplained[p]);
      const voiceEnergy=root>=170?matched.reduce((sum,p)=>sum+residual(p),0):energy;
      const supported=root>=170?matched.filter(p=>residual(p)>.12*peaks[p].energy):matched;
      const share=voiceEnergy/(root>=170?upperTotal:total);
      const rich=supported.length>=3 && share>.09;
      const sparse=root>=170 && (supported.length>=2&&share>.25 || supported.length===1&&share>.38);
      if(!rich&&!sparse)continue;
      const confidence=unit((share-.05)/.3)*quality/matched.length;
      if(root<170) {
        if(!rich||fundamental===undefined||peaks[fundamental].energy<.16*energy||peaks[fundamental].quality<.4)continue;
        if(bassExplained[fundamental]>=.65*peaks[fundamental].energy)continue;
        const low=matched.map(p=>({h:Math.max(1,Math.round(peaks[p].hz/root)),energy:peaks[p].energy})).filter(p=>p.h<=5);
        const slopes:number[]=[];
        for(let a=0;a<low.length;a++)for(let b=a+1;b<low.length;b++)if(low[a].h!==low[b].h)
          slopes.push(Math.log(low[b].energy/low[a].energy)/Math.log(low[b].h/low[a].h));
        const slope=Math.max(-6,Math.min(-.5,slopes.length?quantile(slopes,.5):-2));
        const intercept=quantile(low.map(p=>Math.log(p.energy)-slope*Math.log(p.h)),.6);
        {
          const body=low.filter(p=>p.h<=3),slopes:number[]=[];
          for(let a=0;a<body.length;a++)for(let b=a+1;b<body.length;b++)if(body[a].h!==body[b].h)
            slopes.push(Math.log(body[b].energy/body[a].energy)/Math.log(body[b].h/body[a].h));
          const slope=Math.max(-6,Math.min(-.5,slopes.length?quantile(slopes,.5):-2));
          bassModels.push({root,slope,intercept:quantile(body.map(p=>Math.log(p.energy)-slope*Math.log(p.h)),.6),stable:stableLow(i,root)});
        }
        for(let p=0;p<peaks.length;p++) {
          const h=Math.round(peaks[p].hz/root);
          if(h<1||Math.abs(peaks[p].hz-root*h)>Math.max(df*.85,root*h*.022))continue;
          // Fit the low-order decay robustly, then leave excess high-order power for an independent upper family.
          // Explain harmonics beyond h=10 too, so a rich bass cannot manufacture a second voice in its high tail.
          const expected=h<=2?peaks[p].energy:Math.exp(intercept+slope*Math.log(h))*2;
          bassExplained[p]=Math.max(bassExplained[p],Math.min(peaks[p].energy,expected));
        }
      }
      for(const p of matched) {
        const pk=peaks[p], q=confidence*pk.quality;
        for(let k=pk.bin-1;k<=pk.bin+1;k++) {
          selected[k]=Math.max(selected[k],q);
          // Shared bass partials are not independent evidence of a second upper voice.
          if(root>=170)selectedUpper[k]=Math.max(selectedUpper[k],q*residual(p)/(peaks[p].energy+1e-20));
        }
      }
      const upperEnergy=voiceEnergy,score=(root>=170?upperEnergy:energy)*confidence;
      if(root<170 && score>bestBass){bestBass=score;bassRaw[i]=Math.sqrt(energy*scale);bassPitch[i]=root;bassQ[i]=confidence;}
      if(root>=170 && score>bestUpper){bestUpper=score;upperRaw[i]=Math.sqrt(upperEnergy*scale);upperPitch[i]=root;upperQ[i]=confidence;}
    }
    keyPeaks.sort((a,b)=>b.energy-a.energy);
    let slot=0;
    for(const peak of keyPeaks) {
      let explained=0,compatible=false,interference=false;
      for(const model of bassModels) {
        const h=Math.round(peak.hz/model.root);
        const predicted=Math.exp(model.intercept+model.slope*Math.log(Math.max(1,h)))*2;
        // A strong neighbouring bass partial can bend a low keyboard peak's frequency/amplitude inside the FFT
        // window without matching its harmonic exactly. This is contamination of an already held note, not a
        // new note. High independent lead lines remain unaffected when the predicted bass tail is negligible.
        if(h>=2&&Math.abs(peak.hz-model.root*h)<df*3&&predicted>peak.energy*.08)interference=true;
        if(h<1||Math.abs(peak.hz-model.root*h)>Math.max(df*.85,model.root*h*.022))continue;
        compatible=true;
        if(model.stable)explained=Math.max(explained,h<=2?peak.energy:predicted);
      }
      let residual=Math.max(0,peak.energy-explained),shared=false;
      if(compatible||interference) {
        const previous:number[]=[];
        for(let j=Math.max(0,i-6);j<=i-2;j++)for(let q=0;q<slots;q++){
          const f=partialHz[j*slots+q];if(!f)break;
          if(Math.abs(f-peak.hz)<=Math.max(df*.65,peak.hz*.018)&&partialIndependent[j*slots+q]){previous.push(partialEnergy[j*slots+q]);break;}
        }
        // A note already present before this bass onset does not disappear when one of its lines happens to be
        // a bass harmonic. Preserve its bounded body; the bass-correlated rise is not a fresh keyboard strike.
        if(previous.length>=3){residual=Math.max(residual,Math.min(peak.energy,quantile(previous,.5)));shared=true;}
      }
      // Bass-explained harmonics cannot be promoted by pitch persistence; a held wobble is persistent too.
      if(peak.hz<150||peak.quality<.6||residual<peak.energy*.45||residual<upperTotal*.008)continue;
      const o=i*slots+slot++;partialHz[o]=peak.hz;partialEnergy[o]=residual;partialQuality[o]=peak.quality;
      partialShared[o]=Number(shared);
      partialIndependent[o]=Number(!compatible||shared);
      if(slot===slots)break;
    }
    for(let b=0;b<bands;b++) {
      const k=bandLo[b];if(k>=lastBin)continue;
      // Interpolate narrow low bands; wider high bands average the selected bins in their log-frequency cell.
      const lo=Math.max(1,Math.floor(hz[b]*Math.pow(hz[1]/hz[0],-.5)/df));
      const hi=Math.min(lastBin,Math.ceil(hz[b]*Math.pow(hz[1]/hz[0],.5)/df));
      let energy=0,upperEnergy=0;for(let q=lo;q<=hi;q++){energy+=power[q]*selected[q];upperEnergy+=power[q]*selectedUpper[q];}
      rawBands[i*bands+b]=Math.sqrt(energy*scale/Math.max(1,hi-lo+1))*Math.pow(hz[b]/1000,.35);
      upperBands[i*bands+b]=Math.sqrt(upperEnergy*scale/Math.max(1,hi-lo+1))*Math.pow(hz[b]/1000,.35);
    }
  }
  const polyConfidence=zero(),polyRaw=zero(),polyFlux=zero(),polyBandEnergy=new Float64Array(bands);
  const logRange=Math.log(hz[bands-1]/hz[0]);
  for(let i=0;i<n;i++) {
    if((i&63)===0&&slicer.due()){yield p0+(p1-p0)*(.75+.12*i/n);slicer.resume();}
    polyBandEnergy.fill(0);let energy=0,quality=0,count=0,rise=0,amplitude=0;
    for(let p=0;p<slots;p++) {
      const o=i*slots+p,f=partialHz[o];if(!f)break;
      let support=0;
      for(let j=Math.max(0,i-2);j<=Math.min(n-1,i+2);j++) {
        for(let q=0;q<slots;q++) {
          const other=partialHz[j*slots+q];if(!other)break;
          if(Math.abs(other-f)<=Math.max(df*.65,f*.018)){support++;break;}
        }
      }
      if(support<4)continue;
      const e=partialEnergy[o];energy+=e;quality+=e*partialQuality[o];count++;
      const amp=Math.sqrt(e);amplitude+=amp;
      if(!partialShared[o]) {
        let before=0;
        // One frame masked by a snare must not reset a held partial to silence and manufacture a fresh onset.
        for(let j=Math.max(0,i-3);j<=i-2;j++)for(let q=0;q<slots;q++){
          const previous=partialHz[j*slots+q];if(!previous)break;
          if(Math.abs(f-previous)<=Math.max(df*.65,f*.018)){before=Math.max(before,partialEnergy[j*slots+q]);break;}
        }
        rise+=Math.max(0,amp-1.08*Math.sqrt(before));
      }
      const b=Math.max(0,Math.min(bands-1,Math.round(Math.log(f/hz[0])/logRange*(bands-1))));
      polyBandEnergy[b]+=e;
    }
    const share=energy/(upperPower[i]+1e-20);
    // A lone pitched note is valid, but an isolated random spectral spike is not. Several persistent partials
    // may each be quiet inside a chord; judge their combined independent power, not the loudest note's share.
    if((count>=2&&share>.18)||(count===1&&share>.42)) {
      polyConfidence[i]=unit((share-.08)/.32)*quality/(energy+1e-20);
      polyRaw[i]=Math.sqrt(energy*scale);
      polyFlux[i]=polyRaw[i]*unit(rise/(amplitude+1e-20));
      upperRaw[i]=Math.max(upperRaw[i],polyRaw[i]);
      for(let b=0;b<bands;b++) {
        const width=Math.max(1,Math.ceil(hz[b]*Math.pow(hz[1]/hz[0],.5)/df)-Math.floor(hz[b]*Math.pow(hz[1]/hz[0],-.5)/df)+1);
        upperBands[i*bands+b]=Math.max(upperBands[i*bands+b],Math.sqrt(polyBandEnergy[b]*scale/width)*Math.pow(hz[b]/1000,.35));
      }
    }
  }
  const stability=(pitch:Float32Array,i:number)=>{
    if(!pitch[i])return 0;
    let count=0;
    for(let j=Math.max(0,i-3);j<=Math.min(n-1,i+3);j++)if(pitch[j]>0&&Math.abs(Math.log2(pitch[j]/pitch[i]))<.065)count++;
    return unit((count-2)/3);
  };
  const bass=zero(),upper=zero(), bassConfidence=zero(), upperConfidence=zero();
  for(let i=0;i<n;i++) {
    bassConfidence[i]=bassQ[i]*stability(bassPitch,i);
    upperConfidence[i]=Math.max(upperQ[i]*stability(upperPitch,i),polyConfidence[i]);
    // Confidence gates the resulting light, never the amplitude whose derivative detects an attack: a confidence
    // dip under a snare followed by recovery must not invent a new note on an uninterrupted held lead.
    bass[i]=median5(bassRaw,i);upper[i]=median5(upperRaw,i);
    result.confidence[i]=Math.max(bassConfidence[i],upperConfidence[i]);
  }
  const makeRole=(raw:Float32Array,confidence:Float32Array,low:boolean)=>{
    let rawPeak=0;for(const value of raw)rawPeak=Math.max(rawPeak,value);
    // One genuine note in a long sparse track may occupy less than the upper percentile. A zero quantile is
    // therefore not evidence of silence; preserve a bounded reference to the actual accepted voice's peak.
    const reference=Math.max(quantile(raw,.99),rawPeak*.25),level=zero(),attack=zero();
    if(reference<1e-5)return {level,attack};
    const gain=localReference(raw,fps,reference*.15),flux=zero(),lag=2;
    for(let i=0;i<n;i++) {
      level[i]=Math.pow(unit((raw[i]/gain[i]-.04)/.96),.85)*confidence[i];
      if(i>=lag) {
        flux[i]=Math.max(0,raw[i]-raw[i-lag]-.08*raw[i]);
        // Note changes can keep the same total level (and even share a subharmonic candidate). Require a
        // substantial change in the accepted pitch spectrum, rather than another bump of the mixed amplitude.
        let energy=0,rise=0;
        for(let b=0;b<bands;b++)if((hz[b]<170)===low) {
          const voice=low?rawBands:upperBands;
          const now=voice[i*bands+b],before=voice[(i-lag)*bands+b];
          energy+=now;rise+=Math.max(0,now-1.1*before);
        }
        const novelty=energy>1e-8?rise/energy:0;
        flux[i]=Math.max(flux[i],raw[i]*unit((novelty-.22)/.78));
        if(!low&&polyRaw[i]>0)flux[i]=polyFlux[i];
        else if(!low&&upperPitch[i]>0) {
          // The strict winner can temporarily disappear/reappear when percussion masks/bends a held chord.
          // Do not turn that detector handoff into a new strike. A genuinely new high lead has no matching
          // independent partial in the previous keyboard and keeps its strict-path first attack.
          let existing=0;
          for(let j=Math.max(0,i-12);j<=i-2;j++) {
            if(polyConfidence[j]<.5)continue;
            for(let q=0;q<slots;q++) {
              const f=partialHz[j*slots+q];if(!f)break;
              if(partialIndependent[j*slots+q]&&Math.abs(f-upperPitch[i])<Math.max(df,upperPitch[i]*.035)){existing++;break;}
            }
          }
          if(existing>=3)flux[i]=0;
        }
      }
    }
    let fluxPeak=0;for(const value of flux)fluxPeak=Math.max(fluxPeak,value);
    const fluxRef=Math.max(quantile(flux,.99),fluxPeak*.25);if(fluxPeak<=reference*.01)return {level,attack};
    const attackGain=localReference(flux,fps,fluxRef*.18);
    for(let i=0;i<n;i++)attack[i]=unit(flux[i]/attackGain[i])*confidence[i]*unit(level[i]*3);
    return {level:attackRelease(level,fps,.008,.08),attack:attackRelease(attack,fps,.004,.07)};
  };
  const lower=makeRole(bass,bassConfidence,true),higher=makeRole(upper,upperConfidence,false);
  result.bassStab=lower.attack;result.lead=higher.level;
  result.melodyAttack=higher.attack;
  result.leadBrightness=zero();result.leadPresence=zero();
  let owner=false,lastEvidence=-Infinity,ownership=0;
  for(let i=0;i<n;i++) {
    // A short pitched articulation is a stab; one held into the next half second is a lead onset. Both are allowed
    // over a drum hit: this detector never blindly vetoes events near kick/snare timestamps.
    const future=Math.min(n-1,i+Math.round(.32*fps));
    const short=upper[future]<upper[i]*.55;
    result.synthStab[i]=higher.attack[i]*(short?1:0);
    result.leadAttack[i]=higher.attack[i]*(short?0:1);
    let energy=0,centroid=0;
    for(let b=0;b<bands;b++){const p=upperBands[i*bands+b]**2;energy+=p;centroid+=p*unit(Math.log(hz[b]/170)/Math.log(6200/170));}
    const brightness=energy>1e-12?centroid/energy:0;
    result.leadBrightness[i]=brightness;
    // Ownership is a voice decision, not an instantaneous comparison against bass attack amplitude. Bright lead
    // and independently persistent dark keys both qualify; colour/brightness must not turn a keyboard off.
    if(higher.level[i]>=.2 && upperConfidence[i]>=.12 && (brightness>=.24||polyConfidence[i]>=.5)){owner=true;lastEvidence=i;}
    if(i-lastEvidence>fps*.26)owner=false;
    const tau=owner ? .025 : .13;
    ownership+=(Number(owner)-ownership)*(1-Math.exp(-1/(fps*tau)));
    result.leadPresence[i]=ownership;
  }
  let bandPeak=0;for(const value of rawBands)bandPeak=Math.max(bandPeak,value);
  let upperBandPeak=0;for(const value of upperBands)upperBandPeak=Math.max(upperBandPeak,value);
  const bandReference=Math.max(quantile(rawBands,.995),bandPeak*.25), bandGain=zero();
  if(bandReference>1e-6||upperBandPeak>1e-6) {
    for(let i=0;i<n;i++)for(let b=0;b<bands;b++)bandGain[i]=Math.max(bandGain[i],rawBands[i*bands+b]);
    const gain=localReference(bandGain,fps,Math.max(1e-6,bandReference*.15)),upperPeak=zero();
    for(let i=0;i<n;i++)for(let b=0;b<bands;b++)upperPeak[i]=Math.max(upperPeak[i],upperBands[i*bands+b]);
    let upperMax=0;for(const value of upperPeak)upperMax=Math.max(upperMax,value);
    const upperGain=localReference(upperPeak,fps,Math.max(1e-6,Math.max(quantile(upperPeak,.99),upperMax*.25)*.15));
    for(let i=0;i<n;i++) {
      const strike=Math.max(result.synthStab[i],result.bassStab[i],result.leadAttack[i]);
      const body=Math.max(result.lead[i],lower.level[i]);
      let energy=0,centroid=0;
      for(let b=0;b<bands;b++) {
        const v=rawBands[i*bands+b];energy+=v*v;centroid+=v*v*b/(bands-1);
        const mixed=Math.pow(unit(v/gain[i]),.7)*(.22*body+.78*strike);
        const melodic=Math.pow(unit(upperBands[i*bands+b]/upperGain[i]),.7)*(.25*higher.level[i]+.75*higher.attack[i]);
        const focus=result.leadPresence[i];
        result.spectrum[i*bands+b]=mixed*(1-focus)+melodic*focus;
      }
      result.brightness[i]=energy>1e-12?centroid/energy:.5;
      if((i&127)===127&&slicer.due()){yield p0+(p1-p0)*(.87+.13*(i+1)/n);slicer.resume();}
    }
  }
  return result;
}

export function analyzeTimbre(samples:Float32Array,sampleRate:number):Timbre {
  const steps=analyzeTimbreSteps(samples,sampleRate);
  for(;;){const next=steps.next();if(next.done)return next.value;}
}
