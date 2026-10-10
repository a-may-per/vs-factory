// 多轨混音器：把若干 (PCM, 偏移秒) 混成一条 Float32 PCM，可再叠 BGM。
export interface Track { pcm: Float32Array; offsetSec: number; gain?: number }

export function mixTracks(tracks: Track[], totalSec: number, sr = 44100): Float32Array {
  const n = Math.floor(totalSec * sr);
  const out = new Float32Array(n);
  for (const tr of tracks) {
    const g = tr.gain ?? 1;
    const start = Math.floor(tr.offsetSec * sr);
    for (let i = 0; i < tr.pcm.length; i++) {
      const j = start + i;
      if (j >= 0 && j < n) out[j] += tr.pcm[i] * g;
    }
  }
  return out;
}

export function normalize(samples: Float32Array, target = 0.9): Float32Array {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) return samples;
  const k = target / peak;
  if (k < 1 || k > 1) for (let i = 0; i < samples.length; i++) samples[i] *= k;
  return samples;
}
