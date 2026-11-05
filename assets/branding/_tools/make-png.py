# 生成 logo PNG 多尺寸与 favicon（Pillow LANCZOS 从 512 主图缩放）
from PIL import Image
from pathlib import Path

base = Path(__file__).resolve().parent.parent
png = base / 'png'
sizes = [256, 128, 64, 32, 16]

for name in ['logo', 'mark']:
    src = Image.open(png / f'{name}-512.png').convert('RGBA')
    for s in sizes:
        out = src.resize((s, s), Image.LANCZOS)
        out.save(png / f'{name}-{s}.png', optimize=True)
    print(f'{name}: 512 + {sizes}')

# favicon：16/32/48 三档打进一个 ico（用带底主图）
ico_src = Image.open(png / 'logo-512.png').convert('RGBA')
ico_src.save(base / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
print('favicon.ico written')

for f in sorted(png.glob('*.png')):
    im = Image.open(f)
    print(f.name, im.size, f.stat().st_size, 'bytes')

