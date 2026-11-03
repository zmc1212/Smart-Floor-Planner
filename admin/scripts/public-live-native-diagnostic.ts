/** One observational discriminator; no compile/navigation/input/session changes. */
import fs from 'node:fs';
import path from 'node:path';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { wechatideNativeClient } from './wechatide-native-client';
declare const wx: {getWindowInfo():{windowWidth:number;windowHeight:number};getAppBaseInfo():{SDKVersion:string}};
declare function getCurrentPages():Array<{route:string}>;
declare function getApp():Record<string,unknown>;
async function main(){
  const root=path.resolve('..'),output=path.resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)||'../tmp/public-live-package/native-metadata-discriminator');fs.mkdirSync(output,{recursive:true});
  const connection=JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8'));
  const release=await lockAssistantAcceptance(connection.DATABASE_URL);
  try{
    const project=path.join(root,'miniprogram'),cli=wechatideNativeClient(project,output);
    const fn=()=>{const w=wx.getWindowInfo(),a=wx.getAppBaseInfo();return {windowWidth:w.windowWidth,windowHeight:w.windowHeight,SDKVersion:a.SDKVersion,route:getCurrentPages().at(-1)?.route,controllers:Object.keys(getApp()).filter(k=>/^__qa/.test(k))};};
    const controllers=()=>({value:Object.keys(getApp()).filter(k=>/^__qa/.test(k))});
    const result=await cli.call('automation_evaluate',{project,fnSource:process.argv.includes('--controllers')?controllers.toString():fn.toString()});
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({at:new Date().toISOString(),action:'existing Stable automation_evaluate; maintained wx.getWindowInfo/getAppBaseInfo',result},null,2));console.log(JSON.stringify(result));
  }catch(e){const value={code:(e as NodeJS.ErrnoException).code,signal:(e as {signal?:unknown}).signal,error:e instanceof Error?e.message:String(e),stdout:(e as {stdout?:string}).stdout,stderr:(e as {stderr?:string}).stderr};fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify(value,null,2));console.error(JSON.stringify(value));process.exitCode=1;}
  finally{await release();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
