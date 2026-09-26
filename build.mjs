import {cp,mkdir,readdir,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname);
const src=p=>path.join(root,p);
await rm(src('dist'),{recursive:true,force:true});
await mkdir(src('dist'),{recursive:true});
for(const file of ['manifest.json','background.js','reader.html','reader.js','reader.css','segment.mjs'])await copyFile(src(file),src('dist/'+file));
await mkdir(src('dist/vendor/core'),{recursive:true});
await mkdir(src('dist/vendor/lang'),{recursive:true});
await mkdir(src('dist/licenses'),{recursive:true});
for(const file of ['tesseract.min.js','worker.min.js'])await copyFile(src('node_modules/tesseract.js/dist/'+file),src('dist/vendor/'+file));
for(const file of await readdir(src('node_modules/tesseract.js-core'))){
  if(/^tesseract-core.*\.(wasm|js)$/.test(file))await copyFile(src('node_modules/tesseract.js-core/'+file),src('dist/vendor/core/'+file));
}
for(const lang of ['jpn','jpn_vert']){
  await copyFile(src(`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`),src(`dist/vendor/lang/${lang}.traineddata.gz`));
}
for(const name of ['tesseract.js','tesseract.js-core','@tesseract.js-data/jpn','@tesseract.js-data/jpn_vert']){
  for(const file of await readdir(src('node_modules/'+name))){
    if(/^(LICENSE|NOTICE)/i.test(file))await copyFile(src('node_modules/'+name+'/'+file),src('dist/licenses/'+name.replaceAll('/','-')+'-'+file));
  }
}
for(const file of ['LICENSE','PRIVACY.md','THIRD_PARTY_NOTICES.md'])await copyFile(src(file),src('dist/'+file));
console.log('Built dist/: load this directory as an unpacked Chrome/Edge extension.');
