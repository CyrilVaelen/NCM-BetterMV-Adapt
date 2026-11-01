import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const root='D:/NCM/NCM-BetterMV-0.9.0/src/analysis/',dest='D:/NCM/state/sunshine-form-keys-20261018/timbre-debug.ts';
let src=fs.readFileSync(root+'timbre.ts','utf8').replaceAll("from './","from 'file:///"+root);
src='export let lastDebug:any;\n'+src;
src=src.replace(/\n  return result;\n}/,"\n  lastDebug={bassRaw,upperRaw,bassPitch,upperPitch,bassQ,upperQ,bassConfidence,upperConfidence,upperBands,polyConfidence,polyRaw,polyFlux,partialHz,partialEnergy,partialQuality,partialShared,partialIndependent};\n  return result;\n}");
fs.writeFileSync(dest,src);
const mod=await import(pathToFileURL(dest).href+'?'+Date.now());
const b=fs.readFileSync(process.argv[2]??'D:/NCM/state/sunshine-form-keys-20261018/sunshine.f32'),pcm=new Float32Array(b.buffer,b.byteOffset,b.length/4);
const v=mod.analyzeTimbre(pcm,22050),d=mod.lastDebug;
if(process.argv[3]){fs.writeFileSync(process.argv[3],JSON.stringify({v,d},(_,x)=>ArrayBuffer.isView(x)?Array.from(x):x));process.exit(0);}
const stats=(x)=>{const a=Array.from(x).sort((a,b)=>a-b);return {mean:a.reduce((s,x)=>s+x,0)/a.length,p10:a[Math.floor(a.length*.1)],p50:a[Math.floor(a.length*.5)],p90:a[Math.floor(a.length*.9)],max:a.at(-1),zero:a.filter(x=>x<.001).length/a.length};};
const rows=[];
for(const [from,to]of [[0,30],[30,60],[67,100],[100,130],[130,160],[170,200],[200,240],[240,280],[280,320],[320,340]]){const row={from,to};for(const k of ['bassRaw','upperRaw','bassPitch','upperPitch','bassQ','upperQ','upperConfidence'])row[k]=stats(d[k].slice(from*60,to*60));rows.push(row);}
const output={rows};fs.writeFileSync('D:/NCM/state/sunshine-form-keys-20261018/timbre-debug.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
