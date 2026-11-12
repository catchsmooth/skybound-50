// Small adapter to the locally installed OFFICIAL CLI. No tokens or credentials are read.
import {spawnSync} from 'node:child_process';
const [tool,json='{}']=process.argv.slice(2);
if(!tool)throw Error('Usage: node tools/wechat-ide.mjs <official_tool_name> <JSON arguments>');
const input=JSON.parse(json);
const cli=process.env.WECHAT_IDE_CLI||'D:/Tencent/微信web开发者工具/wechatide.cmd';
const args=['-c','Codex',tool];
for(const [key,value]of Object.entries(input)){
  args.push('--'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()));
  args.push(typeof value==='object'?JSON.stringify(value):String(value));
}
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const result=spawnSync('powershell.exe',['-NoProfile','-Command','& '+[cli,...args].map(quote).join(' ')],{encoding:'utf8',timeout:15000,windowsHide:true});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
if(result.error)throw result.error;
let code=result.status??1;
try{const receipt=JSON.parse(result.stdout);if(receipt.ok===false||receipt.result?.success===false||receipt.result?.status==='pending')code=1;}catch{if(!result.stdout?.trim())code=1;}
process.exitCode=code;
