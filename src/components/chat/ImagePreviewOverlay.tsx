import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Copy, Loader2, Palette, X } from "lucide-react";
import { DrawingBoard, type DrawingBoardRequest } from "./DrawingBoard";

export type PreviewImage = {
  id?: string;
  fileId?: string;
  name: string;
  dataUrl: string;
  url?: string;
};

type PreviewFileLoadResult = {
  success: boolean;
  data?: { dataUrl?: string };
  error?: string;
};

type PreviewFileLoader = (request: { fileId: string }) => Promise<PreviewFileLoadResult>;

export function previewImageIdentity(image: PreviewImage): string {
  if (image.id) return `id:${image.id}`;
  if (image.fileId) return `file:${image.fileId}`;
  if (image.url) return `url:${image.url}`;
  if (image.dataUrl) return `data:${image.dataUrl}`;
  return `name:${image.name}`;
}

export function findPreviewImageIndex(current: PreviewImage, images: PreviewImage[]): number {
  if (current.id) {
    const byId = images.findIndex((item) => item.id === current.id);
    if (byId !== -1) return byId;
  }
  if (current.fileId) {
    const byFileId = images.findIndex((item) => item.fileId === current.fileId);
    if (byFileId !== -1) return byFileId;
  }
  if (current.url) {
    const byUrl = images.findIndex((item) => item.url === current.url);
    if (byUrl !== -1) return byUrl;
  }
  if (current.dataUrl) {
    const byDataUrl = images.findIndex((item) => item.dataUrl === current.dataUrl);
    if (byDataUrl !== -1) return byDataUrl;
  }
  return images.findIndex((item) => item.name === current.name);
}

export function getPreviewImageNeighbor(
  current: PreviewImage,
  images: PreviewImage[],
  direction: -1 | 1,
): PreviewImage | null {
  const index = findPreviewImageIndex(current, images);
  if (index === -1) return null;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= images.length) return null;
  return images[nextIndex];
}

/**
 * file-backed 历史图片在 Renderer 中只带 kimix-media URL；复制和画板仍要求 data URL。
 * 这里按需物化，避免把整张历史图片常驻进 timeline/session 持久化数据。
 */
export async function materializePreviewImageDataUrl(
  image: PreviewImage,
  loadFile: PreviewFileLoader,
): Promise<string> {
  if (image.dataUrl.startsWith("data:image/")) return image.dataUrl;
  if (!image.fileId) throw new Error("图片没有可读取的文件标识");
  const result = await loadFile({ fileId: image.fileId });
  if (!result.success) throw new Error(result.error || "读取图片失败");
  const dataUrl = result.data?.dataUrl ?? "";
  if (!dataUrl.startsWith("data:image/")) throw new Error("读取到的不是可用图片");
  return dataUrl;
}

type ImagePreviewOverlayProps = {
  image: PreviewImage;
  images?: PreviewImage[];
  onNavigate?: (image: PreviewImage) => void;
  onClose: () => void;
  onSaveDrawing: (image: { name: string; dataUrl: string; sourceId?: string }) => void;
};

export function ImagePreviewOverlay({ image, images, onNavigate, onClose, onSaveDrawing }: ImagePreviewOverlayProps) {
  const [drawingBoardRequest, setDrawingBoardRequest] = useState<DrawingBoardRequest | null>(null);
  const [contextMenu, setContextMenu] = useState<{ left: number; top: number } | null>(null);
  const [materializedImage, setMaterializedImage] = useState<{ identity: string; dataUrl: string } | null>(null);
  const [materializingAction, setMaterializingAction] = useState<"copy" | "drawing" | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const failedPreviewFallbacksRef = useRef(new Set<string>());
  const materializingRequestsRef = useRef(new Map<string, Promise<string>>());
  const previewImages = images?.length ? images : [image];
  const canNavigate = previewImages.length > 1;
  const currentIndex = findPreviewImageIndex(image, previewImages);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < previewImages.length - 1;
  const imageIdentity = previewImageIdentity(image);
  const activeDataUrl = materializedImage?.identity === imageIdentity
    ? materializedImage.dataUrl
    : image.dataUrl;
  const activeSource = activeDataUrl || image.url || "";

  const materializeCurrentImage = async (): Promise<string> => {
    if (activeDataUrl.startsWith("data:image/")) return activeDataUrl;
    const pending = materializingRequestsRef.current.get(imageIdentity);
    if (pending) return pending;
    const request = materializePreviewImageDataUrl(image, (request) => window.api.loadKimiCodeFile(request))
      .then((dataUrl) => {
        setMaterializedImage({ identity: imageIdentity, dataUrl });
        return dataUrl;
      })
      .finally(() => {
        materializingRequestsRef.current.delete(imageIdentity);
      });
    materializingRequestsRef.current.set(imageIdentity, request);
    return request;
  };

  const navigate = (direction: -1 | 1) => {
    if (!canNavigate) return;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= previewImages.length) return;
    setContextMenu(null);
    onNavigate?.(previewImages[nextIndex]);
  };

  useEffect(() => {
    overlayRef.current?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (drawingBoardRequest) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (!canNavigate) return;
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp"
      ? -1
      : event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : 0;
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    navigate(direction as -1 | 1);
  };

  const handleCopyImage = async () => {
    setMaterializingAction("copy");
    try {
      const dataUrl = await materializeCurrentImage();
      const result = await window.api.copyImage({ dataUrl });
      setContextMenu(null);
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: result.success ? "图片已复制" : `复制图片失败：${result.error}`,
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: `复制图片失败：${error instanceof Error ? error.message : String(error)}`,
      }));
    } finally {
      setMaterializingAction(null);
    }
  };

  const handleOpenDrawingBoard = async () => {
    setMaterializingAction("drawing");
    let dataUrl: string;
    try {
      dataUrl = await materializeCurrentImage();
    } catch (error) {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: `打开画板失败：${error instanceof Error ? error.message : String(error)}`,
      }));
      return;
    } finally {
      setMaterializingAction(null);
    }
    setDrawingBoardRequest({
      ratio: "1:1",
      source: {
        id: image.id ?? image.fileId ?? image.name,
        name: image.name,
        dataUrl,
      },
    });
  };

  return createPortal(
    <>
      <div
        ref={overlayRef}
        tabIndex={-1}
        className="kimix-preview-overlay fixed inset-0 z-[140] flex items-center justify-center focus:outline-none"
        onKeyDown={handleKeyDown}
        onClick={() => {
          if (contextMenu) {
            setContextMenu(null);
            return;
          }
          onClose();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu(null);
        }}
        role="dialog"
        aria-modal="true"
        aria-label="图片预览"
      >
        <div className="absolute right-6 top-6 flex items-center" style={{ gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            className="kimix-preview-close flex h-10 w-10 items-center justify-center rounded-full shadow-[0_8px_24px_rgba(0,0,0,0.22)] transition-colors"
            title="关闭"
            aria-label="关闭图片预览"
          >
            <X size={20} />
          </button>
        </div>
        {canNavigate && (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                navigate(-1);
              }}
              disabled={!hasPrev}
              className="kimix-preview-nav absolute left-6 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full shadow-[0_8px_24px_rgba(0,0,0,0.22)] transition-colors disabled:cursor-not-allowed disabled:opacity-30"
              style={{ left: 24 }}
              title="上一张"
              aria-label="上一张图片"
            >
              <ChevronLeft size={26} />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                navigate(1);
              }}
              disabled={!hasNext}
              className="kimix-preview-nav absolute right-6 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full shadow-[0_8px_24px_rgba(0,0,0,0.22)] transition-colors disabled:cursor-not-allowed disabled:opacity-30"
              style={{ right: 24 }}
              title="下一张"
              aria-label="下一张图片"
            >
              <ChevronRight size={26} />
            </button>
          </>
        )}
        <div
          className="flex max-h-[88vh] max-w-[88vw] flex-col items-center"
          style={{ gap: 14 }}
          onClick={(event) => {
            event.stopPropagation();
            setContextMenu(null);
          }}
        >
          <img
            src={activeSource}
            alt={image.name}
            className="kimix-preview-image max-h-[76vh] max-w-[86vw] rounded-xl object-contain shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
            onError={() => {
              if (activeDataUrl || !image.fileId || failedPreviewFallbacksRef.current.has(imageIdentity)) return;
              failedPreviewFallbacksRef.current.add(imageIdentity);
              // 预览本身失败时只尝试一次物化回退；失败已由后续复制/画板操作给出提示，
              // 此处必须吞掉 Promise，避免 img onError 触发全局 unhandledrejection 弹窗。
              void materializeCurrentImage().catch(() => undefined);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const menuWidth = 164;
              const menuHeight = 50;
              setContextMenu({
                left: Math.max(12, Math.min(event.clientX, window.innerWidth - menuWidth - 12)),
                top: Math.max(12, Math.min(event.clientY, window.innerHeight - menuHeight - 12)),
              });
            }}
          />
          <button
            type="button"
            onClick={() => void handleOpenDrawingBoard()}
            disabled={materializingAction !== null}
            className="kimix-icon-text-button rounded-xl bg-surface-elevated text-text-primary shadow-elevated-token hover:bg-surface-hover"
            style={{ paddingLeft: 16, paddingRight: 16 }}
          >
            {materializingAction === "drawing" ? <Loader2 size={15} className="kimix-spin" /> : <Palette size={15} />}
            <span>{materializingAction === "drawing" ? "读取图片…" : "画板"}</span>
          </button>
        </div>
        {contextMenu && (
          <div
            role="menu"
            aria-label="图片操作"
            className="kimix-menu-panel fixed z-[160]"
            style={{
              left: contextMenu.left,
              top: contextMenu.top,
              width: 164,
              padding: 7,
            }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              role="menuitem"
              autoFocus
              onClick={() => void handleCopyImage()}
              disabled={materializingAction !== null}
              className="kimix-menu-item justify-start text-text-primary"
              style={{ minHeight: 34, paddingLeft: 12, paddingRight: 12 }}
            >
              <Copy size={15} />
              <span>{materializingAction === "copy" ? "读取图片…" : "复制图片"}</span>
            </button>
          </div>
        )}
      </div>
      {drawingBoardRequest && (
        <DrawingBoard
          request={drawingBoardRequest}
          onClose={() => setDrawingBoardRequest(null)}
          onSave={(nextImage) => {
            onSaveDrawing(nextImage);
            setDrawingBoardRequest(null);
            onClose();
          }}
        />
      )}
    </>,
    document.body,
  );
}
