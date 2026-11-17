const path=require('node:path');
const lib=path.resolve('Codex-config/redstar/lib');
const {google}=require(path.join(lib,'deps'))('googleapis');
const auth=require(path.join(lib,'gsheets')).getUserAuth();
const drive=google.drive({version:'v3',auth});
const f=require('./state.json');
(async()=>{
 const options={fileId:f.id,supportsAllDrives:true};
 let perms=(await drive.permissions.list({...options,fields:'permissions(id,type,role,allowFileDiscovery)'})).data.permissions;
 if(!perms.some(p=>p.type==='anyone' && p.role==='commenter')) {
  const p=perms.find(p=>p.type==='anyone');
  if(p) await drive.permissions.update({...options,permissionId:p.id,requestBody:{role:'commenter',allowFileDiscovery:false}});
  else await drive.permissions.create({...options,requestBody:{type:'anyone',role:'commenter',allowFileDiscovery:false}});
 }
 perms=(await drive.permissions.list({...options,fields:'permissions(type,role,allowFileDiscovery)'})).data.permissions;
 const r=await fetch(f.webViewLink.replace('/edit?usp=drivesdk','/export/pdf'));
 console.log(JSON.stringify({perms,anonymousPdfStatus:r.status,type:r.headers.get('content-type'),pdf:Buffer.from(await r.arrayBuffer()).subarray(0,5).toString()==='%PDF-'}));
})().catch(e=>{console.error(e.response?.data?.error?.message||e.message);process.exitCode=1});
