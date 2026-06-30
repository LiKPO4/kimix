import { useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Palette, X } from "lucide-react";
import { DrawingBoard, type DrawingBoardRequest } from "./DrawingBoard";

export type PreviewImage = {
  id?: string;
  name: string;
  dataUrl: string;
};

type ImagePreviewOverlayProps = {
  image: PreviewImage;
  onClose: () => void;
  onSaveDrawing: (image: { name: string; dataUrl: string; sourceId?: string }) => void;
};

export function ImagePreviewOverlay({ image, onClose, onSaveDrawing }: ImagePreviewOverlayProps) {
  const [drawingBoardRequest, setDrawingBoardRequest] = useState<DrawingBoardRequest | null>(null);
  const [contextMenu, setContextMenu] = useState<{ left: number; top: number } | null>(null);

  const handleCopyImage = async () => {
    setContextMenu(null);
    const result = await window.api.copyImage({ dataUrl: image.dataUrl });
    window.dispatchEvent(new CustomEvent("kimix:toast", {
      detail: result.success ? "图片已复制" : `复制图片失败：${result.error}`,
    }));
  };

  return createPortal(
    <>
      <div
        className="kimix-preview-overlay fixed inset-0 z-[80] flex items-center justify-center"
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
        <div
          className="flex max-h-[88vh] max-w-[88vw] flex-col items-center"
          style={{ gap: 14 }}
          onClick={(event) => {
            event.stopPropagation();
            setContextMenu(null);
          }}
        >
          <img
            src={image.dataUrl}
            alt={image.name}
            className="kimix-preview-image max-h-[76vh] max-w-[86vw] rounded-xl object-contain shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
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
            onClick={() => {
              setDrawingBoardRequest({
                ratio: "1:1",
                source: {
                  id: image.id ?? image.name,
                  name: image.name,
                  dataUrl: image.dataUrl,
                },
              });
            }}
            className="kimix-icon-text-button rounded-xl bg-surface-elevated text-text-primary shadow-elevated-token hover:bg-surface-hover"
            style={{ paddingLeft: 16, paddingRight: 16 }}
          >
            <Palette size={15} />
            <span>画板</span>
          </button>
        </div>
        {contextMenu && (
          <div
            role="menu"
            aria-label="图片操作"
            className="fixed z-[90] rounded-lg border border-border bg-surface-elevated shadow-elevated-token"
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
              className="kimix-icon-text-button w-full justify-start rounded-md text-text-primary hover:bg-surface-hover"
              style={{ minHeight: 34, paddingLeft: 12, paddingRight: 12 }}
            >
              <Copy size={15} />
              <span>复制图片</span>
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
