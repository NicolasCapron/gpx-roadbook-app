/* ============================================================
   Roadbook Autorisations — hiérarchie région/département/commune/rue
   ============================================================ */
const STATUS = {
  a_faire:  {label:"À faire",                short:"À faire",        color:"#000000", key:"1"},
  en_cours: {label:"En cours de validation", short:"En cours",       color:"#f4c20d", key:"2"},
  globale:  {label:"Autorisation globale (préfecture / Sport Vlaanderen)", short:"Autor. globale", color:"#2f6fed", key:"3"},
  ok:       {label:"Accordée",               short:"Accordée",       color:"#1f9d55", key:"4"},
  refuse:   {label:"Refusée",                short:"Refusée",        color:"#e02424", key:"5"},
};
const STATUS_ORDER=["a_faire","en_cours","globale","ok","refuse"];
const COVERED=new Set(["ok","globale"]);
const TRACE_TINTS=["#7aa2ff","#f78fb3","#7ee0c4","#f6c177","#c9a0ff","#8fd694","#f28fad","#69c0ff"];
const FLAG={FR:"🇫🇷",BE:"🇧🇪"};

const state={ project:{name:"Cyclosportive",traces:[],adminStatus:{}}, geocache:{}, filter:{off:{}}, selected:null, ui:{} };
let map,tileLayer; const traceLayers={}; let seq=1;

const $=s=>document.querySelector(s);
const el=(t,c)=>{const e=document.createElement(t);if(c)e.className=c;return e;};
const R=6371000,rad=d=>d*Math.PI/180;
function haversine(a,b){const dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
  const s=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));}
const fmtKm=m=>(m/1000).toFixed(m<10000?2:1)+" km";
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove("show"),2600);}

/* -------- clés administratives -------- */
function akey(level,cc,region,dept,commune){
  if(level==="region")   return "R|"+cc+"|"+(region||"");
  if(level==="dept")     return "D|"+cc+"|"+(region||"")+"|"+(dept||"");
  if(level==="commune")  return "C|"+cc+"|"+(region||"")+"|"+(dept||"")+"|"+(commune||"");
}
function segKeys(s){return {
  region:akey("region",s.country,s.region),
  dept:akey("dept",s.country,s.region,s.department),
  commune:akey("commune",s.country,s.region,s.department,s.commune)
};}
/* statut effectif d'une rue : override rue > commune > département > région > à faire */
function effective(s){
  if(s.override) return s.override;
  const as=state.project.adminStatus, k=segKeys(s);
  if(s.commune && as[k.commune]) return as[k.commune];
  if(s.department && as[k.dept]) return as[k.dept];
  if(s.region && as[k.region])  return as[k.region];
  return "a_faire";
}
/* d'où vient le statut (pour l'affichage "hérité de ...") */
function effectiveSource(s){
  if(s.override) return "rue";
  const as=state.project.adminStatus,k=segKeys(s);
  if(s.commune&&as[k.commune])return "commune";
  if(s.department&&as[k.dept])return "département";
  if(s.region&&as[k.region])return "région";
  return "défaut";
}

/* ============================================================
   GPX
   ============================================================ */
function parseGPX(xmlText,fallbackName){
  const doc=new DOMParser().parseFromString(xmlText,"application/xml");
  if(doc.getElementsByTagName("parsererror").length) throw new Error("GPX illisible");
  const byTag=t=>[...doc.getElementsByTagNameNS("*",t)];
  const firstNameIn=e=>{if(!e)return null;const n=e.getElementsByTagNameNS("*","name");return n.length?n[0].textContent.trim():null;};
  let name=firstNameIn(byTag("trk")[0])||firstNameIn(byTag("rte")[0])||firstNameIn(byTag("metadata")[0])||fallbackName;
  let nodes=byTag("trkpt"); if(!nodes.length)nodes=byTag("rtept"); if(!nodes.length)nodes=byTag("wpt");
  if(!nodes.length) throw new Error("Aucun point dans le GPX");
  const pts=[];let cum=0,prev=null;
  for(const n of nodes){const lat=parseFloat(n.getAttribute("lat")),lon=parseFloat(n.getAttribute("lon"));
    if(isNaN(lat)||isNaN(lon))continue;const p={lat,lon};if(prev)cum+=haversine(prev,p);p.dist=cum;pts.push(p);prev=p;}
  if(pts.length<2)throw new Error("Tracé trop court");
  return {name,points:pts,total:cum};
}
function addTrace(data){
  const id="t"+(seq++);
  const tint=TRACE_TINTS[state.project.traces.length%TRACE_TINTS.length];
  const trace={id,name:data.name,tint,visible:true,open:true,points:data.points,total:data.total,geocoded:false,segments:[]};
  trace.segments=[{id:id+"-s0",country:"",region:"",department:"",commune:"",road:"Tracé complet",
                   startIdx:0,endIdx:trace.points.length-1,distance:trace.total,override:null,note:""}];
  state.project.traces.push(trace);
  drawTrace(trace); fitAll(); render(); save();
  enqueueGeocode(trace);            // identification auto en arrière-plan
}

/* ============================================================
   Carte
   ============================================================ */
function initMap(){
  map=L.map("map",{zoomControl:true,preferCanvas:true}).setView([50.6,3.3],9);
  tileLayer=L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {attribution:"&copy; OpenStreetMap &copy; CARTO",subdomains:"abcd",maxZoom:20}).addTo(map);
  map.on("click",()=>selectSegment(null));
}
function segLatLngs(trace,seg){const a=Math.max(0,seg.startIdx),b=Math.min(trace.points.length-1,seg.endIdx);
  const out=[];for(let i=a;i<=b;i++)out.push([trace.points[i].lat,trace.points[i].lon]);return out;}
function drawTrace(trace){
  if(traceLayers[trace.id])map.removeLayer(traceLayers[trace.id]);
  const grp=L.layerGroup();traceLayers[trace.id]=grp;
  if(trace.visible){grp.addTo(map);redrawTraceSegments(trace);}
}
function redrawTraceSegments(trace){
  const grp=traceLayers[trace.id];if(!grp)return;grp.clearLayers();if(!trace.visible)return;
  for(const seg of trace.segments){
    const lls=segLatLngs(trace,seg);if(lls.length<2)continue;
    const st=effective(seg),col=STATUS[st].color;
    const isSel=state.selected&&state.selected.traceId===trace.id&&state.selected.segId===seg.id;
    const dim=isFilteredOut(st);
    const halo=L.polyline(lls,{color:"#fff",weight:isSel?11:8,opacity:dim?.14:.9,lineCap:"round",lineJoin:"round",interactive:false});
    const line=L.polyline(lls,{color:col,weight:isSel?6.5:4.5,opacity:dim?.18:1,lineCap:"round",lineJoin:"round"});
    line.on("click",ev=>{L.DomEvent.stop(ev);openStreetMenu(trace,seg,ev.latlng);});
    grp.addLayer(halo);grp.addLayer(line);
    if(isSel){const mid=lls[Math.floor(lls.length/2)];
      L.circleMarker(mid,{radius:7,color:"#fff",weight:2,fillColor:col,fillOpacity:1}).addTo(grp);}
  }
}
function redrawAll(){for(const t of state.project.traces)redrawTraceSegments(t);}
function fitAll(){const b=L.latLngBounds([]);
  for(const t of state.project.traces){if(!t.visible)continue;for(const p of t.points)b.extend([p.lat,p.lon]);}
  if(b.isValid())map.fitBounds(b,{padding:[40,40]});}
function fitSeg(trace,seg){const lls=segLatLngs(trace,seg);if(lls.length<2)return;
  map.fitBounds(L.latLngBounds(lls),{padding:[80,80],maxZoom:16});}

/* ============================================================
   Sélection & statuts
   ============================================================ */
function selectSegment(sel){state.selected=sel;redrawAll();renderTraces();}
function findSeg(traceId,segId){const t=state.project.traces.find(x=>x.id===traceId);if(!t)return null;
  const s=t.segments.find(x=>x.id===segId);return s?{trace:t,seg:s}:null;}

function setStreetStatus(traceId,segId,statusOrNull){
  const f=findSeg(traceId,segId);if(!f)return;f.seg.override=statusOrNull;
  redrawTraceSegments(f.trace);render();save();
}
function setAdminStatus(key,statusOrNull){
  if(statusOrNull)state.project.adminStatus[key]=statusOrNull; else delete state.project.adminStatus[key];
  redrawAll();render();save();
}

/* menu générique */
function buildMenu({title,sub,effLine,current,onPick,inheritLabel}){
  const div=el("div","stmenu");
  const h=el("div","sm-h");h.textContent=title;div.appendChild(h);
  if(sub){const s=el("div","sm-sub");s.textContent=sub;div.appendChild(s);}
  if(effLine){const e=el("div","sm-eff");e.innerHTML=effLine;div.appendChild(e);}
  for(const k of STATUS_ORDER){
    const st=STATUS[k];const b=el("button","opt"+(current===k?" on":""));
    const sw=el("span","sw2");sw.style.background=st.color;
    const lab=el("span");lab.textContent=st.label;
    const kk=el("span","kk");kk.textContent=st.key;
    b.append(sw,lab,kk);b.onclick=()=>onPick(k);div.appendChild(b);
  }
  const clr=el("button","opt clear");
  const sw=el("span","sw2 hollow");const lab=el("span");lab.textContent=inheritLabel||"Hériter (effacer ce niveau)";
  clr.append(sw,lab);clr.onclick=()=>onPick(null);div.appendChild(clr);
  return div;
}
function openStreetMenu(trace,seg,latlng){
  selectSegment({traceId:trace.id,segId:seg.id});
  const eff=effective(seg),src=effectiveSource(seg);
  const div=buildMenu({
    title:seg.road||"Rue",
    sub:(seg.commune||"—")+" · "+fmtKm(seg.distance),
    effLine:`Actuel : <b>${STATUS[eff].short}</b>${src!=="rue"?` (hérité du niveau ${src})`:""}`,
    current:seg.override,
    inheritLabel:"Hériter du niveau supérieur",
    onPick:(k)=>{setStreetStatus(trace.id,seg.id,k);pop.close();}
  });
  const ta=el("textarea");ta.placeholder="Note (n° dossier, contact mairie, date d'envoi…)";ta.value=seg.note||"";
  ta.oninput=()=>{seg.note=ta.value;};ta.onchange=()=>{save();renderTraces();};
  div.appendChild(ta);
  const pos=latlng||L.latLng(trace.points[Math.floor((seg.startIdx+seg.endIdx)/2)]);
  const pop=L.popup({minWidth:244,autoPan:true}).setLatLng(pos).setContent(div).openOn(map);
}
function openAdminMenu(level,parts,anchorLatLng){
  const key=akey(level,parts.cc,parts.region,parts.department,parts.commune);
  const labelLevel={region:"Région",dept:parts.cc==="BE"?"Province":"Département",commune:"Commune"}[level];
  const name={region:parts.region,dept:parts.department,commune:parts.commune}[level]||"—";
  const div=buildMenu({
    title:name,
    sub:labelLevel+(FLAG[parts.cc]?" · "+FLAG[parts.cc]:""),
    effLine:`S'applique à toutes les rues ${labelLevel.toLowerCase()==="région"?"de la région":labelLevel.toLowerCase()==="commune"?"de la commune":"du "+labelLevel.toLowerCase()}, sauf statut plus précis.`,
    current:state.project.adminStatus[key]||null,
    inheritLabel:"Ne pas fixer à ce niveau",
    onPick:(k)=>{setAdminStatus(key,k);if(anchorLatLng)pop.close();}
  });
  let pop;
  if(anchorLatLng){pop=L.popup({minWidth:244}).setLatLng(anchorLatLng).setContent(div).openOn(map);}
  else{ // ancrage flottant près du curseur via un popup DOM léger
    showFloating(div);
  }
}

/* petit conteneur flottant pour les menus déclenchés depuis la sidebar */
let floatEl=null;
function showFloating(node){
  closeFloating();
  floatEl=el("div");
  Object.assign(floatEl.style,{position:"fixed",zIndex:3000,left:"398px",top:"120px",background:"#fff",
    borderRadius:"12px",boxShadow:"0 12px 40px rgba(0,0,0,.4)",padding:"12px 14px",maxWidth:"280px"});
  floatEl.appendChild(node);
  document.body.appendChild(floatEl);
  setTimeout(()=>document.addEventListener("mousedown",floatAway),0);
}
function floatAway(e){if(floatEl&&!floatEl.contains(e.target))closeFloating();}
function closeFloating(){if(floatEl){floatEl.remove();floatEl=null;document.removeEventListener("mousedown",floatAway);}}

document.addEventListener("keydown",e=>{
  if(/INPUT|TEXTAREA/.test(document.activeElement.tagName))return;
  if(!state.selected)return;
  const m={"1":"a_faire","2":"en_cours","3":"globale","4":"ok","5":"refuse"};
  if(m[e.key])setStreetStatus(state.selected.traceId,state.selected.segId,m[e.key]);
});

/* ============================================================
   Géocodage inverse -> région / département / commune / rue
   ============================================================ */
const GEO={delay:1000,sample:200};
const geoKey=(lat,lon)=>lat.toFixed(4)+","+lon.toFixed(4);
// Passe par le proxy serveur /api/geocode de l'app Roadbook (Nominatim + rate-limit + retry
// mutualisés — voir server.js) plutôt que d'appeler Nominatim directement depuis le navigateur.
async function reverse(lat,lon){
  const k=geoKey(lat,lon);const cached=state.geocache[k];
  if(cached && cached.commune) return cached;   // on ne réutilise le cache que s'il a une commune (sinon on retente)
  let road="",commune="",region="",department="",cc="";
  try{
    const r=await fetch("/api/geocode",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({points:[{lat,lon}]})});
    const text=await r.text();
    const line=text.split("\n").find(l=>l.startsWith("data:"));
    if(line){
      const payload=JSON.parse(line.slice(5));
      road=payload.road||""; commune=payload.commune||"";
      region=payload.region||""; department=payload.department||""; cc=payload.cc||"";
    }
  }catch(e){}
  const res={road,commune,region,department,cc};state.geocache[k]=res;return res;
}
function sampleIndices(trace,stepM){
  const idx=[0];let last=0;
  for(let i=1;i<trace.points.length;i++)if(trace.points[i].dist-trace.points[last].dist>=stepM){idx.push(i);last=i;}
  if(idx[idx.length-1]!==trace.points.length-1)idx.push(trace.points.length-1);
  return idx;
}
async function geocodeTrace(trace,onProgress){
  const prev={};
  for(const s of trace.segments)if(s.commune&&s.override)prev[(s.commune+"|"+s.road).toLowerCase()]={override:s.override,note:s.note};
  const idx=sampleIndices(trace,GEO.sample);const labels=new Array(trace.points.length);
  for(let s=0;s<idx.length;s++){
    if(trace._cancelled) return;                       // arrêt demandé
    const i=idx[s],p=trace.points[i];const info=await reverse(p.lat,p.lon);
    const nextI=s+1<idx.length?idx[s+1]:trace.points.length;
    for(let j=i;j<nextI;j++)labels[j]=info;
    if(onProgress)onProgress((s+1)/idx.length);
    if(s<idx.length-1){
      await new Promise(r=>setTimeout(r,GEO.delay));
      while(geoPaused && !trace._cancelled){ updateGeoStatus(); await new Promise(r=>setTimeout(r,300)); }
    }
  }
  if(trace._cancelled) return;
  for(let j=0;j<labels.length;j++)if(!labels[j])labels[j]=labels[j-1]||{road:"",commune:"",region:"",department:"",cc:""};

  /* --- 1) Consolidation région/département/pays par commune (vote majoritaire) ---
     Une commune appartient à une seule région/département : on unifie pour éviter
     qu'une même commune se scinde entre "Hauts-de-France" et "(région inconnue)". */
  const info={};
  const bump=(o,v)=>{if(v)o[v]=(o[v]||0)+1;};
  for(const l of labels){ if(!l||!l.commune)continue;
    const c=l.commune; info[c]??={region:{},dept:{},cc:{}};
    bump(info[c].region,l.region); bump(info[c].dept,l.department); bump(info[c].cc,l.cc);
  }
  const top=o=>{let best="",n=0;for(const k in o)if(o[k]>n){n=o[k];best=k;}return best;};
  for(const c in info){info[c].R=top(info[c].region);info[c].D=top(info[c].dept);info[c].C=top(info[c].cc);}
  for(const l of labels){ if(!l||!l.commune)continue; const ci=info[l.commune];
    if(ci){ if(ci.R)l.region=ci.R; if(ci.D)l.department=ci.D; if(ci.C)l.cc=ci.C; } }

  /* --- 2) Continuité le long du parcours pour les points sans commune (dead zones / requêtes vides) :
     la région et le pays ne changent pas tous les 200 m -> on comble avec le voisin,
     en respectant la frontière (on ne propage pas au-delà d'un changement de pays). */
  let lastR="",lastCC="";
  for(const l of labels){ if(!l)continue;
    if(l.cc)lastCC=l.cc;
    if(l.region){lastR=l.region;}
    else if(lastR && (!l.cc || l.cc===lastCC)){l.region=lastR; if(!l.cc)l.cc=lastCC;}
  }
  let nextR="",nextCC="";
  for(let i=labels.length-1;i>=0;i--){ const l=labels[i]; if(!l)continue;
    if(l.cc)nextCC=l.cc;
    if(l.region){nextR=l.region;}
    else if(nextR && (!l.cc || l.cc===nextCC)){l.region=nextR; if(!l.cc)l.cc=nextCC;}
  }

  const segs=[];let cur=null;
  const keyOf=l=>[(l.region||""),(l.department||""),(l.commune||""),(l.road||"")].join("¦");
  for(let i=0;i<trace.points.length;i++){
    const l=labels[i]||{};const key=keyOf(l);
    if(!cur||cur._key!==key){if(cur)segs.push(cur);
      cur={_key:key,country:l.cc||"",region:l.region||"",department:l.department||"",
           commune:l.commune||"Commune inconnue",road:l.road||"Voie non nommée",startIdx:i,endIdx:i};}
    else cur.endIdx=i;
  }
  if(cur)segs.push(cur);
  let k=0;
  for(const s of segs){s.id=trace.id+"-s"+(k++);s.distance=trace.points[s.endIdx].dist-trace.points[s.startIdx].dist;
    const pk=(s.commune+"|"+s.road).toLowerCase();
    if(prev[pk]){s.override=prev[pk].override;s.note=prev[pk].note||"";}else{s.override=null;s.note="";}
    delete s._key;}
  trace.segments=segs;trace.geocoded=true;
}
/* ---- File d'attente de géocodage en arrière-plan (séquentielle) ---- */
let geoQueue=[], geoRunning=false, geoPaused=false, geoCurrent=null;

function setGeoBar(traceId,pct){
  const bar=document.querySelector(`[data-geobar="${traceId}"]`);
  if(bar){bar.style.display="block";bar.firstChild.style.width=Math.min(100,Math.max(0,pct)).toFixed(0)+"%";}
}
function updateGeoStatus(){
  const box=$("#geostatus");if(!box)return;
  const active=geoRunning||geoQueue.length||(geoCurrent&&geoCurrent.geocoding);
  if(!active){box.style.display="none";return;}
  box.style.display="flex";
  const pct=geoCurrent?Math.round((geoCurrent.geoProgress||0)*100):0;
  $("#gsText").textContent=(geoPaused?"En pause · ":"Identification · ")+(geoCurrent?geoCurrent.name+" — "+pct+"%":"…");
  $("#gsQueue").textContent=geoQueue.length?("+"+geoQueue.length+" en file"):"";
  $("#gsPause").textContent=geoPaused?"Reprendre":"Pause";
}
function enqueueGeocode(trace,{force=false}={}){
  if(!trace||trace.geocoding)return;
  if(trace.geocoded&&!force)return;
  if(geoQueue.includes(trace.id))return;
  if(force)trace.geocoded=false;
  trace.queued=true;geoQueue.push(trace.id);
  if(geoRunning&&!geoCurrent)geoRunning=false;   // auto-réparation si un état précédent est resté gelé
  renderTraces();updateGeoStatus();processQueue();
}
async function processQueue(){
  if(geoRunning)return;geoRunning=true;updateGeoStatus();
  try{
    while(geoQueue.length){
      const id=geoQueue.shift();
      const trace=state.project.traces.find(t=>t.id===id);
      if(!trace)continue;
      trace.queued=false;
      try{ await runGeocode(trace); }
      catch(err){ console.error("Identification échouée :",err); if(trace)trace.geocoding=false; toast("Un tracé a échoué — file poursuivie"); }
    }
  } finally {
    geoRunning=false;geoCurrent=null;updateGeoStatus();   // la file ne peut plus rester gelée
  }
}
async function runGeocode(trace){
  trace.geocoding=true;trace.geoProgress=0;trace._cancelled=false;geoCurrent=trace;
  try{ setGeoBar(trace.id,4);renderTraces();updateGeoStatus(); }catch(e){}
  try{
    await geocodeTrace(trace,p=>{trace.geoProgress=p;setGeoBar(trace.id,4+p*96);updateGeoStatus();});
    if(!trace._cancelled){
      const named=trace.segments.filter(s=>s.commune&&s.commune!=="Commune inconnue").length;
      toast(named?`${trace.segments.length} rues identifiées · ${trace.name}`
                 :"Géocodage sans résultat — vérifie le réseau (ouvrir le fichier en local)");
    }
  }catch(e){toast("Erreur : "+e.message);}
  trace.geocoding=false;geoCurrent=null;
  try{ redrawTraceSegments(trace);render();save(); }catch(e){ console.error("Rendu post-identification :",e); }
  updateGeoStatus();
}
function pauseGeo(){geoPaused=!geoPaused;updateGeoStatus();}
function stopGeo(){geoQueue.length=0;geoPaused=false;if(geoCurrent)geoCurrent._cancelled=true;
  state.project.traces.forEach(t=>t.queued=false);updateGeoStatus();renderTraces();toast("Identification arrêtée");}

/* ============================================================
   Agrégats & rendu
   ============================================================ */
function statusTotals(){
  const tot={};STATUS_ORDER.forEach(k=>tot[k]=0);let all=0;
  for(const t of state.project.traces){if(!t.visible)continue;for(const s of t.segments){tot[effective(s)]+=s.distance;all+=s.distance;}}
  return {tot,all};
}
const isFilteredOut=st=>!!state.filter.off[st];

function renderOverview(){
  const {tot,all}=statusTotals();
  const gs=$("#gstack");gs.innerHTML="";
  for(const k of STATUS_ORDER){const w=all?tot[k]/all*100:0;if(w<=0)continue;
    const i=el("i");i.style.width=w+"%";i.style.background=STATUS[k].color;i.title=STATUS[k].label+" · "+fmtKm(tot[k]);gs.appendChild(i);}
  const done=(tot.ok||0)+(tot.globale||0);
  $("#gpct").textContent=all?Math.round(done/all*100)+" % couvert":"0 %";
  $("#gkm").textContent=all?fmtKm(all)+" · "+state.project.traces.filter(t=>t.visible).length+" tracé(s)":"aucun tracé";
  const lg=$("#legend");lg.innerHTML="";
  for(const k of STATUS_ORDER){const st=STATUS[k];
    const row=el("div","lg"+(isFilteredOut(k)?" off":""));
    const sw=el("span","sw");sw.style.background=st.color;
    const n=el("span");n.textContent=st.short;
    const cnt=el("span","n");cnt.textContent=all?fmtKm(tot[k]):"—";
    row.append(sw,n,cnt);row.title="Filtrer la carte";
    row.onclick=()=>{state.filter.off[k]=!state.filter.off[k];renderOverview();redrawAll();};
    lg.appendChild(row);}
}

/* chip de statut réutilisable */
function statusChip(status, opts={}){
  const inherit=!status;
  const c=el("button","chip"+(inherit?" inherit":""));
  const dot=el("span","cdot");
  if(!inherit)dot.style.background=STATUS[status].color;
  const lab=el("span");lab.textContent=inherit?(opts.inheritLabel||"hérité"):STATUS[status].short;
  c.append(dot,lab);
  if(opts.onClick)c.onclick=e=>{e.stopPropagation();opts.onClick(e);};
  return c;
}
/* mini-barre de couverture (répartition effective d'un ensemble de segments) */
function coverageBar(segs){
  const bar=el("div","cov");const tot={};let all=0;STATUS_ORDER.forEach(k=>tot[k]=0);
  for(const s of segs){tot[effective(s)]+=s.distance;all+=s.distance;}
  for(const k of STATUS_ORDER){const w=all?tot[k]/all*100:0;if(w<=0)continue;
    const i=el("i");i.style.width=w+"%";i.style.background=STATUS[k].color;bar.appendChild(i);}
  return bar;
}

/* ---- Section "Autorisations globales" : région -> département ---- */
function renderGlobal(){
  const body=$("#globalBody");body.innerHTML="";
  // agréger tous les segments visibles identifiés
  const segs=[];
  for(const t of state.project.traces){if(!t.visible)continue;for(const s of t.segments)if(s.region||s.department)segs.push(s);}
  if(!segs.length){$("#secGlobal").style.display="none";return;}
  $("#secGlobal").style.display="block";
  // grouper par pays>région>département
  const tree={};
  for(const s of segs){
    const cc=s.country||"?",r=s.region||"(région inconnue)",d=s.department||"";
    tree[cc]??={};tree[cc][r]??={_segs:[],depts:{}};tree[cc][r]._segs.push(s);
    if(d){tree[cc][r].depts[d]??=[];tree[cc][r].depts[d].push(s);}
  }
  const ccs=Object.keys(tree).sort();
  for(const cc of ccs){
    for(const r of Object.keys(tree[cc]).sort()){
      const rNode=tree[cc][r];const parts={cc,region:r,department:"",commune:""};
      const key=akey("region",cc,r);
      const row=el("div","node lvl-region");
      const twig=el("span","twig");row.appendChild(twig);
      const flag=el("span","flag");flag.textContent=FLAG[cc]||"";
      const nm=el("span","nm");nm.append(flag,document.createTextNode(" "+r));
      row.appendChild(nm);
      row.appendChild(coverageBar(rNode._segs));
      row.appendChild(statusChip(state.project.adminStatus[key]||null,{inheritLabel:"fixer",onClick:()=>openAdminMenu("region",parts)}));
      body.appendChild(row);
      for(const d of Object.keys(rNode.depts).sort()){
        const dparts={cc,region:r,department:d,commune:""};const dkey=akey("dept",cc,r,d);
        const drow=el("div","node lvl-dept indent1");
        drow.appendChild(el("span","twig"));
        const dnm=el("span","nm");dnm.textContent=d;drow.appendChild(dnm);
        drow.appendChild(coverageBar(rNode.depts[d]));
        drow.appendChild(statusChip(state.project.adminStatus[dkey]||null,{inheritLabel:"fixer",onClick:()=>openAdminMenu("dept",dparts)}));
        body.appendChild(drow);
      }
    }
  }
}

/* ---- Tracés : arbre région > département > commune > rue ---- */
function renderTraces(){
  const wrap=$("#tracesBody");
  $("#emptyState").style.display=state.project.traces.length?"none":"block";
  $("#tracesTag").textContent=state.project.traces.length?state.project.traces.length+" tracé(s)":"";
  [...wrap.querySelectorAll(".trace")].forEach(n=>n.remove());
  for(const trace of state.project.traces){
    const card=el("div","trace"+(trace.open?" open":""));card.dataset.trace=trace.id;
    const head=el("div","trace-head");
    const chev=el("button","iconbtn");chev.innerHTML='<svg class="chev2" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    chev.onclick=()=>{trace.open=!trace.open;renderTraces();save();};
    const tw=el("span","tw");tw.style.background=trace.tint;
    const name=el("input","trace-name");name.value=trace.name;
    name.onchange=()=>{trace.name=name.value.trim()||trace.name;renderRail();save();};
    const geo=el("button","iconbtn");geo.title=trace.geocoding?"Identification en cours…":"Identifier (ré-identifier) communes & rues";
    geo.innerHTML=trace.geocoding
      ?'<svg viewBox="0 0 24 24" fill="none" class="spin"><path d="M12 3a9 9 0 1 0 9 9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'
      :'<svg viewBox="0 0 24 24" fill="none"><path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9" r="2.3" stroke="currentColor" stroke-width="2"/></svg>';
    geo.onclick=()=>{ if(trace.geocoding){toast("Déjà en cours…");return;} enqueueGeocode(trace,{force:true}); };
    const vis=el("button","iconbtn");vis.title=trace.visible?"Masquer":"Afficher";
    vis.innerHTML=trace.visible
      ?'<svg viewBox="0 0 24 24" fill="none"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="2"/></svg>'
      :'<svg viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18M10.6 10.6a2.6 2.6 0 0 0 3.7 3.7M9.9 5.2A9.6 9.6 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.6M6.3 6.3A17 17 0 0 0 2 12s4 7 10 7a9.6 9.6 0 0 0 3-.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    vis.onclick=()=>{trace.visible=!trace.visible;drawTrace(trace);render();save();};
    const del=el("button","iconbtn");del.title="Supprimer";
    del.innerHTML='<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    del.onclick=()=>{
      trace._cancelled=true; geoQueue=geoQueue.filter(x=>x!==trace.id);
      if(traceLayers[trace.id])map.removeLayer(traceLayers[trace.id]);delete traceLayers[trace.id];
      state.project.traces=state.project.traces.filter(t=>t.id!==trace.id);render();save();updateGeoStatus();};
    head.append(chev,tw,name,geo,vis,del);card.appendChild(head);

    const meta=el("div","trace-meta");
    const m1=el("span","m");m1.textContent=fmtKm(trace.total);
    const mr=el("div","mini-rail");
    for(const s of trace.segments){const i=el("i");i.style.width=(s.distance/trace.total*100)+"%";i.style.background=STATUS[effective(s)].color;mr.appendChild(i);}
    const m2=el("span","m");
    m2.textContent = trace.geocoding ? `identification… ${Math.round((trace.geoProgress||0)*100)}%`
                    : trace.queued   ? "en file d'attente"
                    : trace.geocoded ? trace.segments.length+" rues"
                    :                  "à identifier";
    meta.append(m1,mr,m2);card.appendChild(meta);

    const gb=el("div","geobar");gb.dataset.geobar=trace.id;const gbi=el("i");gb.appendChild(gbi);
    if(trace.geocoding){gb.style.display="block";gbi.style.width=(4+(trace.geoProgress||0)*96).toFixed(0)+"%";}
    card.appendChild(gb);

    if(trace.open){
      const body=el("div","trace-body");
      if(!trace.geocoded){
        const s0=trace.segments[0];
        const row=el("div","node lvl-street"+(state.selected&&state.selected.segId===s0.id?" sel":""));
        row.appendChild(el("span","twig"));
        const nm=el("span","nm");nm.textContent="Tracé complet (non identifié)";row.appendChild(nm);
        row.appendChild(statusChip(effective(s0),{onClick:()=>openStreetMenu(trace,s0)}));
        row.onclick=()=>{selectSegment({traceId:trace.id,segId:s0.id});openStreetMenu(trace,s0);};
        body.appendChild(row);
      }else{
        buildTraceTree(trace,body);
      }
      card.appendChild(body);
    }
    wrap.appendChild(card);
  }
}

function buildTraceTree(trace,container){
  // hiérarchie région>dept>commune>segments (dans l'ordre du parcours)
  const regions=[];const rmap={},dmap={},cmap={};
  for(const s of trace.segments){
    const rk=s.region||"—",dk=(s.region||"—")+"¦"+(s.department||""),ck=dk+"¦"+(s.commune||"");
    if(!rmap[rk]){rmap[rk]={name:s.region,cc:s.country,depts:[],_segs:[]};regions.push(rmap[rk]);}
    rmap[rk]._segs.push(s);
    let dnode=dmap[dk];
    if(!dnode){dnode={name:s.department,cc:s.country,region:s.region,communes:[],_segs:[]};dmap[dk]=dnode;rmap[rk].depts.push(dnode);}
    dnode._segs.push(s);
    let cnode=cmap[ck];
    if(!cnode){cnode={name:s.commune,cc:s.country,region:s.region,department:s.department,segs:[]};cmap[ck]=cnode;dnode.communes.push(cnode);}
    cnode.segs.push(s);
  }
  const exp=state.ui.exp||(state.ui.exp={});
  for(const r of regions){
    const rExpKey=trace.id+"|R|"+r.name;const rOpen=exp[rExpKey]!==false; // régions ouvertes par défaut
    const parts={cc:r.cc,region:r.name,department:"",commune:""};
    const rrow=nodeRow("region",r.name,r.cc,r._segs,rOpen,()=>{exp[rExpKey]=!rOpen;renderTraces();},
      state.project.adminStatus[akey("region",r.cc,r.name)]||null,()=>openAdminMenu("region",parts),0);
    container.appendChild(rrow);
    if(!rOpen)continue;
    for(const d of r.depts){
      const hasDept=!!d.name;
      const dExpKey=trace.id+"|D|"+r.name+"|"+d.name;const dOpen=exp[dExpKey]!==false;
      const dparts={cc:d.cc,region:r.name,department:d.name,commune:""};
      if(hasDept){
        const drow=nodeRow("dept",d.name,d.cc,d._segs,dOpen,()=>{exp[dExpKey]=!dOpen;renderTraces();},
          state.project.adminStatus[akey("dept",d.cc,r.name,d.name)]||null,()=>openAdminMenu("dept",dparts),1);
        container.appendChild(drow);
        if(!dOpen)continue;
      }
      for(const c of d.communes){
        const cExpKey=trace.id+"|C|"+r.name+"|"+d.name+"|"+c.name;const cOpen=exp[cExpKey]!==false;
        const cparts={cc:c.cc,region:r.name,department:d.name,commune:c.name};
        const crow=nodeRow("commune",c.name,c.cc,c.segs,cOpen,()=>{exp[cExpKey]=!cOpen;renderTraces();},
          state.project.adminStatus[akey("commune",c.cc,r.name,d.name,c.name)]||null,()=>openAdminMenu("commune",cparts),hasDept?2:1);
        container.appendChild(crow);
        if(!cOpen)continue;
        for(const s of c.segs){
          const srow=el("div","node lvl-street indent"+(hasDept?3:2)+(state.selected&&state.selected.segId===s.id?" sel":""));
          srow.appendChild(el("span","twig"));
          const nm=el("span","nm");nm.textContent=s.road;srow.appendChild(nm);
          if(s.note){const ni=el("span","note-i");ni.title=s.note;ni.innerHTML='<svg viewBox="0 0 24 24" fill="none"><path d="M4 4h16v12H8l-4 4V4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';srow.appendChild(ni);}
          const km=el("span","km");km.textContent=fmtKm(s.distance);srow.appendChild(km);
          // pastille = statut effectif (pastille pleine) ; grisée + info si héritée
          const eff=effective(s);
          const chip=statusChip(eff,{onClick:()=>openStreetMenu(trace,s)});
          if(!s.override){chip.style.opacity=".72";chip.title="Hérité du niveau "+effectiveSource(s);}
          srow.appendChild(chip);
          srow.onclick=()=>{selectSegment({traceId:trace.id,segId:s.id});fitSeg(trace,s);};
          container.appendChild(srow);
        }
      }
    }
  }
}
function nodeRow(level,name,cc,segs,open,onToggle,adminStatus,onChip,indent){
  const row=el("div","node lvl-"+level+(indent?" indent"+indent:""));
  const twig=el("span","twig");
  const tb=el("button");tb.innerHTML='<svg viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  row.classList.toggle("exp",open);
  tb.onclick=e=>{e.stopPropagation();onToggle();};twig.appendChild(tb);row.appendChild(twig);
  const nm=el("span","nm");
  if(FLAG[cc]&&level==="region"){const f=el("span","flag");f.textContent=FLAG[cc];nm.append(f,document.createTextNode(" "+name));}
  else nm.textContent=name||"—";
  row.appendChild(nm);
  row.appendChild(coverageBar(segs));
  row.appendChild(statusChip(adminStatus,{inheritLabel:"fixer",onClick:onChip}));
  return row;
}

/* ---- Rail bas ---- */
function renderRail(){
  const body=$("#railBody");body.innerHTML="";
  const vis=state.project.traces.filter(t=>t.visible);
  if(!vis.length){body.innerHTML='<div style="color:var(--muted-2);font-size:12px">Charge un tracé pour voir son avancement.</div>';return;}
  for(const trace of vis){
    const row=el("div","railrow");
    const rh=el("div","rh");const tw=el("span","tw");tw.style.background=trace.tint;
    const b=el("b");b.textContent=trace.name;
    let all=0,done=0;for(const s of trace.segments){all+=s.distance;if(COVERED.has(effective(s)))done+=s.distance;}
    const sp=el("span");sp.textContent=fmtKm(trace.total)+" · "+(all?Math.round(done/all*100):0)+" % couvert";
    rh.append(tw,b,sp);row.appendChild(rh);
    const bar=el("div","rbar");
    for(const s of trace.segments){const i=el("i");i.style.width=(s.distance/trace.total*100)+"%";i.style.background=STATUS[effective(s)].color;
      i.title=`${s.road} — ${s.commune} · ${STATUS[effective(s)].label} · ${fmtKm(s.distance)}`;
      i.onclick=()=>{selectSegment({traceId:trace.id,segId:s.id});fitSeg(trace,s);openStreetMenu(trace,s);};
      bar.appendChild(i);}
    row.appendChild(bar);body.appendChild(row);
  }
}
function render(){renderOverview();renderGlobal();renderTraces();renderRail();updateGeoStatus();}

/* ============================================================
   Persistance + import/export + impression
   ============================================================ */
const LSKEY="roadbook_autorisations_v2";
function serialize(){
  return {project:{name:state.project.name,adminStatus:state.project.adminStatus,
    traces:state.project.traces.map(t=>({id:t.id,name:t.name,tint:t.tint,visible:t.visible,open:t.open,
      total:t.total,geocoded:t.geocoded,points:t.points,
      segments:t.segments.map(({...s})=>s)}))},
    geocache:state.geocache,filter:state.filter,seq,ui:state.ui};
}
function save(){try{localStorage.setItem(LSKEY,JSON.stringify(serialize()));}catch(e){}}
function load(){try{const raw=localStorage.getItem(LSKEY);if(!raw)return migrateV1();applyData(JSON.parse(raw));return true;}catch(e){return false;}}
function migrateV1(){
  try{const raw=localStorage.getItem("roadbook_autorisations_v1");if(!raw)return false;
    const d=JSON.parse(raw);
    for(const t of d.project.traces||[])for(const s of t.segments||[]){
      s.region=s.region||"";s.department=s.department||"";
      s.override=(s.status&&s.status!=="a_faire")?s.status:null;delete s.status;
      if(s.commune==="Non identifié")s.commune="";
    }
    d.project.adminStatus=d.project.adminStatus||{};
    applyData(d);toast("Ancien projet migré vers la hiérarchie");return true;
  }catch(e){return false;}
}
function applyData(d){
  state.project=d.project||{name:"Cyclosportive",traces:[],adminStatus:{}};
  state.project.adminStatus=state.project.adminStatus||{};
  state.geocache=d.geocache||{};state.filter=d.filter||{off:{}};state.ui=d.ui||{};seq=d.seq||(state.project.traces.length+1);
  for(const id in traceLayers){if(traceLayers[id])map.removeLayer(traceLayers[id]);delete traceLayers[id];}
  for(const t of state.project.traces)drawTrace(t);
  fitAll();render();
  // reprise auto : identifier les tracés visibles pas encore identifiés
  for(const t of state.project.traces){ t.geocoding=false;t.queued=false; if(t.visible&&!t.geocoded)enqueueGeocode(t); }
}
function exportJSON(){
  const blob=new Blob([JSON.stringify(serialize(),null,1)],{type:"application/json"});
  const a=el("a");a.href=URL.createObjectURL(blob);
  a.download=(state.project.name||"autorisations").replace(/\s+/g,"_")+".json";a.click();toast("Projet exporté");
}
function printList(){
  const w=window.open("","_blank");
  const css=`body{font-family:Inter,Arial,sans-serif;margin:26px;color:#111}
    h1{font-size:18px;margin:0 0 2px}h2{font-size:14px;margin:18px 0 4px;border-bottom:1px solid #ccc;padding-bottom:3px}
    h3{font-size:12px;margin:10px 0 3px;color:#444}h4{font-size:11px;margin:7px 0 2px;color:#666;font-weight:600}
    table{width:100%;border-collapse:collapse;font-size:11px}td,th{border-bottom:1px solid #e8e8e8;padding:3px 6px;text-align:left;vertical-align:top}
    .b{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:middle;box-shadow:0 0 0 .5px #999}
    .muted{color:#888}.glob{font-size:11px}`;
  let html=`<h1>${state.project.name} — suivi des autorisations</h1><div class="muted">Édité le ${new Date().toLocaleDateString("fr-FR")}</div>`;
  const glob=Object.entries(state.project.adminStatus);
  if(glob.length){
    html+=`<h2>Autorisations posées par périmètre</h2>`;
    for(const [k,st] of glob){const p=k.split("|");const lvl=k[0]==="R"?"Région":k[0]==="D"?"Département/Province":"Commune";
      const nm=p[p.length-1]||"—";html+=`<div class="glob"><span class="b" style="background:${STATUS[st].color}"></span><b>${lvl} ${nm}</b> — ${STATUS[st].short}</div>`;}
  }
  for(const t of state.project.traces){
    html+=`<h2>${t.name} — ${fmtKm(t.total)}</h2><table><tbody>`;
    let lr=null,lc=null;
    for(const s of t.segments){
      const eff=effective(s);
      if(s.region!==lr){html+=`<tr><td colspan="4"><h3>${FLAG[s.country]||""} ${s.region||""}${s.department?" — "+s.department:""}</h3></td></tr>`;lr=s.region;lc=null;}
      if(s.commune!==lc){html+=`<tr><td colspan="4"><h4>${s.commune||""}</h4></td></tr>`;lc=s.commune;}
      html+=`<tr><td style="width:42%"><span class="b" style="background:${STATUS[eff].color}"></span>${s.road}</td>
        <td style="width:13%" class="muted">${fmtKm(s.distance)}</td>
        <td style="width:20%">${STATUS[eff].short}${s.override?"":" <span class='muted'>(hérité)</span>"}</td>
        <td class="muted">${(s.note||"").replace(/</g,"&lt;")}</td></tr>`;
    }
    html+="</tbody></table>";
  }
  w.document.write(`<html><head><meta charset="utf-8"><title>${state.project.name}</title><style>${css}</style></head><body>${html}</body></html>`);
  w.document.close();w.focus();setTimeout(()=>w.print(),350);
}

/* ============================================================
   Fichiers & sections
   ============================================================ */
$("#gpxInput").addEventListener("change",async e=>{
  const files=[...e.target.files];e.target.value="";
  for(const f of files){try{const txt=await f.text();addTrace(parseGPX(txt,f.name.replace(/\.gpx$/i,"")));}
    catch(err){toast(f.name+" : "+err.message);}}
});
$("#jsonInput").addEventListener("change",async e=>{
  const f=e.target.files[0];e.target.value="";if(!f)return;
  try{applyData(JSON.parse(await f.text()));save();toast("Projet importé");}catch(err){toast("Import impossible : "+err.message);}
});
$("#btnExport").onclick=exportJSON;
$("#btnPrint").onclick=printList;
$("#btnGeoAll").onclick=()=>{
  const vis=state.project.traces.filter(t=>t.visible);
  if(!vis.length){toast("Aucun tracé visible");return;}
  let n=0;const pending=vis.filter(t=>!t.geocoded&&!t.geocoding&&!t.queued);
  const targets=pending.length?pending:vis;   // sinon, ré-identifier tout
  for(const t of targets){enqueueGeocode(t,{force:!pending.length});n++;}
  toast(n+" tracé(s) en file d'attente");
};
document.querySelectorAll("[data-toggle]").forEach(h=>h.onclick=()=>{const s=$("#"+h.dataset.toggle);s.classList.toggle("open");});
$("#gsPause").onclick=pauseGeo;
$("#gsStop").onclick=stopGeo;

/* ============================================================
   Boot
   ============================================================ */
if(typeof L==="undefined"){
  document.body.innerHTML='<p style="padding:40px;font-family:sans-serif">Leaflet n\'a pas pu se charger. Ouvre le fichier localement dans un navigateur récent.</p>';
}else{
  initMap();render();load();
}
