export type WindowShapeRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function appendOrMerge(rectangles: WindowShapeRectangle[], rectangle: WindowShapeRectangle) {
  const previous = rectangles.at(-1);
  if (
    previous &&
    previous.x === rectangle.x &&
    previous.width === rectangle.width &&
    previous.y + previous.height === rectangle.y
  ) {
    previous.height += rectangle.height;
    return;
  }
  rectangles.push(rectangle);
}

/**
 * 将圆角矩形离散成 Electron setShape() 接受的整数矩形并集。
 * 空数组表示恢复系统矩形；逐行区域会合并相同宽度，限制原生调用负担。
 */
export function buildRoundedWindowShape(
  widthValue: number,
  heightValue: number,
  radiusValue: number,
): WindowShapeRectangle[] {
  const width = Math.floor(widthValue);
  const height = Math.floor(heightValue);
  if (width <= 0 || height <= 0) return [];
  const radius = Math.max(0, Math.min(Math.round(radiusValue), Math.floor(width / 2), Math.floor(height / 2)));
  if (radius === 0) return [];

  const rectangles: WindowShapeRectangle[] = [];
  for (let y = 0; y < radius; y += 1) {
    const distanceFromCenter = radius - y - 0.5;
    const inset = Math.max(0, Math.ceil(radius - Math.sqrt(Math.max(0, radius ** 2 - distanceFromCenter ** 2))));
    appendOrMerge(rectangles, { x: inset, y, width: width - inset * 2, height: 1 });
  }
  if (height > radius * 2) {
    appendOrMerge(rectangles, { x: 0, y: radius, width, height: height - radius * 2 });
  }
  for (let y = Math.max(radius, height - radius); y < height; y += 1) {
    const mirroredY = height - y - 1;
    const distanceFromCenter = radius - mirroredY - 0.5;
    const inset = Math.max(0, Math.ceil(radius - Math.sqrt(Math.max(0, radius ** 2 - distanceFromCenter ** 2))));
    appendOrMerge(rectangles, { x: inset, y, width: width - inset * 2, height: 1 });
  }
  return rectangles;
}
