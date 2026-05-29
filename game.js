import * as THREE from 'three';

/* ============================================================
   COUP — 3D bluffing card game
   ============================================================ */

const CHARS = ['Duke','Assassin','Captain','Ambassador','Contessa'];
const CHAR_THEME = {
  Duke:      { base:'#5b2a86', deep:'#2c0f47', light:'#b07be0', accent:'#e9c9ff', title:'DUKE',       sub:'Tax — take 3 coins',                 icon:'crown'  },
  Assassin:  { base:'#222228', deep:'#0a0a0e', light:'#6b6b78', accent:'#d8d8e4', title:'ASSASSIN',   sub:'Pay 3 — force a loss of influence',  icon:'dagger' },
  Captain:   { base:'#13476b', deep:'#06243a', light:'#4fa0d6', accent:'#bfe6ff', title:'CAPTAIN',    sub:'Steal 2 coins',                      icon:'anchor' },
  Ambassador:{ base:'#1d6b4a', deep:'#08321f', light:'#56c98e', accent:'#c5ffe2', title:'AMBASSADOR', sub:'Exchange cards with the court',      icon:'scroll' },
  Contessa:  { base:'#7d1a2b', deep:'#3a0710', light:'#dd5a72', accent:'#ffc9d2', title:'CONTESSA',   sub:'Blocks assassination',               icon:'goblet' },
};
const RANK = { Duke:5, Captain:4, Contessa:4, Ambassador:3, Assassin:3 };

/* ---------- Three.js scene ---------- */
let scene, camera, renderer, raycaster, pointer;
const clock = new THREE.Clock();
let tableGroup;

/* ---------- Online mode state ---------- */
let onlineMode = false, isHost = false, myPlayerId = 0;
let ws = null, lobbyCode = null, onlinePlayers = [];
const pendingRemote = {};   // globalPlayerId -> resolve fn

function localIdx(gid){ const n=players.length||1; return (gid-myPlayerId+n)%n; }
function globalId(li){ const n=players.length||1; return (li+myPlayerId)%n; }
function playerByGid(gid){ return players.find(p=>p.id===gid); }

function wsSend(msg){ if(ws&&ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
function wsSendTo(gid,msg){ wsSend({...msg,to:gid}); }
function wsBroadcast(msg){ wsSend(msg); }
function waitRemote(gid){ return new Promise(r=>{ pendingRemote[gid]=r; }); }
function resolveRemote(gid,value){ if(pendingRemote[gid]){ pendingRemote[gid](value); delete pendingRemote[gid]; } }

function initScene(){
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05050a, 0.045);

  camera = new THREE.PerspectiveCamera(46, innerWidth/innerHeight, 0.1, 100);
  camera.position.set(0, 8.4, 7.0);
  camera.lookAt(0, -0.4, 0.2);

  renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  document.body.prepend(renderer.domElement);

  scene.add(new THREE.AmbientLight(0x2a2438, 0.7));
  const key = new THREE.SpotLight(0xfff0d0, 900, 30, Math.PI/4.5, 0.55, 1.4);
  key.position.set(0, 12, 3.5);
  key.target.position.set(0,0,0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048,2048);
  key.shadow.bias = -0.0004;
  scene.add(key); scene.add(key.target);
  const rim = new THREE.PointLight(0x7a4fd0, 60, 24); rim.position.set(-7,5,-6); scene.add(rim);
  const rim2 = new THREE.PointLight(0xd4af37, 50, 24); rim2.position.set(7,5,6); scene.add(rim2);

  buildTable();
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  addEventListener('resize', onResize);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('click', onCanvasClick);
}

function onResize(){
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

/* ---------- Felt table ---------- */
function buildTable(){
  tableGroup = new THREE.Group(); scene.add(tableGroup);

  const fc = document.createElement('canvas'); fc.width=fc.height=1024;
  const x = fc.getContext('2d');
  const g = x.createRadialGradient(512,512,80, 512,512,560);
  g.addColorStop(0,'#1a5a44'); g.addColorStop(0.55,'#0d3b2e'); g.addColorStop(1,'#072018');
  x.fillStyle=g; x.fillRect(0,0,1024,1024);
  for(let i=0;i<26000;i++){
    x.fillStyle=`rgba(${Math.random()<.5?'255,255,255':'0,0,0'},${Math.random()*0.035})`;
    x.fillRect(Math.random()*1024, Math.random()*1024, 1.3,1.3);
  }
  const feltTex = new THREE.CanvasTexture(fc); feltTex.anisotropy=8;

  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(7.2,7.2,0.45,80),
    new THREE.MeshStandardMaterial({ map:feltTex, roughness:0.92, metalness:0.0 })
  );
  top.position.y=-0.25; top.receiveShadow=true; tableGroup.add(top);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(7.18,0.16,20,90),
    new THREE.MeshStandardMaterial({ color:0xd4af37, roughness:0.3, metalness:1.0,
      emissive:0x3a2a08, emissiveIntensity:0.4 })
  );
  rim.rotation.x=Math.PI/2; rim.position.y=-0.04; rim.castShadow=true; tableGroup.add(rim);

  const wood = new THREE.Mesh(
    new THREE.CylinderGeometry(7.85,7.95,0.7,80),
    new THREE.MeshStandardMaterial({ color:0x24160c, roughness:0.7, metalness:0.2 })
  );
  wood.position.y=-0.34; wood.receiveShadow=true; tableGroup.add(wood);

  const emb = makeEmblemTexture();
  const center = new THREE.Mesh(
    new THREE.CircleGeometry(2.2,64),
    new THREE.MeshStandardMaterial({ map:emb, transparent:true, roughness:0.85, metalness:0.1, opacity:0.5 })
  );
  center.rotation.x=-Math.PI/2; center.position.y=-0.02; tableGroup.add(center);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(40,48),
    new THREE.MeshStandardMaterial({color:0x06060c, roughness:1}));
  floor.rotation.x=-Math.PI/2; floor.position.y=-0.72; floor.receiveShadow=true; scene.add(floor);

  buildCenterDeck();
  buildCenterTreasury();
}

function buildCenterDeck(){
  const stack = new THREE.Group();
  stack.position.set(-1.05, 0, 0);
  const N = 14;
  for(let i=0;i<N;i++){
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(CARD_W,CARD_H,CARD_D),
      [
        new THREE.MeshStandardMaterial({color:0x1a1020,roughness:0.6,metalness:0.3}),
        new THREE.MeshStandardMaterial({color:0x1a1020,roughness:0.6,metalness:0.3}),
        new THREE.MeshStandardMaterial({color:0x1a1020,roughness:0.6,metalness:0.3}),
        new THREE.MeshStandardMaterial({color:0x1a1020,roughness:0.6,metalness:0.3}),
        new THREE.MeshStandardMaterial({map:getCardBack(),roughness:0.5,metalness:0.15}),
        new THREE.MeshStandardMaterial({map:getCardBack(),roughness:0.5,metalness:0.15}),
      ]
    );
    m.rotation.x = FACE_DOWN;
    m.position.y = CARD_D/2 + i*CARD_D*0.95;
    m.position.x = (Math.random()-0.5)*0.025;
    m.position.z = (Math.random()-0.5)*0.025;
    m.rotation.y = (Math.random()-0.5)*0.04;
    m.castShadow = true;
    stack.add(m);
  }
  tableGroup.add(stack);
}

function buildCenterTreasury(){
  const pile = new THREE.Group();
  pile.position.set(1.15, 0, 0);
  const stacks = [
    {x:-0.25,z:-0.20,h:9},
    {x: 0.22,z:-0.18,h:7},
    {x:-0.05,z: 0.18,h:8},
    {x: 0.30,z: 0.22,h:5},
    {x:-0.32,z: 0.05,h:6},
    {x: 0.05,z:-0.05,h:10},
  ];
  for(const s of stacks){
    for(let i=0;i<s.h;i++){
      const c = makeCoin();
      c.position.set(s.x + (Math.random()-0.5)*0.015, 0.025 + i*0.05, s.z + (Math.random()-0.5)*0.015);
      c.rotation.y = Math.random()*Math.PI*2;
      c.castShadow = true;
      pile.add(c);
    }
  }
  tableGroup.add(pile);
}

function makeEmblemTexture(){
  const c=document.createElement('canvas');c.width=c.height=512;const x=c.getContext('2d');
  x.translate(256,256);
  x.strokeStyle='rgba(212,175,55,.9)';x.lineWidth=4;
  x.beginPath();x.arc(0,0,210,0,Math.PI*2);x.stroke();
  x.beginPath();x.arc(0,0,185,0,Math.PI*2);x.lineWidth=1.5;x.stroke();
  x.font='700 64px Cinzel, serif';x.fillStyle='rgba(212,175,55,.85)';
  x.textAlign='center';x.textBaseline='middle';
  drawCrown(x,0,-30,2.0,'rgba(212,175,55,.8)');
  x.fillText('COUP',0,80);
  x.strokeStyle='rgba(212,175,55,.5)';x.lineWidth=3;
  for(const s of [-1,1]){x.beginPath();for(let i=0;i<8;i++){const a=Math.PI/2 + s*(0.5+i*0.16);x.moveTo(s*150,40);}}
  return new THREE.CanvasTexture(c);
}

/* ============================================================
   CARD & COIN VISUALS
   ============================================================ */
const CARD_W=1.18, CARD_H=1.66, CARD_D=0.035;
const FACE_DOWN = Math.PI/2;
const FACE_UP   = -Math.PI/2;

let cardBackTex;
function getCardBack(){
  if(cardBackTex) return cardBackTex;
  const c=document.createElement('canvas');c.width=512;c.height=720;const x=c.getContext('2d');
  const g=x.createLinearGradient(0,0,0,720);
  g.addColorStop(0,'#3a1860');g.addColorStop(0.5,'#240d3e');g.addColorStop(1,'#160826');
  x.fillStyle=g;x.fillRect(0,0,512,720);
  x.strokeStyle='rgba(212,175,55,0.10)';x.lineWidth=2;
  for(let yy=-40;yy<760;yy+=56){for(let xx=-40;xx<552;xx+=56){
    x.beginPath();x.arc(xx,yy,26,0,Math.PI*2);x.stroke();
    x.beginPath();x.arc(xx+28,yy+28,26,0,Math.PI*2);x.stroke();
  }}
  roundRect(x,18,18,512-36,720-36,14);x.strokeStyle='#d4af37';x.lineWidth=5;x.stroke();
  roundRect(x,30,30,512-60,720-60,10);x.strokeStyle='rgba(212,175,55,.55)';x.lineWidth=2;x.stroke();
  for(const[cx,cy,sx,sy] of [[52,52,1,1],[460,52,-1,1],[52,668,1,-1],[460,668,-1,-1]]){
    x.save();x.translate(cx,cy);x.scale(sx,sy);x.strokeStyle='#e9c87a';x.lineWidth=3;
    x.beginPath();x.moveTo(0,40);x.quadraticCurveTo(0,0,40,0);x.stroke();
    x.beginPath();x.arc(20,20,7,0,Math.PI*2);x.fillStyle='#e9c87a';x.fill();x.restore();
  }
  x.save();x.translate(256,300);
  x.beginPath();x.moveTo(0,-130);x.lineTo(100,0);x.lineTo(0,130);x.lineTo(-100,0);x.closePath();
  const dg=x.createLinearGradient(0,-130,0,130);dg.addColorStop(0,'#5b2a86');dg.addColorStop(1,'#2c0f47');
  x.fillStyle=dg;x.fill();x.strokeStyle='#d4af37';x.lineWidth=4;x.stroke();
  drawCrown(x,0,-12,2.6,'#e9c87a');
  x.restore();
  x.font='900 46px Cinzel, serif';x.fillStyle='#e9c87a';x.textAlign='center';
  x.fillText('COUP',256,560);
  x.font='italic 22px "Cormorant Garamond", serif';x.fillStyle='rgba(233,200,122,.7)';
  x.fillText('· deception ·',256,596);
  cardBackTex=new THREE.CanvasTexture(c);cardBackTex.anisotropy=8;return cardBackTex;
}

const faceTexCache={};
function getCardFace(charName){
  if(faceTexCache[charName]) return faceTexCache[charName];
  const t=CHAR_THEME[charName];
  const c=document.createElement('canvas');c.width=512;c.height=720;const x=c.getContext('2d');
  const g=x.createLinearGradient(0,0,0,720);
  g.addColorStop(0,t.light);g.addColorStop(0.18,t.base);g.addColorStop(1,t.deep);
  x.fillStyle=g;x.fillRect(0,0,512,720);
  roundRect(x,40,40,432,640,18);
  const pg=x.createLinearGradient(0,40,0,680);pg.addColorStop(0,'#f3e8c8');pg.addColorStop(1,'#d9c79a');
  x.fillStyle=pg;x.fill();
  x.strokeStyle=t.base;x.lineWidth=6;x.stroke();
  roundRect(x,54,54,404,612,12);x.strokeStyle='rgba(0,0,0,.25)';x.lineWidth=2;x.stroke();
  x.fillStyle=t.deep;x.textAlign='center';x.font='900 50px Cinzel, serif';
  x.fillText(t.title,256,120);
  x.strokeStyle=t.base;x.lineWidth=3;x.beginPath();x.moveTo(120,140);x.lineTo(392,140);x.stroke();
  x.save();x.translate(256,330);drawCharIcon(x,t.icon,t.deep,t.base);x.restore();
  roundRect(x,74,520,364,96,10);x.fillStyle=t.base;x.fill();
  x.strokeStyle=t.deep;x.lineWidth=3;x.stroke();
  x.fillStyle='#f3e8c8';x.font='italic 26px "Cormorant Garamond", serif';
  wrapText(x,t.sub,256,556,320,30);
  x.fillStyle=t.deep;x.font='700 30px Cinzel, serif';x.textAlign='left';
  x.fillText(t.title[0],70,96);x.textAlign='right';
  x.save();x.translate(442,624);x.rotate(Math.PI);x.fillText(t.title[0],0,0);x.restore();
  const tex=new THREE.CanvasTexture(c);tex.anisotropy=8;faceTexCache[charName]=tex;return tex;
}

function makeCardMesh(charName){
  const edgeMat=new THREE.MeshStandardMaterial({color:0x1a1020,roughness:0.6,metalness:0.3});
  const frontMat=new THREE.MeshStandardMaterial({map:getCardFace(charName),roughness:0.55,metalness:0.05});
  const backMat=new THREE.MeshStandardMaterial({map:getCardBack(),roughness:0.5,metalness:0.15});
  const mats=[edgeMat,edgeMat,edgeMat,edgeMat,frontMat,backMat];
  const m=new THREE.Mesh(new THREE.BoxGeometry(CARD_W,CARD_H,CARD_D),mats);
  m.castShadow=true;m.userData.char=charName;m.userData.frontMat=frontMat;
  return m;
}
function setCardFace(mesh,charName){
  mesh.userData.char=charName;
  mesh.userData.frontMat.map=getCardFace(charName);
  mesh.userData.frontMat.needsUpdate=true;
}

let coinGeo, coinMat;
function makeCoin(){
  if(!coinGeo){
    coinGeo=new THREE.CylinderGeometry(0.2,0.2,0.045,28);
    const cc=document.createElement('canvas');cc.width=cc.height=128;const cx=cc.getContext('2d');
    const cg=cx.createRadialGradient(64,54,6,64,64,64);cg.addColorStop(0,'#fff0b8');cg.addColorStop(.5,'#e6c44e');cg.addColorStop(1,'#9c7a22');
    cx.fillStyle=cg;cx.beginPath();cx.arc(64,64,62,0,Math.PI*2);cx.fill();
    cx.strokeStyle='#7a5e12';cx.lineWidth=4;cx.beginPath();cx.arc(64,64,52,0,Math.PI*2);cx.stroke();
    cx.fillStyle='#8a6a18';cx.font='700 60px Cinzel, serif';cx.textAlign='center';cx.textBaseline='middle';cx.fillText('C',64,68);
    const ct=new THREE.CanvasTexture(cc);
    coinMat=new THREE.MeshStandardMaterial({map:ct,color:0xffe9a0,roughness:0.28,metalness:0.95,emissive:0x2a1f04,emissiveIntensity:0.3});
  }
  return new THREE.Mesh(coinGeo,coinMat.clone? coinMat:coinMat);
}

/* ---------- canvas helpers ---------- */
function roundRect(x,X,Y,w,h,r){x.beginPath();x.moveTo(X+r,Y);x.arcTo(X+w,Y,X+w,Y+h,r);x.arcTo(X+w,Y+h,X,Y+h,r);x.arcTo(X,Y+h,X,Y,r);x.arcTo(X,Y,X+w,Y,r);x.closePath();}
function wrapText(ctx,text,cx,cy,maxW,lh){const words=text.split(' ');let line='';let y=cy;const lines=[];
  for(const w of words){const t=line+w+' ';if(ctx.measureText(t).width>maxW&&line){lines.push(line);line=w+' ';}else line=t;}
  lines.push(line);const startY=cy-((lines.length-1)*lh)/2;lines.forEach((l,i)=>ctx.fillText(l.trim(),cx,startY+i*lh));}
function drawCrown(x,cx,cy,s,col){x.save();x.translate(cx,cy);x.scale(s,s);x.fillStyle=col;
  x.beginPath();x.moveTo(-22,8);x.lineTo(-22,-8);x.lineTo(-11,2);x.lineTo(0,-14);x.lineTo(11,2);x.lineTo(22,-8);x.lineTo(22,8);x.closePath();x.fill();
  x.fillRect(-24,8,48,6);
  for(const px of [-22,0,22]){x.beginPath();x.arc(px,-12,3.2,0,Math.PI*2);x.fill();}x.restore();}

function drawCharIcon(x,kind,dark,mid){
  x.lineWidth=8;x.lineCap='round';x.lineJoin='round';x.strokeStyle=dark;x.fillStyle=dark;
  const r=120;
  x.save();x.beginPath();x.arc(0,0,r,0,Math.PI*2);
  const mg=x.createRadialGradient(-30,-30,10,0,0,r);mg.addColorStop(0,mid);mg.addColorStop(1,dark);
  x.fillStyle=mg;x.fill();x.strokeStyle='#f3e8c8';x.lineWidth=5;x.stroke();x.restore();
  x.save();x.strokeStyle='#f3e8c8';x.fillStyle='#f3e8c8';x.lineWidth=9;
  if(kind==='crown'){
    x.beginPath();x.moveTo(-66,34);x.lineTo(-66,-26);x.lineTo(-33,8);x.lineTo(0,-46);x.lineTo(33,8);x.lineTo(66,-26);x.lineTo(66,34);x.closePath();x.fill();
    x.fillRect(-72,34,144,18);
    for(const px of [-66,0,66]){x.beginPath();x.arc(px,-38,9,0,Math.PI*2);x.fill();}
  }else if(kind==='dagger'){
    x.beginPath();x.moveTo(0,-74);x.lineTo(14,30);x.lineTo(0,52);x.lineTo(-14,30);x.closePath();x.fill();
    x.fillRect(-34,30,68,12);x.fillRect(-7,42,14,40);
    x.beginPath();x.arc(0,90,12,0,Math.PI*2);x.fill();
  }else if(kind==='anchor'){
    x.beginPath();x.arc(0,-50,16,0,Math.PI*2);x.lineWidth=10;x.stroke();
    x.beginPath();x.moveTo(0,-34);x.lineTo(0,60);x.stroke();
    x.beginPath();x.moveTo(-46,8);x.lineTo(46,8);x.stroke();
    x.beginPath();x.moveTo(-58,30);x.quadraticCurveTo(-58,70,0,72);x.quadraticCurveTo(58,70,58,30);x.stroke();
  }else if(kind==='scroll'){
    roundRectPath(x,-58,-58,116,116,14);x.lineWidth=8;x.stroke();
    x.lineWidth=6;for(const yy of [-30,-6,18,42]){x.beginPath();x.moveTo(-38,yy);x.lineTo(38,yy);x.stroke();}
    x.beginPath();x.moveTo(40,-66);x.lineTo(-10,40);x.lineWidth=7;x.stroke();
  }else if(kind==='goblet'){
    x.beginPath();x.moveTo(-44,-50);x.lineTo(44,-50);x.lineTo(28,6);x.quadraticCurveTo(0,30,-28,6);x.closePath();x.fill();
    x.fillRect(-6,6,12,50);x.fillRect(-34,56,68,12);
    x.fillStyle=dark;x.beginPath();x.moveTo(-30,-44);x.lineTo(30,-44);x.lineTo(22,-20);x.lineTo(-22,-20);x.closePath();x.fill();
  }
  x.restore();
}
function roundRectPath(x,X,Y,w,h,r){x.beginPath();x.moveTo(X+r,Y);x.arcTo(X+w,Y,X+w,Y+h,r);x.arcTo(X+w,Y+h,X,Y+h,r);x.arcTo(X,Y+h,X,Y,r);x.arcTo(X,Y,X+w,Y,r);x.closePath();}

/* ============================================================
   SEATING
   ============================================================ */
const SEATS = {
  2:[ {x:0,z:3.3,name:'You'}, {x:0,z:-3.1} ],
  3:[ {x:0,z:3.3,name:'You'}, {x:-4.4,z:-1.4}, {x:4.4,z:-1.4} ],
  4:[ {x:0,z:3.3,name:'You'}, {x:-4.7,z:-0.2}, {x:0,z:-3.3}, {x:4.7,z:-0.2} ],
};
const AI_NAMES = ['Lady Vex','Baron Crowe','Madame Roux','Don Salazar','Sir Aldric'];

/* ============================================================
   GAME STATE
   ============================================================ */
let players=[];
let deck=[];
let turnIndex=0;
let busy=false;

function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* ---------- CPU practice game setup ---------- */
function setupGame(n){
  players.forEach(p=>{ if(p.group) scene.remove(p.group); if(p.coinGroup) scene.remove(p.coinGroup); });
  document.querySelectorAll('.nameplate').forEach(e=>e.remove());
  players=[];deck=[];turnIndex=0;

  deck=[];CHARS.forEach(c=>{for(let i=0;i<3;i++)deck.push(c);});shuffle(deck);

  const seats=SEATS[n];
  const startCoins = (n===2)?1:2;
  for(let i=0;i<n;i++){
    const seat=seats[i];
    const isHuman=(i===0);
    const p={
      id:i, name:isHuman?'You':AI_NAMES[i-1], isHuman, isLocal:isHuman, coins:startCoins,
      alive:true, cards:[], seat
    };
    const group=new THREE.Group();group.position.set(seat.x,0,seat.z);
    group.rotation.y = isHuman ? 0 : Math.atan2(seat.x, seat.z) + Math.PI;
    scene.add(group);
    p.group=group;

    for(let k=0;k<2;k++){
      const ch=deck.pop();
      const mesh=makeCardMesh(ch);
      mesh.position.set((k===0?-0.72:0.72),CARD_D/2,0);
      mesh.rotation.x=FACE_DOWN;
      group.add(mesh);
      const card={char:ch,revealed:false,mesh};
      p.cards.push(card);
      mesh.userData.cardRef=card;mesh.userData.owner=p;
    }
    if(isHuman){p.cards.forEach(c=>{c.mesh.rotation.x=FACE_UP;});}

    p.coinGroup=new THREE.Group();
    p.coinGroup.position.set(isHuman ? 1.8 : -1.8, 0, 0);
    p.group.add(p.coinGroup);

    const np=document.createElement('div');np.className='nameplate';
    np.innerHTML=`<div class="pname"></div><div class="ptag"></div><div class="pcoins"></div>`;
    document.body.appendChild(np);
    p.np=np;

    players.push(p);
    updateCoins(p);
  }
  refreshPlates();
  log(`The court convenes — <span class="who">${n} nobles</span> take their seats.`,'sys');
}

/* ---------- Online game setup ---------- */
function setupOnlineGame(n, playerInfos){
  players.forEach(p=>{ if(p.group) scene.remove(p.group); if(p.coinGroup) scene.remove(p.coinGroup); });
  document.querySelectorAll('.nameplate').forEach(e=>e.remove());
  players=[];deck=[];turnIndex=0;

  deck=[];CHARS.forEach(c=>{for(let i=0;i<3;i++)deck.push(c);});shuffle(deck);

  const seats=SEATS[n];
  const startCoins=(n===2)?1:2;

  for(let li=0;li<n;li++){
    const gi=globalId(li);
    const info=playerInfos.find(p=>p.id===gi)||{name:`Player ${gi+1}`};
    const seat=seats[li];
    const isLocal=(gi===myPlayerId);
    const p={
      id:gi, name:info.name, isHuman:true, isLocal,
      coins:startCoins, alive:true, cards:[], seat
    };

    const group=new THREE.Group();
    group.position.set(seat.x,0,seat.z);
    group.rotation.y = isLocal ? 0 : Math.atan2(seat.x,seat.z)+Math.PI;
    scene.add(group);
    p.group=group;

    for(let k=0;k<2;k++){
      const ch=deck.pop();
      const mesh=makeCardMesh(ch);
      mesh.position.set((k===0?-0.72:0.72),CARD_D/2,0);
      mesh.rotation.x=FACE_DOWN;
      group.add(mesh);
      const card={char:ch,revealed:false,mesh};
      p.cards.push(card);
      mesh.userData.cardRef=card;mesh.userData.owner=p;
    }
    if(isLocal){p.cards.forEach(c=>{c.mesh.rotation.x=FACE_UP;});}

    p.coinGroup=new THREE.Group();
    p.coinGroup.position.set(isLocal?1.8:-1.8,0,0);
    p.group.add(p.coinGroup);

    const np=document.createElement('div');np.className='nameplate';
    np.innerHTML=`<div class="pname"></div><div class="ptag"></div><div class="pcoins"></div>`;
    document.body.appendChild(np);
    p.np=np;

    players.push(p);
    updateCoins(p);
  }
  refreshPlates();
  log(`The court convenes online — <span class="who">${n} nobles</span> take their seats.`,'sys');
}

function updateCoins(p){
  const g=p.coinGroup;
  while(g.children.length) g.remove(g.children[0]);
  const show=Math.min(p.coins,12);
  for(let i=0;i<show;i++){
    const coin=makeCoin();
    const stack=Math.floor(i/6);const idx=i%6;
    coin.position.set(stack*0.46-0.23, 0.025+idx*0.05, 0);
    coin.castShadow=true;
    g.add(coin);
  }
  if(p.np){p.np.querySelector('.pcoins').textContent=p.coins;}
}

function refreshPlates(){
  players.forEach(p=>{
    const np=p.np;
    np.querySelector('.pname').textContent=p.name;
    const inf=p.cards.filter(c=>!c.revealed).length;
    const dead=p.cards.filter(c=>c.revealed).map(c=>c.char);
    let tag='';
    if(!p.alive) tag='— eliminated —';
    else if(dead.length) tag='lost: '+dead.join(', ');
    else tag=p.isLocal? '· your court ·' : `${inf} influence`;
    np.querySelector('.ptag').textContent=tag;
    np.classList.toggle('dead',!p.alive);
    np.classList.toggle('active', p.alive && players[turnIndex]===p && started);
  });
}

const _v=new THREE.Vector3();
function updatePlates(){
  players.forEach(p=>{
    const s=p.seat;
    _v.set(s.x*0.92, 0.2, s.z*0.92 + (s.z>0?1.25:-1.15));
    _v.project(camera);
    const sx=(_v.x*0.5+0.5)*innerWidth;
    const sy=(-_v.y*0.5+0.5)*innerHeight;
    p.np.style.left=sx+'px';p.np.style.top=sy+'px';
    p.np.style.opacity=(_v.z<1)?'1':'0';
  });
}

/* ============================================================
   LOG / UI HELPERS
   ============================================================ */
const logBody=document.getElementById('logbody');
function log(html,cls=''){
  const d=document.createElement('div');d.className='logline '+cls;d.innerHTML=html;
  logBody.appendChild(d);logBody.scrollTop=logBody.scrollHeight;
  while(logBody.children.length>60)logBody.removeChild(logBody.firstChild);
  if(onlineMode&&isHost) wsBroadcast({type:'log',html,cls});
}
function nameTag(p){return `<span class="who">${p.name}</span>`;}

const promptEl=document.getElementById('prompt');
const promptMsg=promptEl.querySelector('.pmsg');
const promptRow=promptEl.querySelector('.prow');
function showPrompt(msgHtml,buttons){
  return new Promise(resolve=>{
    promptMsg.innerHTML=msgHtml;promptRow.innerHTML='';
    buttons.forEach(b=>{
      const el=document.createElement('div');el.className='btn '+(b.cls||'');
      el.innerHTML=b.label+(b.sub?`<span class="sub">${b.sub}</span>`:'');
      el.onclick=()=>{hidePrompt();resolve(b.value);};
      promptRow.appendChild(el);
    });
    promptEl.classList.add('show');
  });
}
function hidePrompt(){promptEl.classList.remove('show');}

const bannerEl=document.getElementById('banner');
async function banner(title,colCls,sub='',hold=1300){
  bannerEl.innerHTML=`<div class="bt ${colCls}">${title}</div>`+(sub?`<div class="bs">${sub}</div>`:'');
  bannerEl.classList.add('show');
  if(onlineMode&&isHost) wsBroadcast({type:'banner_show',title,colCls,sub,hold});
  await sleep(hold);
  bannerEl.classList.remove('show');
  await sleep(280);
}

const hintEl=document.getElementById('hint');
function hint(t){hintEl.textContent=t;hintEl.classList.toggle('show',!!t);}

const actionbar=document.getElementById('actionbar');
function clearActions(){actionbar.innerHTML='';}

/* ============================================================
   CARD ANIMATIONS
   ============================================================ */
function flipCard(card,faceUp){
  return new Promise(res=>{
    gsap.to(card.mesh.rotation,{x:faceUp?FACE_UP:FACE_DOWN,duration:0.62,ease:'power2.inOut',onComplete:res});
    gsap.to(card.mesh.position,{y:CARD_D/2+0.55,duration:0.31,yoyo:true,repeat:1,ease:'power2.out'});
  });
}
function liftCard(mesh,up){gsap.to(mesh.position,{y:up?CARD_D/2+0.35:CARD_D/2,duration:0.3,ease:'power2.out'});}
async function revealPermanent(card){
  await flipCard(card,true);
  card.revealed=true;
  card.mesh.rotation.x=FACE_UP;
  card.mesh.position.y=CARD_D/2;
  const owner=card.mesh.userData.owner;
  const deadCount=owner?owner.cards.filter(c=>c.revealed&&c!==card).length:0;
  const discardX=owner&&!owner.isLocal?2.6+deadCount*0.9:-2.6-deadCount*0.9;
  await new Promise(res=>gsap.to(card.mesh.position,{x:discardX,z:0.6,y:CARD_D/2,duration:0.55,ease:'power2.inOut',onComplete:res}));
}

function pulseCoins(p){gsap.fromTo(p.coinGroup.scale,{x:1,y:1,z:1},{x:1.15,y:1.15,z:1.15,duration:0.18,yoyo:true,repeat:1,ease:'power2.out'});}

/* ============================================================
   CORE GAME RULES
   ============================================================ */
let started=false;

function alivePlayers(){return players.filter(p=>p.alive);}
function opponentsOf(p){return players.filter(q=>q.alive&&q!==p);}
function hidden(p){return p.cards.filter(c=>!c.revealed);}
function hasChar(p,ch){return p.cards.some(c=>!c.revealed&&c.char===ch);}
function revealedCount(ch){let n=0;players.forEach(p=>p.cards.forEach(c=>{if(c.revealed&&c.char===ch)n++;}));return n;}

async function gameLoop(){
  if(onlineMode&&!isHost) return;
  started=true;
  while(alivePlayers().length>1){
    const p=players[turnIndex];
    if(p.alive){
      refreshPlates();
      focusSeat(p);
      await sleep(p.isLocal?250:700);
      await playTurn(p);
      if(alivePlayers().length<=1) break;
      await sleep(450);
    }
    turnIndex=(turnIndex+1)%players.length;
  }
  endGame();
}

function focusSeat(p){
  const tx=p.seat.x*0.18, tz=p.seat.z*0.06;
  gsap.to(camera.position,{x:tx,duration:1.0,ease:'power2.inOut'});
}

async function playTurn(p){
  let action;
  if(!p.isHuman){
    action=aiChooseAction(p);
  }else if(onlineMode&&p.id!==myPlayerId){
    action=await remoteChooseAction(p);
  }else{
    action=await humanChooseAction(p);
  }
  if(!action)return;
  await resolveAction(p,action);
  refreshPlates();
}

async function resolveAction(actor,action){
  const t=action.target;
  if(action.type==='income'){
    actor.coins+=1;updateCoins(actor);pulseCoins(actor);
    log(`${nameTag(actor)} takes <b>Income</b> — 1 coin.`);
    if(onlineMode&&isHost) broadcastState();
    await sleep(450);return;
  }
  if(action.type==='coup'){
    actor.coins-=7;updateCoins(actor);
    log(`${nameTag(actor)} launches a <b>Coup</b> against ${nameTag(t)}! <span style="color:#ff8a8a">(unstoppable)</span>`,'big');
    await banner('COUP','col-bluff','7 coins spent',1100);
    if(onlineMode&&isHost) broadcastState();
    await loseInfluence(t,`the coup against ${t.name}`);
    return;
  }
  if(action.type==='foreign_aid'){
    log(`${nameTag(actor)} reaches for <b>Foreign Aid</b> — 2 coins.`);
    await sleep(350);
    const blocker=await offerBlock(actor,action,'foreign_aid',['Duke'],null);
    if(blocker){
      const stands=await resolveBlock(blocker,blocker._claim,actor,action);
      if(stands){log(`Foreign Aid is <span class="bluff">blocked</span>. No coins for ${nameTag(actor)}.`);await sleep(400);return;}
    }
    actor.coins+=2;updateCoins(actor);pulseCoins(actor);
    log(`${nameTag(actor)} pockets 2 coins.`);
    if(onlineMode&&isHost) broadcastState();
    await sleep(400);return;
  }

  const claim=action.character;
  log(`${nameTag(actor)} claims <b>${claim}</b> — ${actionPhrase(action)}.`);
  await sleep(350);

  const challenger=await offerChallenge(actor,claim,opponentsOf(actor),`${actor.name}'s ${claim}`);
  if(challenger){
    const truthful=await resolveChallenge(actor,claim,challenger);
    if(!truthful){
      log(`The ${claim} was a <span class="bluff">bluff</span> — the action fails.`,'bluff');
      await sleep(400);return;
    }
    if(!actor.alive) return;
  }

  if(action.type==='tax'){
    actor.coins+=3;updateCoins(actor);pulseCoins(actor);
    log(`${nameTag(actor)} collects <b>Tax</b> — 3 coins.`);
    if(onlineMode&&isHost) broadcastState();
    await sleep(400);return;
  }
  if(action.type==='exchange'){
    await doExchange(actor);return;
  }
  if(action.type==='assassinate'){
    const blocker=await offerBlock(actor,action,'assassinate',['Contessa'],t);
    if(blocker){
      const stands=await resolveBlock(blocker,'Contessa',actor,action);
      if(stands){log(`The assassination is <span class="truth">blocked</span> by Contessa.`,'truth');await sleep(400);return;}
    }
    if(t.alive){log(`The blade finds its mark — ${nameTag(t)} must answer.`,'big');await loseInfluence(t,`the assassination`);}
    return;
  }
  if(action.type==='steal'){
    const blocker=await offerBlock(actor,action,'steal',['Captain','Ambassador'],t);
    if(blocker){
      const stands=await resolveBlock(blocker,blocker._claim,actor,action);
      if(stands){log(`The theft is <span class="truth">blocked</span>.`,'truth');await sleep(400);return;}
    }
    const amt=Math.min(2,t.coins);
    t.coins-=amt;actor.coins+=amt;updateCoins(t);updateCoins(actor);pulseCoins(actor);
    log(`${nameTag(actor)} steals ${amt} coin${amt!==1?'s':''} from ${nameTag(t)}.`);
    if(onlineMode&&isHost) broadcastState();
    await sleep(400);return;
  }
}

function actionPhrase(a){
  switch(a.type){
    case 'tax':return 'taking 3 coins';
    case 'assassinate':return `to assassinate ${a.target.name}`;
    case 'steal':return `to steal from ${a.target.name}`;
    case 'exchange':return 'to exchange with the court';
  }return '';
}

/* ---- CHALLENGE ---- */
async function offerChallenge(claimant,char,eligible,desc){
  const ordered=[...eligible].sort((a,b)=>(a.isLocal?-1:0)-(b.isLocal?-1:0));
  for(const p of ordered){
    if(!p.alive)continue;
    let wants;
    if(!p.isHuman){
      wants=aiWantsChallenge(p,claimant,char);
      if(wants)await sleep(500);
    }else if(onlineMode&&p.id!==myPlayerId){
      if(onlineMode&&isHost) broadcastState();
      wsSendTo(p.id,{type:'prompt_challenge',claimantName:claimant.name,char,desc});
      const resp=await waitRemote(p.id);
      wants=resp.value;
    }else{
      wants=await humanChallengePrompt(claimant,char,desc);
    }
    if(wants) return p;
  }
  return null;
}

async function resolveChallenge(claimant,char,challenger){
  log(`${nameTag(challenger)} cries <b>"Challenge!"</b> against the ${char}.`,'big');
  await banner('CHALLENGE!','col-gold','',900);
  const card=hidden(claimant).find(c=>c.char===char);
  if(card){
    await revealCardTemporarily(card);
    log(`${nameTag(claimant)} reveals the <span class="truth">${char}</span> — the claim was true!`,'truth');
    await banner('TRUTH','col-truth',`${claimant.name} held the ${char}`,1200);
    await loseInfluence(challenger,`the failed challenge`);
    await replaceCard(claimant,card);
    return true;
  }else{
    log(`${nameTag(claimant)} has <span class="bluff">no ${char}</span> — caught bluffing!`,'bluff');
    await banner('BLUFF!','col-bluff',`${claimant.name} was lying`,1200);
    await loseInfluence(claimant,`the exposed bluff`);
    return false;
  }
}

/* ---- BLOCK ---- */
async function offerBlock(actor,action,kind,blockChars,onlyTarget){
  const candidates=onlyTarget?[onlyTarget]:opponentsOf(actor);
  const ordered=[...candidates].filter(p=>p.alive).sort((a,b)=>(a.isLocal?-1:0)-(b.isLocal?-1:0));
  for(const p of ordered){
    let claim=null;
    if(!p.isHuman){
      claim=aiBlockDecision(p,actor,action,kind,blockChars);
      if(claim)await sleep(550);
    }else if(onlineMode&&p.id!==myPlayerId){
      if(onlineMode&&isHost) broadcastState();
      wsSendTo(p.id,{type:'prompt_block',actorName:actor.name,kind,blockChars});
      const resp=await waitRemote(p.id);
      claim=resp.claim;
    }else{
      claim=await humanBlockPrompt(actor,action,kind,blockChars);
    }
    if(claim){p._claim=claim;return p;}
  }
  return null;
}

async function resolveBlock(blocker,claim,actor,action){
  log(`${nameTag(blocker)} blocks with <b>${claim}</b>.`);
  await sleep(300);
  const eligible=players.filter(p=>p.alive&&p!==blocker);
  eligible.sort((a,b)=>{
    if(a===actor)return -1;if(b===actor)return 1;
    return (a.isLocal?-1:0)-(b.isLocal?-1:0);
  });
  let challenger=null;
  for(const p of eligible){
    let wants;
    if(!p.isHuman){
      wants=aiWantsChallenge(p,blocker,claim);if(wants)await sleep(500);
    }else if(onlineMode&&p.id!==myPlayerId){
      if(onlineMode&&isHost) broadcastState();
      wsSendTo(p.id,{type:'prompt_challenge',claimantName:blocker.name,char:claim,desc:`${blocker.name}'s ${claim} block`});
      const resp=await waitRemote(p.id);
      wants=resp.value;
    }else{
      wants=await humanChallengePrompt(blocker,claim,`${blocker.name}'s ${claim} block`);
    }
    if(wants){challenger=p;break;}
  }
  if(!challenger) return true;

  log(`${nameTag(challenger)} challenges the ${claim} block!`,'big');
  await banner('CHALLENGE!','col-gold','',850);
  const card=hidden(blocker).find(c=>c.char===claim);
  if(card){
    await revealCardTemporarily(card);
    log(`${nameTag(blocker)} truly holds the <span class="truth">${claim}</span>!`,'truth');
    await banner('TRUTH','col-truth',`${blocker.name} held the ${claim}`,1100);
    await loseInfluence(challenger,'the failed challenge');
    await replaceCard(blocker,card);
    return true;
  }else{
    log(`${nameTag(blocker)} was <span class="bluff">bluffing</span> the ${claim}!`,'bluff');
    await banner('BLUFF!','col-bluff',`${blocker.name} had no ${claim}`,1100);
    await loseInfluence(blocker,'the exposed block');
    return false;
  }
}

/* ---- LOSE INFLUENCE ---- */
async function loseInfluence(p,reason){
  if(!p.alive)return;
  const cards=hidden(p);
  if(cards.length===0){return;}
  let chosen;
  if(cards.length===1){chosen=cards[0];}
  else if(!p.isHuman){
    chosen=[...cards].sort((a,b)=>RANK[a.char]-RANK[b.char])[0];
    await sleep(500);
  }else if(onlineMode&&p.id!==myPlayerId){
    if(onlineMode&&isHost) broadcastState();
    wsSendTo(p.id,{
      type:'prompt_lose',
      cards:cards.map(c=>({index:p.cards.indexOf(c),char:c.char})),
      reason
    });
    const resp=await waitRemote(p.id);
    chosen=p.cards[resp.cardIndex];
  }else{
    chosen=await humanChooseCardToLose(cards,reason);
  }
  log(`${nameTag(p)} loses influence — reveals <span class="bluff">${chosen.char}</span>.`,'bluff');
  await revealPermanent(chosen);
  if(hidden(p).length===0){
    p.alive=false;
    log(`${nameTag(p)} has lost all influence and is <b>eliminated!</b>`,'big');
    await banner(p.isLocal?'YOU FALL':'ELIMINATED','col-bluff',`${p.name} is out of the game`,1300);
    gsap.to(p.group.position,{y:-0.05,duration:0.5});
    refreshPlates();
  }
  if(onlineMode&&isHost) broadcastState();
  refreshPlates();
}

async function revealCardTemporarily(card){
  setCardFace(card.mesh,card.char);
  if(card.mesh.rotation.x!==FACE_UP) await flipCard(card,true);
  await sleep(750);
}
async function replaceCard(p,card){
  deck.push(card.char);shuffle(deck);
  const nu=deck.pop();
  card.char=nu;
  setCardFace(card.mesh,nu);
  if(p.isLocal){
    gsap.fromTo(card.mesh.position,{y:CARD_D/2+0.4},{y:CARD_D/2,duration:0.4,ease:'bounce.out'});
    log(`${nameTag(p)} shuffles it back and draws anew.`,'sys');
  }else{
    await flipCard(card,false);
    log(`${nameTag(p)} shuffles it back and draws anew.`,'sys');
  }
  await sleep(300);
}

/* ---- EXCHANGE ---- */
async function doExchange(actor){
  const h=hidden(actor);
  const keepN=h.length;
  const drawn=[deck.pop(),deck.pop()].filter(Boolean);
  const pool=[...h.map(c=>c.char),...drawn];
  log(`${nameTag(actor)} draws ${drawn.length} cards to exchange.`,'sys');
  let keepChars;
  if(!actor.isHuman){
    keepChars=[...pool].sort((a,b)=>RANK[b]-RANK[a]).slice(0,keepN);
  }else if(onlineMode&&actor.id!==myPlayerId){
    if(onlineMode&&isHost) broadcastState();
    wsSendTo(actor.id,{type:'prompt_exchange',pool,keepN});
    const resp=await waitRemote(actor.id);
    keepChars=resp.indices.map(i=>pool[i]);
  }else{
    keepChars=await humanExchange(pool,keepN);
  }
  const keepCopy=[...keepChars];
  h.forEach(c=>{const ch=keepCopy.shift();c.char=ch;setCardFace(c.mesh,ch);});
  const returnPool=[...pool];
  keepChars.forEach(k=>{const i=returnPool.indexOf(k);if(i>=0)returnPool.splice(i,1);});
  returnPool.forEach(c=>deck.push(c));shuffle(deck);
  h.forEach(c=>{gsap.fromTo(c.mesh.position,{y:CARD_D/2+0.45},{y:CARD_D/2,duration:0.45,ease:'back.out'});});
  log(`${nameTag(actor)} completes the <b>Exchange</b>.`);
  if(onlineMode&&isHost) broadcastState();
  await sleep(500);
}

/* ============================================================
   HUMAN INPUT (local)
   ============================================================ */
function humanChooseAction(p){
  return new Promise(resolve=>{
    clearActions();
    const mustCoup=p.coins>=10;
    hint(mustCoup?'You have 10+ coins — you must launch a Coup.':'Your move, my lord. Choose an action.');
    const opp=opponentsOf(p);

    const make=(label,sub,cls,enabled,fn)=>{
      const el=document.createElement('div');el.className='btn '+cls+(enabled?'':' disabled');
      el.innerHTML=label+`<span class="sub">${sub}</span>`;
      if(enabled)el.onclick=fn;actionbar.appendChild(el);
    };
    const finish=(action)=>{clearActions();hint('');resolve(action);};
    const needTarget=(type,character,then)=>{
      pickTarget(opp,type).then(t=>{ if(t===null){humanChooseAction(p).then(resolve);} else then(t); });
    };

    if(mustCoup){
      make('Coup','7 coins · forced','danger gold',true,()=>needTarget('coup',null,t=>finish({type:'coup',target:t})));
      return;
    }
    make('Income','+1 coin','',true,()=>finish({type:'income'}));
    make('Foreign Aid','+2 · Duke blocks','',true,()=>finish({type:'foreign_aid'}));
    make('Tax','Duke · +3 coins','gold',true,()=>finish({type:'tax',character:'Duke'}));
    make('Steal','Captain · take 2','',opp.length>0,()=>needTarget('steal','Captain',t=>finish({type:'steal',character:'Captain',target:t})));
    make('Assassinate','Assassin · pay 3','danger',p.coins>=3&&opp.length>0,()=>needTarget('assassinate','Assassin',t=>{p.coins-=3;updateCoins(p);finish({type:'assassinate',character:'Assassin',target:t});}));
    make('Exchange','Ambassador','',true,()=>finish({type:'exchange',character:'Ambassador'}));
    make('Coup','pay 7','danger gold',p.coins>=7&&opp.length>0,()=>needTarget('coup',null,t=>finish({type:'coup',target:t})));
  });
}

function pickTarget(opps,type){
  if(opps.length===1)return Promise.resolve(opps[0]);
  const verb={coup:'Coup',steal:'Steal from',assassinate:'Assassinate'}[type]||'Target';
  const btns=opps.map(o=>({label:o.name,sub:`${hidden(o).length} inf · ${o.coins}c`,cls:'',value:o}));
  btns.push({label:'Cancel',sub:'go back',cls:'',value:null});
  return showPrompt(`<b>${verb}</b> which noble?`,btns);
}

function humanChallengePrompt(claimant,char,desc){
  hint('');
  return showPrompt(
    `${claimant===players[0]?'You claim':'<b>'+claimant.name+'</b> claims'} <b>${char}</b>.<br><span style="font-size:16px;color:#b89b66">Do you call it a bluff?</span>`,
    [{label:'Challenge!',sub:'risk an influence',cls:'danger',value:true},
     {label:'Allow it',sub:'let it pass',cls:'',value:false}]
  );
}

function humanBlockPrompt(actor,action,kind,blockChars){
  const map={
    foreign_aid:`<b>${actor.name}</b> takes Foreign Aid.`,
    steal:`<b>${actor.name}</b> tries to steal from you.`,
    assassinate:`<b>${actor.name}</b> sends an assassin for you!`
  };
  const btns=blockChars.map(c=>({label:`Block · ${c}`,sub:'claim this card',cls:c==='Contessa'?'gold':'',value:c}));
  btns.push({label:'Do not block',sub:'allow it',cls:'',value:null});
  return showPrompt(`${map[kind]}<br><span style="font-size:16px;color:#b89b66">Block the action?</span>`,btns);
}

function humanChooseCardToLose(cards,reason){
  return showPrompt(
    `You must lose influence (<span class="em">${reason}</span>).<br><span style="font-size:16px;color:#b89b66">Which card do you reveal — forever?</span>`,
    cards.map(c=>({label:c.char,sub:'reveal this',cls:'danger',value:c}))
  );
}

function humanExchange(pool,keepN){
  return new Promise(resolve=>{
    const chosen=new Set();
    const render=()=>{
      promptMsg.innerHTML=`<b>Exchange</b> — keep exactly <b>${keepN}</b> card${keepN>1?'s':''}.<br><span style="font-size:15px;color:#b89b66">Selected ${chosen.size}/${keepN}</span>`;
      promptRow.innerHTML='';
      pool.forEach((ch,i)=>{
        const el=document.createElement('div');
        const sel=chosen.has(i);
        el.className='btn '+(sel?'gold':'');
        el.style.opacity=sel?'1':'0.85';
        el.innerHTML=ch+`<span class="sub">${sel?'✓ keeping':'tap to keep'}</span>`;
        el.onclick=()=>{
          if(sel)chosen.delete(i);
          else{ if(chosen.size>=keepN){const first=chosen.values().next().value;chosen.delete(first);}chosen.add(i);}
          render();
        };
        promptRow.appendChild(el);
      });
      const conf=document.createElement('div');
      conf.className='btn gold'+(chosen.size===keepN?'':' disabled');
      conf.innerHTML='Confirm<span class="sub">lock it in</span>';
      if(chosen.size===keepN)conf.onclick=()=>{hidePrompt();resolve([...chosen].map(i=>pool[i]));};
      promptRow.appendChild(conf);
    };
    render();promptEl.classList.add('show');
  });
}

/* ============================================================
   AI BRAIN
   ============================================================ */
function aiChooseAction(ai){
  const opp=opponentsOf(ai);
  if(opp.length===0)return null;
  const has=ch=>hasChar(ai,ch);
  const bluffOk=ch=>revealedCount(ch)<3;

  const coupTarget=()=>{
    const oneInf=opp.filter(o=>hidden(o).length===1);
    if(oneInf.length)return oneInf.sort((a,b)=>b.coins-a.coins)[0];
    return [...opp].sort((a,b)=>b.coins-a.coins)[0];
  };
  if(ai.coins>=10)return {type:'coup',target:coupTarget()};
  if(ai.coins>=7 && Math.random()<0.8)return {type:'coup',target:coupTarget()};

  const canAssassinTruth=has('Assassin');
  const assassinBluff=!canAssassinTruth && bluffOk('Assassin') && Math.random()<0.25;
  if(ai.coins>=3 && (canAssassinTruth||assassinBluff)){
    const target=[...opp].sort((a,b)=>hidden(a).length-hidden(b).length || b.coins-a.coins)[0];
    ai.coins-=3;updateCoins(ai);
    return {type:'assassinate',character:'Assassin',target};
  }
  if(has('Captain')){
    const t=[...opp].filter(o=>o.coins>0).sort((a,b)=>b.coins-a.coins)[0];
    if(t)return {type:'steal',character:'Captain',target:t};
  }
  if(has('Duke'))return {type:'tax',character:'Duke'};
  if(has('Ambassador') && Math.random()<0.35)return {type:'exchange',character:'Ambassador'};
  if(bluffOk('Captain') && Math.random()<0.25){
    const t=[...opp].filter(o=>o.coins>0).sort((a,b)=>b.coins-a.coins)[0];
    if(t)return {type:'steal',character:'Captain',target:t};
  }
  if(bluffOk('Duke') && Math.random()<0.45)return {type:'tax',character:'Duke'};
  if(Math.random()<0.55)return {type:'foreign_aid'};
  return {type:'income'};
}

function aiWantsChallenge(ai,claimant,char){
  const own=ai.cards.filter(c=>!c.revealed&&c.char===char).length;
  const remaining=3-revealedCount(char)-own;
  if(remaining<=0)return true;
  let chance=0.08;
  if(remaining===1)chance+=0.14;
  const myHidden=hidden(ai).length;
  const totalHidden=players.reduce((s,p)=>s+hidden(p).length,0);
  const unknown=deck.length+(totalHidden-myHidden);
  const prob=unknown>0?Math.min(1,remaining/unknown):1;
  chance+=(1-prob)*0.18;
  if(claimant.coins>=7)chance+=0.06;
  if(hidden(ai).length===1)chance*=0.6;
  chance=Math.min(chance,0.85);
  return Math.random()<chance;
}

function aiBlockDecision(ai,actor,action,kind,blockChars){
  if(kind==='foreign_aid'){
    if(hasChar(ai,'Duke'))return Math.random()<0.65?'Duke':null;
    return Math.random()<0.14?'Duke':null;
  }
  if(kind==='steal'){
    if(hasChar(ai,'Captain'))return Math.random()<0.9?'Captain':null;
    if(hasChar(ai,'Ambassador'))return Math.random()<0.85?'Ambassador':null;
    if(Math.random()<0.4){
      const opts=blockChars.filter(c=>revealedCount(c)<3);
      if(opts.length)return opts[Math.floor(Math.random()*opts.length)];
    }
    return null;
  }
  if(kind==='assassinate'){
    if(hasChar(ai,'Contessa'))return Math.random()<0.95?'Contessa':null;
    if(revealedCount('Contessa')<3 && Math.random()<0.6)return 'Contessa';
    return null;
  }
  return null;
}

/* ============================================================
   POINTER / HOVER
   ============================================================ */
let hovered=null;
function onPointerMove(e){
  pointer.x=(e.clientX/innerWidth)*2-1;
  pointer.y=-(e.clientY/innerHeight)*2+1;
}
function onCanvasClick(){/* reserved */}

function updateHover(){
  if(!players.length)return;
  raycaster.setFromCamera(pointer,camera);
  const meshes=[];players.forEach(p=>p.cards.forEach(c=>meshes.push(c.mesh)));
  const hits=raycaster.intersectObjects(meshes,false);
  const hit=hits.length?hits[0].object:null;
  if(hovered&&hovered!==hit){const r=hovered.userData.cardRef;if(r&&!r.revealed)liftCard(hovered,false);hovered=null;}
  if(hit&&hit!==hovered){
    const owner=hit.userData.owner;const ref=hit.userData.cardRef;
    if(owner&&owner.isLocal&&ref&&!ref.revealed){liftCard(hit,true);hovered=hit;}
  }
}

/* ============================================================
   END GAME
   ============================================================ */
function endGame(){
  started=false;clearActions();hint('');
  const winner=alivePlayers()[0];
  if(onlineMode&&isHost){
    wsBroadcast({type:'game_over',winnerId:winner?winner.id:null,winnerName:winner?winner.name:null});
  }
  showEndScreen(winner);
}

function showEndScreen(winner){
  const endScreen=document.getElementById('endScreen');
  const title=document.getElementById('endTitle');
  const msg=document.getElementById('endmsg');
  if(winner&&winner.isLocal){
    title.textContent='VICTORY';title.className='crest';title.style.color='var(--gold-bright)';
    msg.innerHTML='The court is yours. Every rival lies exposed, their influence spent — and your final secrets were never called. <br><br>You are the last noble standing.';
  }else{
    title.textContent='DEFEAT';title.style.color='#c84a5a';
    msg.innerHTML=`Your influence is spent. <b style="color:var(--gold-bright)">${winner?winner.name:'A rival'}</b> seizes the court through cunning and nerve.<br><br>The game of deception claims another.`;
  }
  log(`<b>${winner?winner.name:'No one'}</b> wins the game!`,'big');
  endScreen.classList.remove('hidden');
}

/* ============================================================
   RENDER LOOP
   ============================================================ */
function animate(){
  requestAnimationFrame(animate);
  const t=clock.getElapsedTime();
  players.forEach(p=>{ if(p.coinGroup) p.coinGroup.rotation.y=Math.sin(t*0.5+p.id)*0.08; });
  if(started)updateHover();
  if(players.length)updatePlates();
  renderer.render(scene,camera);
}

/* ============================================================
   ONLINE MODE — REMOTE ACTION HELPERS (host side)
   ============================================================ */
async function remoteChooseAction(p){
  const opp=opponentsOf(p);
  const mustCoup=p.coins>=10;
  broadcastState();
  wsSendTo(p.id,{
    type:'prompt_action',
    mustCoup,
    coins:p.coins,
    opponents:opp.map(o=>({id:o.id,name:o.name,coins:o.coins,inf:hidden(o).length}))
  });
  const resp=await waitRemote(p.id);
  const action={type:resp.actionType};
  if(resp.character) action.character=resp.character;
  if(resp.targetId!==undefined&&resp.targetId!==null){
    action.target=playerByGid(resp.targetId);
    if(resp.actionType==='assassinate'){p.coins-=3;updateCoins(p);}
  }
  return action;
}

function broadcastState(){
  if(!onlineMode||!isHost) return;
  players.forEach(recipient=>{
    if(recipient.id===myPlayerId) return;
    wsSendTo(recipient.id,{
      type:'state',
      turnIndex,
      players:players.map(p=>({
        id:p.id,
        coins:p.coins,
        alive:p.alive,
        cards:p.cards.map(c=>({
          revealed:c.revealed,
          char:(c.revealed||p.id===recipient.id)?c.char:null
        }))
      }))
    });
  });
}

/* ============================================================
   ONLINE MODE — STATE APPLICATION (non-host side)
   ============================================================ */
function applyState(stateMsg){
  if(isHost) return;
  stateMsg.players.forEach(sp=>{
    const p=playerByGid(sp.id);
    if(!p) return;
    if(p.coins!==sp.coins){p.coins=sp.coins;updateCoins(p);}
    if(p.alive&&!sp.alive){
      p.alive=false;
      gsap.to(p.group.position,{y:-0.05,duration:0.5});
    }
    sp.cards.forEach((sc,j)=>{
      const card=p.cards[j];
      if(!card) return;
      if(sc.char&&card.char!==sc.char){
        card.char=sc.char;setCardFace(card.mesh,sc.char);
      }
      if(sc.revealed&&!card.revealed){
        card.revealed=true;
        revealPermanent(card);
      }
    });
  });
  // Map global turnIndex to local display index
  turnIndex=(stateMsg.turnIndex-myPlayerId+players.length)%players.length;
  refreshPlates();
}

/* ============================================================
   ONLINE MODE — REMOTE PROMPT DISPLAYS (non-host side)
   ============================================================ */
function showRemoteActionPrompt(msg){
  clearActions();
  const {mustCoup,coins,opponents}=msg;
  hint(mustCoup?'You have 10+ coins — you must launch a Coup.':'Your move, my lord. Choose an action.');

  const finish=(actionType,character,targetId)=>{
    clearActions();hint('');
    wsSend({type:'response_action',actionType,character:character||null,targetId:targetId===undefined?null:targetId});
  };
  const needTarget=(actionType,character)=>{
    const btns=opponents.map(o=>({label:o.name,sub:`${o.inf} inf · ${o.coins}c`,cls:'',value:o.id}));
    btns.push({label:'Cancel',sub:'go back',cls:'',value:'cancel'});
    showPrompt(`<b>${({coup:'Coup',steal:'Steal from',assassinate:'Assassinate'}[actionType]||'Target')}</b> which noble?`,btns)
      .then(v=>{ if(v==='cancel'){showRemoteActionPrompt(msg);}else{finish(actionType,character,v);} });
  };
  const make=(label,sub,cls,enabled,fn)=>{
    const el=document.createElement('div');el.className='btn '+cls+(enabled?'':' disabled');
    el.innerHTML=label+`<span class="sub">${sub}</span>`;
    if(enabled)el.onclick=fn;actionbar.appendChild(el);
  };

  if(mustCoup){
    make('Coup','7 coins · forced','danger gold',true,()=>needTarget('coup',null));
    return;
  }
  make('Income','+1 coin','',true,()=>finish('income',null,null));
  make('Foreign Aid','+2 · Duke blocks','',true,()=>finish('foreign_aid',null,null));
  make('Tax','Duke · +3 coins','gold',true,()=>finish('tax','Duke',null));
  make('Steal','Captain · take 2','',opponents.length>0,()=>needTarget('steal','Captain'));
  make('Assassinate','Assassin · pay 3','danger',coins>=3&&opponents.length>0,()=>needTarget('assassinate','Assassin'));
  make('Exchange','Ambassador','',true,()=>finish('exchange','Ambassador',null));
  make('Coup','pay 7','danger gold',coins>=7&&opponents.length>0,()=>needTarget('coup',null));
}

function showRemoteChallengePrompt(msg){
  const {claimantName,char}=msg;
  showPrompt(
    `<b>${claimantName}</b> claims <b>${char}</b>.<br><span style="font-size:16px;color:#b89b66">Do you call it a bluff?</span>`,
    [{label:'Challenge!',sub:'risk an influence',cls:'danger',value:true},
     {label:'Allow it',sub:'let it pass',cls:'',value:false}]
  ).then(value=>{ wsSend({type:'response_challenge',value}); });
}

function showRemoteBlockPrompt(msg){
  const {actorName,kind,blockChars}=msg;
  const map={
    foreign_aid:`<b>${actorName}</b> takes Foreign Aid.`,
    steal:`<b>${actorName}</b> tries to steal from you.`,
    assassinate:`<b>${actorName}</b> sends an assassin for you!`
  };
  const btns=blockChars.map(c=>({label:`Block · ${c}`,sub:'claim this card',cls:c==='Contessa'?'gold':'',value:c}));
  btns.push({label:'Do not block',sub:'allow it',cls:'',value:null});
  showPrompt(`${map[kind]}<br><span style="font-size:16px;color:#b89b66">Block the action?</span>`,btns)
    .then(claim=>{ wsSend({type:'response_block',claim}); });
}

function showRemoteLosePrompt(msg){
  const {cards,reason}=msg;
  const btns=cards.map(c=>({label:c.char,sub:'reveal this',cls:'danger',value:c.index}));
  showPrompt(
    `You must lose influence (<span class="em">${reason}</span>).<br><span style="font-size:16px;color:#b89b66">Which card do you reveal — forever?</span>`,
    btns
  ).then(cardIndex=>{ wsSend({type:'response_lose',cardIndex}); });
}

function showRemoteExchangePrompt(msg){
  const {pool,keepN}=msg;
  const chosen=new Set();
  const render=()=>{
    promptMsg.innerHTML=`<b>Exchange</b> — keep exactly <b>${keepN}</b> card${keepN>1?'s':''}.<br><span style="font-size:15px;color:#b89b66">Selected ${chosen.size}/${keepN}</span>`;
    promptRow.innerHTML='';
    pool.forEach((ch,i)=>{
      const el=document.createElement('div');
      const sel=chosen.has(i);
      el.className='btn '+(sel?'gold':'');
      el.innerHTML=ch+`<span class="sub">${sel?'✓ keeping':'tap to keep'}</span>`;
      el.onclick=()=>{
        if(sel)chosen.delete(i);
        else{if(chosen.size>=keepN){const first=chosen.values().next().value;chosen.delete(first);}chosen.add(i);}
        render();
      };
      promptRow.appendChild(el);
    });
    const conf=document.createElement('div');
    conf.className='btn gold'+(chosen.size===keepN?'':' disabled');
    conf.innerHTML='Confirm<span class="sub">lock it in</span>';
    if(chosen.size===keepN)conf.onclick=()=>{hidePrompt();wsSend({type:'response_exchange',indices:[...chosen]});};
    promptRow.appendChild(conf);
  };
  render();promptEl.classList.add('show');
}

/* ============================================================
   ONLINE MODE — WEBSOCKET MESSAGE HANDLER
   ============================================================ */
function handleWsMessage(msg){
  if(isHost){
    // Responses from remote players
    const responseMap={
      response_action:'response_action',
      response_challenge:'response_challenge',
      response_block:'response_block',
      response_lose:'response_lose',
      response_exchange:'response_exchange',
    };
    if(responseMap[msg.type]){
      resolveRemote(msg.from,msg);
      return;
    }
    if(msg.type==='player_joined'){
      onlinePlayers=msg.players;
      updateLobbyPlayerList();
    }
  }else{
    switch(msg.type){
      case 'state':        applyState(msg); break;
      case 'log':          log(msg.html,msg.cls); break;
      case 'banner_show':  showRemoteBanner(msg); break;
      case 'game_start':   handleOnlineGameStart(msg); break;
      case 'game_over':    handleOnlineGameOver(msg); break;
      case 'prompt_action':    showRemoteActionPrompt(msg); break;
      case 'prompt_challenge': showRemoteChallengePrompt(msg); break;
      case 'prompt_block':     showRemoteBlockPrompt(msg); break;
      case 'prompt_lose':      showRemoteLosePrompt(msg); break;
      case 'prompt_exchange':  showRemoteExchangePrompt(msg); break;
      case 'player_joined':
        onlinePlayers=msg.players;
        updateLobbyPlayerList();
        break;
      case 'player_left':
        log(`A player has disconnected.`,'sys');
        break;
    }
  }
}

async function showRemoteBanner(msg){
  bannerEl.innerHTML=`<div class="bt ${msg.colCls}">${msg.title}</div>`+(msg.sub?`<div class="bs">${msg.sub}</div>`:'');
  bannerEl.classList.add('show');
  await sleep(msg.hold||1300);
  bannerEl.classList.remove('show');
}

function handleOnlineGameStart(msg){
  onlineMode=true;
  onlinePlayers=msg.players;
  const n=msg.n;
  hideAllScreens();
  setupOnlineGame(n,onlinePlayers);
  started=true;
  document.getElementById('legend').innerHTML=`Online — ${onlinePlayers.map(p=>p.name).join(', ')} · Esc for rules`;
}

function handleOnlineGameOver(msg){
  started=false;clearActions();hint('');
  const winner=msg.winnerId!==null?playerByGid(msg.winnerId):null;
  showEndScreen(winner||{name:msg.winnerName||'A rival',isLocal:false});
}

/* ============================================================
   ONLINE MODE — WEBSOCKET CONNECTION
   ============================================================ */
function connectWs(code,pid){
  const proto=location.protocol==='https:'?'wss:':'ws:';
  ws=new WebSocket(`${proto}//${location.host}/ws/${code}/${pid}`);
  ws.onmessage=e=>handleWsMessage(JSON.parse(e.data));
  ws.onclose=()=>{
    if(started) log('Connection lost.','sys');
  };
  ws.onerror=()=>{ showOnlineError('Connection error. Is the server running?'); };
}

/* ============================================================
   LOBBY UI
   ============================================================ */
function hideAllScreens(){
  ['modeScreen','startScreen','onlineScreen','lobbyScreen','endScreen'].forEach(id=>{
    document.getElementById(id).classList.add('hidden');
  });
}

function showOnlineError(msg){
  const el=document.getElementById('onlineError');
  if(el){el.textContent=msg;}
}

async function doCreateLobby(){
  const name=document.getElementById('playerNameInput').value.trim()||'Player 1';
  showOnlineError('');
  try{
    const resp=await fetch('/lobby/create',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name})
    });
    const data=await resp.json();
    lobbyCode=data.code;
    myPlayerId=data.playerId;
    isHost=true;
    onlinePlayers=[{id:0,name}];
    connectWs(lobbyCode,myPlayerId);
    showLobbyScreen(lobbyCode);
  }catch(e){
    showOnlineError('Could not reach server.');
  }
}

async function doJoinLobby(){
  const code=document.getElementById('lobbyCodeInput').value.trim().toUpperCase();
  const name=document.getElementById('playerNameInput').value.trim()||'Player';
  showOnlineError('');
  if(!code||code.length!==4){showOnlineError('Enter a 4-letter lobby code.');return;}
  try{
    const resp=await fetch(`/lobby/join/${code}`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name})
    });
    const data=await resp.json();
    if(data.error){showOnlineError(data.error);return;}
    lobbyCode=data.code;
    myPlayerId=data.playerId;
    isHost=false;
    onlinePlayers=data.players;
    connectWs(lobbyCode,myPlayerId);
    showLobbyScreen(lobbyCode);
  }catch(e){
    showOnlineError('Could not reach server.');
  }
}

function showLobbyScreen(code){
  hideAllScreens();
  const lobby=document.getElementById('lobbyScreen');
  lobby.classList.remove('hidden');
  document.getElementById('lobbyCodeDisplay').textContent=code;
  // Host sees start button; non-host doesn't
  const startBtn=document.getElementById('startOnlineBtn');
  if(isHost){startBtn.classList.remove('hidden');}else{startBtn.classList.add('hidden');}
  updateLobbyPlayerList();
}

function updateLobbyPlayerList(){
  const list=document.getElementById('lobbyPlayerList');
  list.innerHTML='';
  onlinePlayers.forEach((p,i)=>{
    const el=document.createElement('div');
    el.className='lobby-player'+(p.id===myPlayerId?' is-you':'');
    el.textContent=`${p.name}${i===0?' (host)':''}${p.id===myPlayerId?' — you':''}`;
    list.appendChild(el);
  });
  const status=document.getElementById('lobbyStatus');
  const startBtn=document.getElementById('startOnlineBtn');
  if(isHost){
    const ready=onlinePlayers.length>=2;
    startBtn.disabled=!ready;
    status.textContent=ready?`${onlinePlayers.length} players ready — host can start.`:'Waiting for at least one more player…';
  }else{
    status.textContent=`${onlinePlayers.length} player${onlinePlayers.length!==1?'s':''} in lobby — waiting for host to start.`;
  }
}

function doStartOnlineGame(){
  if(!isHost||onlinePlayers.length<2) return;
  onlineMode=true;
  const n=onlinePlayers.length;
  wsBroadcast({type:'game_start',n,players:onlinePlayers});
  hideAllScreens();
  setupOnlineGame(n,onlinePlayers);
  document.getElementById('legend').innerHTML=`Online — ${onlinePlayers.map(p=>p.name).join(', ')} · Esc for rules`;
  sleep(700).then(()=>gameLoop());
}

/* ============================================================
   BOOT
   ============================================================ */
let chosenCount=4;

function buildPCountOpts(){
  const opts=document.getElementById('pcountOpts');
  opts.innerHTML='';
  [2,3,4].forEach(n=>{
    const el=document.createElement('div');el.className='opt';
    el.innerHTML=`<div class="n">${n}</div><div class="l">nobles</div>`;
    el.onclick=()=>{chosenCount=n;[...opts.children].forEach(c=>c.style.borderColor='');el.style.borderColor='var(--gold-bright)';el.style.boxShadow='0 0 24px rgba(212,175,55,.5)';};
    opts.appendChild(el);
  });
  opts.children[2].click();
}

async function startPracticeMatch(){
  hideAllScreens();
  logBody.innerHTML='';
  onlineMode=false;isHost=false;myPlayerId=0;
  setupGame(chosenCount);
  document.getElementById('legend').innerHTML='Hover your cards to inspect · 3× of each role exist · Esc for rules';
  await sleep(700);
  gameLoop();
}

async function boot(){
  initScene();
  try{
    await document.fonts.load('900 50px Cinzel');
    await document.fonts.load('italic 26px "Cormorant Garamond"');
    await document.fonts.ready;
  }catch(e){}
  buildPCountOpts();
  animate();

  // Mode screen buttons
  document.getElementById('practiceBtn').onclick=()=>{
    document.getElementById('modeScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
  };
  document.getElementById('onlineBtn').onclick=()=>{
    document.getElementById('modeScreen').classList.add('hidden');
    document.getElementById('onlineScreen').classList.remove('hidden');
  };

  // Practice screen
  document.getElementById('startBtn').onclick=startPracticeMatch;
  document.getElementById('backFromStartBtn').onclick=()=>{
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('modeScreen').classList.remove('hidden');
  };

  // Online screen
  document.getElementById('createLobbyBtn').onclick=doCreateLobby;
  document.getElementById('joinLobbyBtn').onclick=doJoinLobby;
  document.getElementById('lobbyCodeInput').addEventListener('keydown',e=>{
    if(e.key==='Enter') doJoinLobby();
  });
  document.getElementById('backFromOnlineBtn').onclick=()=>{
    document.getElementById('onlineScreen').classList.add('hidden');
    document.getElementById('modeScreen').classList.remove('hidden');
  };

  // Lobby screen
  document.getElementById('startOnlineBtn').onclick=doStartOnlineGame;

  // Rules overlay
  const rulesOverlay=document.getElementById('rulesOverlay');
  const toggleRules=()=>rulesOverlay.classList.toggle('hidden');
  document.getElementById('rulesClose').onclick=()=>rulesOverlay.classList.add('hidden');
  addEventListener('keydown',e=>{
    if(e.key==='Escape') toggleRules();
  });

  // End screen
  document.getElementById('againBtn').onclick=()=>{
    document.getElementById('endScreen').classList.add('hidden');
    document.getElementById('modeScreen').classList.remove('hidden');
    // Reset online state so new game is clean
    onlineMode=false;isHost=false;myPlayerId=0;ws=null;lobbyCode=null;onlinePlayers=[];
  };
}
boot();
