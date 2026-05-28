import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Circle, Copy, Crop, Eraser, Minus, PaintBucket, Pencil, Redo2, Save, Square, Undo2, X } from "lucide-react";

type BoardRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16";

type DrawTool = "brush" | "eraser" | "rect" | "roundRect" | "circle" | "line" | "crop" | "bucket";

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

function replaceColor(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, fromColor: string, toColor: string) {
  const from = hexToRgba(fromColor);
  const to = hexToRgba(toColor);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    if (colorsMatch(data, index, from)) {
      setPixel(data, index, to);
    }
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
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [cropSelection, setCropSelection] = useState<CropSelection | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: size.width, height: size.height });

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
    return temp.toDataURL("image/png");
  };

  const pushHistory = () => {
    const drawCanvas = canvasRef.current;
    if (!drawCanvas) return;
    const dataUrl = drawCanvas.toDataURL("image/png");
    setUndoStack((prev) => (prev[prev.length - 1] === dataUrl ? prev : [...prev, dataUrl]));
    setRedoStack([]);
  };

  const drawDataUrl = async (dataUrl: string) => {
    const drawCanvas = canvasRef.current;
    const ctx = drawCanvas?.getContext("2d");
    if (!drawCanvas || !ctx) return;
    const image = await loadImage(dataUrl);
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    ctx.drawImage(image, 0, 0, drawCanvas.width, drawCanvas.height);
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

    if (!request.source?.dataUrl) {
      initCanvas(size.width, size.height);
      setUndoStack([drawCanvas.toDataURL("image/png")]);
      setRedoStack([]);
      return;
    }
    let cancelled = false;
    void loadImage(request.source.dataUrl).then((image) => {
      if (cancelled) return;
      initCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
      drawCtx.drawImage(image, 0, 0, drawCanvas.width, drawCanvas.height);
      setUndoStack([drawCanvas.toDataURL("image/png")]);
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
    setCropSelection(null);
    void drawDataUrl(previous);
  };

  const handleRedo = () => {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, next]);
    setCropSelection(null);
    void drawDataUrl(next);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const point = getCanvasPoint(canvas, event);
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
    setIsDrawing(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
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

    const temp = document.createElement("canvas");
    temp.width = cropSelection.width;
    temp.height = cropSelection.height;
    const tempCtx = temp.getContext("2d");
    if (!tempCtx) return;

    tempCtx.drawImage(bgCanvas, cropSelection.x, cropSelection.y, cropSelection.width, cropSelection.height, 0, 0, cropSelection.width, cropSelection.height);
    tempCtx.drawImage(drawCanvas, cropSelection.x, cropSelection.y, cropSelection.width, cropSelection.height, 0, 0, cropSelection.width, cropSelection.height);

    bgCanvas.width = cropSelection.width;
    bgCanvas.height = cropSelection.height;
    drawCanvas.width = cropSelection.width;
    drawCanvas.height = cropSelection.height;
    setCanvasSize({ width: cropSelection.width, height: cropSelection.height });

    const bgCtx = bgCanvas.getContext("2d");
    if (bgCtx) {
      bgCtx.fillStyle = appliedBackgroundRef.current;
      bgCtx.fillRect(0, 0, cropSelection.width, cropSelection.height);
    }

    const drawCtx = drawCanvas.getContext("2d");
    if (drawCtx) {
      drawCtx.clearRect(0, 0, cropSelection.width, cropSelection.height);
      drawCtx.drawImage(temp, 0, 0);
    }

    setCropSelection(null);
    pushHistory();
  };

  const applyBackgroundColor = (nextColor: string) => {
    const bgCanvas = bgCanvasRef.current;
    const bgCtx = bgCanvas?.getContext("2d");
    if (!bgCanvas || !bgCtx) return;
    bgCtx.fillStyle = nextColor;
    bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
    appliedBackgroundRef.current = nextColor;
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
      if (key === "b") setTool("brush");
      if (key === "e") setTool("eraser");
      if (key === "r") setTool("rect");
      if (key === "q") setTool("roundRect");
      if (key === "o") setTool("circle");
      if (key === "l") setTool("line");
      if (key === "c") setTool("crop");
      if (key === "f") setTool("bucket");
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

  return (
    <div className="kimix-preview-overlay fixed inset-0 z-[90] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="画板">
      <div className="kimix-modal-card flex max-h-[92vh] w-[min(1120px,94vw)] flex-col rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.28)]" style={{ padding: 20 }} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between" style={{ gap: 16, marginBottom: 16 }}>
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

        <div className="flex min-h-0 flex-1 gap-4">
          <aside className="kimix-settings-card flex w-[214px] shrink-0 flex-col overflow-y-auto rounded-xl" style={{ padding: "16px 14px", gap: 18 }}>
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

            <section>
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
              <div className="mt-3 grid grid-cols-5 gap-2">
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

            <section>
              <div className="text-[13px] font-medium text-[var(--kimix-panel-text)]">工具</div>
              <div className="mt-1 text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">快捷键：B/E/R/Q/O/L/C/F</div>
              <div className="mt-3 flex flex-col" style={{ gap: 8 }}>
                {DRAW_TOOLS.map((item) => {
                  const Icon = item.icon;
                  const active = tool === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setTool(item.value)}
                      className={`kimix-icon-text-button is-compact rounded-lg text-[13px] ${active ? "bg-accent-primary-light text-accent-primary" : "text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-hover)]"}`}
                      aria-pressed={active}
                    >
                      <Icon size={14} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {cropSelection && (
              <section className="rounded-xl bg-[var(--kimix-panel-soft-bg)]" style={{ padding: "12px 12px" }}>
                <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">已选择裁剪区域，应用后会铺满当前画板。</div>
                <div className="mt-3 flex" style={{ gap: 8 }}>
                  <button type="button" onClick={handleApplyCrop} className="kimix-icon-text-button is-compact flex-1 justify-center rounded-lg bg-accent-primary text-white hover:bg-accent-primary-dark">
                    应用
                  </button>
                  <button type="button" onClick={() => setCropSelection(null)} className="kimix-icon-text-button is-compact justify-center rounded-lg text-text-secondary hover:bg-[var(--kimix-panel-hover)]">
                    取消
                  </button>
                </div>
              </section>
            )}
          </aside>

          <div className="flex min-w-0 flex-1 items-center justify-center rounded-xl bg-[var(--kimix-panel-soft-bg)]" style={{ padding: 18 }}>
            <div className="relative max-h-[64vh] max-w-full">
              <canvas
                ref={bgCanvasRef}
                className="block max-h-[64vh] max-w-full rounded-lg border border-border-default shadow-elevated-token"
                style={{ aspectRatio: `${canvasSize.width} / ${canvasSize.height}` }}
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 block h-full w-full touch-none rounded-lg"
                style={{ aspectRatio: `${canvasSize.width} / ${canvasSize.height}`, background: "transparent" }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishDrawing}
                onPointerCancel={finishDrawing}
              />
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

        <div className="flex items-center justify-between" style={{ gap: 14, marginTop: 16 }}>
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
