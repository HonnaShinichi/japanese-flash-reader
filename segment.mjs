const JA = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー、。！？「」『』（）`;
const JA_GAP = new RegExp(`(?<=[${JA}])\\s+(?=[${JA}])`, 'gu');
// Tesseract also pads half-width parentheses inside Japanese text with spaces.
const OCR_GAP = new RegExp(`(?<=[${JA}()])[ \\t]+(?=[${JA}()])`, 'gu');
const PUNCTUATION = /^[、。，．！？!?：:；;」』）】〉》)…]+$/u;
// A blank line ends a paragraph; other line breaks and spaces between Japanese characters are wrapping.
function* paragraphs(text) {
  for (const paragraph of text.normalize('NFC').split(/\n\s*\n/u)) yield paragraph.replace(JA_GAP, '').replace(/\s+/gu, ' ').trim();
}
export function segmentJapanese(text, maxLength = 12) {
  const max = Math.max(4, Math.min(40, Number(maxLength) || 12));
  const words = new Intl.Segmenter('ja', {granularity:'word'});
  const chunks = [];
  let buffer = '';
  const push = () => { if (buffer.trim()) chunks.push(buffer.trim()); buffer = ''; };
  for (const clean of paragraphs(text)) {
    for (const {segment:word} of words.segment(clean)) {
      if (PUNCTUATION.test(word)) {
        if (buffer) buffer += word;
        else if (chunks.length) chunks[chunks.length-1] += word;
        else buffer += word;
        if (/[。！？!?]/u.test(word)) push();
        continue;
      }
      if ([...buffer+word].length > max && buffer.trim()) push();
      buffer += word;
      if ([...buffer].length >= Math.floor(max * .6) && /^(は|が|を|に|で|と|へ|から|まで|より|ので|のに)$/u.test(word)) push();
    }
    push();
  }
  return chunks;
}
const PARTICLE = /^(は|が|を|に|へ|と|で|も|から|まで|より|には|では|とは|という|として)$/u;
const FOLLOWER = /^(は|が|を|に|へ|と|で|も|の|や|か|ね|よ|な|から|まで|より)$/u;
// Approximates bunsetsu (a content word and its particles) for RSVP, without a morphological analyzer.
export function segmentPhrases(text, maxLength = 8) {
  const words = new Intl.Segmenter('ja', {granularity:'word'});
  const phrases = [];
  let buffer = '', previous = '';
  const push = () => { if (buffer.trim()) phrases.push(buffer.trim()); buffer = ''; };
  for (const clean of paragraphs(text)) {
    for (const {segment:word} of words.segment(clean)) {
      if (!word.trim()) { push(); continue; }
      if (PUNCTUATION.test(word)) {
        if (buffer) buffer += word;
        else if (phrases.length) phrases[phrases.length-1] += word;
        else buffer = word;
        if (/[、。，．！？!?]/u.test(word)) push();
        previous = word;
        continue;
      }
      if (/^[「『（【〈《(]+$/u.test(word)) push();
      else if (buffer && /\p{Script=Hiragana}$/u.test(buffer) && /^[\p{Script=Han}\p{Script=Katakana}\p{Script=Latin}\p{N}]/u.test(word)) push();
      else if (buffer && PARTICLE.test(previous) && /^\p{Script=Hiragana}/u.test(word) && !FOLLOWER.test(word)) push();
      if (buffer && [...buffer+word].length > maxLength) push();
      buffer += word;
      previous = word;
    }
    push();
  }
  return phrases;
}
// Fixation point for RSVP: slightly left of the middle, ignoring brackets and trailing punctuation.
export function pivotIndex(phrase) {
  const chars = [...phrase];
  let start = 0, end = chars.length;
  while (start < end - 1 && /[「『（【〈《(]/u.test(chars[start])) start++;
  while (end - 1 > start && /[、。，．！？!?：:；;」』）】〉》)…]/u.test(chars[end-1])) end--;
  const length = end - start;
  return start + (length <= 2 ? 0 : length <= 5 ? 1 : length <= 9 ? 2 : 3);
}
export function displayDelay(text, cpm = 600) {
  const base = Math.max(100, [...text].length * 60000 / Math.max(60, cpm));
  return base * (/[。！？!?][」』）】]*$/u.test(text) ? 1.65 : /[、,]$/u.test(text) ? 1.25 : 1);
}
export function cropRect(start, end, width, height) {
  const x = Math.max(0, Math.min(start.x,end.x,width));
  const y = Math.max(0, Math.min(start.y,end.y,height));
  return {x, y, width: Math.max(0,Math.min(width,Math.max(start.x,end.x))-x), height: Math.max(0,Math.min(height,Math.max(start.y,end.y))-y)};
}

export function normalizeOcrText(text) {
  return text.replace(OCR_GAP, '').trim();
}

// Ruby (furigana) forms narrow, faint bands beside the body lines: about half the line width, with little ink.
// profile[i] counts dark pixels in column i (vertical writing) or row i (horizontal writing).
export function rubyBands(profile) {
  const bands = [];
  let start = -1;
  for (let i = 0; i <= profile.length; i++) {
    const on = i < profile.length && profile[i] > 0;
    if (on && start < 0) start = i;
    if (!on && start >= 0) { let ink = 0; for (let k = start; k < i; k++) ink += profile[k]; bands.push({start, size: i - start, ink}); start = -1; }
  }
  const maxInk = Math.max(0, ...bands.map(b => b.ink)), body = bands.filter(b => b.ink > maxInk / 4);
  if (body.length < 3) return [];
  const median = values => values.sort((a, b) => a - b)[values.length >> 1];
  const size = median(body.map(b => b.size)), ink = median(body.map(b => b.ink));
  return bands.filter(b => b.size >= size * .35 && b.size <= size * .7 && b.ink < ink / 4);
}

export function mergeOcrText(current, addition, append = true) {
  const text = addition.trim();
  if (!text) return current;
  return append && current.trim() ? current.trimEnd() + '\n' + text : text;
}
