# 节拍分析 v2（music-beat-sync §1/§2）：鲁棒网格拟合 + 三分类鼓点 + 平滑能量结构
# 用法：uv run --with librosa --with scipy --python 3.11 analyze_bgm.py <bgm.mp3> <out_dir>
import sys, json, os
import numpy as np
import librosa
from scipy.signal import butter, sosfilt

src, outdir = sys.argv[1], sys.argv[2]

y, sr = librosa.load(src, sr=None, mono=True)
dur = float(len(y) / sr)
tempo, beats = librosa.beat.beat_track(y=y, sr=sr, tightness=400, units="time")

def fit_grid(beats):
    i = np.arange(len(beats))
    A = np.vstack([i, np.ones_like(i)]).T
    (T, t0), *_ = np.linalg.lstsq(A, beats, rcond=None)
    return T, t0, beats - (t0 + np.arange(len(beats)) * T)

# 第一轮拟合 → 剔除离群 → 第二轮（beat_track 漏/多检的拍点会拉歪网格）
T1, t01, r1 = fit_grid(beats)
inliers = np.abs(r1) < 0.040
T, t0, r2 = fit_grid(beats[inliers])
bpm = 60.0 / T
res = beats - (t0 + np.arange(len(beats)) * T)

harm, perc = librosa.effects.hpss(y)
def band_env(sig, lo, hi):
    sos = butter(4, [lo, hi], btype="band", fs=sr, output="sos")
    env = librosa.onset.onset_strength(y=sosfilt(sos, sig), sr=sr)
    return env, librosa.times_like(env, sr=sr)

kick_env, times = band_env(perc, 40, 160)
snare_env, _ = band_env(perc, 150, 500)
hihat_env, _ = band_env(perc, 6000, 14000)

n_beats = int((dur - t0) / T) - 1
hits = []
for n in range(n_beats):
    t = t0 + n * T
    j = int(np.argmin(np.abs(times - t)))
    hits.append({
        "beat": n, "t": round(float(t), 4),
        "kick": round(float(kick_env[j]), 3),
        "snare": round(float(snare_env[j]), 3),
        "hihat": round(float(hihat_env[j]), 3),
    })

# 能量结构：8 拍滑动平均（拍级 RMS 本身随鼓点脉动，不平滑没法切段落）
rms = librosa.feature.rms(y=y)[0]
rms_t = librosa.times_like(rms, sr=sr)
energy = []
for n in range(n_beats):
    t = t0 + n * T
    j = int(np.argmin(np.abs(rms_t - t)))
    energy.append(float(rms[j]))
en = np.convolve(np.array(energy), np.ones(8) / 8, mode="same")
en = en / (en.max() + 1e-9)

# 段落边界：滑动能量过中位数为高能段（迟滞 0.05 防抖）
sections = []
cur = None
hi, lo = 0.62, 0.5
for n in range(n_beats):
    e = en[n]
    lvl = cur
    if cur is None:
        lvl = "high" if e > hi else "low"
    elif cur == "low" and e > hi:
        lvl = "high"
    elif cur == "high" and e < lo:
        lvl = "low"
    if lvl != cur:
        sections.append({"from_beat": n, "t": round(float(t0 + n * T), 3), "level": lvl, "energy": round(float(e), 3)})
        cur = lvl
sections.append({"from_beat": n_beats, "t": round(float(dur), 2), "level": "end", "energy": 0})

# 能量跃升点（drop 候选：8 拍窗能量差分 top）
diff = np.diff(en, prepend=en[0])
drops = sorted(
    [{"beat": n, "t": round(float(t0 + n * T), 3), "jump": round(float(diff[n]), 3)} for n in range(4, n_beats) if diff[n] > 0],
    key=lambda d: -d["jump"],
)[:8]

# 最强 kick 候选（大 slam 池）
top = sorted([{"beat": h["beat"], "t": h["t"], "kick": h["kick"]} for h in hits], key=lambda h: -h["kick"])[:12]
top = sorted(top, key=lambda h: h["beat"])

out = {
    "src": src, "sr": sr, "duration": dur,
    "bpm": round(float(bpm), 3), "t0": round(float(t0), 5), "T": round(float(T), 6),
    "fit": {
        "beats_total": int(len(beats)), "inliers": int(inliers.sum()),
        "residual_ms_mean": round(float(np.abs(res).mean()) * 1000, 1),
        "residual_ms_p95": round(float(np.percentile(np.abs(res), 95)) * 1000, 1),
        "residual_ms_max": round(float(np.abs(res).max()) * 1000, 1),
    },
    "beats": [round(float(b), 4) for b in beats],
    "hits": hits, "energy_smooth": [round(float(e), 4) for e in en],
    "sections": sections, "drops": drops, "top_kicks": top,
}
os.makedirs(outdir, exist_ok=True)
with open(os.path.join(outdir, "beat_data.json"), "w") as f:
    json.dump(out, f, indent=1)
print(f"== {os.path.basename(src)}")
print(f"dur={dur:.1f}s BPM={bpm:.2f} t0={t0:.4f}s T={T:.5f}s beats={len(beats)} inliers={inliers.sum()}")
print(f"residual: mean={out['fit']['residual_ms_mean']}ms p95={out['fit']['residual_ms_p95']}ms max={out['fit']['residual_ms_max']}ms")
print("sections:", [(s['from_beat'], s['level']) for s in sections])
print("drops:", [(d['beat'], d['jump']) for d in drops[:5]])
print("top kicks:", [(h['beat'], h['kick']) for h in top[:6]])
