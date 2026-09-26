import {test} from 'node:test';
import assert from 'node:assert/strict';
import {segmentJapanese,displayDelay,cropRect,normalizeOcrText} from './segment.mjs';
test('preserves Japanese text, punctuation and supplementary characters',()=>{
 for(const text of ['今日は晴れです。明日はどうでしょう？','「物語」を読む。𠮷野家と🍵。','長い文章を少しずつ読み進めるために、画面に表示します。']){
  const cards=segmentJapanese(text,8);assert.equal(cards.join(''),text);assert.ok(cards.every(c=>! /^[、。！？]/.test(c)));
 }
});
test('empty input produces no cards',()=>assert.deepEqual(segmentJapanese(' \n '),[]));
test('sentence stops and selected speed affect reading time',()=>{assert.ok(displayDelay('これは。')>displayDelay('これはね'));assert.ok(displayDelay('文章',300)>displayDelay('文章',600));});
test('crop is normalized for reverse dragging and clamped to image',()=>{assert.deepEqual(cropRect({x:80,y:70},{x:-10,y:5},100,60),{x:0,y:5,width:80,height:55});});

test('OCR removes Japanese spacing while preserving English word boundaries',()=>assert.equal(normalizeOcrText('今日 は 晴れ で す 。\nHello world'), '今日は晴れです。\nHello world'));
