import { normalizeText } from '../saferide-gemma4-dataset-audit.mjs';

export { normalizeText };

export function words(value) {
  return normalizeText(value).split(' ').filter(Boolean);
}

export function ngrams(tokens, size) {
  const result = new Set();
  for (let index = 0; index <= tokens.length - size; index += 1) {
    result.add(tokens.slice(index, index + size).join(' '));
  }
  return result;
}

export function jaccard(left, right) {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / Math.max(1, left.size + right.size - intersection);
}

export function termFrequency(tokens) {
  const frequencies = new Map();
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  return frequencies;
}

export function cosine(left, right) {
  let dot = 0;
  let leftSquare = 0;
  let rightSquare = 0;
  for (const value of left.values()) leftSquare += value * value;
  for (const value of right.values()) rightSquare += value * value;
  for (const [token, value] of left.entries()) dot += value * (right.get(token) ?? 0);
  if (leftSquare === 0 || rightSquare === 0) return 0;
  return dot / (Math.sqrt(leftSquare) * Math.sqrt(rightSquare));
}

export function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

export function distinctMetric(documents, size) {
  let total = 0;
  const unique = new Set();
  for (const document of documents) {
    const rowNgrams = [];
    for (let index = 0; index <= document.tokens.length - size; index += 1) {
      rowNgrams.push(document.tokens.slice(index, index + size).join(' '));
    }
    total += rowNgrams.length;
    rowNgrams.forEach(value => unique.add(value));
  }
  return total === 0 ? 0 : unique.size / total;
}
