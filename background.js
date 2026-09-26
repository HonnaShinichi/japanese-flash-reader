const READER = chrome.runtime.getURL('reader.html');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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
// Hands a capture to the reader through session storage and returns its key.
async function saveCapture(payload) {
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
  return key;
}
async function findReader() {
  const contexts = await chrome.runtime.getContexts({contextTypes: ['TAB']});
  return contexts.find(c => c.documentUrl?.startsWith(READER));
}
async function openReader(tab) {
  if (!tab?.id || opening) return;
  opening = true;
  try {
    const reader = await findReader();
    if (reader?.tabId === tab.id) return;
    const payload = {text: '', image: '', error: '', created: Date.now(), source: {tabId: tab.id, windowId: tab.windowId}};
    // Capture before focusing the reader, while the source tab is still active.
    try { payload.image = await chrome.tabs.captureVisibleTab(tab.windowId, {format: 'png'}); }
    catch { payload.error = 'この画面は撮影できませんでした。文章の貼り付け、または画像ファイルをお使いください。'; }
    try {
      const frames = await chrome.scripting.executeScript({
        target: {tabId: tab.id, allFrames: true},
        func: () => String(window.getSelection() || '').trim()
      });
      payload.text = frames.map(f => f.result || '').filter(Boolean).join('\n');
    } catch { /* Browser-owned viewers may still be captured as images. */ }
    const key = await saveCapture(payload);
    const delivered = reader && await chrome.runtime.sendMessage({type: 'capture', key, readerTabId: reader.tabId}).catch(() => false);
    if (delivered) await chrome.windows.update(reader.windowId, {focused: true});
    else {
      // A separate window keeps the source tab visible, so the reader can capture the following pages.
      const url = READER+'#'+key, source = await chrome.windows.get(tab.windowId);
      const width = Math.min(720, Math.round(source.width / 2));
      // Chrome rejects bounds that are mostly off-screen; then let it place the window, or fall back to a tab.
      await chrome.windows.create({url, type: 'popup', width, height: source.height, left: source.left + source.width - width, top: source.top})
        .catch(() => chrome.windows.create({url, type: 'popup'}))
        .catch(() => chrome.tabs.create({url}));
    }
  } catch (error) {
    console.error('Reader failed:', error);
    await chrome.tabs.create({url: READER});
  } finally { opening = false; }
}
// Turns the source tab one page forward and captures it once the display has settled.
async function nextPage({tabId, windowId, key}) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return {error: '元の電子書籍タブが閉じられています。電子書籍のタブで拡張アイコンを押し直してください。'};
  if (!tab.active) return {error: '元の電子書籍タブを表示してから、もう一度押してください。'};
  const capture = () => chrome.tabs.captureVisibleTab(windowId, {format: 'png'});
  const save = image => saveCapture({text: '', image, error: '', created: Date.now(), source: {tabId, windowId}});
  try {
    const before = await capture();
    await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', args: [key], func: key => {
      for (const type of ['keydown', 'keyup']) document.dispatchEvent(new KeyboardEvent(type, {key, code: key, keyCode: key === 'ArrowLeft' ? 37 : 39, bubbles: true}));
    }});
    // captureVisibleTab allows two calls per second.
    let last = before;
    for (let i = 0; i < 8; i++) {
      await sleep(600);
      const image = await capture();
      if (image !== before && image === last) return {key: await save(image)};
      last = image;
    }
    if (last !== before) return {key: await save(last)};
    return {error: 'ページが変わりませんでした。最後のページか、ビューアがページ送りを受け付けていない可能性があります。'};
  } catch (error) {
    console.error('Next page failed:', error);
    return {error: '元のタブを操作できませんでした。電子書籍のタブで拡張アイコンを押し直してください。'};
  }
}
chrome.action.onClicked.addListener(openReader);
chrome.commands.onCommand.addListener(async command => {
  if (command === 'open-reader') {
    const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
    await openReader(tab);
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'nextPage' || sender.id !== chrome.runtime.id) return;
  nextPage(message).then(sendResponse);
  return true;
});
