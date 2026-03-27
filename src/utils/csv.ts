import type { OHLCBar } from '@/types';

export function ohlcToCsv(data: OHLCBar[]): string {
  const header = 'Date,Open,High,Low,Close,Volume';
  const rows = data.map(b => `${b.time},${b.open},${b.high},${b.low},${b.close},${b.volume ?? ''}`);
  return [header, ...rows].join('\n');
}

export function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function tableToCsv(headers: string[], rows: (string | number)[][]): string {
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}
