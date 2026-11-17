const fs = require('node:fs');
const path = require('node:path');
const home = process.env.USERPROFILE;
const packageRoot = path.join(home,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const pptxgen = require(path.join(packageRoot,'pptxgenjs'));
const lib = path.resolve('Codex-config/redstar/lib');
const { google } = require(path.join(lib,'deps'))('googleapis');
const auth = require(path.join(lib,'gsheets')).getUserAuth();
const drive = google.drive({version:'v3', auth});
const dir = __dirname;
const source = JSON.parse(fs.readFileSync(path.join(dir,'source.json'),'utf8').replace(/^\uFEFF/,''));
const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.title = 'GEO Redstar — продукт и процесс';
const readable = s => s.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&quot;/g,'"').trim();
const parts = c => {
  const heading = c.html.match(/<div[^>]*>(.*?)<\/div>/s);
  return {title:readable(heading[1]), bullets:[...c.html.matchAll(/<li[^>]*>(.*?)<\/li>/gs)].map(m=>readable(m[1])),
    notes:[...c.html.slice(heading[0].length).matchAll(/<div[^>]*>(.*?)<\/div>/gs)].map(m=>readable(m[1]))};
};
const outline = [
 [0,'Что продаём и кому подходит',['value','audience']],
 [0,'Задачи и результат для клиента',['requests','outcome']],
 [0,'Как проверяем ответы ИИ',['diagnosis','promise']],
 [0,'Работы на сайте',['site']],
 [0,'Работы на внешних площадках',['external']],
 [1,'От вводных к плану',['brief','baseline','plan']],
 [1,'От правок к ежемесячному отчёту',['delivery','measure','report']],
 [1,'Что храним по проекту',['record']],
 [2,'Два тарифа',['geo','combo']],
 [2,'Что согласуем до старта',['scope','limits']],
 [2,'Проверки и материалы для продаж',['entry','proof']]
];
const palette = {'E7EFFA':'1B4976','E8F3E9':'26573B','F0E9F8':'563B78'};
function card(slide,c,x,y,w,h,step){
 const p=parts(c);
 const runs = [{text:(step ? step + '. ' : '') + p.title,options:{bold:true,fontSize:20,color:palette[c.fill] || '26573B',breakLine:true}}];
 const lines = [...p.bullets.map(text=>({text:'•  '+text})), ...p.notes.map(text=>({text}))];
 for (const [i,l] of lines.entries()) runs.push({text:l.text,options:{breakLine:i<lines.length-1,fontSize:17}});
 slide.addText(runs,{x,y,w,h,margin:[17,19,15,19],valign:'top',fontFace:'Arial',color:'262338',
  paraSpaceAfter:9,fill:{color:c.fill},line:{transparency:100},rectRadius:0.12});
}
for (const [section,heading,ids] of outline) {
 const p=source[section];
 const slide=pptx.addSlide();
 slide.background={color:'FFFFFF'};
 slide.addText(p.name.toUpperCase(),{x:0,y:0,w:13.333,h:0.48,margin:[1,38,0,38],fill:{color:'29263B'},color:'FFFFFF',fontFace:'Arial',fontSize:13,bold:true});
 slide.addText(heading,{x:.52,y:.68,w:12.25,h:.63,margin:0,fontFace:'Arial',fontSize:31,color:'29263B',bold:true});
 const steps = {brief:1,baseline:2,plan:3,delivery:4,measure:5,report:6};
 ids.forEach((id,i)=>{
   const n=ids.length;
   const w=n===1?12.28:n===2?6.01:3.92;
   card(slide,p.cards[id],.52+i*(w+.26),1.57,w,n===3?4.93:n===2?4.8:5.18,steps[id]);
 });
}
(async()=>{
 const ppt=path.join(dir,'geo-review.pptx');
 await pptx.writeFile({fileName:ppt});
 const found=await drive.files.list({q:"trashed=false and mimeType='application/vnd.google-apps.folder' and (name='3 GEO: продукт и аналитика' or name contains '3 GEO: продукт и аналитика')",fields:'files(id,name),nextPageToken'});
 const folder=found.data.files.length===1 ? found.data.files[0] : null;
 const statePath=path.join(dir,'state.json');
 let file=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):null;
 if(!file){
  const metadata={name:pptx.title,mimeType:'application/vnd.google-apps.presentation'};
  if(folder) metadata.parents=[folder.id];
  const made= await drive.files.create({requestBody:metadata, media:{
   mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',body:fs.createReadStream(ppt)},fields:'id,name,parents,webViewLink,mimeType'});
  file=made.data;
  fs.writeFileSync(statePath,JSON.stringify(file));
 }
 const pdf=await drive.files.export({fileId:file.id,mimeType:'application/pdf'},{responseType:'arraybuffer'});
 fs.writeFileSync(path.join(dir,'review.pdf'),Buffer.from(pdf.data));
 console.log(JSON.stringify({file,folder,slides:outline.length}));
})().catch(error=>{console.error(error.response?.data?.error?.message || error.message);process.exitCode=1});
