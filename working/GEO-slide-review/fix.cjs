const path=require('node:path');
const lib=path.resolve('Codex-config/redstar/lib');
const {google}=require(path.join(lib,'deps'))('googleapis');
const auth=require(path.join(lib,'gsheets')).getUserAuth();
const drive=google.drive({version:'v3',auth});
const slides=google.slides({version:'v1',auth});
const file=require('./state.json');
(async()=>{
 const p=await slides.presentations.get({presentationId:file.id});
 console.log(JSON.stringify(p.data.slides[0].pageElements.map(e=>[e.objectId,e.shape?.shapeProperties?.contentAlignment,e.shape?.text?.textElements?.map(t=>t.textRun?.content).filter(Boolean).join('').slice(0,70)])));
 const requests=p.data.slides.flatMap((s,i)=>{
  const old=s.pageElements[0];
  const title=old.shape.text.textElements.map(t=>t.textRun?.content||'').join('').trim();
  const id='review_section_'+i;
  return [
   {deleteObject:{objectId:old.objectId}},
   {createShape:{objectId:id,shapeType:'RECTANGLE',elementProperties:{pageObjectId:s.objectId,
      size:{width:{magnitude:960,unit:'PT'},height:{magnitude:35,unit:'PT'}},
      transform:{scaleX:1,scaleY:1,translateX:0,translateY:0,unit:'PT'}}}},
   {updateShapeProperties:{objectId:id,shapeProperties:{contentAlignment:'MIDDLE',outline:{propertyState:'NOT_RENDERED'},
      shapeBackgroundFill:{solidFill:{color:{rgbColor:{red:41/255,green:38/255,blue:59/255}},alpha:1}}},
      fields:'contentAlignment,outline,shapeBackgroundFill'}},
   {insertText:{objectId:id,text:title}},
   {updateTextStyle:{objectId:id,textRange:{type:'ALL'},style:{fontFamily:'Arial',bold:true,fontSize:{magnitude:13,unit:'PT'},
      foregroundColor:{opaqueColor:{rgbColor:{red:1,green:1,blue:1}}}},fields:'fontFamily,bold,fontSize,foregroundColor'}},
   {updateParagraphStyle:{objectId:id,textRange:{type:'ALL'},style:{indentStart:{magnitude:30,unit:'PT'},indentFirstLine:{magnitude:30,unit:'PT'},spaceAbove:{magnitude:0,unit:'PT'},spaceBelow:{magnitude:0,unit:'PT'}},fields:'indentStart,indentFirstLine,spaceAbove,spaceBelow'}}
  ];
 });
 await slides.presentations.batchUpdate({presentationId:file.id,requestBody:{requests,writeControl:{requiredRevisionId:p.data.revisionId}}});
 const updated=await drive.files.export({fileId:file.id,mimeType:'application/pdf'},{responseType:'arraybuffer'});
 require('node:fs').writeFileSync(path.join(__dirname,'review.pdf'),Buffer.from(updated.data));
})().catch(e=>{console.error(e.response?.data?.error?.message||e.message);process.exitCode=1});


