export function computeSMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(sum / period);
  }
  return result;
}

export function computeEMA(data: number[], period: number): (number | null)[] {
  if (data.length === 0) return [];
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (i === period - 1) {
      ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
      result.push(ema);
      continue;
    }
    ema = (data[i] - ema) * k + ema;
    result.push(ema);
  }
  return result;
}

export function computeRSI(data: number[], period: number): (number | null)[] {
  if (data.length < period + 1) return data.map(() => null);
  const result: (number | null)[] = [null];
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = data[i] - data[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
    result.push(null);
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < data.length; i++) {
    const d = data[i] - data[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

/**
 * Parabolic SAR (Stop and Reverse) — Wilder's trend-following indicator.
 * Returns one SAR value per bar. Dots below price = uptrend, above = downtrend.
 *
 * Reference: J. Welles Wilder Jr., "New Concepts in Technical Trading Systems" (1978)
 * Formula:  SAR(i) = SAR(i-1) + AF * (EP - SAR(i-1))
 *   AF starts at `afStep`, increments by `afStep` on each new EP, capped at `afMax`.
 *   EP = extreme point (highest high in uptrend / lowest low in downtrend).
 */
export function computeParabolicSAR(
  highs: number[],
  lows: number[],
  closes: number[],
  afStep = 0.02,
  afMax = 0.20,
): (number | null)[] {
  const n = highs.length;
  if (n < 2) return new Array(n).fill(null);

  const result: (number | null)[] = new Array(n).fill(null);

  let isLong = closes[1] >= closes[0];
  let af = afStep;
  let ep: number;
  let sar: number;

  if (isLong) {
    sar = lows[0];
    ep = highs[0];
    for (let k = 0; k <= 1; k++) if (highs[k] > ep) ep = highs[k];
  } else {
    sar = highs[0];
    ep = lows[0];
    for (let k = 0; k <= 1; k++) if (lows[k] < ep) ep = lows[k];
  }

  result[0] = sar;

  for (let i = 1; i < n; i++) {
    let newSar = sar + af * (ep - sar);

    if (isLong) {
      newSar = Math.min(newSar, lows[i - 1]);
      if (i >= 2) newSar = Math.min(newSar, lows[i - 2]);

      if (lows[i] < newSar) {
        isLong = false;
        newSar = ep;
        ep = lows[i];
        af = afStep;
      } else {
        if (highs[i] > ep) {
          ep = highs[i];
          af = Math.min(af + afStep, afMax);
        }
      }
    } else {
      newSar = Math.max(newSar, highs[i - 1]);
      if (i >= 2) newSar = Math.max(newSar, highs[i - 2]);

      if (highs[i] > newSar) {
        isLong = true;
        newSar = ep;
        ep = highs[i];
        af = afStep;
      } else {
        if (lows[i] < ep) {
          ep = lows[i];
          af = Math.min(af + afStep, afMax);
        }
      }
    }

    sar = newSar;
    result[i] = sar;
  }

  return result;
}

/**
 * Average Directional Index (ADX) — Wilder's trend-strength indicator.
 * Returns { adx, plusDI, minusDI } arrays aligned with input length.
 *
 * Calculation (Wilder smoothing, period typically 14):
 *  1. +DM = max(high - prevHigh, 0), -DM = max(prevLow - low, 0)
 *     If +DM > -DM keep +DM, zero -DM; else vice versa.
 *  2. TR = max(high-low, |high-prevClose|, |low-prevClose|)
 *  3. Wilder-smooth +DM, -DM, TR over `period` bars:
 *     smoothed(t) = smoothed(t-1) - smoothed(t-1)/period + value(t)
 *  4. +DI = smoothed(+DM) / smoothed(TR) * 100
 *     -DI = smoothed(-DM) / smoothed(TR) * 100
 *  5. DX = |+DI - -DI| / (+DI + -DI) * 100
 *  6. ADX = Wilder-smooth DX over `period` bars.
 */
export function computeADX(
  highs: number[], lows: number[], closes: number[], period = 14,
): { adx: (number | null)[]; plusDI: (number | null)[]; minusDI: (number | null)[] } {
  const n = highs.length;
  const empty = () => new Array(n).fill(null) as (number | null)[];
  if (n < period * 2 + 1) return { adx: empty(), plusDI: empty(), minusDI: empty() };

  const adx = empty(), plusDI = empty(), minusDI = empty();

  const rawPlusDM: number[] = [0];
  const rawMinusDM: number[] = [0];
  const rawTR: number[] = [highs[0] - lows[0]];

  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    let pDM = 0, mDM = 0;
    if (upMove > downMove && upMove > 0) pDM = upMove;
    if (downMove > upMove && downMove > 0) mDM = downMove;
    rawPlusDM.push(pDM);
    rawMinusDM.push(mDM);

    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    rawTR.push(tr);
  }

  let sPlusDM = 0, sMinusDM = 0, sTR = 0;
  for (let i = 1; i <= period; i++) {
    sPlusDM += rawPlusDM[i];
    sMinusDM += rawMinusDM[i];
    sTR += rawTR[i];
  }

  const dxArr: number[] = [];

  for (let i = period; i < n; i++) {
    if (i > period) {
      sPlusDM = sPlusDM - sPlusDM / period + rawPlusDM[i];
      sMinusDM = sMinusDM - sMinusDM / period + rawMinusDM[i];
      sTR = sTR - sTR / period + rawTR[i];
    }

    const pdi = sTR !== 0 ? (sPlusDM / sTR) * 100 : 0;
    const mdi = sTR !== 0 ? (sMinusDM / sTR) * 100 : 0;
    plusDI[i] = pdi;
    minusDI[i] = mdi;

    const diSum = pdi + mdi;
    const dx = diSum !== 0 ? (Math.abs(pdi - mdi) / diSum) * 100 : 0;
    dxArr.push(dx);

    if (dxArr.length === period) {
      adx[i] = dxArr.reduce((a, b) => a + b, 0) / period;
    } else if (dxArr.length > period) {
      adx[i] = ((adx[i - 1] as number) * (period - 1) + dx) / period;
    }
  }

  return { adx, plusDI, minusDI };
}

export function computeMACD(data: number[], fast: number, slow: number, signal: number) {
  const emaFast = computeEMA(data, fast);
  const emaSlow = computeEMA(data, slow);
  const macdLine: (number | null)[] = emaFast.map((f, i) => {
    const s = emaSlow[i];
    if (f === null || s === null) return null;
    return f - s;
  });
  const validMacd = macdLine.filter((v): v is number => v !== null);
  const signalRaw = computeEMA(validMacd, signal);
  const offset = macdLine.length - validMacd.length;
  const signalLine: (number | null)[] = new Array(offset).fill(null).concat(signalRaw);
  const histogram: (number | null)[] = macdLine.map((m, i) => {
    const s = signalLine[i];
    if (m === null || s === null) return null;
    return m - s;
  });
  return { macdLine, signalLine, histogram };
}

export function computeATR(
  highs: number[], lows: number[], closes: number[], period = 14,
): (number | null)[] {
  const n = highs.length;
  const tr: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) { tr.push(highs[i] - lows[i]); continue; }
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    ));
  }
  const result: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += tr[j];
      result.push(sum / period);
    } else {
      const prev = result[i - 1] as number;
      result.push((prev * (period - 1) + tr[i]) / period);
    }
  }
  return result;
}
