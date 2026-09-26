import {segmentJapanese, segmentPhrases, pivotIndex, displayDelay, cropRect, normalizeOcrText, mergeOcrText, rubyBands} from './segment.mjs';
const $ = id => document.getElementById(id);
let cards = [], index = 0, timer = null, playing = false;
let bitmap = null, crop = null, anchor = null, busy = false;
// source: the e-book tab that "次のページ" turns. regions: areas OCR'd by hand, read again on the next page.
let source = null, regions = [], freshPage = true, tabId = null;
const canvas = $('capture'), ctx = canvas.getContext('2d');
canvas.hidden = true;
function status(message) { $('status').textContent = message; }
function speed() { return Math.min(2400, Math.max(120, Number($('speed').value) || 600)); }
const rsvp = () => $('mode').value === 'rsvp';
const segment = text => rsvp() ? segmentPhrases(text) : segmentJapanese(text, $('length').value);
function span(className, text) { const e = document.createElement('span'); e.className = className; e.textContent = text; return e; }
function render() {
  const card = cards[index];
  $('card').classList.toggle('rsvp', rsvp() && Boolean(card));
  if (rsvp() && card) {
    // Keep the fixation point at the same spot so the eyes do not move.
    const chars = [...card], p = pivotIndex(card);
    $('card').replaceChildren(span('before', chars.slice(0,p).join('')), span('pivot', chars[p]), span('after', chars.slice(p+1).join('')));
  } else $('card').textContent = card || '読み始めましょう';
  $('context').textContent = rsvp() ? '' : cards.length ? cards.slice(Math.max(0,index-2),index).join('') : '文章を取り込んで「反映」を押してください';
  $('progressText').textContent = cards.length ? `${index+1} / ${cards.length}` : '0 / 0';
  $('position').max = Math.max(0,cards.length-1); $('position').value = index;
  $('play').textContent = playing ? '停止' : '再生';
}
function stop() { playing = false; clearTimeout(timer); render(); }
function tick() {
  clearTimeout(timer); render();
  if (!playing || !cards.length) return;
  timer = setTimeout(() => {
    if (index >= cards.length-1) { stop(); status(source ? '最後まで読みました。「次のページを取り込む」で続きを読み込めます。' : '最後まで読みました。'); }
    else { index++; tick(); }
  }, displayDelay(cards[index],speed()));
}
function apply() {
  stop(); cards = segment($('source').value); index=0; render();
  status(cards.length ? `${cards.length}枚に区切りました。再生で開始します。` : '読む文章を入力してください。');
}
// Adds text to the source. When continuing to a new page, playback resumes at the first new card.
function addText(text, continuing) {
  const current=$('source').value, before=segment(current), appended=$('append').checked&&Boolean(current.trim());
  $('source').value=mergeOcrText(current,text,$('append').checked);apply();
  if(continuing&&appended){let i=0;while(i<before.length&&before[i]===cards[i])i++;index=Math.min(i,Math.max(0,cards.length-1));render();}
  return appended;
}
const LOCKED=['ocr','clear','imageFile','resetCrop','direction','append','ruby','nextPage'];
function lock(on){busy=on;LOCKED.forEach(id=>$(id).disabled=on);if(!on)$('ocr').disabled=!bitmap;}
$('apply').onclick=apply;
$('play').onclick=() => { if (!cards.length) apply(); if (!cards.length) return; playing=!playing; tick(); };
$('prev').onclick=()=>{stop();index=Math.max(0,index-1);render();};
$('next').onclick=()=>{stop();index=Math.min(Math.max(0,cards.length-1),index+1);render();};
$('restart').onclick=()=>{stop();index=0;render();};
$('position').oninput=()=>{const next=Number($('position').value);stop();index=next;render();};
function saveSettings() {
  chrome.storage.local.set({settings:{speed:speed(),length:$('length').value,font:$('font').value,direction:$('direction').value,mode:$('mode').value,ruby:$('ruby').checked}}).catch(()=>{});
}
// Re-splits the text for the current mode, keeping the reading position.
function resegment() {
  const size=card=>card.replace(/\s/gu,'').length, offset=size(cards.slice(0,index).join(''));
  stop();cards=segment($('source').value);index=0;
  for(let n=0;index<cards.length-1&&n+size(cards[index])<=offset;index++)n+=size(cards[index]);
  $('length').disabled=rsvp();render();
}
$('speed').onchange=()=>{$('speed').value=speed();saveSettings();tick();};
$('length').onchange=()=>{saveSettings();resegment();};
$('mode').onchange=()=>{saveSettings();resegment();};
$('ruby').onchange=saveSettings;
$('font').oninput=()=>{$('card').style.fontSize=$('font').value+'px';saveSettings();};
$('direction').onchange=saveSettings;
$('sample').onclick=()=>{$('source').value='雨上がりの道を歩くと、木々の葉に小さな水滴が残っていました。立ち止まって眺めるうちに、いつもの景色にも新しい発見があることに気づきました。読む速さを調整しながら、自分に合うリズムを探してみましょう。';apply();};
document.addEventListener('keydown',event=>{
  if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName)) return;
  if (event.code==='Space') {event.preventDefault();$('play').click();}
  if (event.key==='ArrowLeft') {event.preventDefault();$('prev').click();}
  if (event.key==='ArrowRight') {event.preventDefault();$('next').click();}
  if (event.key==='Escape') stop();
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if (!bitmap) return;
  ctx.drawImage(bitmap,0,0);
  if (crop) {
    ctx.fillStyle='rgba(0,0,0,.38)';ctx.fillRect(0,0,canvas.width,canvas.height);
    if (crop.width && crop.height) ctx.drawImage(bitmap,crop.x,crop.y,crop.width,crop.height,crop.x,crop.y,crop.width,crop.height);
    ctx.strokeStyle='#81b833';ctx.lineWidth=Math.max(2,canvas.width/450);ctx.strokeRect(crop.x,crop.y,crop.width,crop.height);
  }
}
async function loadImage(blob, keepCrop=false) {
  if (blob.size>25*1024*1024) throw new Error('画像は25MB以下にしてください。');
  const next = await createImageBitmap(blob);
  if (next.width*next.height>40000000) {next.close();throw new Error('画像を4000万画素以下に縮小してください。');}
  const sameSize=keepCrop&&bitmap&&bitmap.width===next.width&&bitmap.height===next.height;
  bitmap?.close();bitmap=next;canvas.width=bitmap.width;canvas.height=bitmap.height;
  if(!sameSize){crop={x:0,y:0,width:bitmap.width,height:bitmap.height};regions=[];}
  freshPage=true;canvas.hidden=false;$('noImage').hidden=true;$('ocr').disabled=busy;draw();
}
function point(e) { const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}; }
canvas.onpointerdown=e=>{if(!bitmap||busy)return;anchor=point(e);canvas.setPointerCapture(e.pointerId);crop=cropRect(anchor,anchor,canvas.width,canvas.height);draw();};
canvas.onpointermove=e=>{if(!anchor)return;crop=cropRect(anchor,point(e),canvas.width,canvas.height);draw();};
canvas.onpointerup=()=>{anchor=null;};canvas.onpointercancel=()=>{anchor=null;};
$('resetCrop').onclick=()=>{if(bitmap&&!busy){crop={x:0,y:0,width:bitmap.width,height:bitmap.height};draw();}};
$('imageFile').onchange=async()=>{try{if($('imageFile').files[0]){await loadImage($('imageFile').files[0]);status('本文を囲んでOCRを実行してください。');}}catch(e){status(e.message);}};
$('clear').onclick=()=>{stop();cards=[];index=0;$('source').value='';bitmap?.close();bitmap=null;crop=null;regions=[];freshPage=true;canvas.width=0;canvas.height=0;canvas.hidden=true;$('noImage').hidden=false;$('ocr').disabled=true;$('imageFile').value='';render();status('文章と画像を消去しました。');};
// Whitens ruby beside the body lines: to the right of columns in vertical writing, above rows in horizontal writing.
function eraseRuby(area, vertical) {
  const g=area.getContext('2d'), {data,width,height}=g.getImageData(0,0,area.width,area.height), profile=new Uint32Array(vertical?width:height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if(data[i]*.3+data[i+1]*.59+data[i+2]*.11<140)profile[vertical?x:y]++;}
  g.fillStyle='#fff';
  for(const b of rubyBands(profile))vertical?g.fillRect(b.start,0,b.size,height):g.fillRect(0,b.start,width,b.size);
}
// Reads the areas in order and adds the text. Returns whether any text was read.
async function recognize(rects, continuing=false) {
  lock(true);stop();
  let workers=[];
  try {
    status('日本語OCRを準備しています…');
    const vertical=$('direction').value==='vertical';
    const areas=rects.map(r=>{
      const area=document.createElement('canvas');area.width=Math.round(r.width);area.height=Math.round(r.height);
      area.getContext('2d',{willReadFrequently:true}).drawImage(bitmap,r.x,r.y,r.width,r.height,0,0,area.width,area.height);
      if($('ruby').checked)eraseRuby(area,vertical);
      return area;
    });
    // Two workers read both pages of a spread at the same time.
    const count=Math.min(rects.length,navigator.hardwareConcurrency>1?2:1);
    workers=await Promise.all(Array.from({length:count},(_,k)=>Tesseract.createWorker(vertical?'jpn_vert':'jpn',1,{
      workerPath:chrome.runtime.getURL('vendor/worker.min.js'),
      corePath:chrome.runtime.getURL('vendor/core'),
      langPath:chrome.runtime.getURL('vendor/lang'),workerBlobURL:false,
      logger:m=>{if(!k)status(`OCR: ${m.status} ${Math.round((m.progress||0)*100)}%`);}
    })));
    await Promise.all(workers.map(w=>w.setParameters({tessedit_pageseg_mode:vertical?'5':'6',preserve_interword_spaces:'0'})));
    const texts=[];
    await Promise.all(workers.map(async(w,k)=>{for(let i=k;i<areas.length;i+=count)texts[i]=normalizeOcrText((await w.recognize(areas[i])).data.text);}));
    const text=texts.reduce((all,t)=>mergeOcrText(all,t),'');
    if(!text){status('文字を読み取れませんでした。範囲や組み方向を調整してください。');return false;}
    const appended=addText(text,continuing);
    status(continuing&&appended?`次のページを読み取り、末尾に追記しました（${rects.length}か所）。再生で続きから読めます。`:`${appended?'読み取り結果を末尾に追記しました':'読み取り完了'}。誤字や読み順を確認し、修正後に「文章を反映」を押してください。`);
    return true;
  } catch(e) {status(`OCRに失敗しました: ${e.message}。再試行、または文章を貼り付けてください。`);return false;}
  finally {await Promise.all(workers.map(w=>w.terminate().catch(()=>{})));lock(false);}
}
$('ocr').onclick=async()=>{
  if(busy||!bitmap)return;
  if(!crop||crop.width<12||crop.height<12){status('本文を含む広さで範囲を選択してください。');return;}
  const rect={...crop};
  if(await recognize([rect])){regions=freshPage?[rect]:[...regions,rect];freshPage=false;}
};
// Loads a capture handed over by the background script.
async function receive(key, continuing=false) {
  const name='capture:'+key, payload=(await chrome.storage.session.get(name))[name];
  await chrome.storage.session.remove(name);
  if(!payload){status('取り込みデータの有効期間が終了しました。元のタブで拡張アイコンを押してください。');return false;}
  if(payload.source){source=payload.source;$('nextPage').hidden=false;}
  if(payload.image)await loadImage(await (await fetch(payload.image)).blob(),continuing);
  if(payload.text)addText(payload.text,continuing);
  if(payload.error||!payload.text)status(payload.error||(regions.length?'前回と同じ範囲を選択しています。必要なら囲み直して、OCRを実行してください。':'本文を囲んでOCRを実行してください。'));
  return Boolean(payload.image);
}
$('nextPage').onclick=async()=>{
  if(busy||!source)return;
  lock(true);stop();status('次のページへ進めています…');
  let result;
  try{result=await chrome.runtime.sendMessage({type:'nextPage',...source,key:$('direction').value==='vertical'?'ArrowLeft':'ArrowRight'});}
  catch(e){result={error:`次のページを取り込めませんでした: ${e.message}`};}
  lock(false);
  if(!result?.key){status(result?.error||'次のページを取り込めませんでした。');return;}
  try{if(!await receive(result.key,true))return;}catch(e){status(`読み込みエラー: ${e.message}`);return;}
  if(regions.length)await recognize(regions,true);
  else status('次のページを取り込みました。本文を囲んでOCRを実行してください。');
};
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type!=='capture'||message.readerTabId!==tabId)return;
  sendResponse(true);
  if(busy){chrome.storage.session.remove('capture:'+message.key);status('処理中のため取り込みませんでした。終わってから、もう一度拡張アイコンを押してください。');return;}
  receive(message.key,true).catch(e=>status(`読み込みエラー: ${e.message}`));
});
async function init(){
  try {
    tabId=(await chrome.tabs.getCurrent())?.id;
    const {settings}=await chrome.storage.local.get('settings');
    if(settings){for(const id of ['speed','length','font','direction','mode'])if(settings[id]!=null)$(id).value=settings[id];if(settings.ruby!=null)$('ruby').checked=settings.ruby;$('card').style.fontSize=$('font').value+'px';$('length').disabled=rsvp();}
    const key=location.hash.slice(1);
    if(key){history.replaceState(null,'',location.pathname);await receive(key);}
    else status('文章を貼り付けるか、画像を開いてください。');
  }catch(e){status(`読み込みエラー: ${e.message}`);}
  render();
}
init();
