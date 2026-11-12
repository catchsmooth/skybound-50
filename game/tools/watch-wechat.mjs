import {watch,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.resolve(root,'../wechat-game');
const cli=process.env.WECHAT_IDE_CLI||'D:/Tencent/微信web开发者工具/wechatide.cmd';
const refresh=process.argv.includes('--refresh');
let running=false,pending=false,timer,stopping=false;
function run(exe,args){return new Promise(resolve=>{const child=spawn(exe,args,{cwd:root,stdio:'inherit',windowsHide:true});child.on('error',error=>{console.error(error.message);resolve(1);});child.on('exit',code=>resolve(code??1));});}
async function build(){
  if(stopping)return;
  if(running){pending=true;return;}running=true;
  do{pending=false;
    console.log('[wechat-watch] Building source changes…');
    const code=await run(process.execPath,[path.join(root,'tools/build-wechat.mjs')]);
    if(code===0){
      console.log('[wechat-watch] Runtime ready',new Date().toLocaleTimeString());
      if(refresh&&existsSync(cli)){
        // This is the source-confirmed mini-game compile/restart action.
        // Receipt acknowledges dispatch, not readiness. Verify the actual #myCanvas,
        // not a possibly stale frontend simulator_screenshot composition.
        if(!stopping){
          const result=await run(process.execPath,[path.join(root,'tools/wechat-ide.mjs'),'simulator_refresh',JSON.stringify({project})]);
          if(result!==0)console.error('[wechat-watch] IDE compile dispatch failed; runtime built, check official CLI output.');
          else console.log('[wechat-watch] Compile dispatched; simulator restarts after loading.');
        }
      }
    }else console.error('[wechat-watch] Build failed; no IDE compile dispatched. Check diagnostics before retrying.');
  }while(pending&&!stopping);
  running=false;
}
const watcher=watch(path.join(root,'src'),{recursive:true},(_event,file)=>{
  if(!file||!file.toString().endsWith('.ts'))return;
  clearTimeout(timer);timer=setTimeout(build,250);
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;clearTimeout(timer);watcher.close();});
console.log('[wechat-watch] Watching game/src; output = existing wechat-game/runtime');
console.log('[wechat-watch] Does not overwrite AppID/config. '+(refresh?'Official IDE refresh enabled.':'IDE file watcher handles runtime changes.'));
if(!process.argv.includes('--no-initial'))await build();
