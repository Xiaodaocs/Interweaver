# 渲后回测（music-beat-sync §5b + sound-design §4.6）：
# 从成片抽音轨，拿尖锐 SFX 原件（快门 fs-270435）做归一化交叉相关，量输出音轨偏移。
# 用法：uv run --with numpy --with scipy --python 3.11 measure_offset.py <render.mp4>
import sys, subprocess, os
import numpy as np
from scipy.io.wavfile import read as read_wav_raw

FFMPEG = os.environ.get("FFMPEG", "C:/Users/25402/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe")
mp4 = sys.argv[1]
TMP_R = os.path.abspath("tmp-render.wav")
TMP_S = os.path.abspath("tmp-probe.wav")
subprocess.run([FFMPEG, "-y", "-v", "error", "-i", mp4, "-vn", "-ac", "1", "-ar", "48000", "-acodec", "pcm_s16le", TMP_R], check=True)
subprocess.run([FFMPEG, "-y", "-v", "error", "-i", "../public/audio/sfx/fs-270435.mp3", "-ac", "1", "-ar", "48000", "-acodec", "pcm_s16le", TMP_S], check=True)

def read_wav(p):
    sr, d = read_wav_raw(p)
    if d.dtype == np.int16:
        d = d.astype(np.float32) / 32768
    return sr, d
srR, R = read_wav(TMP_R)
srS, S = read_wav(TMP_S)
assert srR == srS == 48000

# 快门在片中出现三次：b152/158/164
BEAT_INT = 0.48387
results = []
for beat in [152, 158, 164]:
    center = int(beat * BEAT_INT * 48000)
    win = R[max(0, center - 24000): center + 24000]
    c = np.correlate(win, S, mode="valid")
    lag = int(np.argmax(np.abs(c)))
    peak_time = (max(0, center - 24000) + lag + int(np.argmax(np.abs(S)))) / 48000
    off = peak_time - beat * BEAT_INT
    results.append(float(off))
    print(f"beat {beat}: 峰在 {peak_time:.4f}s，设计 {beat*BEAT_INT:.4f}s，偏移 {off*1000:.1f}ms（{off*30:.2f}f）")
print(f"平均输出音轨偏移：{np.mean(results)*1000:.1f}ms ≈ {np.mean(results)*30:.2f}f → 填 beats.ts 的 OUTPUT_AUDIO_OFFSET_SEC")
