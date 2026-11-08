const fs = require('fs');
const data = JSON.parse(fs.readFileSync('D:/NCM/state/ascend_analysis.json', 'utf8'));

for (const [file, song] of Object.entries(data)) {
  console.log('====================================');
  console.log('FILE:', file, 'BPM:', Math.round(song.bpm), 'Dur:', Math.round(song.duration));
  
  const climaxes = song.drops.length > 0 ? song.drops : song.sections.filter(s => s.label === 'chorus');
  
  climaxes.forEach((c, idx) => {
    // Find lines before this climax
    const preLines = song.lines.filter(l => l.start < c.start && l.text.trim().length > 0);
    const lastLine = preLines[preLines.length - 1];
    console.log(`  [Climax ${idx + 1}] (${c.label}) ${c.start.toFixed(2)}s -> ${c.end.toFixed(2)}s (dur: ${(c.end - c.start).toFixed(1)}s, energy: ${c.energy})`);
    if (lastLine) {
      console.log(`    Last vocal before climax: [${lastLine.start.toFixed(2)}s - ${lastLine.end.toFixed(2)}s] "${lastLine.text}"`);
    } else {
      console.log(`    No vocal before climax found`);
    }
  });
}
