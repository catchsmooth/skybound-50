import ts from 'typescript';
import { mkdir, copyFile } from 'node:fs/promises';
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, '.');
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {getCanonicalFileName:f=>f,getCurrentDirectory:ts.sys.getCurrentDirectory,getNewLine:()=> '\n'}));
  process.exit(1);
}
program.emit();
await mkdir('dist', {recursive:true});
for (const file of ['index.html','styles.css','favicon.svg']) await copyFile(file, `dist/${file}`);
console.log('Built Skybound 50 0.4.0 → dist/');
