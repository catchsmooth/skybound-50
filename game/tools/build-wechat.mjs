import ts from 'typescript';
import path from 'node:path';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const config=ts.readConfigFile(path.join(root,'tsconfig.json'),ts.sys.readFile);
if(config.error)throw Error(ts.flattenDiagnosticMessageText(config.error.messageText,'\n'));
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root);
const options={...parsed.options,module:ts.ModuleKind.CommonJS,moduleResolution:ts.ModuleResolutionKind.Node10,
  target:ts.ScriptTarget.ES2019,sourceMap:false,outDir:path.resolve(root,'../wechat-game/runtime')};
const program=ts.createProgram([path.join(root,'src/wechat/main.ts')],options);
const diagnostics=ts.getPreEmitDiagnostics(program);
if(diagnostics.length){console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));process.exit(1);}
const emitted=program.emit();if(emitted.emitSkipped)throw Error('WeChat runtime emission skipped');
// Update the actual game entry LAST, after all emitted modules are complete.
// Publish a diagnostic build ID only after module emission; verify readiness from the live canvas.
const buildId=new Date().toISOString();
writeFileSync(path.resolve(root,'../wechat-game/game.js'),`// Generated WeChat 0.5.0 entry; build ${buildId}\nconsole.info('[Skybound build]', ${JSON.stringify(buildId)});\nrequire('./runtime/wechat/main.js');\n`);
console.log(`Built WeChat 0.5.0 Canvas runtime -> wechat-game/runtime (${buildId}; project AppID/config preserved)`);
