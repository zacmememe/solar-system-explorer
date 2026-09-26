/** Static source-sample refinement. One indexed surface, no overlapping patch or LOD switch. */
export interface LocalRefinement {
  outer: {x0:number; y0:number; x1:number; y1:number}; // original coarse-grid coordinates
  core: {x0:number; y0:number; dx:number; dy:number; cols:number; rows:number; offset:number};
  bandTriangles:number[];
  bandCells:Record<string,number[]>;
}
interface Input {
  positions:Float64Array; uvs:Float32Array; indices:number[];
  cols:number; rows:number; stepX:number; stepY:number;
  centerX:number; centerY:number; halfSamples:number;
  vertex:(x:number,y:number)=>{position:[number,number,number];uv:[number,number]}|null;
}
export function refineTerrainGrid(input:Input) {
  const {cols,rows,stepX,stepY,vertex}=input;
  const half=Math.floor(input.halfSamples), cx=Math.round(input.centerX), cy=Math.round(input.centerY);
  const x0=cx-half,x1=cx+half,y0=cy-half,y1=cy+half;
  const ox0=Math.floor((x0-1)/stepX),ox1=Math.ceil((x1+1)/stepX);
  const oy0=Math.floor((y0-1)/stepY),oy1=Math.ceil((y1+1)/stepY);
  if(half<1 || ![cx,cy,half].every(Number.isFinite) || ox0<0 || oy0<0 || ox1>=cols || oy1>=rows)return null;
  const size=half*2+1, offset=cols*rows;
  const positions=Array.from(input.positions),uvs=Array.from(input.uvs);
  // Validate all samples before any caller-owned buffer is touched.
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const v=vertex(x,y);
    if(!v || ![...v.position,...v.uv].every(Number.isFinite))return null;
    positions.push(...v.position);uvs.push(...v.uv);
  }
  const indices:number[]=[];
  for(let j=0;j<rows-1;j++)for(let i=0;i<cols-1;i++){
    if(i>=ox0&&i<ox1&&j>=oy0&&j<oy1)continue;
    const start=(j*(cols-1)+i)*6;
    indices.push(...input.indices.slice(start,start+6));
  }
  for(let y=0;y<size-1;y++)for(let x=0;x<size-1;x++){
    const a=offset+y*size+x,b=a+1,c=a+size,d=c+1;
    indices.push(a,c,b,b,c,d);
  }
  const refinement:LocalRefinement={outer:{x0:ox0,y0:oy0,x1:ox1,y1:oy1},
    core:{x0:x0/stepX,y0:y0/stepY,dx:1/stepX,dy:1/stepY,cols:size,rows:size,offset},bandTriangles:[],bandCells:{}};
  const coord=(id:number):[number,number]=>id<offset ? [id%cols,Math.floor(id/cols)]
    : [(x0+(id-offset)%size)/stepX,(y0+Math.floor((id-offset)/size))/stepY];
  function bandTriangle(a:number,b:number,c:number){
    const [ax,ay]=coord(a),[bx,by]=coord(b),[cx,cy]=coord(c);
    const cross=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
    if(Math.abs(cross)<1e-12)throw new Error('Degenerate terrain transition triangle');
    if(cross>0)[b,c]=[c,b]; // same outward winding as the source grid
    const index=refinement.bandTriangles.length;
    refinement.bandTriangles.push(a,b,c);indices.push(a,b,c);
    for(let y=Math.floor(Math.min(ay,by,cy));y<=Math.min(rows-2,Math.floor(Math.max(ay,by,cy)));y++)
      for(let x=Math.floor(Math.min(ax,bx,cx));x<=Math.min(cols-2,Math.floor(Math.max(ax,bx,cx)));x++)
        (refinement.bandCells[`${x},${y}`]??=[]).push(index);
  }
  // Two ordered edge chains. Equal parameters advance each chain once; corner indices are shared.
  function connect(outer:number[],inner:number[]){
    let a=0,b=0;
    while(a<outer.length-1 || b<inner.length-1){
      const ta=a<outer.length-1?(a+1)/(outer.length-1):Infinity;
      const tb=b<inner.length-1?(b+1)/(inner.length-1):Infinity;
      if(ta<=tb){bandTriangle(outer[a],outer[a+1],inner[b]);a++;}
      else {bandTriangle(outer[a],inner[b+1],inner[b]);b++;}
    }
  }
  const horizontal=(y:number)=>Array.from({length:ox1-ox0+1},(_,i)=>y*cols+ox0+i);
  const vertical=(x:number)=>Array.from({length:oy1-oy0+1},(_,j)=>(oy0+j)*cols+x);
  connect(horizontal(oy0),Array.from({length:size},(_,i)=>offset+i));
  connect(horizontal(oy1),Array.from({length:size},(_,i)=>offset+(size-1)*size+i));
  connect(vertical(ox0),Array.from({length:size},(_,j)=>offset+j*size));
  connect(vertical(ox1),Array.from({length:size},(_,j)=>offset+j*size+size-1));
  return {positions:Float64Array.from(positions),uvs:Float32Array.from(uvs),indices,refinement};
}
