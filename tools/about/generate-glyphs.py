#!/usr/bin/env python3
# 将固定来源字体转换为共用矢量，保持字标画布与基线一致。
import json,pathlib,re
root=pathlib.Path(__file__).resolve().parents[2]
out=root/'shared/about'
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
import hashlib
variants=[]
fingerprints={}
original=(root/'apps/macos/Folio/Assets.xcassets/BrandLogo.imageset/BrandLogo.svg').read_text()
paths=re.findall(r'<path[^>]*d="([^"]+)"',original)
variants.append({'name':'Folio','paths':paths})
fingerprints['apps/macos/Folio/Assets.xcassets/BrandLogo.imageset/BrandLogo.svg']=hashlib.sha256(original.encode()).hexdigest()
for name,file in [('Inter','fixtures/fonts/Inter-Variable.ttf'),('Source Serif 4','fixtures/fonts/SourceSerif4-Regular.otf'),('JetBrains Mono','apps/desktop-ui/src/assets/fonts/JetBrainsMono-Variable.ttf')]:
 fingerprints[file]=hashlib.sha256((root/file).read_bytes()).hexdigest()
 font=TTFont(root/file); glyphset=font.getGlyphSet(); cmap=font.getBestCmap(); advance=sum(glyphset[cmap[ord(c)]].width for c in 'Folio')
 bounds=BoundsPen(glyphset)
 for c in 'Folio': glyphset[cmap[ord(c)]].draw(bounds)
 scale=min(960/advance,340/bounds.bounds[3]); left=(1024-advance*scale)/2; ps=[]
 for c in 'Folio':
  pen=SVGPathPen(glyphset); glyphset[cmap[ord(c)]].draw(TransformPen(pen,(scale,0,0,-scale,left,359))); ps.append(pen.getCommands()); left+=glyphset[cmap[ord(c)]].width*scale
 variants.append({'name':name,'paths':ps})
for index,v in enumerate(variants):
 svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 364">'+''.join('<path fill="currentColor" d="'+p+'"/>' for p in v['paths'])+'</svg>'
 (out/f'wordmark-{index}.svg').write_text(svg+'\n')
(out/'glyphs.json').write_text(json.dumps(variants,ensure_ascii=False,indent=2)+'\n')

import json,pathlib
from fontTools.svgLib.path import parse_path
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.qu2cuPen import Qu2CuPen
p=out/'glyphs.json'; data=json.loads(p.read_text())
for glyph in data:
 commands=[]
 for path in glyph['paths']:
  pen=RecordingPen(); parse_path(path,Qu2CuPen(pen,1,all_cubic=True))
  for op,args in pen.value:
   if op=='moveTo': commands.append(['M',*args[0]])
   elif op=='lineTo': commands.append(['L',*args[0]])
   elif op=='curveTo': commands.append(['C',*[v for point in args for v in point]])
   elif op=='closePath': commands.append(['Z'])
 glyph['commands']=commands
p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')

(out/"glyph-sources.json").write_text(json.dumps(fingerprints,indent=2)+"\n")
