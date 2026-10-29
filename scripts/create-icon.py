"""Generate deterministic bundled application icon; no external fonts or assets."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / 'apps/desktop/resources/icons'
root.mkdir(parents=True, exist_ok=True)
image = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((16, 16, 496, 496), radius=104, fill='#EE2233')
# Open hexagonal C suggests an assembly cell and a woven data link.
points = [(365, 134), (262, 81), (133, 155), (133, 342), (262, 416), (365, 362)]
draw.line(points, fill='white', width=49, joint='curve')
for x, y in points:
    draw.ellipse((x-24, y-24, x+24, y+24), fill='white')
draw.rounded_rectangle((260, 230, 426, 277), radius=13, fill='white')
draw.rounded_rectangle((375, 207, 425, 318), radius=13, fill='white')
image.save(root / 'cadweave.png')
image.save(root / 'cadweave.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print(root)
