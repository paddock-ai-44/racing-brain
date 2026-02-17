import { useState, useMemo, useEffect } from "react";

// ─── CONFIG ───────────────────────────────────────────────────
const BASE_ID  = "appd4lJ5ZCraN4gUk";
const API_KEY = import.meta.env.VITE_AIRTABLE_KEY; console.log("API_KEY loaded:", API_KEY ? "YES (key present)" : "NO (undefined)");
const TABLES   = {
  horses:   "tblTo3Zsa0w8HSvZs",
  trainers: "tblVOaFVaqCgs2NzT",
  results:  "tblgfRjM3IrQU0qhu",
  races:    "tblSxHVRoo2pEwNe3",
  courses:  "tbllcnmsNZ7VQie9l",
};

// ─── FETCHER ──────────────────────────────────────────────────
async function fetchAll(tableId) {
  let records = [], offset = null;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`);
    if (offset) url.searchParams.set("offset", offset);
    url.searchParams.set("pageSize", "100");
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${API_KEY}` } });
    if (!res.ok) throw new Error(`Airtable error ${res.status}`);
    const data = await res.json();
    records = records.concat(data.records);
    offset = data.offset || null;
  } while (offset);
  return records;
}

// ─── DATA LOADER ──────────────────────────────────────────────
async function loadData() {
  const [horseRecs, trainerRecs, resultRecs, raceRecs, courseRecs] = await Promise.all([
    fetchAll(TABLES.horses),
    fetchAll(TABLES.trainers),
    fetchAll(TABLES.results),
    fetchAll(TABLES.races),
    fetchAll(TABLES.courses),
  ]);

  const courseMap = {};
  courseRecs.forEach(r => {
    courseMap[r.id] = { name: r.fields.course_name || "Unknown", handedness: r.fields.handedness || "Unknown" };
  });

  const raceMap = {};
  raceRecs.forEach(r => {
    const courseId = r.fields.Course?.[0];
    raceMap[r.id] = {
      distM: r.fields.distance_meters || 0,
      going: r.fields.going || "Unknown",
      date:  r.fields.race_date || "",
      courseName: courseId ? (courseMap[courseId]?.name || "Unknown") : "Unknown",
      handedness: courseId ? (courseMap[courseId]?.handedness || "Unknown") : "Unknown",
    };
  });

  const horseMap = {};
  horseRecs.forEach(r => {
    if (!r.fields.horse_name) return;
    horseMap[r.id] = { id:r.id, name:r.fields.horse_name, sex:r.fields.sex||"", sire:r.fields.sire_name||"", dam:r.fields.dam_name||"", country:r.fields.country_bred||"", results:[] };
  });

  const trainerMap = {};
  trainerRecs.forEach(r => {
    if (!r.fields.trainer_name) return;
    trainerMap[r.id] = { id:r.id, name:r.fields.trainer_name, results:[] };
  });

  resultRecs.forEach(r => {
    const horseId   = r.fields.Horse?.[0];
    const trainerId = r.fields.Trainer?.[0];
    const raceId    = r.fields.Race?.[0];
    if (!raceId || !raceMap[raceId]) return;
    const pos  = r.fields.position;
    if (!pos && !r.fields.position_text) return;
    const race = raceMap[raceId];
    const result = {
      date:race.date, course:race.courseName, handedness:race.handedness,
      distM:race.distM, going:race.going,
      pos:pos||99, or:r.fields.official_rating||null,
      beaten:r.fields.beaten_distance||0,
      horseName: horseId ? (horseMap[horseId]?.name || "Unknown") : "Unknown",
    };
    if (horseId && horseMap[horseId]) horseMap[horseId].results.push(result);
    if (trainerId && trainerMap[trainerId]) trainerMap[trainerId].results.push(result);
  });

  const sort = arr => arr.sort((a,b) => new Date(b.date)-new Date(a.date));
  const horses   = Object.values(horseMap).filter(h=>h.results.length>0).map(h=>({...h,results:sort(h.results)})).sort((a,b)=>a.name.localeCompare(b.name));
  const trainers = Object.values(trainerMap).filter(t=>t.results.length>0).map(t=>({...t,results:sort(t.results)})).sort((a,b)=>a.name.localeCompare(b.name));
  return { horses, trainers };
}

// ─── ANALYSIS ─────────────────────────────────────────────────
const mToF     = m => (m/201.168).toFixed(1);
const distBand = m => { const f=m/201.168; if(f<=6.5)return"Sprint (≤6.5f)"; if(f<=9)return"Mile (7–9f)"; if(f<=12)return"Middle (9–12f)"; if(f<=17)return"Long (12–17f)"; return"Staying (17f+)"; };
const goingGroup = g => { const l=(g||"").toLowerCase(); if(l.includes("heavy"))return"Heavy"; if(l.includes("good to soft")||l.includes("yielding"))return"Soft/Yield"; if(l.includes("soft"))return"Soft/Yield"; if(l.includes("good to firm"))return"Good/Firm"; if(l.includes("good"))return"Good"; if(l.includes("firm")||l.includes("fast"))return"Fast/Firm"; if(l.includes("standard"))return"Standard (AW)"; return g||"Unknown"; };

function calcScore(wins,places,runs,avgOR,bestOR) {
  if(!runs) return 0;
  const sw=Math.min(1,runs/5);
  return Math.round(((wins/runs)*40+(places/runs)*20+Math.min((avgOR||0)/130,1)*25+Math.min((bestOR||0)/130,1)*15)*sw*100);
}

function groupAnalysis(results,keyFn,labelKey) {
  const groups={};
  results.forEach(r=>{ const k=keyFn(r); if(!groups[k])groups[k]=[]; groups[k].push(r); });
  return Object.entries(groups).map(([k,runs])=>{
    const w=runs.filter(r=>r.pos===1).length, p=runs.filter(r=>r.pos<=3).length;
    const ors=runs.map(r=>r.or).filter(Boolean);
    const avgOR=ors.length?Math.round(ors.reduce((a,b)=>a+b,0)/ors.length):0;
    const bestOR=ors.length?Math.max(...ors):0;
    return {[labelKey]:k,runs:runs.length,wins:w,places:p,avgOR,bestOR,score:calcScore(w,p,runs.length,avgOR,bestOR)};
  }).sort((a,b)=>b.score-a.score);
}

function analyseHorse(horse) {
  const results=horse.results.filter(r=>r.pos<99);
  const totalRuns=results.length, wins=results.filter(r=>r.pos===1).length, places=results.filter(r=>r.pos<=3).length;
  const ors=results.map(r=>r.or).filter(Boolean);
  return { totalRuns, wins, places,
    bestOR:ors.length?Math.max(...ors):null, avgOR:ors.length?Math.round(ors.reduce((a,b)=>a+b,0)/ors.length):null,
    distAnalysis:  groupAnalysis(results,r=>distBand(r.distM),"band"),
    goingAnalysis: groupAnalysis(results,r=>goingGroup(r.going),"going"),
    handAnalysis:  groupAnalysis(results,r=>r.handedness||"Unknown","handedness"),
  };
}

function analyseTrainer(trainer) {
  const results=trainer.results.filter(r=>r.pos<99);
  const totalRuns=results.length, wins=results.filter(r=>r.pos===1).length, places=results.filter(r=>r.pos<=3).length;
  const ors=results.map(r=>r.or).filter(Boolean);
  return { totalRuns, wins, places,
    bestOR:ors.length?Math.max(...ors):null, avgOR:ors.length?Math.round(ors.reduce((a,b)=>a+b,0)/ors.length):null,
    distAnalysis:  groupAnalysis(results,r=>distBand(r.distM),"band"),
    goingAnalysis: groupAnalysis(results,r=>goingGroup(r.going),"going"),
    handAnalysis:  groupAnalysis(results,r=>r.handedness||"Unknown","handedness"),
    winRate: totalRuns ? Math.round((wins/totalRuns)*100) : 0,
  };
}

// ─── UI COMPONENTS ────────────────────────────────────────────
const ScoreBar = ({score}) => {
  const pct=Math.min(score,100), color=pct>=60?"#22d3a0":pct>=35?"#f5a623":"#e05c5c";
  return <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{flex:1,height:6,background:"#1e2a3a",borderRadius:3,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:color,borderRadius:3}}/></div><span style={{fontSize:12,color,fontWeight:700,minWidth:28,fontFamily:"monospace"}}>{score}</span></div>;
};

const StatPill = ({label,value,highlight}) => (
  <div style={{background:highlight?"rgba(34,211,160,0.1)":"rgba(255,255,255,0.04)",border:`1px solid ${highlight?"rgba(34,211,160,0.3)":"rgba(255,255,255,0.08)"}`,borderRadius:8,padding:"10px 14px",textAlign:"center"}}>
    <div style={{fontSize:11,color:"#6b8aad",fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase"}}>{label}</div>
    <div style={{fontSize:20,fontWeight:800,color:highlight?"#22d3a0":"#e8f0fe",marginTop:2,fontFamily:"'Playfair Display',Georgia,serif"}}>{value}</div>
  </div>
);

const SectionHeader = ({title,icon}) => (
  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
    <span>{icon}</span>
    <span style={{fontSize:13,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:"#6b8aad"}}>{title}</span>
    <div style={{flex:1,height:1,background:"rgba(255,255,255,0.06)"}}/>
  </div>
);

const BadgePos = ({pos}) => {
  const colors={1:["#f5c842","#2a1f00"],2:["#a0aec0","#1a1f2e"],3:["#c27b3a","#1e140a"]};
  const [bg,text]=colors[pos]||["#1e2a3a","#6b8aad"];
  return <div style={{width:28,height:28,borderRadius:"50%",background:bg,color:text,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,margin:"0 auto"}}>{pos>90?"NF":pos}</div>;
};

const ConditionTable = ({rows,keyField,keyLabel}) => (
  <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
    <thead><tr style={{borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
      {[keyLabel,"Runs","W–P","Win%","Avg OR","Best OR","Score"].map(h=>(
        <th key={h} style={{padding:"6px 8px",textAlign:h===keyLabel?"left":"center",color:"#6b8aad",fontSize:11,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase"}}>{h}</th>
      ))}
    </tr></thead>
    <tbody>{rows.map((r,i)=>(
      <tr key={i} style={{borderBottom:"1px solid rgba(255,255,255,0.04)",background:i===0?"rgba(34,211,160,0.04)":"transparent"}}>
        <td style={{padding:"10px 8px",color:i===0?"#22d3a0":"#c8d8f0",fontWeight:i===0?700:400}}>{i===0&&"★ "}{r[keyField]}</td>
        <td style={{padding:"10px 8px",textAlign:"center",color:"#8aa0be"}}>{r.runs}</td>
        <td style={{padding:"10px 8px",textAlign:"center",color:"#8aa0be"}}>{r.wins}–{r.places}</td>
        <td style={{padding:"10px 8px",textAlign:"center",color:r.wins>0?"#22d3a0":"#8aa0be",fontWeight:r.wins>0?700:400}}>{r.runs?Math.round((r.wins/r.runs)*100):0}%</td>
        <td style={{padding:"10px 8px",textAlign:"center",color:"#8aa0be"}}>{r.avgOR||"—"}</td>
        <td style={{padding:"10px 8px",textAlign:"center",color:"#c8d8f0"}}>{r.bestOR||"—"}</td>
        <td style={{padding:"10px 8px",minWidth:110}}><ScoreBar score={r.score}/></td>
      </tr>
    ))}</tbody>
  </table>
);

// ─── HORSE PROFILE ────────────────────────────────────────────
function HorseProfile({horse}) {
  const data = useMemo(()=>analyseHorse(horse),[horse]);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:16,alignItems:"start"}}>
        <div>
          <div style={{fontSize:26,fontWeight:800,color:"#e8f0fe",fontFamily:"'Playfair Display',Georgia,serif"}}>{horse.name}</div>
          <div style={{fontSize:13,color:"#6b8aad",marginTop:4}}>{horse.sex} · {horse.country}</div>
          {horse.sire&&<div style={{fontSize:12,color:"#4a6080",marginTop:2}}>By {horse.sire}{horse.dam?` ex ${horse.dam}`:""}</div>}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,minWidth:320}}>
          <StatPill label="Runs" value={data.totalRuns}/>
          <StatPill label="Wins" value={data.wins} highlight={data.wins>0}/>
          <StatPill label="Best OR" value={data.bestOR||"—"}/>
          <StatPill label="Avg OR" value={data.avgOR||"—"}/>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
        {[{label:"Optimal Distance",value:data.distAnalysis[0]?.band||"—",sub:`${data.distAnalysis[0]?.wins||0}W from ${data.distAnalysis[0]?.runs||0} runs`},{label:"Optimal Going",value:data.goingAnalysis[0]?.going||"—",sub:`${data.goingAnalysis[0]?.wins||0}W from ${data.goingAnalysis[0]?.runs||0} runs`},{label:"Track Preference",value:data.handAnalysis[0]?.handedness||"—",sub:`${data.handAnalysis[0]?.wins||0}W from ${data.handAnalysis[0]?.runs||0} runs`}].map((item,i)=>(
          <div key={i} style={{background:"rgba(34,211,160,0.06)",border:"1px solid rgba(34,211,160,0.2)",borderRadius:10,padding:"14px 16px"}}>
            <div style={{fontSize:11,color:"#22d3a0",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>{item.label}</div>
            <div style={{fontSize:15,fontWeight:800,color:"#e8f0fe",marginTop:6,fontFamily:"'Playfair Display',Georgia,serif"}}>{item.value}</div>
            <div style={{fontSize:11,color:"#6b8aad",marginTop:3}}>{item.sub}</div>
          </div>
        ))}
      </div>
      {[{title:"Distance Analysis",icon:"📏",rows:data.distAnalysis,field:"band",label:"Distance"},{title:"Going Analysis",icon:"🌧",rows:data.goingAnalysis,field:"going",label:"Going"},{title:"Track Direction",icon:"↩",rows:data.handAnalysis,field:"handedness",label:"Direction"}].map((s,i)=>(
        <div key={i} style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"16px 18px"}}>
          <SectionHeader title={s.title} icon={s.icon}/>
          <ConditionTable rows={s.rows} keyField={s.field} keyLabel={s.label}/>
        </div>
      ))}
      <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"16px 18px"}}>
        <SectionHeader title="Recent Form" icon="📋"/>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead><tr style={{borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
            {["Date","Course","Dist","Going","Pos","OR","Beaten"].map(h=>(
              <th key={h} style={{padding:"6px 8px",textAlign:h==="Course"||h==="Date"?"left":"center",color:"#6b8aad",fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>{horse.results.slice(0,15).map((r,i)=>(
            <tr key={i} style={{borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
              <td style={{padding:"9px 8px",color:"#6b8aad",fontFamily:"monospace",fontSize:12}}>{r.date}</td>
              <td style={{padding:"9px 8px",color:"#c8d8f0"}}>{r.course}</td>
              <td style={{padding:"9px 8px",textAlign:"center",color:"#8aa0be"}}>{r.distM?`${mToF(r.distM)}f`:"—"}</td>
              <td style={{padding:"9px 8px",textAlign:"center",color:"#8aa0be"}}>{r.going}</td>
              <td style={{padding:"9px 8px"}}><BadgePos pos={r.pos}/></td>
              <td style={{padding:"9px 8px",textAlign:"center",color:"#c8d8f0"}}>{r.or||"—"}</td>
              <td style={{padding:"9px 8px",textAlign:"center",color:r.pos===1?"#22d3a0":"#8aa0be"}}>{r.pos===1?"Won":r.pos<99?`${r.beaten}L`:"NF"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

// ─── TRAINER PROFILE ──────────────────────────────────────────
function TrainerProfile({trainer}) {
  const data = useMemo(()=>analyseTrainer(trainer),[trainer]);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:16,alignItems:"start"}}>
        <div>
          <div style={{fontSize:26,fontWeight:800,color:"#e8f0fe",fontFamily:"'Playfair Display',Georgia,serif"}}>{trainer.name}</div>
          <div style={{fontSize:13,color:"#6b8aad",marginTop:4}}>Trainer · {data.totalRuns} recorded runs</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,minWidth:320}}>
          <StatPill label="Runs"   value={data.totalRuns}/>
          <StatPill label="Wins"   value={data.wins} highlight={data.wins>0}/>
          <StatPill label="Places" value={data.places}/>
          <StatPill label="Win %"  value={`${data.winRate}%`} highlight={data.winRate>=20}/>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
        {[{label:"Best Distance",value:data.distAnalysis[0]?.band||"—",sub:`${data.distAnalysis[0]?.wins||0}W from ${data.distAnalysis[0]?.runs||0} runs`},{label:"Best Going",value:data.goingAnalysis[0]?.going||"—",sub:`${data.goingAnalysis[0]?.wins||0}W from ${data.goingAnalysis[0]?.runs||0} runs`},{label:"Track Preference",value:data.handAnalysis[0]?.handedness||"—",sub:`${data.handAnalysis[0]?.wins||0}W from ${data.handAnalysis[0]?.runs||0} runs`}].map((item,i)=>(
          <div key={i} style={{background:"rgba(34,211,160,0.06)",border:"1px solid rgba(34,211,160,0.2)",borderRadius:10,padding:"14px 16px"}}>
            <div style={{fontSize:11,color:"#22d3a0",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>{item.label}</div>
            <div style={{fontSize:15,fontWeight:800,color:"#e8f0fe",marginTop:6,fontFamily:"'Playfair Display',Georgia,serif"}}>{item.value}</div>
            <div style={{fontSize:11,color:"#6b8aad",marginTop:3}}>{item.sub}</div>
          </div>
        ))}
      </div>
      {[{title:"Distance Analysis",icon:"📏",rows:data.distAnalysis,field:"band",label:"Distance"},{title:"Going Analysis",icon:"🌧",rows:data.goingAnalysis,field:"going",label:"Going"},{title:"Track Direction",icon:"↩",rows:data.handAnalysis,field:"handedness",label:"Direction"}].map((s,i)=>(
        <div key={i} style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"16px 18px"}}>
          <SectionHeader title={s.title} icon={s.icon}/>
          <ConditionTable rows={s.rows} keyField={s.field} keyLabel={s.label}/>
        </div>
      ))}
      <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"16px 18px"}}>
        <SectionHeader title="Recent Results" icon="📋"/>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead><tr style={{borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
            {["Date","Horse","Course","Dist","Going","Pos"].map(h=>(
              <th key={h} style={{padding:"6px 8px",textAlign:h==="Horse"||h==="Date"||h==="Course"?"left":"center",color:"#6b8aad",fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>{trainer.results.slice(0,20).map((r,i)=>(
            <tr key={i} style={{borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
              <td style={{padding:"9px 8px",color:"#6b8aad",fontFamily:"monospace",fontSize:12}}>{r.date}</td>
              <td style={{padding:"9px 8px",color:"#c8d8f0",fontWeight:600}}>{r.horseName}</td>
              <td style={{padding:"9px 8px",color:"#8aa0be"}}>{r.course}</td>
              <td style={{padding:"9px 8px",textAlign:"center",color:"#8aa0be"}}>{r.distM?`${mToF(r.distM)}f`:"—"}</td>
              <td style={{padding:"9px 8px",textAlign:"center",color:"#8aa0be"}}>{r.going}</td>
              <td style={{padding:"9px 8px"}}><BadgePos pos={r.pos}/></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

// ─── SEARCH TAB ───────────────────────────────────────────────
function SearchTab({items, type, renderProfile}) {
  const [query,    setQuery]    = useState("");
  const [selected, setSelected] = useState(null);
  const filtered = items.filter(h=>h.name.toLowerCase().includes(query.toLowerCase()));
  const icon = type==="horse"?"🐴":"🎓";

  return (
    <div style={{display:"flex",flexDirection:"column",gap:24}}>
      <div style={{position:"relative",maxWidth:420}}>
        <span style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",color:"#4a6080"}}>🔍</span>
        <input value={query} onChange={e=>{setQuery(e.target.value);setSelected(null);}} placeholder={`Search ${type} name...`} style={{width:"100%",padding:"11px 14px 11px 38px",borderRadius:8,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:"#e8f0fe",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
      </div>
      {!selected && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
          {filtered.map(item=>{
            const d = type==="horse" ? analyseHorse(item) : analyseTrainer(item);
            return (
              <button key={item.id} onClick={()=>setSelected(item)}
                style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"16px 18px",textAlign:"left",cursor:"pointer",color:"inherit"}}
                onMouseEnter={e=>{e.currentTarget.style.background="rgba(34,211,160,0.05)";e.currentTarget.style.borderColor="rgba(34,211,160,0.2)";}}
                onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.03)";e.currentTarget.style.borderColor="rgba(255,255,255,0.08)";}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <span style={{fontSize:16}}>{icon}</span>
                  <span style={{fontSize:15,fontWeight:700,color:"#e8f0fe",fontFamily:"'Playfair Display',Georgia,serif"}}>{item.name}</span>
                </div>
                {type==="horse"&&item.sex&&<div style={{fontSize:12,color:"#4a6080",marginBottom:8}}>{item.sex}{item.country?` · ${item.country}`:""}</div>}
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
                  <span style={{fontSize:11,background:"rgba(255,255,255,0.06)",padding:"2px 8px",borderRadius:4,color:"#8aa0be"}}>{d.totalRuns} runs</span>
                  <span style={{fontSize:11,background:d.wins>0?"rgba(34,211,160,0.1)":"rgba(255,255,255,0.06)",padding:"2px 8px",borderRadius:4,color:d.wins>0?"#22d3a0":"#8aa0be"}}>{d.wins} wins</span>
                  {type==="horse"&&d.bestOR&&<span style={{fontSize:11,background:"rgba(255,255,255,0.06)",padding:"2px 8px",borderRadius:4,color:"#8aa0be"}}>OR {d.bestOR}</span>}
                  {type==="trainer"&&<span style={{fontSize:11,background:d.winRate>=20?"rgba(34,211,160,0.1)":"rgba(255,255,255,0.06)",padding:"2px 8px",borderRadius:4,color:d.winRate>=20?"#22d3a0":"#8aa0be"}}>{d.winRate}% SR</span>}
                </div>
                <div style={{fontSize:11,color:"#4a6080"}}>★ {d.distAnalysis[0]?.[type==="horse"?"band":"band"]||"—"} · {d.goingAnalysis[0]?.going||"—"}</div>
              </button>
            );
          })}
          {filtered.length===0&&<div style={{color:"#4a6080",fontSize:14,padding:"20px 0"}}>No {type}s found matching "{query}"</div>}
        </div>
      )}
      {selected&&(
        <div>
          <button onClick={()=>setSelected(null)} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,padding:"6px 14px",color:"#8aa0be",fontSize:13,cursor:"pointer",marginBottom:20,display:"flex",alignItems:"center",gap:6}}>
            ← Back to search
          </button>
          {renderProfile(selected)}
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────
export default function App() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [tab,     setTab]     = useState("horses");

  useEffect(()=>{
    loadData()
      .then(d=>{ setData(d); setLoading(false); })
      .catch(e=>{ setError(e.message); setLoading(false); });
  },[]);

  if (loading) return (
    <div style={{minHeight:"100vh",background:"#0d1520",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',system-ui,sans-serif"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:16}}>🏇</div>
        <div style={{fontSize:18,fontWeight:700,color:"#e8f0fe",fontFamily:"'Playfair Display',Georgia,serif",marginBottom:8}}>AI Racing Brain</div>
        <div style={{fontSize:14,color:"#6b8aad"}}>Loading live data...</div>
      </div>
    </div>
  );

  if (error) return (
    <div style={{minHeight:"100vh",background:"#0d1520",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',system-ui,sans-serif"}}>
      <div style={{textAlign:"center",maxWidth:440}}>
        <div style={{fontSize:36,marginBottom:16}}>⚠️</div>
        <div style={{fontSize:16,color:"#e05c5c",marginBottom:8}}>Failed to load data</div>
        <div style={{fontSize:13,color:"#6b8aad",wordBreak:"break-all"}}>{error}</div>
      </div>
    </div>
  );

  const { horses, trainers } = data;

  return (
    <div style={{minHeight:"100vh",background:"#0d1520",fontFamily:"'DM Sans',system-ui,sans-serif",color:"#c8d8f0"}}>
      {/* Nav */}
      <div style={{background:"rgba(13,21,32,0.97)",backdropFilter:"blur(10px)",borderBottom:"1px solid rgba(255,255,255,0.06)",padding:"0 32px",display:"flex",alignItems:"center",gap:32,position:"sticky",top:0,zIndex:50,height:64}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:32,height:32,background:"linear-gradient(135deg,#22d3a0,#0ea5e9)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🏇</div>
          <div>
            <div style={{fontFamily:"'Playfair Display',Georgia,serif",fontWeight:800,fontSize:17,color:"#e8f0fe",lineHeight:1}}>AI Racing Brain</div>
            <div style={{fontSize:10,color:"#3d5068",letterSpacing:"0.12em",textTransform:"uppercase"}}>paddock-ai.com</div>
          </div>
        </div>
        <div style={{display:"flex",gap:4}}>
          {[{id:"horses",label:"Horses",icon:"🐴"},{id:"trainers",label:"Trainers",icon:"🎓"}].map(n=>(
            <button key={n.id} onClick={()=>setTab(n.id)} style={{padding:"7px 16px",borderRadius:6,border:"none",background:tab===n.id?"rgba(34,211,160,0.1)":"transparent",color:tab===n.id?"#22d3a0":"#6b8aad",fontSize:13,cursor:"pointer",fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
              {n.icon} {n.label}
            </button>
          ))}
        </div>
        <div style={{marginLeft:"auto",fontSize:12,color:"#3d5068"}}>
          {horses.length} horses · {trainers.length} trainers
        </div>
      </div>

      {/* Content */}
      <div style={{maxWidth:1100,margin:"0 auto",padding:"32px 24px"}}>
        <div style={{fontSize:22,fontWeight:800,color:"#e8f0fe",fontFamily:"'Playfair Display',Georgia,serif",marginBottom:24}}>
          {tab==="horses" ? "🐴 Horse Search" : "🎓 Trainer Search"}
        </div>
        {tab==="horses" && <SearchTab items={horses} type="horse" renderProfile={h=><HorseProfile horse={h}/>}/>}
        {tab==="trainers" && <SearchTab items={trainers} type="trainer" renderProfile={t=><TrainerProfile trainer={t}/>}/>}
      </div>
    </div>
  );
}
