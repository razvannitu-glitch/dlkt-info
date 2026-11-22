export interface PhotoRaster {readonly mime:'image/jpeg'|'image/png'|'image/webp';readonly width:number;readonly height:number}
const valid=(mime:PhotoRaster['mime'],width:number,height:number):PhotoRaster|null=>
 Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>=240&&height>=120&&width<=8000&&height<=8000&&width*height<=24_000_000?{mime,width,height}:null;
/** Inspect raster magic and dimensions, independently of HTTP headers; SVG/HTML cannot pass. */
export function inspectPhotoRaster(bytes:Uint8Array):PhotoRaster|null {
 const data=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(data.length<30)return null;
 if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&data.toString('ascii',12,16)==='IHDR')
  return valid('image/png',data.readUInt32BE(16),data.readUInt32BE(20));
 if(data[0]===255&&data[1]===216){
  let offset=2,segments=0;
  while(offset+4<=data.length&&segments++<512){
   if(data[offset]!==255)return null;
   while(data[offset]===255)offset++;
   const marker=data[offset++];if(marker===undefined||marker===218||marker===217)return null;
   if(marker===216||marker===1||marker>=208&&marker<=215)continue;
   if(offset+2>data.length)return null;const length=data.readUInt16BE(offset);
   if(length<2||offset+length>data.length)return null;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
    if(length<8)return null;return valid('image/jpeg',data.readUInt16BE(offset+5),data.readUInt16BE(offset+3));
   }
   offset+=length;
  }
  return null;
 }
 if(data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP'&&data.readUInt32LE(4)+8===data.length){
  const kind=data.toString('ascii',12,16);
  if(kind==='VP8X')return valid('image/webp',1+data.readUIntLE(24,3),1+data.readUIntLE(27,3));
  if(kind==='VP8 '&&data[23]===157&&data[24]===1&&data[25]===42)return valid('image/webp',data.readUInt16LE(26)&16383,data.readUInt16LE(28)&16383);
  if(kind==='VP8L'&&data[20]===47){const bits=data.readUInt32LE(21);return valid('image/webp',(bits&16383)+1,((bits>>>14)&16383)+1);}
 }
 return null;
}
