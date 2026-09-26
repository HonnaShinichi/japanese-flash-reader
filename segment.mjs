export function segmentJapanese(text, maxLength = 12) {
  const max = Math.max(4, Math.min(40, Number(maxLength) || 12));
  const clean = text.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const words = new Intl.Segmenter('ja', {granularity:'word'});
  const chunks = [];
  let buffer = '';
  const push = () => { if (buffer.trim()) chunks.push(buffer.trim()); buffer = ''; };
  for (const {segment:word} of words.segment(clean)) {
    if (/^[、。，．！？!?：:；;」』）】〉》]+$/u.test(word)) {
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
  return chunks;
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
  return text.replace(/(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}、。！？「」『』（）])[ \t]+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}、。！？「」『』（）])/gu, '').trim();
}
