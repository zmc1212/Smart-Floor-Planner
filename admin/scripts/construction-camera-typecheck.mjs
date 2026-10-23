import ts from 'typescript';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const configPath = path.join(root, 'tsconfig.json');
const config = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, root);
const files = [
  'src/lib/construction/camera/wvp.ts','src/lib/construction/camera/service.ts','src/lib/construction/camera/http.ts','src/lib/construction/camera/ptz.ts','src/lib/construction/camera/media.ts',
  'src/lib/construction/camera/__tests__/adapter.test.ts','src/lib/construction/camera/__tests__/storage.test.ts','src/db/__tests__/construction-camera.test.ts','src/db/construction-camera-schema.ts',
  'src/components/construction/camera-panel.tsx','src/app/api/construction-camera/[[...path]]/route.ts','src/app/construction-camera/route.ts',
  'scripts/construction-camera-gateway.ts','scripts/construction-camera-fixture.ts','scripts/construction-camera-recording-live.ts','scripts/construction-camera-retention-live.ts','scripts/construction-camera-recovery-live.ts','scripts/construction-camera-storage-live.ts','scripts/construction-camera-soak.ts','scripts/construction-camera-soak-control.ts','src/db/__tests__/construction-recordings.test.ts',
  'src/lib/construction/camera-capacity.ts','src/lib/construction/recording-capacity.ts','src/components/construction/recording-capacity-preview.tsx','src/app/api/construction/video-capacity/projects/[projectId]/bindings/[bindingId]/route.ts','src/db/__tests__/construction-camera-capacity.test.ts','src/lib/construction/__tests__/recording-capacity.test.ts',
  'scripts/construction-camera-capacity-http.ts',
];
const program = ts.createProgram(files.map(f=>path.join(root,f)),{...config.options,incremental:false,noEmit:true,target:ts.ScriptTarget.ES2022});
const diagnostics = ts.getPreEmitDiagnostics(program);
console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
console.log(JSON.stringify({files:files.length,errors:diagnostics.length})); process.exitCode=diagnostics.length?1:0;
