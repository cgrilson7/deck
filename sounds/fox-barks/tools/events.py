import sys, subprocess, numpy as np
# prints loud events (vs. the clip's noise floor) in a file: start-end, peak dB above floor
for f in sys.argv[1:]:
    import tempfile, os, wave
    t = tempfile.mktemp(suffix='.wav')
    subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', f, t], check=True)
    w = wave.open(t); x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768; os.remove(t)
    X = np.fft.rfft(x); X[:int(300 * len(x) / 16000)] = 0; x = np.fft.irfft(X, len(x))
    hop = 800  # 50ms
    n = len(x) // hop
    rms = np.sqrt(np.mean(x[:n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    floor = np.percentile(db, 20)
    on = db > floor + 12
    ev = []; i = 0
    while i < n:
        if on[i]:
            j = i
            while j < n and (on[j] or (j + 3 < n and on[j:j + 4].any())): j += 1
            ev.append((i * .05, j * .05, db[i:j].max() - floor)); i = j
        else: i += 1
    print(f"{f}: {n*.05:.1f}s floor {floor:.0f}dBFS peak {db.max():.0f}dBFS, {len(ev)} events")
    print('  ' + '  '.join(f"{a:.1f}-{b:.1f}(+{p:.0f})" for a, b, p in ev[:40]))
