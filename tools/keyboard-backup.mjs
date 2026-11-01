import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PROJECT} from '../exporter/server.mjs';
const root=path.resolve(PROJECT,'../BetterNCM/setup/before-keyboard-20261016');
try{await fs.access(path.join(root,'baseline.json'));}catch{
  const baseline={};
  for(const file of ['src/analysis/lead.ts','src/analysis/index.ts','src/director/music.ts','src/types.ts','src/plugin/clock.ts','src/plugin/main.ts','src/plugin/ui.ts','exporter/build-plugin.mjs','tools/lead.test.ts','../主旋律动效增强说明.md','../BetterNCM/plugins/BetterMV-0.9.0-local-export.plugin']){
    const data=await fs.readFile(path.resolve(PROJECT,file));
    const target=path.join(root,file.startsWith('../')?path.basename(file):`source/${file}`);
    await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data,{flag:'wx'});
    baseline[file]=createHash('sha256').update(data).digest('hex');
  }
  await fs.writeFile(path.join(root,'baseline.json'),JSON.stringify(baseline,null,2),{flag:'wx'});
}
console.log(root);
