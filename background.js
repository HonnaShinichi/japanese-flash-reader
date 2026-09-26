let opening = false;
async function toJpeg(dataUrl) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  const bytes = new Uint8Array(await (await canvas.convertToBlob({type: 'image/jpeg', quality: 0.92})).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return 'data:image/jpeg;base64,' + btoa(binary);
}
async function openReader(tab) {
  if (!tab?.id || opening) return;
  opening = true;
  const payload = {text: '', image: '', error: '', created: Date.now()};
  try {
    // Capture before opening the reader, while the source tab is still active.
    try { payload.image = await chrome.tabs.captureVisibleTab(tab.windowId, {format: 'png'}); }
    catch { payload.error = 'この画面は撮影できませんでした。文章の貼り付け、または画像ファイルをお使いください。'; }
    try {
      const frames = await chrome.scripting.executeScript({
        target: {tabId: tab.id, allFrames: true},
        func: () => String(window.getSelection() || '').trim()
      });
      payload.text = frames.map(f => f.result || '').filter(Boolean).join('\n');
    } catch { /* Browser-owned viewers may still be captured as images. */ }
    const key = crypto.randomUUID();
    const stored = await chrome.storage.session.get(null);
    const old = Object.entries(stored).filter(([k,v]) => k.startsWith('capture:') && Date.now()-v.created > 600000).map(([k]) => k);
    if (old.length) await chrome.storage.session.remove(old);
    const store = () => chrome.storage.session.set({['capture:'+key]: payload});
    try { await store(); }
    catch {
      // Session storage holds 10 MB; a PNG of a very large screen can exceed it.
      try { payload.image = await toJpeg(payload.image); await store(); }
      catch {
        payload.image = '';
        payload.error = '画面が大きすぎるため取り込めませんでした。ウィンドウを小さくするか、ブラウザの表示倍率を下げてから再度お試しください。';
        await store();
      }
    }
    await chrome.tabs.create({url: chrome.runtime.getURL('reader.html')+'#'+key});
  } catch (error) {
    console.error('Reader failed:', error);
    await chrome.tabs.create({url: chrome.runtime.getURL('reader.html')});
  } finally { opening = false; }
}
chrome.action.onClicked.addListener(openReader);
chrome.commands.onCommand.addListener(async command => {
  if (command === 'open-reader') {
    const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
    await openReader(tab);
  }
});
