import QRCode from 'qrcode';
import jsQR from 'jsqr';
const PREFIX='FRIBENCH-AVALON-1:';
export async function encodePair(data) {
  const bytes=new TextEncoder().encode(JSON.stringify(data));
  const stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  const packed=new Uint8Array(await new Response(stream).arrayBuffer());
  let binary='';for(const n of packed)binary+=String.fromCharCode(n);
  return PREFIX+btoa(binary).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}
export async function decodePair(text,kind) {
  if(typeof text!=='string'||text.length>18000||!text.startsWith(PREFIX))throw new Error('这不是阿瓦隆连接码，请重新扫描。');
  try {
    let base=text.slice(PREFIX.length).replaceAll('-','+').replaceAll('_','/');while(base.length%4)base+='=';
    const bytes=Uint8Array.from(atob(base),c=>c.charCodeAt(0));
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const reader=stream.getReader();const chunks=[];let length=0;
    for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>60000){await reader.cancel();throw new Error();}chunks.push(value);}
    const out=new Uint8Array(length);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}
    const data=JSON.parse(new TextDecoder().decode(out));
    if(data.kind!==kind||typeof data.pairId!=='string'||typeof data.roomId!=='string'||typeof data.expires!=='number'||data.expires<Date.now()||data.expires>Date.now()+6*60000||typeof data.sdp!=='string'||data.sdp.length>40000)throw new Error();
    return data;
  }catch{throw new Error('连接码无效或已过期，请让房主重新生成。');}
}
export async function drawQR(canvas,text) {
  await QRCode.toCanvas(canvas,text,{width:560,margin:3,errorCorrectionLevel:'L',color:{dark:'#122029',light:'#ffffff'}});
}
export async function startScanner(video,onText,onError) {
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('当前浏览器不能使用相机，请改用连接文本。');
  const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});
  if(!video.isConnected){stream.getTracks().forEach(t=>t.stop());throw new Error('扫描窗口已关闭。');}
  video.srcObject=stream;video.playsInline=true;video.muted=true;try{await video.play();}catch(error){stream.getTracks().forEach(t=>t.stop());throw error;}
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});let stopped=false,timer;
  const stop=()=>{stopped=true;clearTimeout(timer);stream.getTracks().forEach(t=>t.stop());video.srcObject=null;};
  function tick(){if(stopped)return;if(!video.isConnected){stop();return;}try{if(video.readyState>=2){const ratio=Math.min(1,1200/video.videoWidth);canvas.width=Math.round(video.videoWidth*ratio);canvas.height=Math.round(video.videoHeight*ratio);ctx.drawImage(video,0,0,canvas.width,canvas.height);const result=jsQR(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,{inversionAttempts:'attemptBoth'});if(result){stop();onText(result.data);return;}}}catch(e){stop();onError(e);}timer=setTimeout(tick,140);}tick();return stop;
}
