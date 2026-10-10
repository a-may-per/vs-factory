#!/usr/bin/env python3
"""音频分析：mp3/wav → JSON 事件轴（敲击点关卡数据）。
输出: [{t_ms, strength, band, beat, downbeat}, ...]
"""
import json, sys

def analyze(path: str, out_path: str):
    import librosa, numpy as np
    y, sr = librosa.load(path, sr=22050, mono=True)
    duration = len(y) / sr

    # onset 强度包络 + 事件检测
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, units="time", backtrack=True)
    strengths = librosa.util.normalize(onset_env)

    # 节拍网格
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    beat_set = set(round(b * 1000) for b in beats)
    tempo = float(np.atleast_1d(tempo)[0])

    # HPSS 分离鼓点成分判定 band（粗分：percussive 强度占比高 → 打击乐）
    y_harm, y_perc = librosa.effects.hpss(y)

    events = []
    for i, t in enumerate(onsets):
        t_ms = int(t * 1000)
        # 取 onset 前后 100ms 窗口，比较 percussive/harmonic 能量
        s0, s1 = max(0, int((t - 0.05) * sr)), min(len(y), int((t + 0.05) * sr))
        if s1 <= s0: continue
        pe = float(np.sum(y_perc[s0:s1] ** 2))
        he = float(np.sum(y_harm[s0:s1] ** 2)) + 1e-9
        band = "perc" if pe / (pe + he) > 0.5 else "harm"
        # strength: 该时刻的 onset 强度归一化
        idx = min(len(strengths) - 1, int(t * sr / 512))
        strength = round(float(strengths[idx]), 3)
        events.append({
            "t_ms": t_ms,
            "strength": strength,
            "band": band,
            "beat": t_ms in beat_set or any(abs(t_ms - b) < 60 for b in beat_set),
            "downbeat": False,
        })
    # downbeat：每小节第一拍（简化：节拍序列每 4 个一个重音）
    beat_list = sorted(beat_set)
    for i, b in enumerate(beat_list):
        if i % 4 == 0:
            for ev in events:
                if abs(ev["t_ms"] - b) < 60:
                    ev["downbeat"] = True
                    break

    # 克制密度：相邻 120ms 内只保留 strength 最高的事件
    events.sort(key=lambda e: e["t_ms"])
    filtered = []
    for ev in events:
        if filtered and ev["t_ms"] - filtered[-1]["t_ms"] < 120:
            if ev["strength"] > filtered[-1]["strength"]:
                filtered[-1] = ev
        else:
            filtered.append(ev)

    meta = {"duration_s": round(duration, 2), "tempo": round(tempo, 1), "events": len(filtered)}
    json.dump({"meta": meta, "events": filtered}, open(out_path, "w"), ensure_ascii=False)
    print(f"analyzed {path}: {meta}, saved {out_path}")

if __name__ == "__main__":
    analyze(sys.argv[1], sys.argv[2])
