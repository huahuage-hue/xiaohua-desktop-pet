'use strict';
/* 静态合成预览：原图层 + 替换层 + 配饰层，按渲染顺序叠加（不含动态） */
const {fs,path,P,ROOT,IW,IH}=require('./common.js');
const D=path.join(ROOT,'psd/raw/wardrobe/worn');
const src=fs.readFileSync(path.join(ROOT,'assets/xiaohua_layers.js'),'utf8');const sb={};sb.window=sb;new Function('window',src)(sb);
const pages=sb.XH_ATLAS.map(u=>P.decodePNG(Buffer.from(u.split(',')[1],'base64')));
const meta=sb.XH_LAYERS.layers;
const sets=process.argv[2].split(';'); /* 每组：outfit|acc1,acc2 */
const ZB={scarf:'Hand_R',fur:'Hand_R',bag:'Hand_R',cloudpin:'Hand_R',charm:'Face',flower:'Ahoge',ribbon:'Ahoge',glasses:'Hair_Side_R',lantern:'Ahoge',heart:'Ahoge',knot:'Face',sachet:'Face',bell:'Face',bunny:'Ahoge',witch:'Ahoge',antler:'Ahoge'};
const CR=(process.argv[4]||'0,0,1200,2133').split(',').map(Number),S=+(process.argv[5]||0.4),cw=Math.round(CR[2]*S),ch=Math.round(CR[3]*S),out=Buffer.alloc(cw*sets.length*ch*4);
sets.forEach((set,n)=>{
 const [of,accs]=set.split('|'); const acc=(accs||'').split(',').filter(Boolean);
 const buf=new Float32Array(IW*IH*3).fill(0); for(let i=0;i<IW*IH;i++){buf[i*3]=120;buf[i*3+1]=165;buf[i*3+2]=215;}
 const draw=(L,get)=>{for(let y=0;y<L.h;y++)for(let x=0;x<L.w;x++){const p=get(x,y);if(!p||!p[3])continue;const a=p[3]/255,i=((L.y+y)*IW+L.x+x)*3;for(let c=0;c<3;c++)buf[i+c]=buf[i+c]*(1-a)+p[c]*a;}};
 const png=(f)=>{const im=P.decodePNG(fs.readFileSync(f));return (x,y)=>{const q=(y*im.width+x)*4;return [im.rgba[q],im.rgba[q+1],im.rgba[q+2],im.rgba[q+3]];};};
 const wj=JSON.parse(fs.readFileSync(path.join(D,'worn.json'),'utf8'));
 for(const L of meta){
  if(L.hidden||L.id==='Misc'||L.prop) continue;
  for(const a of acc) if(ZB[a]===L.id){const e=wj[a];draw(e,png(path.join(D,a+'.png')));}
  if(acc.includes('cloudpin')&&L.id==='Brooch')continue;
  const rf=path.join(D,`${of}__${L.id}.png`);
  if(of&&of!=='classic'&&fs.existsSync(rf)){draw(L,png(rf));continue;}
  const pg=pages[L.page];draw(L,(x,y)=>{const q=((L.v+y)*pg.width+L.u+x)*4;return [pg.rgba[q],pg.rgba[q+1],pg.rgba[q+2],pg.rgba[q+3]];});
 }
 for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){const i=((CR[1]+Math.floor(y/S))*IW+CR[0]+Math.floor(x/S))*3,o=(y*cw*sets.length+n*cw+x)*4;out[o]=buf[i];out[o+1]=buf[i+1];out[o+2]=buf[i+2];out[o+3]=255;}
});
fs.writeFileSync(process.argv[3],P.encodePNG(cw*sets.length,ch,out));