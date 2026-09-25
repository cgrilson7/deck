import sys, subprocess, numpy as np, tempfile, os, wave
f=sys.argv[1]; segs=[tuple(map(float,s.split('-'))) for s in sys.argv[2:]]
t=tempfile.mktemp(suffix='.wav'); subprocess.run(['afconvert','-f','WAVE','-d','LEI16@32000','-c','1',f,t],check=True)
w=wave.open(t); x=np.frombuffer(w.readframes(w.getnframes()),np.int16).astype(np.float32); os.remove(t)
for a,b in segs:
    y=x[int(a*32000):int(b*32000)]; Y=np.abs(np.fft.rfft(y*np.hanning(len(y)))); fr=np.fft.rfftfreq(len(y),1/32000)
    m=fr>250; pk=fr[m][np.argmax(Y[m])]; cen=(fr[m]*Y[m]).sum()/Y[m].sum()
    print(f"{f} {a}-{b}: peak {pk:.0f}Hz centroid {cen:.0f}Hz")
