// Local Docker Desktop only. Shares the existing media volume read-only.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {randomBytes} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'../tmp/cloud-camera');
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
