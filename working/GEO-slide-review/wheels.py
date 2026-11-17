import concurrent.futures as cf
import json, os, subprocess, urllib.request, pathlib, shutil, math
target=pathlib.Path(os.environ['TEMP'])/'codex-geo-wheels'
target.mkdir(exist_ok=True)
packages={'av':'19.0.2','onnxruntime':'1.32.0','numpy':'2.5.5'}
def fetch_wheel(pair):
 name,version=pair
 with urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{version}/json',timeout=20) as req:
  meta=json.load(req)
 w=next(w for w in meta['urls'] if w['filename'].endswith('win_amd64.whl') and 'cp312-cp312-' in w['filename'])
 dest=target/w['filename']
 def part(i):
  start=i*2_500_000; end=min(start+2_499_999,w['size']-1)
  p=target/f'{name}.{i:02}.part'
  subprocess.run(['curl.exe','-fsSL','--retry','2','--max-time','80','--range',f'{start}-{end}',w['url']+f'?geo_part={i}','-o',str(p)],check=True)
  if p.stat().st_size!=end-start+1: raise RuntimeError(p.name)
  return p
 with cf.ThreadPoolExecutor(max_workers=12) as pool:
  files=list(pool.map(part,range(math.ceil(w['size']/2_500_000))))
 with dest.open('wb') as out:
  for p in files:
   with p.open('rb') as src: shutil.copyfileobj(src,out)
 print(dest.name, dest.stat().st_size, flush=True)
with cf.ThreadPoolExecutor(max_workers=3) as pool:
 list(pool.map(fetch_wheel,packages.items()))
