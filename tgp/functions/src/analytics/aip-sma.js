'use strict';

/**
 * AIP simple-moving-average analytics — operates ONLY on observations
 * actually passed in. Never generates, interpolates, or assumes a missing
 * observation; a gap in the input array is a gap in the output confidence,
 * not something this module papers over.
 */

function sma(observations, windowSize, valueKey) {
  if (observations.length < windowSize) {
    return { status: 'INSUFFICIENT_DATA', reason: `Need ${windowSize} observations, have ${observations.length}.` };
  }
  const window = observations.slice(-windowSize);
  const sum = window.reduce((acc, o) => acc + o[valueKey], 0);
  return { status: 'OK', value: +(sum / windowSize).toFixed(2), windowSize, from: window[0].date, to: window[window.length - 1].date };
}

/**
 * @param {Array<{date:string, ulp:number, diesel:number}>} observations  real, ascending by date
 * @param {string} valueKey  'ulp' | 'diesel'
 */
function direction(observations, valueKey) {
  const sma3 = sma(observations, 3, valueKey);
  const sma10 = sma(observations, 10, valueKey);

  if (sma3.status !== 'OK' || sma10.status !== 'OK') {
    return { state: 'INSUFFICIENT_DATA', sma3, sma10 };
  }

  const latest = observations[observations.length - 1][valueKey];
  const diff3 = +(latest - sma3.value).toFixed(2);
  // Short-term average vs long-term average: positive means recent prices
  // are running above the longer trend (upward momentum), negative means
  // below it (downward momentum). This must be sma3 MINUS sma10, not the
  // other way round — sma10 lags behind sma3 by construction, so getting
  // the subtraction order backwards flips the sign of the whole signal.
  const diff10 = +(sma3.value - sma10.value).toFixed(2);

  const epsilon = 0.1; // c/L — ignore noise below this as NEUTRAL
  let state = 'NEUTRAL';
  if (diff3 > epsilon && diff10 > epsilon) state = 'UPWARD';
  else if (diff3 < -epsilon && diff10 < -epsilon) state = 'DOWNWARD';

  return { state, sma3, sma10, latest, diffLatestVsSma3: diff3, diffSma3VsSma10: diff10 };
}

module.exports = { sma, direction };
