// Live output calibration is separate from media time. It must never shift the
// offline export, which muxes the same decoded audio that was analysed.
export const PICTURE_DELAY_LIMIT = 5000;
export interface PictureSync {
  latencyMs: number;
  songVisualDelays: Record<string, number>;
}
export function parseVisualDelays(value: unknown): Record<string, number> {
  try {
    const input = typeof value === 'string' ? JSON.parse(value) : value;
    const out: Record<string, number> = {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
    for (const [key, n] of Object.entries(input)) {
      if (/^[1-9]\d*$/.test(key) && typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= PICTURE_DELAY_LIMIT) out[key] = Math.round(n);
    }
    return out;
  } catch { return {}; }
}
export function pictureDelayMs(config: PictureSync, songId?: number): number {
  const device = Number.isFinite(config.latencyMs) ? config.latencyMs : 0;
  const song = songId ? config.songVisualDelays[String(songId)] : 0;
  return Math.max(-PICTURE_DELAY_LIMIT, Math.min(PICTURE_DELAY_LIMIT, device + (Number.isFinite(song) ? song : 0)));
}
/** Import local calibration once per song. An explicit zero remains a reset. */
export async function importPictureCalibration(config: PictureSync): Promise<void> {
  try {
    const root = (await betterncm.app.getDataPath()).replace(/[\\/]+$/, '');
    const doc = JSON.parse(await betterncm.fs.readFileText(`${root}/BetterMV/playback-sync.json`));
    if (doc.version !== 1) return;
    const defaults = parseVisualDelays(doc.delaysMs);
    let changed = false, rememberRevision = false;
    // Withdraw an imported estimate once; subsequent manual choices survive.
    const revision=typeof doc.revision==='string'?doc.revision:'';
    if(revision&&plugin.getConfig('pictureCalibrationRevision','')!==revision){
      for(const [id,estimate] of Object.entries(parseVisualDelays(doc.resetEstimatedMs))){
        if(config.songVisualDelays[id]===estimate){config.songVisualDelays[id]=0;changed=true;}
      }
      rememberRevision = true;
    }
    // NetEase embeds Chromium 91, before Object.hasOwn was introduced.
    for (const [id, ms] of Object.entries(defaults)) if (!Object.prototype.hasOwnProperty.call(config.songVisualDelays, id)) {
      config.songVisualDelays[id] = ms; changed = true;
    }
    if (changed) plugin.setConfig('songVisualDelays', JSON.stringify(config.songVisualDelays));
    if (rememberRevision) plugin.setConfig('pictureCalibrationRevision',revision);
  } catch { /* No local calibration file: use the saved/default values. */ }
}
