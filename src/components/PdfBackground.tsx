import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { TextLayer, type RenderTask } from 'pdfjs-dist';
import type { BoardPage, SoftDocument } from '../types';
import { acquirePdf, pdfError } from '../lib/pdf';
import { boundedRasterScale, selectionRectsToPage, type HighlightRect } from '../lib/pdfCoordinates';
import './pdf.css';

interface Props {
  document: SoftDocument; page: BoardPage; scale: number; textSelection: boolean;
  onTextHighlight: (rects: HighlightRect[]) => void;
  onReady?: () => void; onError?: (message: string) => void;
}

export function PdfBackground({ document: doc, page, scale, textSelection, onTextHighlight, onReady, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const raster = useRef<HTMLDivElement>(null);
  const textHost = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const callback = useRef(onTextHighlight);
  callback.current = onTextHighlight;
  const statusCallbacks = useRef({ onReady, onError });
  statusCallbacks.current = { onReady, onError };
  // Quantization avoids rebuilding a large canvas on every tiny wheel/pinch movement.
  const renderScale = Math.ceil(Math.max(.5, Math.min(4, scale)) * 2) / 2;

  useEffect(() => {
    let disposed = false;
    let release: (() => void) | undefined;
    let renderTask: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    const rasterContainer = raster.current;
    const textContainer = textHost.current;
    setError(''); setReady(false);
    if (!doc.pdfAssetId || page.pdfPageIndex === undefined || !rasterContainer || !textContainer) return;
    // Each effect gets its own canvas. A cancelled render never races a new render
    // for the same canvas (PDF.js forbids concurrent tasks on one canvas).
    const canvas = window.document.createElement('canvas');
    const layer = window.document.createElement('div');
    layer.className = 'textLayer';
    textContainer.replaceChildren(layer);
    const timer = setTimeout(() => {
      void (async () => {
        const acquired = await acquirePdf(doc.pdfAssetId!);
        release = acquired.release;
        if (disposed) { release(); return; }
        const source = await acquired.pdf.getPage(page.pdfPageIndex! + 1);
        if (disposed) return;
        const cssViewport = source.getViewport({ scale: 1 });
        const density = boundedRasterScale(page.width, page.height, Math.min(3, renderScale * (window.devicePixelRatio || 1)));
        const viewport = source.getViewport({ scale: density });
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        canvas.style.width = `${page.width}px`; canvas.style.height = `${page.height}px`;
        layer.style.setProperty('--total-scale-factor', String(source.userUnit));
        renderTask = source.render({ canvas, viewport });
        await renderTask.promise;
        if (disposed) return;
        const previous = rasterContainer.firstElementChild;
        rasterContainer.replaceChildren(canvas);
        if (previous instanceof HTMLCanvasElement) previous.width = previous.height = 0;
        textLayer = new TextLayer({ textContentSource: source.streamTextContent(), container: layer, viewport: cssViewport });
        await textLayer.render();
        if (!disposed) { setReady(true); statusCallbacks.current.onReady?.(); }
      })().catch(reason => {
        if (!disposed && reason?.name !== 'RenderingCancelledException' && reason?.name !== 'AbortException') {
          const message = pdfError(reason).message; setError(message); statusCallbacks.current.onError?.(message);
        }
      });
    }, ready ? 90 : 0);
    return () => {
      disposed = true; clearTimeout(timer); renderTask?.cancel(); textLayer?.cancel(); release?.();
      if (canvas.parentNode !== rasterContainer) canvas.width = canvas.height = 0;
      else setTimeout(() => { if (!canvas.isConnected) canvas.width = canvas.height = 0; }, 0);
    };
  // ready intentionally not a dependency: it describes this render's lifecycle.
  }, [doc.pdfAssetId, page.id, page.pdfPageIndex, page.width, page.height, renderScale]);

  useEffect(() => {
    const onSelection = () => {
      const selection = window.getSelection();
      const layer = textHost.current;
      setHasSelection(!!textSelection && !!selection && !selection.isCollapsed && !!layer &&
        !!selection.anchorNode && layer.contains(selection.anchorNode) && !!selection.focusNode && layer.contains(selection.focusNode));
    };
    window.document.addEventListener('selectionchange', onSelection);
    onSelection();
    return () => window.document.removeEventListener('selectionchange', onSelection);
  }, [textSelection, page.id]);

  const highlightSelection = () => {
    const selection = window.getSelection();
    const layer = textHost.current;
    if (!textSelection || !selection || selection.isCollapsed || !layer || !host.current ||
      !selection.anchorNode || !selection.focusNode || !layer.contains(selection.anchorNode) || !layer.contains(selection.focusNode)) return;
    const boxes: DOMRect[] = [];
    for (let index = 0; index < selection.rangeCount; index++) boxes.push(...selection.getRangeAt(index).getClientRects());
    const rects = selectionRectsToPage(boxes, host.current.getBoundingClientRect(), page.width, page.height);
    if (rects.length) { callback.current(rects); selection.removeAllRanges(); setHasSelection(false); }
  };

  if (page.pdfPageIndex === undefined || !doc.pdfAssetId) return null;
  return <div ref={host} className={`pdf-background${textSelection ? ' pdf-text-active' : ''}`}
    style={{ width: page.width, height: page.height } as CSSProperties}>
    <div ref={raster} className="pdf-raster" />
    <div ref={textHost} className="pdf-text-container"
      onPointerDown={event => { if (textSelection) event.stopPropagation(); }}
      onPointerUp={event => { if (textSelection) { event.stopPropagation(); if (event.pointerType !== 'touch') requestAnimationFrame(highlightSelection); } }} />
    {!ready && !error && <span className="pdf-loading" role="status">Rendering PDF…</span>}
    {error && <div className="pdf-error" role="alert">{error}</div>}
    {textSelection && hasSelection && <button className="pdf-apply-highlight" type="button"
      onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}
      onClick={event => { event.stopPropagation(); highlightSelection(); }}>Highlight selected text</button>}
  </div>;
}

export default PdfBackground;

/** Small page preview; never builds a text selection layer. */
export function PdfThumbnail({ document: doc, page, width = 120 }: { document: SoftDocument; page: BoardPage; width?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    // Large PDFs should not parse/rasterize every page merely to fill the rail.
    const observer = new IntersectionObserver(entries => setVisible(entries[0]?.isIntersecting ?? false), { rootMargin: '160px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let disposed = false, release: (() => void) | undefined, render: RenderTask | undefined;
    const element = host.current;
    if (!visible || !element || !doc.pdfAssetId || page.pdfPageIndex === undefined) return;
    const canvas = document.createElement('canvas');
    void (async () => {
      const acquired = await acquirePdf(doc.pdfAssetId!); release = acquired.release;
      if (disposed) { release(); return; }
      const source = await acquired.pdf.getPage(page.pdfPageIndex! + 1);
      if (disposed) return;
      const viewport = source.getViewport({ scale: width * 1.5 / page.width });
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      canvas.style.width = `${width}px`; canvas.style.height = 'auto';
      render = source.render({ canvas, viewport }); await render.promise;
      if (!disposed) element.replaceChildren(canvas);
    })().catch(() => { /* Main page reports missing/corrupt document errors. */ });
    return () => { disposed = true; render?.cancel(); release?.(); canvas.width = canvas.height = 0; };
  }, [doc.pdfAssetId, page.pdfPageIndex, page.width, width, visible]);
  return <div className="pdf-thumbnail" ref={host} aria-hidden="true" style={{ width, height: width * page.height / page.width }} />;
}
