'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Space } from 'antd';

type HlsInstance={loadSource:(src:string)=>void;attachMedia:(video:HTMLVideoElement)=>void;destroy:()=>void;on:(event:string,fn:()=>void)=>void};
type HlsConstructor={new(options:Record<string,unknown>):HlsInstance;isSupported:()=>boolean;Events:{ERROR:string}};
let loader:Promise<HlsConstructor>|undefined;
function hls():Promise<HlsConstructor>{
  if(!loader)loader=new Promise<HlsConstructor>((resolve,reject)=>{
    const current=(window as unknown as {Hls?:HlsConstructor}).Hls;if(current){resolve(current);return;}
    const s=document.createElement('script');s.src='/construction-camera/vendor/hls-1.6.13.js';s.onload=()=>{
      const value=(window as unknown as {Hls?:HlsConstructor}).Hls;if(value)resolve(value);else reject(Error());
    };s.onerror=reject;document.head.appendChild(s);
  }).catch(error=>{loader=undefined;throw error;});
  return loader!;
}
export function PublicLiveVideo({url,onFailure}:{url:string;onFailure:()=>void}){
  const video=useRef<HTMLVideoElement>(null),[paused,setPaused]=useState(false),[playing,setPlaying]=useState(false);
  useEffect(()=>{
    const v=video.current;if(!v||!url)return;let active=true,player:HlsInstance|undefined;
    if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=url;void v.play().catch(()=>{if(active)onFailure();});}
    else void hls().then(Hls=>{if(!active)return;if(!Hls.isSupported()){onFailure();return;}player=new Hls({enableWorker:true,backBufferLength:0,maxBufferLength:4});player.on(Hls.Events.ERROR,()=>{if(active)onFailure();});player.loadSource(url);player.attachMedia(v);void v.play().catch(()=>{if(active)onFailure();});}).catch(()=>{if(active)onFailure();});
    return()=>{active=false;v.pause();v.removeAttribute('src');v.load();player?.destroy();};
  },[url,onFailure]);
  return <div><div style={{aspectRatio:'16 / 9',position:'relative',background:'#172b25'}}>
    <video ref={video} autoPlay muted playsInline disablePictureInPicture controlsList="nodownload noremoteplayback" onPlaying={()=>{setPlaying(true);setPaused(false);}} onError={onFailure} style={{width:'100%',height:'100%',objectFit:'contain'}}/>
    {!playing&&<div style={{position:'absolute',inset:0,display:'grid',placeItems:'center',color:'#fff'}}>正在连接直播</div>}
  </div><Space style={{marginTop:8}}><Button onClick={()=>{const v=video.current;if(!v)return;if(v.paused){void v.play();setPaused(false);}else{v.pause();setPaused(true);}}}>{paused?'继续观看':'暂停'}</Button><Button onClick={()=>{void video.current?.requestFullscreen();}}>全屏</Button><span>实时 · 无声</span></Space>
    <Alert style={{marginTop:8}} type="info" message="仅供授权预览，尚未公开；没有回放、抓拍和云台控制。"/>
  </div>;
}
