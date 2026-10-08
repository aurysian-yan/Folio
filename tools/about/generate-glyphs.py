#!/usr/bin/env python3
# 将共用 SVG 字标转换为各端绘制资源，保留原始画布与路径。
import hashlib
import json
import pathlib
import xml.etree.ElementTree as ET

from fontTools.pens.qu2cuPen import Qu2CuPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.svgLib.path import parse_path

root = pathlib.Path(__file__).resolve().parents[2]
output = root / 'shared/about'
sources = ['logo-main.svg'] + [f'logo-egg{index}.svg' for index in range(1, 6)]
variants = []
fingerprints = {}
for filename in sources:
    file = output / 'wordmarks' / filename
    svg = ET.parse(file).getroot()
    x, y, width, height = map(float, svg.attrib['viewBox'].split())
    if x != 0 or y != 0 or width <= 0 or height <= 0:
        raise ValueError(f'字标画布无效：{filename}')
    paths = [path.attrib['d'] for path in svg.iter('{http://www.w3.org/2000/svg}path')]
    if not paths or any(node.tag.endswith('text') for node in svg.iter()):
        raise ValueError(f'字标必须使用矢量路径：{filename}')
    commands = []
    for path in paths:
        pen = RecordingPen()
        parse_path(path, Qu2CuPen(pen, 1, all_cubic=True))
        for operation, arguments in pen.value:
            if operation == 'moveTo':
                commands.append(['M', *arguments[0]])
            elif operation == 'lineTo':
                commands.append(['L', *arguments[0]])
            elif operation == 'curveTo':
                commands.append(['C', *[value for point in arguments for value in point]])
            elif operation == 'closePath':
                commands.append(['Z'])
    variants.append({'name': file.stem, 'width': width, 'height': height, 'paths': paths, 'commands': commands})
    fingerprints[str(file.relative_to(root))] = hashlib.sha256(file.read_bytes()).hexdigest()

(output / 'glyphs.json').write_text(json.dumps(variants, ensure_ascii=False, indent=2) + '\n')
(output / 'glyph-sources.json').write_text(json.dumps(fingerprints, indent=2) + '\n')
