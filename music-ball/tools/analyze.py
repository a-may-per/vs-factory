#!/usr/bin/env python3
"""音频分析：歌曲 -> 稳定节拍骨架 + onset 强弱分层事件轴。

输出事件：
  t_ms / strength / band / beat / downbeat / tier

设计原则：beat_track 是主轴，onset 只负责给节拍补充强弱和音色信息。
这样流行歌曲里人声 onset 漂移时，主碰撞点仍锁在节拍网格上；
远离节拍的明显 onset 才作为 weak 装饰点，不会把主轨迹带偏。
"""
import json
import sys


def nearest(values, target, window):
    """返回 window 内离 target 最近的索引和值。"""
    best = None
    for i, value in enumerate(values):
        distance = abs(float(value) - float(target))
        if distance <= window and (best is None or distance < best[0]):
            best = (distance, i, float(value))
    return best


def percentile(values, q, fallback=0.5):
    if not values:
        return fallback
    values = sorted(values)
    index = min(len(values) - 1, max(0, int((len(values) - 1) * q)))
    return float(values[index])


def analyze(path: str, out_path: str):
    import librosa
    import numpy as np

    y, sr = librosa.load(path, sr=22050, mono=True)
    duration = len(y) / sr
    hop = 512

    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    if len(onset_env) == 0:
        raise RuntimeError("audio has no analyzable onset envelope")
    normalized = librosa.util.normalize(onset_env)
    normalized = np.nan_to_num(normalized, nan=0.0, posinf=1.0, neginf=0.0)

    onset_times = librosa.onset.onset_detect(
        onset_envelope=onset_env,
        sr=sr,
        hop_length=hop,
        units="time",
        backtrack=True,
        pre_max=3,
        post_max=3,
        pre_avg=3,
        post_avg=5,
        delta=0.07,
        wait=2,
    )
    onset_times = [float(t) for t in onset_times]
    onset_strengths = []
    for t in onset_times:
        index = min(len(normalized) - 1, max(0, int(t * sr / hop)))
        onset_strengths.append(float(normalized[index]))

    # beat_track 提供不漂移的主节拍骨架。
    tempo, beat_times = librosa.beat.beat_track(
        y=y,
        sr=sr,
        hop_length=hop,
        units="time",
        trim=False,
    )
    beat_times = [float(t) for t in np.atleast_1d(beat_times)]
    tempo = float(np.atleast_1d(tempo)[0]) if np.size(tempo) else 0.0
    beat_tolerance = max(0.075, min(0.12, 30.0 / max(tempo, 60.0)))

    y_harm, y_perc = librosa.effects.hpss(y)

    def band_at(t):
        s0 = max(0, int((t - 0.05) * sr))
        s1 = min(len(y), int((t + 0.05) * sr))
        if s1 <= s0:
            return "harm"
        pe = float(np.sum(y_perc[s0:s1] ** 2))
        he = float(np.sum(y_harm[s0:s1] ** 2)) + 1e-9
        return "perc" if pe / (pe + he) > 0.5 else "harm"

    def strength_at(t):
        index = min(len(normalized) - 1, max(0, int(t * sr / hop)))
        return float(normalized[index])

    events = []
    # 每个 beat 都是候选主节点。附近 onset 只贡献 strength/band，不改变时间。
    for beat_index, beat_time in enumerate(beat_times):
        match = nearest(onset_times, beat_time, beat_tolerance)
        strength = max(strength_at(beat_time), onset_strengths[match[1]] if match else 0.0)
        events.append({
            "t_ms": int(round(beat_time * 1000)),
            "strength": round(float(strength), 3),
            "band": band_at(match[2] if match else beat_time),
            "beat": True,
            "downbeat": beat_index % 4 == 0,
            "source": "beat",
        })

    # 节拍网格之外的明显 onset 作为 weak 装饰；不会抢占主碰撞轨迹。
    strong_onset_cut = percentile(onset_strengths, 0.70, fallback=0.8)
    for onset_time, strength in zip(onset_times, onset_strengths):
        if nearest(beat_times, onset_time, beat_tolerance):
            continue
        if strength < strong_onset_cut:
            continue
        events.append({
            "t_ms": int(round(onset_time * 1000)),
            "strength": round(float(strength), 3),
            "band": band_at(onset_time),
            "beat": False,
            "downbeat": False,
            "source": "onset",
        })

    # 同一时间附近只保留一个事件。beat 优先，保证主轴稳定。
    events.sort(key=lambda event: event["t_ms"])
    filtered = []
    for event in events:
        if filtered and event["t_ms"] - filtered[-1]["t_ms"] < 95:
            previous = filtered[-1]
            if event["beat"] and not previous["beat"]:
                filtered[-1] = event
            elif event["strength"] > previous["strength"] and not previous["beat"]:
                filtered[-1] = event
        else:
            filtered.append(event)

    strong_cut = percentile([event["strength"] for event in filtered], 0.68, fallback=0.6)
    for event in filtered:
        if event["downbeat"] or event["strength"] >= strong_cut:
            event["tier"] = "strong"
        elif event["beat"]:
            event["tier"] = "beat"
        else:
            event["tier"] = "weak"
        event.pop("source", None)

    meta = {
        "duration_s": round(duration, 2),
        "tempo": round(tempo, 1),
        "events": len(filtered),
        "strong_events": sum(event["tier"] == "strong" for event in filtered),
        "beat_events": sum(event["tier"] == "beat" for event in filtered),
        "weak_events": sum(event["tier"] == "weak" for event in filtered),
        "beat_tolerance_ms": round(beat_tolerance * 1000),
    }
    json.dump({"meta": meta, "events": filtered}, open(out_path, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"analyzed {path}: {meta}, saved {out_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: analyze.py <input-audio> <axis.json>")
    analyze(sys.argv[1], sys.argv[2])
