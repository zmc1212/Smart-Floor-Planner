// Explicit local deployment or read-only remote verification. Never implicitly
// start local Docker after the development dependencies have moved remotely.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {cameraDeployment, cameraTransport, inspectCameraEnvironment} from './construction-camera-environment.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'../tmp/cloud-camera');

export function storageArguments(args) {
 const options={};
 for(let i=0;i<args.length;i++){
  const key=args[i];assert.ok(['--context','--output','--check','--deploy-local'].includes(key),'Unknown storage option');
  assert.ok(!Object.hasOwn(options,key),'Duplicate storage option');
  if(key==='--check'||key==='--deploy-local')options[key]=true;
  else{assert.ok(args[i+1]&&!args[i+1].startsWith('--'),'Storage option requires a value');options[key]=args[++i];}
 }
 cameraDeployment(options['--context']);
 assert.ok(!!options['--check']!==!!options['--deploy-local'],'Choose read-only --check or explicit --deploy-local');
 if(options['--deploy-local'])assert.equal(options['--context'],'desktop-linux','Remote mode is read-only; maintain remote compose through SSH');
 if(options['--check'])assert.ok(options['--output'],'Use a new explicit output file for read-only evidence');
 return options;
}

async function main(args){
 const options=storageArguments(args),context=options['--context'];
 // This check happens before any capacity configuration write or compose call.
 cameraTransport(context);
 if(options['--check']){
  const output=path.resolve(options['--output']);
  const relative=path.relative(path.resolve(root,'../tmp'),output);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Evidence must stay in repository tmp');
  assert.ok(fs.existsSync(path.dirname(output))&&!fs.existsSync(output),'Use an existing private evidence directory and a new file');
  const storage=JSON.parse(fs.readFileSync(path.join(out,'storage.private.json'),'utf8'));
  const report=await inspectCameraEnvironment(context,storage);
  fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({context,recordingHostPath:report.recordingHostPath,physicalCapacityVerified:true,anonymous:401,output}));
  return;
 }
const docker=args=>cp.execFileSync('docker',['--context','desktop-linux',...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
const mounts=JSON.parse(docker(['inspect','--format','{{json .Mounts}}','wvp-stack-zlm-1']));
const media=mounts.find(m=>m.Destination==='/opt/media/www'&&m.Type==='volume'&&m.RW);
if(media?.Name!=='wvp-stack_media-data')throw Error('Refuse unknown media volume');
const recording=mounts.find(m=>m.Destination==='/opt/media/www/record');
if(recording&&(recording.Type!=='bind'||!recording.RW))throw Error('Refuse an unknown recording overlay');
// Docker Desktop's sparse VHD free space is not Windows host free space.
// A direct host recording mount makes the probe observe the physical drive.
if(process.platform==='win32'&&!recording)throw Error('Windows recording requires an approved host bind; Docker virtual free space is insufficient evidence');
const hostPath=source=>fs.realpathSync(process.platform==='win32'?source.replace(/^\/run\/desktop\/mnt\/host\/([a-z])\//i,(_all,drive)=>drive.toUpperCase()+':/'):source);
const recordingPath=recording?hostPath(recording.Source):null;
assert.equal(recordingPath?.replaceAll('\\','/').toLowerCase(),cameraDeployment(context).recordingHostPath.toLowerCase(),'Local deployment requires the approved F recording directory');
const host=recordingPath?fs.statfsSync(recordingPath,{bigint:true}):null;
fs.mkdirSync(out,{recursive:true});const privatePath=path.join(out,'storage.private.json');
const config=fs.existsSync(privatePath)?JSON.parse(fs.readFileSync(privatePath,'utf8')):{origin:'http://127.0.0.1:18082',token:randomBytes(32).toString('hex')};
if(config.origin!=='http://127.0.0.1:18082'||typeof config.token!=='string'||config.token.length<32)throw Error('Invalid local capacity configuration');
if(!fs.existsSync(privatePath))fs.writeFileSync(privatePath,JSON.stringify(config),{mode:0o600});
const compose=['--context','desktop-linux','compose','-f','docker-compose.camera-storage.yml'];
if(recordingPath)compose.push('-f','docker-compose.camera-storage.host.yml');
const build=cp.spawnSync('docker',[...compose,'up','-d','--build'],{
 cwd:root,env:{...process.env,CAMERA_STORAGE_TOKEN:config.token,CAMERA_MEDIA_VOLUME:media.Name,CAMERA_MEDIA_SERVER_ID:'wvp-zlm-01',...(recordingPath?{CAMERA_RECORDING_HOST_PATH:recordingPath}:{})},encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024
});
fs.writeFileSync(path.join(out,'storage-build.log'),(build.stdout||'')+(build.stderr||''));if(build.status!==0)throw Error('Capacity container build/start failed; see private local build log');
let sample;for(let n=0;n<20;n++){try{const response=await fetch(config.origin+'/storage',{headers:{Authorization:'Bearer '+config.token},signal:AbortSignal.timeout(2000)});if(response.ok){sample=await response.json();break;}}catch{}await new Promise(r=>setTimeout(r,1000));}
if(sample?.node!=='wvp-zlm-01'||BigInt(sample.totalBytes)<=0n)throw Error('Capacity probe did not read the media filesystem');
if((await fetch(config.origin+'/storage')).status!==401)throw Error('Probe must deny anonymous metrics');
const attached=JSON.parse(docker(['inspect','--format','{{json .Mounts}}','sfp-camera-storage-storage-1']));
if(!attached.some(m=>m.Name===media.Name&&m.Destination==='/media'&&m.RW===false))throw Error('Probe media mount must be read-only');
if(recordingPath){
 const overlay=attached.find(m=>m.Destination==='/media/record');
 if(overlay?.Type!=='bind'||overlay.RW!==false||hostPath(overlay.Source)!==recordingPath)throw Error('Probe and recorder must share the same physical host directory');
 if(BigInt(sample.totalBytes)!==host.blocks*host.bsize||BigInt(sample.availableBytes)>host.bavail*host.bsize+64n*1024n**2n)throw Error('Probe capacity does not match the physical Windows drive');
}
const image=docker(['inspect','--format','{{.Image}}','sfp-camera-storage-storage-1']);
const report={checkedAt:new Date().toISOString(),node:sample.node,mediaVolume:media.Name,recordingHostPath:recordingPath,physicalCapacityVerified:!!recordingPath,mountReadOnly:true,anonymous:401,image,totalBytes:sample.totalBytes,availableBytes:sample.availableBytes};
fs.writeFileSync(path.join(out,'storage-deployment.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
