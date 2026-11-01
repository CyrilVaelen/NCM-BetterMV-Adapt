import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PROJECT} from '../exporter/server.mjs';

export const backup=path.resolve(PROJECT,'../BetterNCM/setup/before-lead-wide-20261016');
export const files=['src/director/music.ts','src/director/overlay.ts','src/render/lead-motion.ts',
  ...['drive','channel','orb','ripple','shatter','particles','kaleido','rings','tunnel','relief','pillars','bokeh','ridges','city','cityTowers'].map(s=>`src/scenes/${s}.ts`),
  'exporter/build-plugin.mjs','tools/lead.test.ts','tools/lead-preview.mjs'];
try{await fs.access(path.join(backup,'baseline.json'));}
catch{
  const baseline={};
  for(const file of [...files,'../BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin']){
    const data=await fs.readFile(path.resolve(PROJECT,file));
    const target=path.join(backup,file.startsWith('../')?'BetterMV-0.9.0-local-export.plugin':`source/${file}`);
    await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data,{flag:'wx'});
    baseline[file]=createHash('sha256').update(data).digest('hex');
  }
  await fs.writeFile(path.join(backup,'baseline.json'),JSON.stringify(baseline,null,2),{flag:'wx'});
}
console.log(`Backup: ${backup}`);
