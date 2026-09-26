import {test} from 'node:test';
import assert from 'node:assert/strict';
import {segmentJapanese,displayDelay,cropRect,normalizeOcrText,mergeOcrText} from './segment.mjs';
test('preserves Japanese text, punctuation and supplementary characters',()=>{
 for(const text of ['今日は晴れです。明日はどうでしょう？','「物語」を読む。𠮷野家と🍵。','長い文章を少しずつ読み進めるために、画面に表示します。']){
  const cards=segmentJapanese(text,8);assert.equal(cards.join(''),text);assert.ok(cards.every(c=>! /^[、。！？]/.test(c)));
 }
});
test('empty input produces no cards',()=>assert.deepEqual(segmentJapanese(' \n '),[]));
test('sentence stops and selected speed affect reading time',()=>{assert.ok(displayDelay('これは。')>displayDelay('これはね'));assert.ok(displayDelay('文章',300)>displayDelay('文章',600));});
test('crop is normalized for reverse dragging and clamped to image',()=>{assert.deepEqual(cropRect({x:80,y:70},{x:-10,y:5},100,60),{x:0,y:5,width:80,height:55});});

test('OCR removes Japanese spacing while preserving English word boundaries',()=>{
 assert.equal(normalizeOcrText('今日 は 晴れ で す 。\nHello world'), '今日は晴れです。\nHello world');
 assert.equal(normalizeOcrText('しまう (このところ小生の蛇足 ) という話\nsee (page 2)'), 'しまう(このところ小生の蛇足)という話\nsee (page 2)');
});
test('line wraps inside Japanese words do not leave spaces; blank lines start a new card',()=>{
 const cards=segmentJapanese('花の下を歩いて絶景だの春ランマンだのと浮か\nれて陽気になります。スマー\nトフォン\n\n見出し\n\n本文です。',12);
 assert.ok(cards.every(c=>!/\s/.test(c)));
 assert.equal(cards.join(''),'花の下を歩いて絶景だの春ランマンだのと浮かれて陽気になります。スマートフォン見出し本文です。');
 assert.deepEqual(cards.slice(-2),['見出し','本文です。']);
 assert.deepEqual(segmentJapanese('Hello\nworld と日本語',24),['Hello world と日本語']);
});
test('OCR results are appended to existing text unless replacing is chosen',()=>{
 assert.equal(mergeOcrText('右ページの終わりで小','説が続く。'),'右ページの終わりで小\n説が続く。');
 assert.equal(segmentJapanese(mergeOcrText('右ページの終わりで小','説が続く。'),40)[0],'右ページの終わりで小説が続く。');
 assert.equal(mergeOcrText('前の文章','新しい文章',false),'新しい文章');
 assert.equal(mergeOcrText('','新しい文章'),'新しい文章');
 assert.equal(mergeOcrText('前の文章',''),'前の文章');
});
