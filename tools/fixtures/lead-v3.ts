// A mix-derived melodic cue, not an isolated instrument stem. Sustained upper-mid
// harmonics and their changes drive the lead independently of the drum pulses.
import type { Spectra } from '../../src/analysis/spectrum.ts';
import { attackRelease, quantile, Slicer } from '../../src/analysis/util.ts';

export interface LeadFeatures {
  level: Float32Array;
  attack: Float32Array;
  brightness: Float32Array;
}

const unit = (v: number) => Math.max(0, Math.min(1, v));
const median5 = (a: number, b: number, c: number, d: number, e: number): number => {
  // Fixed-size sorting network; no arrays allocated in the per-band loop.
  let t: number;
  if (a>b) { t=a;a=b;b=t; } if (d>e) { t=d;d=e;e=t; }
  if (c>e) { t=c;c=e;e=t; } if (c>d) { t=c;c=d;d=t; }
  if (a>d) { t=a;a=d;d=t; } if (a>c) { t=a;a=c;c=t; }
  if (b>e) { t=b;b=e;e=t; } if (b>d) { t=b;b=d;d=t; }
  if (b>c) { t=b;b=c;c=t; }
  return c;
};

type LeadInput = Pick<Spectra, 'fps'|'nFrames'|'nMel'|'melAmp'|'melHz'|'power'>;

export function* analyzeLeadSteps(spec: LeadInput, slicer = new Slicer(Infinity), p0 = 0, p1 = 1): Generator<number,LeadFeatures,void> {
  const {nFrames:n,nMel:bands,fps,melAmp,melHz} = spec;
  const level = new Float32Array(n), attack = new Float32Array(n), brightness = new Float32Array(n);
  if (!n || !bands) return {level,attack,brightness};
  const weights = new Float32Array(bands), position = new Float32Array(bands);
  let weightSum = 0;
  for(let b=0;b<bands;b++) {
    if(melHz[b]<350 || melHz[b]>6200) continue;
    weights[b]=Math.exp(-0.5*(Math.log2(melHz[b]/1600)/1.45)**2);
    position[b]=unit(Math.log(melHz[b]/350)/Math.log(6200/350));
    weightSum+=weights[b];
  }
  if (!weightSum) return {level,attack,brightness};
  const filtered = new Float32Array(n*bands), raw = new Float32Array(n), tone = new Float32Array(n);
  for(let i=0;i<n;i++) {
    const o=i*bands;
    let energy=0,logEnergy=0,centroid=0;
    for(let b=0;b<bands;b++) {
      const w=weights[b];if(!w)continue;
      const amp=median5(melAmp[Math.max(0,i-2)*bands+b],melAmp[Math.max(0,i-1)*bands+b],melAmp[o+b],melAmp[Math.min(n-1,i+1)*bands+b],melAmp[Math.min(n-1,i+2)*bands+b]);
      filtered[o+b]=amp;
      const power=amp*amp;
      energy+=power*w;logEnergy+=Math.log(power+1e-16)*w;centroid+=power*w*position[b];
    }
    raw[i]=Math.sqrt(energy/weightSum);
    const flatness=Math.exp(logEnergy/weightSum)/(energy/weightSum+1e-16);
    // A broad supersaw keeps a response; short, spectrally flat noise gets less.
    tone[i]=0.08+0.92*Math.sqrt(unit(1-flatness));
    brightness[i]=energy>1e-14 ? centroid/energy : 0;
    if((i&63)===63&&slicer.due()){yield p0+(p1-p0)*0.7*(i+1)/n;slicer.resume();}
  }
  const reference=quantile(raw,0.99);
  const songReference=Math.sqrt(Math.max(0,quantile(spec.power,0.99)));
  if(reference<1e-6 || songReference<1e-6) { brightness.fill(0);return {level,attack,brightness}; }
  // Mel filters average bins, so their RMS is below the full-band RMS. Keep a
  // real broadband synth responsive while rejecting leakage from sub-only input.
  const presence=unit(reference/(songReference*0.025));
  const flux=new Float32Array(n),lag=Math.max(1,Math.round(fps*0.04));
  for(let i=0;i<n;i++) {
    const audible=unit((raw[i]/reference-0.035)/0.965);
    level[i]=audible*tone[i]*presence;
    if(i<lag)continue;
    let change=0;
    for(let b=0;b<bands;b++) if(weights[b])change+=Math.max(0,filtered[i*bands+b]-filtered[(i-lag)*bands+b])*weights[b];
    flux[i]=change/weightSum;
    if((i&127)===127&&slicer.due()){yield p0+(p1-p0)*(0.7+0.25*(i+1)/n);slicer.resume();}
  }
  const fluxReference=quantile(flux,0.98);
  if(fluxReference>reference*0.005)for(let i=0;i<n;i++)attack[i]=unit(flux[i]/fluxReference)*tone[i]*presence*unit(level[i]*4);
  return {
    level:attackRelease(level,fps,0.018,0.16),
    attack:attackRelease(attack,fps,0.008,0.11),
    brightness:attackRelease(brightness,fps,0.035,0.08),
  };
}

/** Synchronous entry point for DSP checks and command-line analysis. */
export function analyzeLead(spec: LeadInput): LeadFeatures {
  const steps=analyzeLeadSteps(spec);
  for(;;){const result=steps.next();if(result.done)return result.value;}
}
