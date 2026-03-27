import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import {
  createChart, ColorType,
  CandlestickSeries, LineSeries, AreaSeries, HistogramSeries,
  createSeriesMarkers,
  type IChartApi, type LogicalRange, type ISeriesApi,
  type SeriesType, type SeriesMarker,
} from 'lightweight-charts';
import type { OHLCBar, Timeframe } from '@/types';

export type DrawingTool = 'cursor' | 'select' | 'trendline' | 'hline' | 'rect' | 'arrow' | 'fib';

export interface TradeMarker {
  time: string;
  type: 'BUY' | 'SELL';
  price: number;
  label?: string;
}

interface Overlay { name: string; data: { time: string; value: number }[]; color: string }

interface Props {
  data: OHLCBar[];
  overlays?: Overlay[];
  tradeMarkers?: TradeMarker[];
  showVolume?: boolean;
  showGrid?: boolean;
  height?: number;
  timeframe?: Timeframe;
  drawingTool?: DrawingTool;
  fillContainer?: boolean;
  onClearDrawings?: number;
  onScreenshot?: number;
}

/* ── helpers ─────────────────────────────────────────────────────── */

function adjustToLocal(utcSec: number): number {
  return utcSec - new Date(utcSec * 1000).getTimezoneOffset() * 60;
}

function parseTimeForChart(t: string): string | number {
  if (/^\d+$/.test(t)) return adjustToLocal(Number(t));
  return t;
}

function formatTime(t: string): string {
  if (/^\d+$/.test(t)) {
    const d = new Date(Number(t) * 1000);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return t;
}

function isLineMode(tf?: Timeframe): boolean {
  return tf === '1M' || tf === '5M';
}

/* ── Drawing model (chart coordinates: logical index + price) ──── */

interface ChartPt { logical: number; price: number }
interface PixelPt { x: number; y: number }

type DrawingType = 'trendline' | 'hline' | 'rect' | 'arrow' | 'fib';

interface Drawing {
  id: number;
  tool: DrawingType;
  p1: ChartPt;
  p2: ChartPt;
}

interface PixelDrawing {
  id: number;
  tool: DrawingType;
  p1: PixelPt;
  p2: PixelPt;
}

let _nextId = 1;

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS = ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ef4444'];

const DRAW_COLOR = '#3b82f6';
const SELECT_COLOR = '#ffffff';
const HANDLE_SIZE = 4;

/* ── Coordinate conversion ─────────────────────────────────────── */

function pixelToChart(px: PixelPt, chart: IChartApi, series: ISeriesApi<SeriesType>): ChartPt | null {
  const logical = chart.timeScale().coordinateToLogical(px.x);
  const price = series.coordinateToPrice(px.y);
  if (logical == null || price == null) return null;
  return { logical: logical as number, price: price as number };
}

function chartToPixel(cp: ChartPt, chart: IChartApi, series: ISeriesApi<SeriesType>): PixelPt | null {
  const x = chart.timeScale().logicalToCoordinate(cp.logical as any);
  const y = series.priceToCoordinate(cp.price);
  if (x == null || y == null) return null;
  return { x: x as number, y: y as number };
}

function drawingToPixel(d: Drawing, chart: IChartApi, series: ISeriesApi<SeriesType>): PixelDrawing | null {
  const px1 = chartToPixel(d.p1, chart, series);
  const px2 = chartToPixel(d.p2, chart, series);
  if (!px1 || !px2) return null;
  return { id: d.id, tool: d.tool, p1: px1, p2: px2 };
}

/* ── Hit-testing (pixel space) ─────────────────────────────────── */

function distToSegment(p: PixelPt, a: PixelPt, b: PixelPt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

type HandleId = 'p1' | 'p2' | 'p1x_p2y' | 'p2x_p1y';

function hitTestHandle(pos: PixelPt, d: PixelDrawing, threshold = 8): HandleId | null {
  const nearP1 = Math.hypot(pos.x - d.p1.x, pos.y - d.p1.y) < threshold;
  const nearP2 = Math.hypot(pos.x - d.p2.x, pos.y - d.p2.y) < threshold;

  if (d.tool === 'rect' || d.tool === 'fib') {
    if (nearP1) return 'p1';
    if (nearP2) return 'p2';
    if (Math.hypot(pos.x - d.p1.x, pos.y - d.p2.y) < threshold) return 'p1x_p2y';
    if (Math.hypot(pos.x - d.p2.x, pos.y - d.p1.y) < threshold) return 'p2x_p1y';
  } else if (d.tool === 'trendline' || d.tool === 'arrow') {
    if (nearP1) return 'p1';
    if (nearP2) return 'p2';
  } else if (d.tool === 'hline') {
    if (Math.abs(pos.y - d.p1.y) < threshold && pos.x < 60) return 'p1';
  }
  return null;
}

function hitTestPixel(pos: PixelPt, d: PixelDrawing, canvasW: number, threshold = 8): boolean {
  switch (d.tool) {
    case 'hline':
      return Math.abs(pos.y - d.p1.y) < threshold;
    case 'trendline':
    case 'arrow':
      return distToSegment(pos, d.p1, d.p2) < threshold;
    case 'rect': {
      const x1 = Math.min(d.p1.x, d.p2.x), x2 = Math.max(d.p1.x, d.p2.x);
      const y1 = Math.min(d.p1.y, d.p2.y), y2 = Math.max(d.p1.y, d.p2.y);
      const inside = pos.x >= x1 - threshold && pos.x <= x2 + threshold &&
                     pos.y >= y1 - threshold && pos.y <= y2 + threshold;
      const deepInside = pos.x > x1 + threshold && pos.x < x2 - threshold &&
                         pos.y > y1 + threshold && pos.y < y2 - threshold;
      return inside && !deepInside;
    }
    case 'fib': {
      const topY = Math.min(d.p1.y, d.p2.y), botY = Math.max(d.p1.y, d.p2.y);
      const range = botY - topY;
      if (range < 2) return false;
      return FIB_LEVELS.some(level => Math.abs(pos.y - (botY - range * level)) < threshold);
    }
  }
  return false;
}

/* ── Drawing renderer (pixel space) ───────────────────────────── */

function drawArrowhead(ctx: CanvasRenderingContext2D, from: PixelPt, to: PixelPt, size: number) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - Math.PI / 6), to.y - size * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle + Math.PI / 6), to.y - size * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

function drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = SELECT_COLOR;
  ctx.fillRect(Math.round(x) - HANDLE_SIZE, Math.round(y) - HANDLE_SIZE, HANDLE_SIZE * 2, HANDLE_SIZE * 2);
}

function paintPixelDrawing(ctx: CanvasRenderingContext2D, d: PixelDrawing, w: number, selected: boolean) {
  const color = selected ? SELECT_COLOR : DRAW_COLOR;
  ctx.save();
  ctx.translate(0.5, 0.5);
  ctx.lineWidth = selected ? 2.5 : 1.5;
  ctx.strokeStyle = color;
  ctx.setLineDash([]);

  switch (d.tool) {
    case 'hline':
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(0, Math.round(d.p1.y));
      ctx.lineTo(w, Math.round(d.p1.y));
      ctx.stroke();
      if (selected) drawHandle(ctx, 40, d.p1.y);
      break;
    case 'trendline':
      ctx.beginPath();
      ctx.moveTo(Math.round(d.p1.x), Math.round(d.p1.y));
      ctx.lineTo(Math.round(d.p2.x), Math.round(d.p2.y));
      ctx.stroke();
      if (selected) { drawHandle(ctx, d.p1.x, d.p1.y); drawHandle(ctx, d.p2.x, d.p2.y); }
      break;
    case 'arrow':
      ctx.beginPath();
      ctx.moveTo(Math.round(d.p1.x), Math.round(d.p1.y));
      ctx.lineTo(Math.round(d.p2.x), Math.round(d.p2.y));
      ctx.stroke();
      drawArrowhead(ctx, d.p1, d.p2, 12);
      if (selected) { drawHandle(ctx, d.p1.x, d.p1.y); drawHandle(ctx, d.p2.x, d.p2.y); }
      break;
    case 'rect': {
      const x = Math.round(Math.min(d.p1.x, d.p2.x)), y = Math.round(Math.min(d.p1.y, d.p2.y));
      const rw = Math.round(Math.abs(d.p2.x - d.p1.x)), rh = Math.round(Math.abs(d.p2.y - d.p1.y));
      ctx.fillStyle = selected ? 'rgba(255,255,255,0.05)' : 'rgba(59,130,246,0.08)';
      ctx.fillRect(x, y, rw, rh);
      ctx.strokeRect(x, y, rw, rh);
      if (selected) {
        drawHandle(ctx, d.p1.x, d.p1.y); drawHandle(ctx, d.p2.x, d.p2.y);
        drawHandle(ctx, d.p1.x, d.p2.y); drawHandle(ctx, d.p2.x, d.p1.y);
      }
      break;
    }
    case 'fib': {
      const topY = Math.min(d.p1.y, d.p2.y), botY = Math.max(d.p1.y, d.p2.y);
      const range = botY - topY;
      ctx.font = '10px monospace';
      FIB_LEVELS.forEach((level, i) => {
        const ly = Math.round(botY - range * level);
        ctx.strokeStyle = selected ? SELECT_COLOR : FIB_COLORS[i];
        ctx.setLineDash([4, 2]);
        ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(w, ly); ctx.stroke();
        ctx.fillStyle = selected ? SELECT_COLOR : FIB_COLORS[i];
        ctx.fillText(`${(level * 100).toFixed(1)}%`, 4, ly - 3);
      });
      ctx.setLineDash([]);
      ctx.fillStyle = selected ? 'rgba(255,255,255,0.03)' : 'rgba(59,130,246,0.04)';
      ctx.fillRect(Math.min(d.p1.x, d.p2.x), topY, Math.abs(d.p2.x - d.p1.x), range);
      if (selected) { drawHandle(ctx, d.p1.x, d.p1.y); drawHandle(ctx, d.p2.x, d.p2.y); }
      break;
    }
  }
  ctx.restore();
}

/* ── Component ───────────────────────────────────────────────────── */

export function CandlestickChart({
  data, overlays = [], tradeMarkers, showVolume = false, showGrid = false, height = 500, timeframe,
  drawingTool = 'cursor', fillContainer = false, onClearDrawings, onScreenshot,
}: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const savedRangeRef = useRef<LogicalRange | null>(null);
  const prevDataLenRef = useRef(0);
  const [crosshairIdx, setCrosshairIdx] = useState(-1);
  const dataRef = useRef(data);
  dataRef.current = data;

  const drawingToolRef = useRef(drawingTool);
  drawingToolRef.current = drawingTool;

  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const [dragCreate, setDragCreate] = useState<{ startPx: PixelPt; currentPx: PixelPt; tool: DrawingType } | null>(null);
  const dragCreateRef = useRef(dragCreate);
  dragCreateRef.current = dragCreate;

  const [dragMove, setDragMove] = useState<{ drawingId: number; startPx: PixelPt; currentPx: PixelPt } | null>(null);
  const dragMoveRef = useRef(dragMove);
  dragMoveRef.current = dragMove;

  const [dragResize, setDragResize] = useState<{ drawingId: number; handle: HandleId; currentPx: PixelPt } | null>(null);
  const dragResizeRef = useRef(dragResize);
  dragResizeRef.current = dragResize;

  const lineMode = isLineMode(timeframe);

  /* ── Clear ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (onClearDrawings) { setDrawings([]); setSelectedId(null); setDragCreate(null); setDragMove(null); setDragResize(null); }
  }, [onClearDrawings]);

  /* ── Screenshot ────────────────────────────────────────────────── */
  useEffect(() => {
    if (!onScreenshot || !chartContainerRef.current) return;
    const chartCanvas = chartContainerRef.current.querySelector('canvas') as HTMLCanvasElement | null;
    if (!chartCanvas) return;
    const overlay = overlayRef.current;
    const w = chartCanvas.width, h = chartCanvas.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(chartCanvas, 0, 0);
    if (overlay && overlay.width > 0) ctx.drawImage(overlay, 0, 0, w, h);
    out.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `fx-chart-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }, 'image/png');
  }, [onScreenshot]);

  /* ── Delete key ────────────────────────────────────────────────── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sid = selectedIdRef.current;
        if (sid != null) {
          setDrawings(prev => prev.filter(d => d.id !== sid));
          setSelectedId(null);
          e.preventDefault();
        }
      }
      if (e.key === 'Escape') {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /* ── Repaint overlay (converts chart coords → pixels each frame) ─ */
  const repaintOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const { width: pw, height: ph } = parent.getBoundingClientRect();
    if (pw < 10 || ph < 10) return;

    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(pw);
    const ch = Math.round(ph);

    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    const sid = selectedIdRef.current;
    const dm = dragMoveRef.current;
    const dr = dragResizeRef.current;

    drawingsRef.current.forEach(d => {
      let drawTarget = d;

      if (dm && dm.drawingId === d.id) {
        const startChart = pixelToChart(dm.startPx, chart, series);
        const curChart = pixelToChart(dm.currentPx, chart, series);
        if (startChart && curChart) {
          const dl = curChart.logical - startChart.logical;
          const dp = curChart.price - startChart.price;
          drawTarget = {
            ...d,
            p1: { logical: d.p1.logical + dl, price: d.p1.price + dp },
            p2: { logical: d.p2.logical + dl, price: d.p2.price + dp },
          };
        }
      } else if (dr && dr.drawingId === d.id) {
        const cp = pixelToChart(dr.currentPx, chart, series);
        if (cp) {
          const newP1 = { ...d.p1 }, newP2 = { ...d.p2 };
          switch (dr.handle) {
            case 'p1': newP1.logical = cp.logical; newP1.price = cp.price; break;
            case 'p2': newP2.logical = cp.logical; newP2.price = cp.price; break;
            case 'p1x_p2y': newP1.logical = cp.logical; newP2.price = cp.price; break;
            case 'p2x_p1y': newP2.logical = cp.logical; newP1.price = cp.price; break;
          }
          drawTarget = { ...d, p1: newP1, p2: newP2 };
        }
      }

      const pxd = drawingToPixel(drawTarget, chart, series);
      if (pxd) paintPixelDrawing(ctx, pxd, cw, d.id === sid);
    });

    const dc = dragCreateRef.current;
    if (dc) {
      const p1 = pixelToChart(dc.startPx, chart, series);
      const p2 = pixelToChart(dc.currentPx, chart, series);
      if (p1 && p2) {
        const pxd = drawingToPixel({ id: -1, tool: dc.tool, p1, p2 }, chart, series);
        if (pxd) paintPixelDrawing(ctx, pxd, cw, false);
      }
    }
  }, []);

  useEffect(() => { repaintOverlay(); }, [drawings, selectedId, dragCreate, dragMove, dragResize, repaintOverlay]);

  /* ── Main chart ────────────────────────────────────────────────── */
  useEffect(() => {
    if (!chartContainerRef.current || !data || data.length === 0) return;

    if (chartRef.current) {
      try { savedRangeRef.current = chartRef.current.timeScale().getVisibleLogicalRange(); } catch { /* */ }
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
    }

    const isIntraday = /^\d+$/.test(data[0].time);
    const container = chartContainerRef.current;
    const parent = container.parentElement;
    let effectiveHeight = height;
    if (fillContainer && parent) {
      const parentH = parent.getBoundingClientRect().height;
      effectiveHeight = parentH > 50 ? parentH - 24 : 400;
    }

    const defaultBarSpacing = lineMode ? 2 : (isIntraday ? 4 : 8);

    const chart = createChart(container, {
      localization: { locale: 'en-US' },
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
        fontFamily: "'SF Mono','Cascadia Code','Consolas',monospace",
        fontSize: 12,
      },
      grid: {
        vertLines: { visible: showGrid, color: 'rgba(255,255,255,0.03)' },
        horzLines: { visible: true, color: 'rgba(255,255,255,0.04)' },
      },
      width: container.clientWidth,
      height: effectiveHeight,
      crosshair: {
        mode: 0,
        vertLine: { color: 'rgba(59,130,246,0.3)', width: 1, style: 0, labelBackgroundColor: '#2563eb' },
        horzLine: { color: 'rgba(59,130,246,0.3)', width: 1, style: 0, labelBackgroundColor: '#2563eb' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.06)', textColor: '#9ca3af',
        scaleMargins: { top: 0.05, bottom: showVolume ? 0.2 : 0.05 },
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.06)', timeVisible: isIntraday, secondsVisible: false,
        rightOffset: 5, barSpacing: defaultBarSpacing,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
        minBarSpacing: 1,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    let mainSeries: ISeriesApi<SeriesType>;
    if (lineMode) {
      mainSeries = chart.addSeries(AreaSeries, {
        lineColor: '#3b82f6', topColor: 'rgba(59,130,246,0.28)', bottomColor: 'rgba(59,130,246,0.02)',
        lineWidth: 2, priceLineColor: '#3b82f6',
      });
      mainSeries.setData(data.map(b => ({ time: parseTimeForChart(b.time) as any, value: b.close })));
    } else {
      mainSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#22c55e', downColor: '#ef4444',
        borderUpColor: '#16a34a', borderDownColor: '#dc2626',
        wickUpColor: '#16a34a', wickDownColor: '#dc2626',
      });
      mainSeries.setData(data.map(b => ({
        time: parseTimeForChart(b.time) as any, open: b.open, high: b.high, low: b.low, close: b.close,
      })));
    }
    seriesRef.current = mainSeries;

    if (showVolume && data.some(b => b.volume && b.volume > 0)) {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
      vol.setData(data.map(b => ({
        time: parseTimeForChart(b.time) as any, value: b.volume || 0,
        color: b.close >= b.open ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
      })));
    }

    overlays.forEach(o => {
      const isSAR = o.name.startsWith('SAR');
      const colorMap: Record<string, string> = { SMA: '#f59e0b', EMA: '#8b5cf6' };
      const color = isSAR ? o.color : (Object.entries(colorMap).find(([k]) => o.name.startsWith(k))?.[1] || o.color || '#64748b');
      if (isSAR) {
        const line = chart.addSeries(LineSeries, {
          color, lineWidth: 0, priceLineVisible: false,
          crosshairMarkerVisible: false, lastValueVisible: false,
          pointMarkersVisible: true, pointMarkersRadius: 3,
        });
        line.setData(o.data.map(d => ({ time: parseTimeForChart(d.time) as any, value: d.value })));
      } else {
        const line = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, crosshairMarkerVisible: false, lastValueVisible: false });
        line.setData(o.data.map(d => ({ time: parseTimeForChart(d.time) as any, value: d.value })));
      }
    });

    if (tradeMarkers && tradeMarkers.length > 0) {
      const markers: SeriesMarker<any>[] = tradeMarkers.map(m => ({
        time: parseTimeForChart(m.time) as any,
        position: m.type === 'BUY' ? 'belowBar' as const : 'aboveBar' as const,
        shape: m.type === 'BUY' ? 'arrowUp' as const : 'arrowDown' as const,
        color: m.type === 'BUY' ? '#22c55e' : '#ef4444',
        text: m.label || (m.type === 'BUY' ? `BUY ${m.price.toFixed(5)}` : `SELL ${m.price.toFixed(5)}`),
        size: 1.5,
      })).sort((a, b) => {
        const ta = typeof a.time === 'number' ? a.time : new Date(a.time as string).getTime();
        const tb = typeof b.time === 'number' ? b.time : new Date(b.time as string).getTime();
        return ta - tb;
      });
      createSeriesMarkers(mainSeries, markers, { zOrder: 'top' });
    }

    chart.subscribeCrosshairMove(param => {
      if (!param.time) { setCrosshairIdx(-1); return; }
      const d = dataRef.current;
      const idx = d.findIndex(b => {
        const ct = parseTimeForChart(b.time);
        return ct === param.time || String(ct) === String(param.time);
      });
      setCrosshairIdx(idx);
    });

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      requestAnimationFrame(repaintOverlay);
    });

    const prevLen = prevDataLenRef.current;
    const curLen = data.length;
    prevDataLenRef.current = curLen;
    const bigChange = prevLen > 0 && Math.abs(curLen - prevLen) > prevLen * 0.5;
    if (bigChange || !savedRangeRef.current) chart.timeScale().fitContent();
    else { try { chart.timeScale().setVisibleLogicalRange(savedRangeRef.current); } catch { chart.timeScale().fitContent(); } }

    chartRef.current = chart;
    requestAnimationFrame(repaintOverlay);

    const ro = new ResizeObserver(() => {
      if (fillContainer && parent) {
        const r = parent.getBoundingClientRect();
        chart.applyOptions({ width: r.width, height: r.height - 24 });
      }
      repaintOverlay();
    });
    if (parent) ro.observe(parent);

    return () => {
      ro.disconnect();
      try { savedRangeRef.current = chart.timeScale().getVisibleLogicalRange(); } catch { /* */ }
      chart.remove();
      chartRef.current = null; seriesRef.current = null;
    };
  }, [data, overlays, tradeMarkers, showVolume, showGrid, height, lineMode, fillContainer, repaintOverlay]);

  /* ── Mouse interaction ─────────────────────────────────────────── */
  const getPixelPos = useCallback((e: React.MouseEvent): PixelPt => {
    const el = overlayRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const tool = drawingToolRef.current;
    if (tool === 'cursor') return;
    e.stopPropagation();
    e.preventDefault();
    const px = getPixelPos(e);
    const chart = chartRef.current;
    const series = seriesRef.current;

    if (tool === 'select') {
      if (!chart || !series) return;
      const canvasW = overlayRef.current?.parentElement?.getBoundingClientRect().width || 800;

      const selDrawingId = selectedIdRef.current;
      if (selDrawingId != null) {
        const selDrawing = drawingsRef.current.find(d => d.id === selDrawingId);
        if (selDrawing) {
          const pxd = drawingToPixel(selDrawing, chart, series);
          if (pxd) {
            const handle = hitTestHandle(px, pxd);
            if (handle) {
              setDragResize({ drawingId: selDrawingId, handle, currentPx: px });
              return;
            }
          }
        }
      }

      let found: Drawing | null = null;
      for (let i = drawingsRef.current.length - 1; i >= 0; i--) {
        const pxd = drawingToPixel(drawingsRef.current[i], chart, series);
        if (pxd && hitTestPixel(px, pxd, canvasW)) {
          found = drawingsRef.current[i];
          break;
        }
      }
      if (found) {
        setSelectedId(found.id);
        setDragMove({ drawingId: found.id, startPx: px, currentPx: px });
      } else {
        setSelectedId(null);
      }
      return;
    }

    if (tool === 'hline') {
      if (!chart || !series) return;
      const cp = pixelToChart(px, chart, series);
      if (cp) {
        setDrawings(prev => [...prev, { id: _nextId++, tool: 'hline', p1: { logical: 0, price: cp.price }, p2: { logical: 0, price: cp.price } }]);
      }
      return;
    }

    setDragCreate({ startPx: px, currentPx: { ...px }, tool: tool as DrawingType });
  }, [getPixelPos]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const px = getPixelPos(e);

    if (dragResizeRef.current) {
      setDragResize(prev => prev ? { ...prev, currentPx: px } : null);
      return;
    }

    if (dragMoveRef.current) {
      setDragMove(prev => prev ? { ...prev, currentPx: px } : null);
      return;
    }

    if (dragCreateRef.current) {
      setDragCreate(prev => prev ? { ...prev, currentPx: px } : null);
    }
  }, [getPixelPos]);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const chart = chartRef.current;
    const series = seriesRef.current;

    const dr = dragResizeRef.current;
    if (dr) {
      if (chart && series) {
        const cp = pixelToChart(dr.currentPx, chart, series);
        if (cp) {
          setDrawings(prev => prev.map(d => {
            if (d.id !== dr.drawingId) return d;
            const newP1 = { ...d.p1 }, newP2 = { ...d.p2 };
            switch (dr.handle) {
              case 'p1': newP1.logical = cp.logical; newP1.price = cp.price; break;
              case 'p2': newP2.logical = cp.logical; newP2.price = cp.price; break;
              case 'p1x_p2y': newP1.logical = cp.logical; newP2.price = cp.price; break;
              case 'p2x_p1y': newP2.logical = cp.logical; newP1.price = cp.price; break;
            }
            return { ...d, p1: newP1, p2: newP2 };
          }));
        }
      }
      setDragResize(null);
      return;
    }

    const dm = dragMoveRef.current;
    if (dm) {
      if (chart && series) {
        const startChart = pixelToChart(dm.startPx, chart, series);
        const curChart = pixelToChart(dm.currentPx, chart, series);
        if (startChart && curChart) {
          const dl = curChart.logical - startChart.logical;
          const dp = curChart.price - startChart.price;
          if (Math.abs(dl) > 0.01 || Math.abs(dp) > 0.000001) {
            setDrawings(prev => prev.map(d => {
              if (d.id !== dm.drawingId) return d;
              return {
                ...d,
                p1: { logical: d.p1.logical + dl, price: d.p1.price + dp },
                p2: { logical: d.p2.logical + dl, price: d.p2.price + dp },
              };
            }));
          }
        }
      }
      setDragMove(null);
      return;
    }

    const dc = dragCreateRef.current;
    if (dc && chart && series) {
      const dxPx = Math.abs(dc.currentPx.x - dc.startPx.x);
      const dyPx = Math.abs(dc.currentPx.y - dc.startPx.y);
      if (dxPx > 3 || dyPx > 3) {
        const p1 = pixelToChart(dc.startPx, chart, series);
        const p2 = pixelToChart(dc.currentPx, chart, series);
        if (p1 && p2) {
          setDrawings(prev => [...prev, { id: _nextId++, tool: dc.tool, p1, p2 }]);
        }
      }
      setDragCreate(null);
    }
  }, []);

  /* ── Info bar ──────────────────────────────────────────────────── */
  const displayIdx = crosshairIdx >= 0 ? crosshairIdx : (data?.length ? data.length - 1 : -1);
  const displayBar = displayIdx >= 0 && data ? data[displayIdx] : null;
  const prevBar = displayIdx > 0 && data ? data[displayIdx - 1] : null;
  const change = useMemo(() => {
    if (!displayBar) return 0;
    if (lineMode) return prevBar ? displayBar.close - prevBar.close : 0;
    return displayBar.close - displayBar.open;
  }, [displayBar, prevBar, lineMode]);
  const changePct = useMemo(() => {
    if (!displayBar) return 0;
    if (lineMode && prevBar) return prevBar.close ? (change / prevBar.close) * 100 : 0;
    return displayBar.open ? (change / displayBar.open) * 100 : 0;
  }, [displayBar, prevBar, change, lineMode]);
  const isUp = change >= 0;

  const isActive = drawingTool !== 'cursor';

  return (
    <div className={fillContainer ? 'w-full h-full flex flex-col' : 'w-full'}>
      {displayBar && (
        <div className="flex items-center gap-3 px-1 text-[11px] font-mono flex-wrap select-none shrink-0" style={{ height: '22px' }}>
          <span className="text-muted-foreground/70">{formatTime(displayBar.time)}</span>
          {lineMode ? (
            <>
              <span className="text-muted-foreground">Price <span className="text-foreground font-medium">{displayBar.close.toFixed(5)}</span></span>
              {prevBar && <span className={`font-medium ${isUp ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>{isUp ? '▲' : '▼'} {Math.abs(change).toFixed(5)} ({isUp ? '+' : ''}{changePct.toFixed(2)}%)</span>}
            </>
          ) : (
            <>
              <span className="text-muted-foreground">O <span className="text-foreground font-medium">{displayBar.open.toFixed(5)}</span></span>
              <span className="text-muted-foreground">H <span className="text-[#22c55e] font-medium">{displayBar.high.toFixed(5)}</span></span>
              <span className="text-muted-foreground">L <span className="text-[#ef4444] font-medium">{displayBar.low.toFixed(5)}</span></span>
              <span className="text-muted-foreground">C <span className={`font-medium ${isUp ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>{displayBar.close.toFixed(5)}</span></span>
              <span className={`font-medium ${isUp ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>{isUp ? '▲' : '▼'} {Math.abs(change).toFixed(5)} ({isUp ? '+' : ''}{changePct.toFixed(2)}%)</span>
            </>
          )}
        </div>
      )}
      <div className={`relative ${fillContainer ? 'flex-1 min-h-0' : ''}`} style={{ minHeight: fillContainer ? undefined : height }}>
        <div ref={chartContainerRef} style={{ position: 'absolute', inset: 0 }} />
        <canvas
          ref={overlayRef}
          style={{
            position: 'absolute', inset: 0, zIndex: 10,
            pointerEvents: isActive ? 'auto' : 'none',
            cursor: drawingTool === 'select' ? (dragResize ? 'nwse-resize' : dragMove ? 'grabbing' : 'pointer') : (isActive ? 'crosshair' : 'default'),
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />
      </div>
    </div>
  );
}
