import {segmentJapanese, displayDelay, cropRect, normalizeOcrText} from './segment.mjs';
const $ = id => document.getElementById(id);
let cards = [], index = 0, timer = null, playing = false;
let bitmap = null, crop = null, anchor = null, busy = false;
const canvas = $('capture'), ctx = canvas.getContext('2d');
canvas.hidden = true;
function status(message) { $('status').textContent = message; }
function speed() { return Math.min(2400, Math.max(120, Number($('speed').value) || 600)); }
function render() {
  $('card').textContent = cards[index] || '読み始めましょう';
  $('context').textContent = cards.length ? cards.slice(Math.max(0,index-2),index).join('') : '文章を取り込んで「反映」を押してください';
  $('progressText').textContent = cards.length ? `${index+1} / ${cards.length}` : '0 / 0';
  $('position').max = Math.max(0,cards.length-1); $('position').value = index;
  $('play').textContent = playing ? '停止' : '再生';
}
function stop() { playing = false; clearTimeout(timer); render(); }
function tick() {
  clearTimeout(timer); render();
  if (!playing || !cards.length) return;
  timer = setTimeout(() => {
    if (index >= cards.length-1) { stop(); status('最後まで読みました。'); }
    else { index++; tick(); }
  }, displayDelay(cards[index],speed()));
}
function apply() {
  stop(); cards = segmentJapanese($('source').value, $('length').value); index=0; render();
  status(cards.length ? `${cards.length}枚に区切りました。再生で開始します。` : '読む文章を入力してください。');
}
$('apply').onclick=apply;
$('play').onclick=() => { if (!cards.length) apply(); if (!cards.length) return; playing=!playing; tick(); };
$('prev').onclick=()=>{stop();index=Math.max(0,index-1);render();};
$('next').onclick=()=>{stop();index=Math.min(Math.max(0,cards.length-1),index+1);render();};
$('restart').onclick=()=>{stop();index=0;render();};
$('position').oninput=()=>{stop();index=Number($('position').value);render();};
function saveSettings() {
  chrome.storage.local.set({settings:{speed:speed(),length:$('length').value,font:$('font').value,direction:$('direction').value}}).catch(()=>{});
}
$('speed').onchange=()=>{$('speed').value=speed();saveSettings();tick();};
$('length').onchange=()=>{saveSettings();apply();};
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
async function loadImage(blob) {
  if (blob.size>25*1024*1024) throw new Error('画像は25MB以下にしてください。');
  const next = await createImageBitmap(blob);
  if (next.width*next.height>40000000) {next.close();throw new Error('画像を4000万画素以下に縮小してください。');}
  bitmap?.close();bitmap=next;canvas.width=bitmap.width;canvas.height=bitmap.height;
  crop={x:0,y:0,width:bitmap.width,height:bitmap.height};canvas.hidden=false;$('noImage').hidden=true;$('ocr').disabled=false;draw();
}
function point(e) { const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}; }
canvas.onpointerdown=e=>{if(!bitmap||busy)return;anchor=point(e);canvas.setPointerCapture(e.pointerId);crop=cropRect(anchor,anchor,canvas.width,canvas.height);draw();};
canvas.onpointermove=e=>{if(!anchor)return;crop=cropRect(anchor,point(e),canvas.width,canvas.height);draw();};
canvas.onpointerup=()=>{anchor=null;};canvas.onpointercancel=()=>{anchor=null;};
$('resetCrop').onclick=()=>{if(bitmap&&!busy){crop={x:0,y:0,width:bitmap.width,height:bitmap.height};draw();}};
$('imageFile').onchange=async()=>{try{if($('imageFile').files[0]){await loadImage($('imageFile').files[0]);status('本文を囲んでOCRを実行してください。');}}catch(e){status(e.message);}};
$('clear').onclick=()=>{stop();cards=[];index=0;$('source').value='';bitmap?.close();bitmap=null;crop=null;canvas.width=0;canvas.height=0;canvas.hidden=true;$('noImage').hidden=false;$('ocr').disabled=true;$('imageFile').value='';render();status('文章と画像を消去しました。');};
$('ocr').onclick=async()=>{
  if(busy||!bitmap)return;
  if(!crop||crop.width<12||crop.height<12){status('本文を含む広さで範囲を選択してください。');return;}
  busy=true;stop();
  const locked=['ocr','clear','imageFile','resetCrop','direction'];locked.forEach(id=>$(id).disabled=true);
  let worker;
  try {
    const area=document.createElement('canvas');area.width=Math.round(crop.width);area.height=Math.round(crop.height);
    area.getContext('2d').drawImage(bitmap,crop.x,crop.y,crop.width,crop.height,0,0,area.width,area.height);
    status('日本語OCRを準備しています…');
    const vertical=$('direction').value==='vertical';
    worker=await Tesseract.createWorker(vertical?'jpn_vert':'jpn',1,{
      workerPath:chrome.runtime.getURL('vendor/worker.min.js'),
      corePath:chrome.runtime.getURL('vendor/core'),
      langPath:chrome.runtime.getURL('vendor/lang'),workerBlobURL:false,
      logger:m=>status(`OCR: ${m.status} ${Math.round((m.progress||0)*100)}%`)
    });
    await worker.setParameters({tessedit_pageseg_mode:vertical?'5':'6',preserve_interword_spaces:'0'});
    const {data}=await worker.recognize(area);
    $('source').value=normalizeOcrText(data.text);
    apply();
    status(data.text.trim()?'読み取り完了。誤字や読み順を確認し、修正後に「文章を反映」を押してください。':'文字を読み取れませんでした。範囲や組み方向を調整してください。');
  } catch(e) {status(`OCRに失敗しました: ${e.message}。再試行、または文章を貼り付けてください。`);}
  finally {if(worker)await worker.terminate().catch(()=>{});busy=false;locked.forEach(id=>$(id).disabled=false);$('ocr').disabled=!bitmap;}
};
async function init(){
  try {
    const {settings}=await chrome.storage.local.get('settings');
    if(settings){for(const id of ['speed','length','font','direction'])if(settings[id]!=null)$(id).value=settings[id];$('card').style.fontSize=$('font').value+'px';}
    const key=location.hash.slice(1);
    if(key){
      const name='capture:'+key, stored=await chrome.storage.session.get(name), payload=stored[name];
      await chrome.storage.session.remove(name);history.replaceState(null,'',location.pathname);
      if(payload){
        if(payload.image)await loadImage(await (await fetch(payload.image)).blob());
        if(payload.text){$('source').value=payload.text;apply();}
        else status(payload.error||'本文を囲んでOCRを実行してください。');
      }else status('取り込みデータの有効期間が終了しました。元のタブで拡張アイコンを押してください。');
    }else status('文章を貼り付けるか、画像を開いてください。');
  }catch(e){status(`読み込みエラー: ${e.message}`);}
  render();
}
init();
