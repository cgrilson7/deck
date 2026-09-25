import sys, subprocess, numpy as np, tempfile, os, wave
f,a,b,out=sys.argv[1],float(sys.argv[2]),float(sys.argv[3]),sys.argv[4]
t=tempfile.mktemp(suffix='.wav'); subprocess.run(['afconvert','-f','WAVE','-d','LEI16@44100','-c','1',f,t],check=True)
w=wave.open(t); sr=w.getframerate(); x=np.frombuffer(w.readframes(w.getnframes()),np.int16).astype(np.float32); os.remove(t)
y=x[int(a*sr):int(b*sr)].copy(); n=int(.01*sr); y[:n]*=np.linspace(0,1,n); m=int(.08*sr); y[-m:]*=np.linspace(1,0,m)
y*=0.89*32767/np.abs(y).max()  # peak -1 dBFS
o=wave.open(out,'wb'); o.setnchannels(1); o.setsampwidth(2); o.setframerate(sr); o.writeframes(y.astype(np.int16).tobytes())
