import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Circle, Copy, Crop, Eraser, Minus, MousePointer2, PaintBucket, Pencil, Redo2, Save, Square, Trash2, Undo2, X } from "lucide-react";

type BoardRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16";

type DrawTool = "select" | "brush" | "eraser" | "rect" | "roundRect" | "circle" | "line" | "crop" | "bucket";
type ShapeTool = "rect" | "roundRect" | "circle" | "line";

export type DrawingBoardRequest = {
  ratio: BoardRatio;
  source?: {
    id: string;
    name: string;
    dataUrl: string;
  };
};

type DrawingBoardProps = {
  request: DrawingBoardRequest;
  onClose: () => void;
  onSave: (image: { name: string; dataUrl: string; sourceId?: string }) => void;
};

type Point = {
  x: number;
  y: number;
};

type CropSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ShapeObject = {
  id: string;
  type: ShapeTool;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  strokeColor: string;
  strokeWidth: number;
};

type ShapeHandle = "nw" | "ne" | "se" | "sw";

type ShapeInteraction =
  | {
      mode: "draw";
      pointerId: number;
      start: Point;
    }
  | {
      mode: "move";
      pointerId: number;
      start: Point;
      original: ShapeObject;
    }
  | {
      mode: "resize";
      pointerId: number;
      handle: ShapeHandle;
      original: ShapeObject;
    }
  | {
      mode: "rotate";
      pointerId: number;
      original: ShapeObject;
      center: Point;
      startAngle: number;
    };

type BoardSnapshot = {
  width: number;
  height: number;
  backgroundColor: string;
  bgDataUrl: string;
  drawDataUrl: string;
  shapeObjects: ShapeObject[];
};

const BOARD_SIZES: Record<BoardRatio, { width: number; height: number; label: string }> = {
  "1:1": { width: 720, height: 720, label: "1:1 方形" },
  "4:3": { width: 800, height: 600, label: "4:3 横向" },
  "3:4": { width: 600, height: 800, label: "3:4 竖向" },
  "16:9": { width: 960, height: 540, label: "16:9 宽屏" },
  "9:16": { width: 540, height: 960, label: "9:16 竖屏" },
};

const DRAW_COLORS = [
  { value: "#ef4444", label: "红" },
  { value: "#facc15", label: "黄" },
  { value: "#2563eb", label: "蓝" },
  { value: "#111827", label: "黑" },
  { value: "#ffffff", label: "白" },
  { value: "#22c55e", label: "绿" },
  { value: "#f97316", label: "橙" },
  { value: "#a855f7", label: "紫" },
  { value: "#ec4899", label: "粉" },
  { value: "#6b7280", label: "灰" },
];

const DRAW_TOOLS: { value: DrawTool; label: string; icon: typeof Pencil }[] = [
  { value: "select", label: "选择", icon: MousePointer2 },
  { value: "brush", label: "画笔", icon: Pencil },
  { value: "eraser", label: "橡皮", icon: Eraser },
  { value: "rect", label: "方形", icon: Square },
  { value: "roundRect", label: "圆角矩形", icon: Square },
  { value: "circle", label: "圆形", icon: Circle },
  { value: "line", label: "线条", icon: Minus },
  { value: "crop", label: "裁剪", icon: Crop },
  { value: "bucket", label: "油漆桶", icon: PaintBucket },
];

const STROKE_SIZES = [
  { value: 4, label: "小" },
  { value: 8, label: "中" },
  { value: 14, label: "大" },
  { value: 24, label: "特大" },
];

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = dataUrl;
  });
}

function getCanvasPoint(canvas: HTMLCanvasElement, event: React.PointerEvent<HTMLCanvasElement>): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function isShapeTool(tool: DrawTool): tool is ShapeTool {
  return tool === "rect" || tool === "roundRect" || tool === "circle" || tool === "line";
}

function createShapeObject(tool: ShapeTool, start: Point, end: Point, color: string, strokeWidth: number): ShapeObject {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.max(8, Math.abs(end.x - start.x));
  const height = Math.max(8, Math.abs(end.y - start.y));
  if (tool === "line") {
    return {
      id: `shape-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: tool,
      x: start.x,
      y: start.y,
      width: end.x - start.x,
      height: end.y - start.y,
      rotation: 0,
      strokeColor: color,
      strokeWidth,
    };
  }
  return {
    id: `shape-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: tool,
    x: left,
    y: top,
    width,
    height,
    rotation: 0,
    strokeColor: color,
    strokeWidth,
  };
}

function getShapeCenter(shape: ShapeObject): Point {
  return {
    x: shape.x + shape.width / 2,
    y: shape.y + shape.height / 2,
  };
}

function rotatePoint(point: Point, center: Point, rotation: number): Point {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function toLocalPoint(point: Point, shape: ShapeObject): Point {
  return rotatePoint(point, getShapeCenter(shape), -shape.rotation);
}

function getShapeCorners(shape: ShapeObject) {
  const corners: Record<ShapeHandle, Point> = {
    nw: { x: shape.x, y: shape.y },
    ne: { x: shape.x + shape.width, y: shape.y },
    se: { x: shape.x + shape.width, y: shape.y + shape.height },
    sw: { x: shape.x, y: shape.y + shape.height },
  };
  const center = getShapeCenter(shape);
  return Object.fromEntries(
    Object.entries(corners).map(([key, point]) => [key, rotatePoint(point, center, shape.rotation)])
  ) as Record<ShapeHandle, Point>;
}

function getRotateHandle(shape: ShapeObject): Point {
  const center = getShapeCenter(shape);
  return rotatePoint({ x: center.x, y: shape.y - 34 }, center, shape.rotation);
}

function pointDistance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return pointDistance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq));
  return pointDistance(point, { x: start.x + t * dx, y: start.y + t * dy });
}

function hitTestShape(point: Point, shape: ShapeObject) {
  const local = toLocalPoint(point, shape);
  const tolerance = Math.max(8, shape.strokeWidth / 2 + 5);
  if (shape.type === "line") {
    return distanceToSegment(local, { x: shape.x, y: shape.y }, { x: shape.x + shape.width, y: shape.y + shape.height }) <= tolerance;
  }
  return (
    local.x >= shape.x - tolerance &&
    local.x <= shape.x + shape.width + tolerance &&
    local.y >= shape.y - tolerance &&
    local.y <= shape.y + shape.height + tolerance
  );
}

function hitTestShapeHandle(point: Point, shape: ShapeObject): ShapeHandle | "rotate" | null {
  const corners = getShapeCorners(shape);
  const handleHitSize = 12;
  for (const [handle, corner] of Object.entries(corners) as [ShapeHandle, Point][]) {
    if (pointDistance(point, corner) <= handleHitSize) return handle;
  }
  if (pointDistance(point, getRotateHandle(shape)) <= handleHitSize) return "rotate";
  return null;
}

function resizeShapeFromHandle(shape: ShapeObject, handle: ShapeHandle, point: Point): ShapeObject {
  const local = toLocalPoint(point, shape);
  let left = shape.x;
  let right = shape.x + shape.width;
  let top = shape.y;
  let bottom = shape.y + shape.height;
  if (handle.includes("w")) left = Math.min(local.x, right - 8);
  if (handle.includes("e")) right = Math.max(local.x, left + 8);
  if (handle.includes("n")) top = Math.min(local.y, bottom - 8);
  if (handle.includes("s")) bottom = Math.max(local.y, top + 8);
  return {
    ...shape,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const left = Math.min(x, x + width);
  const top = Math.min(y, y + height);
  const w = Math.abs(width);
  const h = Math.abs(height);
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(left + r, top);
  ctx.lineTo(left + w - r, top);
  ctx.quadraticCurveTo(left + w, top, left + w, top + r);
  ctx.lineTo(left + w, top + h - r);
  ctx.quadraticCurveTo(left + w, top + h, left + w - r, top + h);
  ctx.lineTo(left + r, top + h);
  ctx.quadraticCurveTo(left, top + h, left, top + h - r);
  ctx.lineTo(left, top + r);
  ctx.quadraticCurveTo(left, top, left + r, top);
  ctx.stroke();
}

function drawShape(ctx: CanvasRenderingContext2D, tool: DrawTool, start: Point, end: Point) {
  const width = end.x - start.x;
  const height = end.y - start.y;
  if (tool === "rect") {
    ctx.strokeRect(start.x, start.y, width, height);
    return;
  }
  if (tool === "roundRect") {
    drawRoundRect(ctx, start.x, start.y, width, height, 24);
    return;
  }
  if (tool === "circle") {
    const centerX = start.x + width / 2;
    const centerY = start.y + height / 2;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  if (tool === "line") {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
}

function drawShapeObject(ctx: CanvasRenderingContext2D, shape: ShapeObject) {
  const center = getShapeCenter(shape);
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(shape.rotation);
  ctx.translate(-center.x, -center.y);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = shape.strokeWidth;
  ctx.strokeStyle = shape.strokeColor;
  if (shape.type === "rect") {
    ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
  } else if (shape.type === "roundRect") {
    drawRoundRect(ctx, shape.x, shape.y, shape.width, shape.height, 24);
  } else if (shape.type === "circle") {
    ctx.beginPath();
    ctx.ellipse(shape.x + shape.width / 2, shape.y + shape.height / 2, Math.abs(shape.width / 2), Math.abs(shape.height / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (shape.type === "line") {
    ctx.beginPath();
    ctx.moveTo(shape.x, shape.y);
    ctx.lineTo(shape.x + shape.width, shape.y + shape.height);
    ctx.stroke();
  }
  ctx.restore();
}

function normalizeCropSelection(start: Point, end: Point, canvas: HTMLCanvasElement): CropSelection {
  const x = Math.max(0, Math.min(start.x, end.x));
  const y = Math.max(0, Math.min(start.y, end.y));
  const right = Math.min(canvas.width, Math.max(start.x, end.x));
  const bottom = Math.min(canvas.height, Math.max(start.y, end.y));
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

function drawCropOutline(ctx: CanvasRenderingContext2D, selection: CropSelection) {
  ctx.save();
  ctx.setLineDash([10, 6]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#339af0";
  ctx.strokeRect(selection.x, selection.y, selection.width, selection.height);
  ctx.restore();
}

function hexToRgba(hex: string): [number, number, number, number] {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

function colorsMatch(data: Uint8ClampedArray, index: number, target: [number, number, number, number]) {
  return data[index] === target[0] && data[index + 1] === target[1] && data[index + 2] === target[2] && data[index + 3] === target[3];
}

function setPixel(data: Uint8ClampedArray, index: number, color: [number, number, number, number]) {
  data[index] = color[0];
  data[index + 1] = color[1];
  data[index + 2] = color[2];
  data[index + 3] = color[3];
}

function floodFill(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, point: Point, fillColor: string) {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const startIndex = (y * canvas.width + x) * 4;
  const target: [number, number, number, number] = [
    data[startIndex],
    data[startIndex + 1],
    data[startIndex + 2],
    data[startIndex + 3],
  ];
  const replacement = hexToRgba(fillColor);
  if (target.every((value, index) => value === replacement[index])) return;

  const stack: Point[] = [{ x, y }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const px = current.x;
    const py = current.y;
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
    const index = (py * canvas.width + px) * 4;
    if (!colorsMatch(data, index, target)) continue;
    setPixel(data, index, replacement);
    stack.push({ x: px + 1, y: py }, { x: px - 1, y: py }, { x: px, y: py + 1 }, { x: px, y: py - 1 });
  }
  ctx.putImageData(imageData, 0, 0);
}

export function DrawingBoard({ request, onClose, onSave }: DrawingBoardProps) {
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapshotRef = useRef<ImageData | null>(null);
  const startPointRef = useRef<Point | null>(null);
  const lastPointRef = useRef<Point | null>(null);
  const appliedBackgroundRef = useRef("#ffffff");
  const size = useMemo(() => BOARD_SIZES[request.ratio], [request.ratio]);
  const [tool, setTool] = useState<DrawTool>("brush");
  const [color, setColor] = useState("#111827");
  const [backgroundColor, setBackgroundColor] = useState("#ffffff");
  const [colorPanelMode, setColorPanelMode] = useState<"stroke" | "background">("stroke");
  const [strokeWidth, setStrokeWidth] = useState(8);
  const [isDrawing, setIsDrawing] = useState(false);
  const [undoStack, setUndoStack] = useState<BoardSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<BoardSnapshot[]>([]);
  const [cropSelection, setCropSelection] = useState<CropSelection | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: size.width, height: size.height });
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window === "undefined" ? 1120 : window.innerWidth,
    height: typeof window === "undefined" ? 780 : window.innerHeight,
  }));
  const [shapeObjects, setShapeObjects] = useState<ShapeObject[]>([]);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [draftShape, setDraftShape] = useState<ShapeObject | null>(null);
  const [shapeInteraction, setShapeInteraction] = useState<ShapeInteraction | null>(null);

  const selectedShape = shapeObjects.find((shape) => shape.id === selectedShapeId) ?? null;
  const boardDisplaySize = useMemo(() => {
    const modalWidth = Math.min(1120, viewportSize.width * 0.94);
    const modalHeight = Math.min(720, viewportSize.height * 0.92);
    const headerReserve = 56;
    const footerReserve = 50;
    const contentPadding = 40;
    const sidebarWidth = 214;
    const contentGap = 16;
    const verticalBreathing = 16;
    const availableWidth = Math.max(260, modalWidth - contentPadding - sidebarWidth - contentGap);
    const availableHeight = Math.max(300, modalHeight - contentPadding - headerReserve - footerReserve - verticalBreathing);
    const scale = Math.min(availableWidth / canvasSize.width, availableHeight / canvasSize.height);
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    return {
      width: Math.max(1, Math.floor(canvasSize.width * safeScale)),
      height: Math.max(1, Math.floor(canvasSize.height * safeScale)),
    };
  }, [canvasSize.height, canvasSize.width, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    const updateViewportSize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setViewportSize((current) => (
        current.width === width && current.height === height ? current : { width, height }
      ));
    };
    updateViewportSize();
    window.addEventListener("resize", updateViewportSize);
    return () => window.removeEventListener("resize", updateViewportSize);
  }, []);

  const captureCanvas = () => {
    const bgCanvas = bgCanvasRef.current;
    const drawCanvas = canvasRef.current;
    if (!bgCanvas || !drawCanvas) return null;
    const temp = document.createElement("canvas");
    temp.width = drawCanvas.width;
    temp.height = drawCanvas.height;
    const ctx = temp.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bgCanvas, 0, 0);
    ctx.drawImage(drawCanvas, 0, 0);
    shapeObjects.forEach((shape) => drawShapeObject(ctx, shape));
    return temp.toDataURL("image/png");
  };

  const captureBoardSnapshot = (overrides: Partial<Pick<BoardSnapshot, "width" | "height" | "backgroundColor" | "shapeObjects">> = {}): BoardSnapshot | null => {
    const bgCanvas = bgCanvasRef.current;
    const drawCanvas = canvasRef.current;
    if (!bgCanvas || !drawCanvas) return null;
    return {
      width: overrides.width ?? drawCanvas.width,
      height: overrides.height ?? drawCanvas.height,
      backgroundColor: overrides.backgroundColor ?? backgroundColor,
      bgDataUrl: bgCanvas.toDataURL("image/png"),
      drawDataUrl: drawCanvas.toDataURL("image/png"),
      shapeObjects: overrides.shapeObjects ?? shapeObjects,
    };
  };

  const snapshotSignature = (snapshot: BoardSnapshot) => JSON.stringify({
    width: snapshot.width,
    height: snapshot.height,
    backgroundColor: snapshot.backgroundColor,
    bgDataUrl: snapshot.bgDataUrl,
    drawDataUrl: snapshot.drawDataUrl,
    shapeObjects: snapshot.shapeObjects,
  });

  const pushHistory = (overrides: Partial<Pick<BoardSnapshot, "width" | "height" | "backgroundColor" | "shapeObjects">> = {}) => {
    const snapshot = captureBoardSnapshot(overrides);
    if (!snapshot) return;
    setUndoStack((prev) => {
      const previous = prev[prev.length - 1];
      if (previous && snapshotSignature(previous) === snapshotSignature(snapshot)) return prev;
      return [...prev, snapshot];
    });
    setRedoStack([]);
  };

  const replaceLatestHistory = (overrides: Partial<Pick<BoardSnapshot, "width" | "height" | "backgroundColor" | "shapeObjects">> = {}) => {
    const snapshot = captureBoardSnapshot(overrides);
    if (!snapshot) return;
    setUndoStack((prev) => {
      if (prev.length === 0) return [snapshot];
      const next = prev.slice(0, -1);
      return [...next, snapshot];
    });
    setRedoStack([]);
  };

  const drawDataUrl = async (dataUrl: string, target: "bg" | "draw") => {
    const canvas = target === "bg" ? bgCanvasRef.current : canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const image = await loadImage(dataUrl);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  };

  const restoreBoardSnapshot = async (snapshot: BoardSnapshot) => {
    const bgCanvas = bgCanvasRef.current;
    const drawCanvas = canvasRef.current;
    if (!bgCanvas || !drawCanvas) return;
    if (bgCanvas.width !== snapshot.width || bgCanvas.height !== snapshot.height) {
      bgCanvas.width = snapshot.width;
      bgCanvas.height = snapshot.height;
    }
    if (drawCanvas.width !== snapshot.width || drawCanvas.height !== snapshot.height) {
      drawCanvas.width = snapshot.width;
      drawCanvas.height = snapshot.height;
    }
    setCanvasSize((current) => (
      current.width === snapshot.width && current.height === snapshot.height
        ? current
        : { width: snapshot.width, height: snapshot.height }
    ));
    setBackgroundColor(snapshot.backgroundColor);
    appliedBackgroundRef.current = snapshot.backgroundColor;
    await Promise.all([
      drawDataUrl(snapshot.bgDataUrl, "bg"),
      drawDataUrl(snapshot.drawDataUrl, "draw"),
    ]);
    setShapeObjects(snapshot.shapeObjects);
    setSelectedShapeId(null);
    setDraftShape(null);
    setShapeInteraction(null);
    setCropSelection(null);
  };

  useEffect(() => {
    const bgCanvas = bgCanvasRef.current;
    const drawCanvas = canvasRef.current;
    const bgCtx = bgCanvas?.getContext("2d");
    const drawCtx = drawCanvas?.getContext("2d");
    if (!bgCanvas || !drawCanvas || !bgCtx || !drawCtx) return;

    const initCanvas = (width: number, height: number) => {
      bgCanvas.width = width;
      bgCanvas.height = height;
      drawCanvas.width = width;
      drawCanvas.height = height;
      setCanvasSize({ width, height });
      bgCtx.fillStyle = backgroundColor;
      bgCtx.fillRect(0, 0, width, height);
      drawCtx.clearRect(0, 0, width, height);
      appliedBackgroundRef.current = backgroundColor;
    };

    setCropSelection(null);
    setShapeObjects([]);
    setSelectedShapeId(null);
    setDraftShape(null);
    setShapeInteraction(null);

    if (!request.source?.dataUrl) {
      initCanvas(size.width, size.height);
      const initialSnapshot: BoardSnapshot = {
        width: drawCanvas.width,
        height: drawCanvas.height,
        backgroundColor,
        bgDataUrl: bgCanvas.toDataURL("image/png"),
        drawDataUrl: drawCanvas.toDataURL("image/png"),
        shapeObjects: [],
      };
      setUndoStack([initialSnapshot]);
      setRedoStack([]);
      return;
    }
    let cancelled = false;
    void loadImage(request.source.dataUrl).then((image) => {
      if (cancelled) return;
      initCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
      bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
      bgCtx.drawImage(image, 0, 0, bgCanvas.width, bgCanvas.height);
      appliedBackgroundRef.current = backgroundColor;
      const initialSnapshot: BoardSnapshot = {
        width: drawCanvas.width,
        height: drawCanvas.height,
        backgroundColor,
        bgDataUrl: bgCanvas.toDataURL("image/png"),
        drawDataUrl: drawCanvas.toDataURL("image/png"),
        shapeObjects: [],
      };
      setUndoStack([initialSnapshot]);
      setRedoStack([]);
    });
    return () => {
      cancelled = true;
    };
  }, [request.source?.dataUrl, size.height, size.width]);

  const prepareContext = (ctx: CanvasRenderingContext2D) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = strokeWidth;
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color;
    }
  };

  const handleUndo = () => {
    if (undoStack.length <= 1) return;
    const current = undoStack[undoStack.length - 1];
    const previous = undoStack[undoStack.length - 2];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, current]);
    void restoreBoardSnapshot(previous);
  };

  const handleRedo = () => {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, next]);
    void restoreBoardSnapshot(next);
  };

  const handleDeleteSelectedShape = () => {
    if (!selectedShapeId) return;
    const nextShapes = shapeObjects.filter((shape) => shape.id !== selectedShapeId);
    setShapeObjects(nextShapes);
    setSelectedShapeId(null);
    setDraftShape(null);
    setShapeInteraction(null);
    pushHistory({ shapeObjects: nextShapes });
  };

  const commitShapeObjectsToCanvas = (shapes = shapeObjects) => {
    const drawCanvas = canvasRef.current;
    const ctx = drawCanvas?.getContext("2d");
    if (!drawCanvas || !ctx || shapes.length === 0) return false;
    ctx.globalCompositeOperation = "source-over";
    shapes.forEach((shape) => drawShapeObject(ctx, shape));
    setShapeObjects([]);
    setSelectedShapeId(null);
    setDraftShape(null);
    setShapeInteraction(null);
    replaceLatestHistory({ shapeObjects: [] });
    return true;
  };

  const handleToolChange = (nextTool: DrawTool) => {
    if (tool === "select" && nextTool !== "select") {
      commitShapeObjectsToCanvas();
    }
    setTool(nextTool);
    if (nextTool !== "select") {
      setSelectedShapeId(null);
      setDraftShape(null);
      setShapeInteraction(null);
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const point = getCanvasPoint(canvas, event);

    if (tool === "select") {
      const activeShape = selectedShapeId ? shapeObjects.find((shape) => shape.id === selectedShapeId) ?? null : null;
      const activeHandle = activeShape ? hitTestShapeHandle(point, activeShape) : null;
      if (activeShape && activeHandle) {
        canvas.setPointerCapture(event.pointerId);
        if (activeHandle === "rotate") {
          const center = getShapeCenter(activeShape);
          setShapeInteraction({
            mode: "rotate",
            pointerId: event.pointerId,
            original: activeShape,
            center,
            startAngle: Math.atan2(point.y - center.y, point.x - center.x),
          });
        } else {
          setShapeInteraction({
            mode: "resize",
            pointerId: event.pointerId,
            handle: activeHandle,
            original: activeShape,
          });
        }
        return;
      }

      const hitShape = [...shapeObjects].reverse().find((shape) => hitTestShape(point, shape)) ?? null;
      setSelectedShapeId(hitShape?.id ?? null);
      if (!hitShape) {
        commitShapeObjectsToCanvas();
        return;
      }
      if (hitShape) {
        canvas.setPointerCapture(event.pointerId);
        setShapeInteraction({
          mode: "move",
          pointerId: event.pointerId,
          start: point,
          original: hitShape,
        });
      }
      return;
    }

    if (isShapeTool(tool)) {
      canvas.setPointerCapture(event.pointerId);
      setCropSelection(null);
      const nextShape = createShapeObject(tool, point, point, color, strokeWidth);
      setDraftShape(nextShape);
      setSelectedShapeId(null);
      setShapeInteraction({
        mode: "draw",
        pointerId: event.pointerId,
        start: point,
      });
      return;
    }

    prepareContext(ctx);
    if (tool === "bucket") {
      floodFill(ctx, canvas, point, color);
      pushHistory();
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    startPointRef.current = point;
    lastPointRef.current = point;
    snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setCropSelection(null);
    setSelectedShapeId(null);
    setIsDrawing(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (shapeInteraction && canvas) {
      const point = getCanvasPoint(canvas, event);
      if (shapeInteraction.mode === "draw" && isShapeTool(tool)) {
        setDraftShape(createShapeObject(tool, shapeInteraction.start, point, color, strokeWidth));
        return;
      }
      if (shapeInteraction.mode === "move") {
        const dx = point.x - shapeInteraction.start.x;
        const dy = point.y - shapeInteraction.start.y;
        setShapeObjects((prev) =>
          prev.map((shape) =>
            shape.id === shapeInteraction.original.id
              ? { ...shapeInteraction.original, x: shapeInteraction.original.x + dx, y: shapeInteraction.original.y + dy }
              : shape
          )
        );
        return;
      }
      if (shapeInteraction.mode === "resize") {
        const resized = resizeShapeFromHandle(shapeInteraction.original, shapeInteraction.handle, point);
        setShapeObjects((prev) => prev.map((shape) => (shape.id === shapeInteraction.original.id ? resized : shape)));
        return;
      }
      if (shapeInteraction.mode === "rotate") {
        const currentAngle = Math.atan2(point.y - shapeInteraction.center.y, point.x - shapeInteraction.center.x);
        const rotation = shapeInteraction.original.rotation + currentAngle - shapeInteraction.startAngle;
        setShapeObjects((prev) =>
          prev.map((shape) => (shape.id === shapeInteraction.original.id ? { ...shapeInteraction.original, rotation } : shape))
        );
        return;
      }
    }

    if (!isDrawing) return;
    const ctx = canvas?.getContext("2d");
    const start = startPointRef.current;
    const last = lastPointRef.current;
    if (!canvas || !ctx || !start || !last) return;
    const point = getCanvasPoint(canvas, event);
    prepareContext(ctx);

    if (tool === "brush" || tool === "eraser") {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      lastPointRef.current = point;
      return;
    }

    if (snapshotRef.current) {
      ctx.putImageData(snapshotRef.current, 0, 0);
    }
    if (tool === "crop") {
      drawCropOutline(ctx, normalizeCropSelection(start, point, canvas));
      return;
    }
    drawShape(ctx, tool, start, point);
  };

  const finishDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const start = startPointRef.current;
    const snapshot = snapshotRef.current;
    const end = canvas ? getCanvasPoint(canvas, event) : null;
    if (canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    if (shapeInteraction) {
      if (shapeInteraction.mode === "draw" && draftShape && Math.hypot(draftShape.width, draftShape.height) >= 8) {
        const nextShapes = [...shapeObjects, draftShape];
        setShapeObjects(nextShapes);
        setSelectedShapeId(draftShape.id);
        setTool("select");
        pushHistory({ shapeObjects: nextShapes });
      } else if (end && shapeInteraction.mode === "move") {
        const dx = end.x - shapeInteraction.start.x;
        const dy = end.y - shapeInteraction.start.y;
        const moved = { ...shapeInteraction.original, x: shapeInteraction.original.x + dx, y: shapeInteraction.original.y + dy };
        const nextShapes = shapeObjects.map((shape) => (shape.id === moved.id ? moved : shape));
        setShapeObjects(nextShapes);
        pushHistory({ shapeObjects: nextShapes });
      } else if (end && shapeInteraction.mode === "resize") {
        const resized = resizeShapeFromHandle(shapeInteraction.original, shapeInteraction.handle, end);
        const nextShapes = shapeObjects.map((shape) => (shape.id === resized.id ? resized : shape));
        setShapeObjects(nextShapes);
        pushHistory({ shapeObjects: nextShapes });
      } else if (end && shapeInteraction.mode === "rotate") {
        const currentAngle = Math.atan2(end.y - shapeInteraction.center.y, end.x - shapeInteraction.center.x);
        const rotation = shapeInteraction.original.rotation + currentAngle - shapeInteraction.startAngle;
        const rotated = { ...shapeInteraction.original, rotation };
        const nextShapes = shapeObjects.map((shape) => (shape.id === rotated.id ? rotated : shape));
        setShapeObjects(nextShapes);
        pushHistory({ shapeObjects: nextShapes });
      }
      setDraftShape(null);
      setShapeInteraction(null);
      return;
    }

    if (canvas && ctx && start && end && snapshot && tool === "crop") {
      ctx.putImageData(snapshot, 0, 0);
      const selection = normalizeCropSelection(start, end, canvas);
      if (selection.width >= 8 && selection.height >= 8) {
        setCropSelection(selection);
      }
    } else if (isDrawing) {
      pushHistory();
    }
    if (ctx) {
      ctx.globalCompositeOperation = "source-over";
    }
    setIsDrawing(false);
    startPointRef.current = null;
    lastPointRef.current = null;
    snapshotRef.current = null;
  };

  const handleApplyCrop = () => {
    const bgCanvas = bgCanvasRef.current;
    const drawCanvas = canvasRef.current;
    if (!bgCanvas || !drawCanvas || !cropSelection) return;

    const bgTemp = document.createElement("canvas");
    const drawTemp = document.createElement("canvas");
    bgTemp.width = cropSelection.width;
    bgTemp.height = cropSelection.height;
    drawTemp.width = cropSelection.width;
    drawTemp.height = cropSelection.height;
    const bgTempCtx = bgTemp.getContext("2d");
    const drawTempCtx = drawTemp.getContext("2d");
    if (!bgTempCtx || !drawTempCtx) return;

    bgTempCtx.drawImage(bgCanvas, cropSelection.x, cropSelection.y, cropSelection.width, cropSelection.height, 0, 0, cropSelection.width, cropSelection.height);
    drawTempCtx.drawImage(drawCanvas, cropSelection.x, cropSelection.y, cropSelection.width, cropSelection.height, 0, 0, cropSelection.width, cropSelection.height);

    bgCanvas.width = cropSelection.width;
    bgCanvas.height = cropSelection.height;
    drawCanvas.width = cropSelection.width;
    drawCanvas.height = cropSelection.height;
    setCanvasSize({ width: cropSelection.width, height: cropSelection.height });

    const bgCtx = bgCanvas.getContext("2d");
    if (bgCtx) {
      bgCtx.clearRect(0, 0, cropSelection.width, cropSelection.height);
      bgCtx.drawImage(bgTemp, 0, 0);
    }

    const drawCtx = drawCanvas.getContext("2d");
    if (drawCtx) {
      drawCtx.clearRect(0, 0, cropSelection.width, cropSelection.height);
      drawCtx.drawImage(drawTemp, 0, 0);
    }

    const nextShapes = shapeObjects
      .map((shape) => ({ ...shape, x: shape.x - cropSelection.x, y: shape.y - cropSelection.y }))
      .filter((shape) => shape.x + shape.width >= 0 && shape.y + shape.height >= 0 && shape.x <= cropSelection.width && shape.y <= cropSelection.height);
    setShapeObjects(nextShapes);
    setSelectedShapeId(null);
    setCropSelection(null);
    pushHistory({
      width: cropSelection.width,
      height: cropSelection.height,
      shapeObjects: nextShapes,
    });
  };

  const applyBackgroundColor = (nextColor: string) => {
    const bgCanvas = bgCanvasRef.current;
    const bgCtx = bgCanvas?.getContext("2d");
    if (!bgCanvas || !bgCtx) return;
    bgCtx.fillStyle = nextColor;
    bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
    appliedBackgroundRef.current = nextColor;
    pushHistory({ backgroundColor: nextColor });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "z" && event.shiftKey) {
        event.preventDefault();
        handleRedo();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        handleUndo();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        handleRedo();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        handleSave();
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === "enter" && cropSelection) {
        event.preventDefault();
        handleApplyCrop();
        return;
      }
      if (key === "delete" || key === "backspace") {
        handleDeleteSelectedShape();
        return;
      }
      if (key === "escape") {
        if (cropSelection) {
          setCropSelection(null);
          return;
        }
        if (shapeObjects.length > 0) {
          commitShapeObjectsToCanvas();
          return;
        }
        setSelectedShapeId(null);
        setDraftShape(null);
        setShapeInteraction(null);
        return;
      }
      if (key === "v") handleToolChange("select");
      if (key === "b") handleToolChange("brush");
      if (key === "e") handleToolChange("eraser");
      if (key === "r") handleToolChange("rect");
      if (key === "q") handleToolChange("roundRect");
      if (key === "o") handleToolChange("circle");
      if (key === "l") handleToolChange("line");
      if (key === "c") handleToolChange("crop");
      if (key === "f") handleToolChange("bucket");
      if (["1", "2", "3", "4"].includes(key)) {
        setStrokeWidth(STROKE_SIZES[Number(key) - 1]?.value ?? strokeWidth);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const handleSave = () => {
    const dataUrl = captureCanvas();
    if (!dataUrl) return;
    const now = new Date();
    const suffix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    onSave({
      name: request.source ? `${request.source.name.replace(/\.[^.]+$/, "")}-画板.png` : `kimix-画板-${request.ratio}-${suffix}.png`,
      dataUrl,
      sourceId: request.source?.id,
    });
  };

  const handleCopy = async () => {
    const dataUrl = captureCanvas();
    if (!dataUrl) return;
    const res = await window.api.copyImage({ dataUrl });
    if (!res.success) return;
  };

  const renderShapeSvg = (shape: ShapeObject, isDraft = false) => {
    const center = getShapeCenter(shape);
    const transform = `rotate(${(shape.rotation * 180) / Math.PI} ${center.x} ${center.y})`;
    const commonProps = {
      fill: "none",
      stroke: shape.strokeColor,
      strokeWidth: shape.strokeWidth,
      strokeLinecap: "round" as const,
      strokeLinejoin: "round" as const,
      opacity: isDraft ? 0.72 : 1,
    };
    if (shape.type === "rect") {
      return <rect key={shape.id} x={shape.x} y={shape.y} width={shape.width} height={shape.height} transform={transform} {...commonProps} />;
    }
    if (shape.type === "roundRect") {
      return <rect key={shape.id} x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={24} ry={24} transform={transform} {...commonProps} />;
    }
    if (shape.type === "circle") {
      return (
        <ellipse
          key={shape.id}
          cx={shape.x + shape.width / 2}
          cy={shape.y + shape.height / 2}
          rx={Math.abs(shape.width / 2)}
          ry={Math.abs(shape.height / 2)}
          transform={transform}
          {...commonProps}
        />
      );
    }
    return (
      <line
        key={shape.id}
        x1={shape.x}
        y1={shape.y}
        x2={shape.x + shape.width}
        y2={shape.y + shape.height}
        transform={transform}
        {...commonProps}
      />
    );
  };

  const selectionCorners = selectedShape ? getShapeCorners(selectedShape) : null;
  const rotateHandle = selectedShape ? getRotateHandle(selectedShape) : null;

  return (
    <div className="kimix-preview-overlay fixed inset-0 z-[90] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="画板">
      <div
        className="kimix-modal-card flex w-[min(1120px,94vw)] flex-col rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)]"
        style={{ boxSizing: "border-box", height: "min(720px, 92vh)", padding: 20 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between" style={{ gap: 16, marginBottom: 16 }}>
          <div className="min-w-0">
            <div className="text-[17px] font-semibold text-[var(--kimix-panel-text)]">简易画板</div>
            <div className="mt-1 text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]">
              {request.source ? `基于原图：${request.source.name} · ${canvasSize.width}×${canvasSize.height}` : `新建画板：${size.label}`}
            </div>
          </div>
          <button type="button" onClick={onClose} className="kimix-settings-icon-button shrink-0 rounded-lg" aria-label="关闭画板" title="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: "214px minmax(0, 1fr)", gap: 16 }}>
          <aside className="kimix-settings-card flex w-[214px] shrink-0 flex-col rounded-xl" style={{ padding: "16px 10px 16px 14px", height: "100%", minHeight: 0 }}>
            <div className="kimix-stable-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto" style={{ paddingRight: 4, scrollbarGutter: "stable" }}>
              <section>
              <div className="text-[13px] font-medium text-[var(--kimix-panel-text)]">历史</div>
              <div className="mt-3 grid grid-cols-2" style={{ gap: 8 }}>
                <button type="button" onClick={handleUndo} disabled={undoStack.length <= 1} className="kimix-icon-text-button is-compact justify-center rounded-lg text-[13px] text-text-secondary hover:bg-[var(--kimix-panel-hover)] disabled:cursor-not-allowed disabled:opacity-35">
                  <Undo2 size={14} />
                  撤销
                </button>
                <button type="button" onClick={handleRedo} disabled={redoStack.length === 0} className="kimix-icon-text-button is-compact justify-center rounded-lg text-[13px] text-text-secondary hover:bg-[var(--kimix-panel-hover)] disabled:cursor-not-allowed disabled:opacity-35">
                  <Redo2 size={14} />
                  重做
                </button>
              </div>
              </section>

              <section style={{ marginTop: 12 }}>
              <div className="flex rounded-xl bg-[var(--kimix-panel-soft-bg)]" style={{ gap: 4, padding: 4 }}>
                {[
                  { value: "stroke" as const, label: "颜色" },
                  { value: "background" as const, label: "背景" },
                ].map((item) => {
                  const active = colorPanelMode === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setColorPanelMode(item.value)}
                      className={`h-8 flex-1 rounded-lg text-[13px] transition-colors ${active ? "bg-surface-elevated text-accent-primary shadow-[0_1px_2px_rgba(25,23,20,0.08)]" : "text-[var(--kimix-panel-text-secondary)] hover:bg-surface-elevated/70"}`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-5" style={{ gap: 8, marginTop: 14 }}>
                {DRAW_COLORS.map((item) => (
                  <button
                    key={`${colorPanelMode}-${item.value}`}
                    type="button"
                    onClick={() => {
                      if (colorPanelMode === "stroke") {
                        setColor(item.value);
                        return;
                      }
                      setBackgroundColor(item.value);
                      applyBackgroundColor(item.value);
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-full border transition-colors"
                    style={{ backgroundColor: item.value, borderColor: (colorPanelMode === "stroke" ? color : backgroundColor) === item.value ? "#339af0" : "var(--kimix-panel-border)" }}
                    title={`${colorPanelMode === "stroke" ? "" : "背景"}${item.label}`}
                    aria-label={`选择${colorPanelMode === "stroke" ? "" : "背景"}${item.label}色`}
                  >
                    {(colorPanelMode === "stroke" ? color : backgroundColor) === item.value && <Check size={15} className={item.value === "#ffffff" || item.value === "#facc15" ? "text-text-primary" : "text-white"} />}
                  </button>
                ))}
              </div>
              </section>

              <section>
              <div className="text-[13px] font-medium text-[var(--kimix-panel-text)]">线条宽度</div>
              <div className="mt-3 grid grid-cols-4" style={{ gap: 8 }}>
                {STROKE_SIZES.map((item) => {
                  const active = strokeWidth === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setStrokeWidth(item.value)}
                      className={`h-8 rounded-lg text-[13px] transition-colors ${active ? "bg-accent-primary-light text-accent-primary" : "text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-hover)]"}`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
              </section>

              {selectedShape && (
                <section className="rounded-xl bg-[var(--kimix-panel-soft-bg)]" style={{ marginTop: 18, padding: "12px 12px" }}>
                  <div className="text-[13px] font-medium text-[var(--kimix-panel-text)]">对象属性</div>
                  <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 8 }}>
                    拖动图形移动，拖角点缩放，拖顶部圆点旋转。
                  </div>
                  <div className="grid grid-cols-2 text-[12px] text-[var(--kimix-panel-text-secondary)]" style={{ gap: 8, marginTop: 12 }}>
                    <div>宽 {Math.round(Math.abs(selectedShape.width))}</div>
                    <div>高 {Math.round(Math.abs(selectedShape.height))}</div>
                    <div>角度 {Math.round((selectedShape.rotation * 180) / Math.PI)}°</div>
                    <div>线宽 {selectedShape.strokeWidth}</div>
                  </div>
                  <button
                    type="button"
                    onClick={handleDeleteSelectedShape}
                    className="kimix-icon-text-button is-compact justify-center rounded-lg text-[13px] text-accent-danger hover:bg-accent-danger-light"
                    style={{ marginTop: 12, width: "100%" }}
                  >
                    <Trash2 size={14} />
                    删除对象
                  </button>
                </section>
              )}

              {cropSelection && (
                <section className="rounded-xl bg-[var(--kimix-panel-soft-bg)]" style={{ marginTop: 18, padding: "12px 12px" }}>
                  <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">已选择裁剪区域，应用后会铺满当前画板。</div>
                  <div className="flex" style={{ gap: 8, marginTop: 12 }}>
                    <button type="button" onClick={handleApplyCrop} className="kimix-icon-text-button is-compact flex-1 justify-center rounded-lg bg-accent-primary text-white hover:bg-accent-primary-dark">
                      应用
                    </button>
                    <button type="button" onClick={() => setCropSelection(null)} className="kimix-icon-text-button is-compact justify-center rounded-lg text-text-secondary hover:bg-[var(--kimix-panel-hover)]">
                      取消
                    </button>
                  </div>
                </section>
              )}

              <section style={{ marginTop: 18 }}>
              <div className="text-[13px] font-medium text-[var(--kimix-panel-text)]">工具</div>
              <div className="mt-1 text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">快捷键：V/B/E/R/Q/O/L/C/F</div>
              <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 12 }}>
                {DRAW_TOOLS.map((item) => {
                  const Icon = item.icon;
                  const active = tool === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => handleToolChange(item.value)}
                      className={`kimix-icon-text-button is-compact justify-center rounded-lg text-[12.5px] ${active ? "bg-accent-primary-light text-accent-primary" : "text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-hover)]"}`}
                      aria-pressed={active}
                    >
                      <Icon size={14} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
              </section>
            </div>
          </aside>

          <div className="flex min-h-0 min-w-0 items-center justify-center overflow-hidden" style={{ height: "100%" }}>
            <div className="flex h-full w-full min-w-0 items-center justify-center overflow-hidden">
              <div
                className="relative rounded-lg border border-border-default shadow-elevated-token"
                style={{
                  width: boardDisplaySize.width,
                  height: boardDisplaySize.height,
                }}
              >
                <canvas
                  ref={bgCanvasRef}
                  className="absolute inset-0 block h-full w-full rounded-lg"
                />
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 block h-full w-full touch-none rounded-lg"
                  style={{
                    background: "transparent",
                    cursor: tool === "select" ? "default" : isShapeTool(tool) ? "crosshair" : undefined,
                  }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={finishDrawing}
                  onPointerCancel={finishDrawing}
                />
                <svg
                  className="pointer-events-none absolute inset-0 block h-full w-full rounded-lg"
                  viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
                  aria-hidden="true"
                >
                  {shapeObjects.map((shape) => renderShapeSvg(shape))}
                  {draftShape && renderShapeSvg(draftShape, true)}
                  {selectedShape && selectionCorners && (
                    <g>
                      <polygon
                        points={`${selectionCorners.nw.x},${selectionCorners.nw.y} ${selectionCorners.ne.x},${selectionCorners.ne.y} ${selectionCorners.se.x},${selectionCorners.se.y} ${selectionCorners.sw.x},${selectionCorners.sw.y}`}
                        fill="none"
                        stroke="#339af0"
                        strokeWidth={2}
                        strokeDasharray="8 6"
                      />
                      {rotateHandle && (
                        <>
                          <line
                            x1={(selectionCorners.nw.x + selectionCorners.ne.x) / 2}
                            y1={(selectionCorners.nw.y + selectionCorners.ne.y) / 2}
                            x2={rotateHandle.x}
                            y2={rotateHandle.y}
                            stroke="#339af0"
                            strokeWidth={2}
                          />
                          <circle cx={rotateHandle.x} cy={rotateHandle.y} r={7} fill="#ffffff" stroke="#339af0" strokeWidth={2} />
                        </>
                      )}
                      {(Object.entries(selectionCorners) as [ShapeHandle, Point][]).map(([handle, point]) => (
                        <rect
                          key={handle}
                          x={point.x - 6}
                          y={point.y - 6}
                          width={12}
                          height={12}
                          rx={3}
                          fill="#ffffff"
                          stroke="#339af0"
                          strokeWidth={2}
                        />
                      ))}
                    </g>
                  )}
                </svg>
                {cropSelection && (
                  <div
                    className="pointer-events-none absolute border-2 border-dashed border-accent-primary bg-accent-primary/10"
                    style={{
                      left: `${(cropSelection.x / canvasSize.width) * 100}%`,
                      top: `${(cropSelection.y / canvasSize.height) * 100}%`,
                      width: `${(cropSelection.width / canvasSize.width) * 100}%`,
                      height: `${(cropSelection.height / canvasSize.height) * 100}%`,
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between" style={{ gap: 14, marginTop: 16 }}>
          <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]">保存后会作为一张 PNG 图片加入输入区的上传图片列表。</div>
          <div className="flex shrink-0 items-center" style={{ gap: 14 }}>
            <button type="button" onClick={onClose} className="kimix-icon-text-button is-compact rounded-lg text-text-secondary hover:bg-[var(--kimix-panel-hover)]">
              取消
            </button>
            <button type="button" onClick={() => void handleCopy()} className="kimix-icon-text-button is-compact rounded-lg bg-accent-primary text-white hover:bg-accent-primary-dark">
              <Copy size={14} />
              复制
            </button>
            <button type="button" onClick={handleSave} className="kimix-icon-text-button is-compact rounded-lg bg-accent-primary text-white hover:bg-accent-primary-dark">
              <Save size={14} />
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
