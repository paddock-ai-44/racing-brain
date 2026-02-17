import { useState, useMemo, useEffect } from "react";

const BASE_ID = "appd4lJ5ZCraN4gUk";
const TABLES = {
  horses:  "tblTo3Zsa0w8HSvZs",
  results: "tblgfRjM3IrQU0qhu",
  races:   "tblSxHVRoo2pEwNe3",
  courses: "tbllcnmsNZ7VQie9l",
};

async function fetchAll(tableId, apiKey) {
  let records = [], offset = null;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`);
    if (offset) url.searchParams.set("offset", offset);
    url.searchParams.set("pageSize", "100");
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    records = records.concat(data.records);
    offset = data.offset || null;
  } while (offset);
  return records;
}

async function loadData(apiKey) {
  const [horseRecs, resultRecs, raceRecs, courseRecs] = await Promise.all([
    fetchAll(TABLES.horses, apiKey),
    fetchAll(TABLES.results, apiKey),
    fetchAll(TABLES.races, apiKey),
    fetchAll(TABLES.courses, apiKey),
  ]);

  const courseMap = {};
  courseRecs.forEach(r => {
    courseMap[r.id] = {
      name: r.fields.course_name || "Unknown",
      handedness: r.fields.handedness || "Unknown",
      region: r.fields.region || "",
    };
  });

  const raceMap = {};
  raceRecs.forEach(r => {
    const courseId = r.fields.Course?.[0];
    raceMap[r.id] = {
      distM: r.fields.distance_meters || 0,
      going: r.fields.going || "Unknown",
      raceType: r.fields.race_type || "Flat",
      date: r.fields.race_date || "",
      courseName: courseId ? (courseMap[courseId]?.name || "Unknown") : "Unknown",
      handedness: courseId ? (courseMap[courseId]?.handedness || "Unknown") : "Unknown",
    };
  });

  const horseMap = {};
  horseRecs.forEach(r => {
    if (!r.fields.horse_name) return;
    horseMap[r.id] = {
      id: r.id,
      name: r.fields.horse_name,
      sex: r.fields.sex || "",
      sire: r.fields.sire_name || "",
      dam: r.fields.dam_name || "",
      country: r.fields.country_bred || "",
      results: [],
    };
  });

  resultRecs.forEach(r => {
    const horseId = r.fields.Horse?.[0];
    const raceId = r.fields.Race?.[0];
    if (!horseId || !raceId || !horseMap[horseId] || !raceMap[raceId]) return;
    const pos = r.fields.position;
    if (!pos && !r.fields.position_text) return;
    const race = raceMap[raceId];
    horseMap[horseId].results.push({
      date: race.date, course: race.courseName, handedness: race.handedness,
      distM: race.distM, going: race.going, raceType: race.raceType,
      pos: pos || 99, or: r.fields.official_rating || null,
      beaten: r.fields.beaten_distance || 0, prize: r.fields.prize_won || 0,
    });
  });

  return Object.values(horseMap)
    .filter(h => h.results.length > 0)
    .map(h => ({ ...h, results: h.results.sort((a, b) => new Date(b.date) - new Date(a.date)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const mToF = m => (m / 201.168).toFixed(1);
const distBand = m => {
  const f = m / 201.168;
  if (f <= 6.5) return "Sprint (≤6.5f)";
  if (f <= 9) return "Mile (7–9f)";
  if (f <= 12) return "Middle (9–12f)";
  if (f <= 17) return "Long (12–17f)";
  return "Staying (17f+)";
};
const goingGroup = g => {
  const l = (g || "").toLowerCase();
  if (l.includes("heavy")) return "Heavy";
  if (l.includes("good to soft") || l.includes("yielding")) return "Soft/Yield";
  if (l.includes("soft")) return "Soft/Yield";
  if (l.includes("good to firm")) return "Good/Firm";
  if (l.includes("good")) return "Good";
  if (l.includes("firm") || l.includes("fast")) return "Fast/Firm";
  if (l.includes("standard")) return "Standard (AW)";
  return g || "Unknown";
};

function calcScore(wins, places, runs, avgOR, bestOR) {
  if (runs === 0) return 0;
  const sw = Math.min(1, runs / 5);
  return Math.round(((wins/runs)*40 + (places/runs)*20 + Math.min((avgOR||0)/130,1)*25 + Math.min((bestOR||0)/130,1)*15) * sw * 100);
}

function groupAnalysis(results, keyFn, labelKey) {
  const groups = {};
  results.forEach(r => { const k = keyFn(r); if (!groups[k]) groups[k] = []; groups[k].push(r); });
  return Object.entries(groups).map(([k, runs]) => {
    const w = runs.filter(r => r.pos === 1).length;
    const p = runs.filter(r => r.pos <= 3).length;
    const ors = runs.map(r => r.or).filter(Boolean);
    const avgOR = ors.length ? Math.round(ors.reduce((a,b)=>a+b,0)/ors.length) : 0;
    const bestOR = ors.length ? Math.max(...ors) : 0;
    return { [labelKey]: k, runs: runs.length, wins: w, places: p, avgOR, bestOR, score: calcScore(w,p,runs.length,avgOR,bestOR) };
  }).sort((a, b) => b.score - a.score);
}

function analyseHorse(horse) {
  const results = horse.results.filter(r => r.pos < 99);
  const totalRuns = results.length;
  const wins = results.filter(r => r.pos === 1).length;
  const places = results.filter(r => r.pos <= 3).length;
  const ors = results.map(r => r.or).filter(Boolean);
  const bestOR = ors.length ? Math.max(...ors) : null;
  const avgOR = ors.length ? Math.round(ors.reduce((a,b)=>a+b,0)/ors.length) : null;
  return {
    totalRuns, wins, places, bestOR, avgOR,
    distAnalysis: groupAnalysis(results, r => distBand(r.distM), "band"),
    goingAnalysis: groupAnalysis(results, r => goingGroup(r.going), "going"),
    handAnalysis: groupAnalysis(results, r => r.handedness || "Unknown", "handedness"),
  };
}

const ScoreBar = ({ score }) => {
  const pct = Math.min(score, 100);
  const color = pct >= 60 ? "#22d3a0" : pct >= 35 ? "#f5a623" : "#e05c5c";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <div style={{ flex:1, height:6, background:"#1e2a3a", borderRadius:3, overflow:"hidden" }}>
        <div style={{ width:`${pct}%`, height:"100%", background:color, borderRadius:3 }} />
      </div>
      <span style={{ fontSize:12, color, fontWeight:700, minWidth:28, fontFamily:"monospace" }}>{score}</span>
    </div>
  );
};

const StatPill = ({ label, value, highlight }) => (
  <div style={{ background: highlight?"rgba(34,211,160,0.1)":"rgba(255,255,255,0.04)", border:`1px solid ${highlight?"rgba(34,211,160,0.3)":"rgba(255,255,255,0.08)"}`, borderRadius:8, padding:"10px 14px", textAlign:"center" }}>
    <div style={{ fontSize:11, color:"#6b8aad", fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase" }}>{label}</div>
    <div style={{ fontSize:20, fontWeight:800, color:highlight?"#22d3a0":"#e8f0fe", marginTop:2, fontFamily:"'Playfair Display',Georgia,serif" }}>{value}</div>
  </div>
);

const SectionHeader = ({ title, icon }) => (
  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
    <span>{icon}</span>
    <span style={{ fontSize:13, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"#6b8aad" }}>{title}</span>
    <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.06)" }} />
  </div>
);

const BadgePos = ({ pos }) => {
  const colors = { 1:["#f5c842","#2a1f00"], 2:["#a0aec0","#1a1f2e"], 3:["#c27b3a","#1e140a"] };
  const [bg, text] = colors[pos] || ["#1e2a3a","#6b8aad"];
  return <div style={{ width:28, height:28, borderRadius:"50%", background:bg, color:text, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, margin:"0 auto" }}>{pos > 90 ? "NF" : pos}</div>;
};

const ConditionTable = ({ rows, keyField, keyLabel }) => (
  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
    <thead>
      <tr style={{ borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
        {[keyLabel,"Runs","W–P","Win%","Avg OR","Best OR","Score"].map(h => (
          <th key={h} style={{ padding:"6px 8px", textAlign:h===keyLabel?"left":"center", color:"#6b8aad", fontSize:11, fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase" }}>{h}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((r,i) => (
        <tr key={i} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)", background:i===0?"rgba(34,211,160,0.04)":"transparent" }}>
          <td style={{ padding:"10px 8px", color:i===0?"#22d3a0":"#c8d8f0", fontWeight:i===0?700:400 }}>
            {i===0 && "★ "}{r[keyField]}
          </td>
          <td style={{ padding:"10px 8px", textAlign:"center", color:"#8aa0be" }}>{r.runs}</td>
          <td style={{ padding:"10px 8px", textAlign:"center", color:"#8aa0be" }}>{r.wins}–{r.places}</td>
          <td style={{ padding:"10px 8px", textAlign:"center", color:r.wins>0?"#22d3a0":"#8aa0be", fontWeight:r.wins>0?700:400 }}>
            {r.runs ? Math.round((r.wins/r.runs)*100) : 0}%
          </td>
          <td style={{ padding:"10px 8px", textAlign:"center", color:"#8aa0be" }}>{r.avgOR||"—"}</td>
          <td style={{ padding:"10px 8px", textAlign:"center", color:"#c8d8f0" }}>{r.bestOR||"—"}</td>
          <td style={{ padding:"10px 8px", minWidth:110 }}><ScoreBar score={r.score} /></td>
        </tr>
      ))}
    </tbody>
  </table>
);

function HorseProfile({ horse }) {
  const data = useMemo(() => analyseHorse(horse), [horse]);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:16, alignItems:"start" }}>
        <div>
          <div style={{ fontSize:26, fontWeight:800, color:"#e8f0fe", fontFamily:"'Playfair Display',Georgia,serif" }}>{horse.name}</div>
          <div style={{ fontSize:13, color:"#6b8aad", marginTop:4 }}>{horse.sex} · {horse.country}</div>
          {horse.sire && <div style={{ fontSize:12, color:"#4a6080", marginTop:2 }}>By {horse.sire}{horse.dam ? ` ex ${horse.dam}` : ""}</div>}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, minWidth:320 }}>
          <StatPill label="Runs" value={data.totalRuns} />
          <StatPill label="Wins" value={data.wins} highlight={data.wins>0} />
          <StatPill label="Best OR" value={data.bestOR||"—"} />
          <StatPill label="Avg OR" value={data.avgOR||"—"} />
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
        {[
          { label:"Optimal Distance", value:data.distAnalysis[0]?.band||"—", sub:`${data.distAnalysis[0]?.wins||0}W from ${data.distAnalysis[0]?.runs||0} runs` },
          { label:"Optimal Going",    value:data.goingAnalysis[0]?.going||"—", sub:`${data.goingAnalysis[0]?.wins||0}W from ${data.goingAnalysis[0]?.runs||0} runs` },
          { label:"Track Preference", value:data.handAnalysis[0]?.handedness||"—", sub:`${data.handAnalysis[0]?.wins||0}W from ${data.handAnalysis[0]?.runs||0} runs` },
        ].map((item,i) => (
          <div key={i} style={{ background:"rgba(34,211,160,0.06)", border:"1px solid rgba(34,211,160,0.2)", borderRadius:10, padding:"14px 16px" }}>
            <div style={{ fontSize:11, color:"#22d3a0", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase" }}>{item.label}</div>
            <div style={{ fontSize:15, fontWeight:800, color:"#e8f0fe", marginTop:6, fontFamily:"'Playfair Display',Georgia,serif" }}>{item.value}</div>
            <div style={{ fontSize:11, color:"#6b8aad", marginTop:3 }}>{item.sub}</div>
          </div>
        ))}
      </div>

      {[
        { title:"Distance Analysis", icon:"📏", rows:data.distAnalysis, field:"band", label:"Distance" },
        { title:"Going Analysis",    icon:"🌧",  rows:data.goingAnalysis, field:"going", label:"Going" },
        { title:"Track Direction",   icon:"↩",  rows:data.handAnalysis, field:"handedness", label:"Direction" },
      ].map((s,i) => (
        <div key={i} style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, padding:"16px 18px" }}>
          <SectionHeader title={s.title} icon={s.icon} />
          <ConditionTable rows={s.rows} keyField={s.field} keyLabel={s.label} />
        </div>
      ))}

      <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, padding:"16px 18px" }}>
        <SectionHeader title="Recent Form" icon="📋" />
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead>
            <tr style={{ borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
              {["Date","Course","Dist","Going","Pos","OR","Beaten"].map(h => (
                <th key={h} style={{ padding:"6px 8px", textAlign:h==="Course"||h==="Date"?"left":"center", color:"#6b8aad", fontSize:11, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {horse.results.slice(0,15).map((r,i) => (
              <tr key={i} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ padding:"9px 8px", color:"#6b8aad", fontFamily:"monospace", fontSize:12 }}>{r.date}</td>
                <td style={{ padding:"9px 8px", color:"#c8d8f0" }}>{r.course}</td>
                <td style={{ padding:"9px 8px", textAlign:"center", color:"#8aa0be" }}>{r.distM ? `${mToF(r.distM)}f` : "—"}</td>
                <td style={{ padding:"9px 8px", textAlign:"center", color:"#8aa0be" }}>{r.going}</td>
                <td style={{ padding:"9px 8px" }}><BadgePos pos={r.pos} /></td>
                <td style={{ padding:"9px 8px", textAlign:"center", color:"#c8d8f0" }}>{r.or||"—"}</td>
                <td style={{ padding:"9px 8px", textAlign:"center", color:r.pos===1?"#22d3a0":"#8aa0be" }}>
                  {r.pos===1 ? "Won" : r.pos<99 ? `${r.beaten}L` : "NF"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompareView({ horses }) {
  const [selectedIds, setSelectedIds] = useState(horses.slice(0,2).map(h=>h.id));
  const [searchQ, setSearchQ] = useState("");
  const selected = horses.filter(h => selectedIds.includes(h.id));
  const analyses = selected.map(h => ({ horse:h, data:analyseHorse(h) }));
  const filtered = horses.filter(h => h.name.toLowerCase().includes(searchQ.toLowerCase()));
  const toggle = id => {
    if (selectedIds.includes(id)) { if (selectedIds.length > 1) setSelectedIds(selectedIds.filter(x=>x!==id)); }
    else { if (selectedIds.length < 4) setSelectedIds([...selectedIds, id]); }
  };
  const metrics = [
    { label:"Total Runs",       get:d=>d.totalRuns },
    { label:"Wins",             get:d=>d.wins },
    { label:"Win %",            get:d=>d.totalRuns?Math.round((d.wins/d.totalRuns)*100)+"%":"0%" },
    { label:"Best OR",          get:d=>d.bestOR||"—" },
    { label:"Avg OR",           get:d=>d.avgOR||"—" },
    { label:"Optimal Distance", get:d=>d.distAnalysis[0]?.band||"—" },
    { label:"Optimal Going",    get:d=>d.goingAnalysis[0]?.going||"—" },
    { label:"Track Preference", get:d=>d.handAnalysis[0]?.handedness||"—" },
  ];
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      <div>
        <div style={{ fontSize:11, color:"#6b8aad", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8 }}>Select horses to compare (max 4)</div>
        <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search horse..." style={{ width:"100%", maxWidth:340, padding:"9px 14px", borderRadius:8, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"#e8f0fe", fontSize:13, outline:"none", marginBottom:12, boxSizing:"border-box" }} />
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, maxHeight:160, overflowY:"auto" }}>
          {filtered.map(h => (
            <button key={h.id} onClick={()=>toggle(h.id)} style={{ padding:"5px 12px", borderRadius:20, border:"1px solid", borderColor:selectedIds.includes(h.id)?"#22d3a0":"rgba(255,255,255,0.12)", background:selectedIds.includes(h.id)?"rgba(34,211,160,0.12)":"rgba(255,255,255,0.04)", color:selectedIds.includes(h.id)?"#22d3a0":"#8aa0be", fontSize:12, cursor:"pointer", fontWeight:600 }}>
              {h.name}
            </button>
          ))}
        </div>
      </div>
      {selected.length > 0 && (
        <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr style={{ background:"rgba(255,255,255,0.04)", borderBottom:"1px solid rgba(255,255,255,0.1)" }}>
                <th style={{ padding:"12px 16px", textAlign:"left", color:"#6b8aad", fontSize:11, fontWeight:700, textTransform:"uppercase" }}>Metric</th>
                {analyses.map(({horse}) => (
                  <th key={horse.id} style={{ padding:"12px 16px", textAlign:"center", color:"#e8f0fe", fontSize:12, fontWeight:700, fontFamily:"'Playfair Display',Georgia,serif" }}>
                    {horse.name.split(" (")[0]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map((m,i) => (
                <tr key={i} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.01)" }}>
                  <td style={{ padding:"10px 16px", color:"#6b8aad", fontSize:12, fontWeight:600 }}>{m.label}</td>
                  {analyses.map(({horse,data}) => (
                    <td key={horse.id} style={{ padding:"10px 16px", textAlign:"center", color:"#c8d8f0", fontWeight:600 }}>{m.get(data)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [apiKey,        setApiKey]        = useState(() => localStorage.getItem("rb_api_key") || "");
  const [keyInput,      setKeyInput]      = useState("");
  const [horses,        setHorses]        = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(null);
  const [view,          setView]          = useState("search");
  const [selectedHorse, setSelectedHorse] = useState(null);
  const [query,         setQuery]         = useState("");
  const [lastLoaded,    setLastLoaded]    = useState(null);

  useEffect(() => {
    if (!apiKey) return;
    setLoading(true); setError(null);
    loadData(apiKey)
      .then(data => { setHorses(data); setLastLoaded(new Date().toLocaleTimeString()); setLoading(false); })
      .catch(err  => { setError(err.message); setLoading(false); });
  }, [apiKey]);

  const handleConnect = () => {
    if (!keyInput.trim()) return;
    localStorage.setItem("rb_api_key", keyInput.trim());
    setApiKey(keyInput.trim());
  };

  const filtered = horses.filter(h => h.name.toLowerCase().includes(query.toLowerCase()));

  if (!apiKey) return (
    <div style={{ minHeight:"100vh", background:"#0d1520", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',system-ui,sans-serif" }}>
      <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:16, padding:"40px 48px", maxWidth:460, width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:36, marginBottom:12 }}>🏇</div>
        <div style={{ fontSize:24, fontWeight:800, color:"#e8f0fe", fontFamily:"'Playfair Display',Georgia,serif", marginBottom:8 }}>AI Racing Brain</div>
        <div style={{ fontSize:14, color:"#6b8aad", marginBottom:28 }}>Enter your Airtable API key to load live data</div>
        <input value={keyInput} onChange={e=>setKeyInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleConnect()} placeholder="pat..." style={{ width:"100%", padding:"12px 16px", borderRadius:8, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.15)", color:"#e8f0fe", fontSize:14, outline:"none", marginBottom:12, boxSizing:"border-box", fontFamily:"monospace" }} />
        <button onClick={handleConnect} style={{ width:"100%", padding:"12px", borderRadius:8, background:"#22d3a0", border:"none", color:"#0d1520", fontSize:14, fontWeight:800, cursor:"pointer" }}>
          Connect to Airtable →
        </button>
        <div style={{ fontSize:12, color:"#3d5068", marginTop:16 }}>Get your key at airtable.com/create/tokens</div>
      </div>
    </div>
  );

  if (loading) return (
    <div style={{ minHeight:"100vh", background:"#0d1520", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',system-ui,sans-serif" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:36, marginBottom:16 }}>🏇</div>
        <div style={{ fontSize:16, color:"#6b8aad" }}>Loading live data from Airtable...</div>
        <div style={{ fontSize:13, color:"#3d5068", marginTop:8 }}>Fetching horses, results, races and courses</div>
      </div>
    </div>
  );

  if (error) return (
    <div style={{ minHeight:"100vh", background:"#0d1520", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',system-ui,sans-serif" }}>
      <div style={{ textAlign:"center", maxWidth:440 }}>
        <div style={{ fontSize:36, marginBottom:16 }}>⚠️</div>
        <div style={{ fontSize:16, color:"#e05c5c", marginBottom:8 }}>Connection failed</div>
        <div style={{ fontSize:13, color:"#6b8aad", marginBottom:20, wordBreak:"break-all" }}>{error}</div>
        <button onClick={()=>{ localStorage.removeItem("rb_api_key"); setApiKey(""); setKeyInput(""); }} style={{ padding:"10px 24px", borderRadius:8, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:"#c8d8f0", fontSize:13, cursor:"pointer" }}>
          Try a different API key
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"#0d1520", fontFamily:"'DM Sans',system-ui,sans-serif", color:"#c8d8f0" }}>
      <div style={{ background:"rgba(13,21,32,0.95)", backdropFilter:"blur(10px)", borderBottom:"1px solid rgba(255,255,255,0.06)", padding:"0 32px", display:"flex", alignItems:"center", gap:32, position:"sticky", top:0, zIndex:50, height:60 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:28, height:28, background:"linear-gradient(135deg,#22d3a0,#0ea5e9)", borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>🏇</div>
          <span style={{ fontFamily:"'Playfair Display',Georgia,serif", fontWeight:800, fontSize:16, color:"#e8f0fe" }}>AI Racing Brain</span>
        </div>
        <div style={{ display:"flex", gap:4 }}>
          {[{id:"search",label:"Horse Search",icon:"🔍"},{id:"compare",label:"Compare",icon:"⚖"}].map(n => (
            <button key={n.id} onClick={()=>{ setView(n.id); setSelectedHorse(null); }} style={{ padding:"6px 14px", borderRadius:6, border:"none", background:view===n.id?"rgba(34,211,160,0.1)":"transparent", color:view===n.id?"#22d3a0":"#6b8aad", fontSize:13, cursor:"pointer", fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
              {n.icon} {n.label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:16 }}>
          <span style={{ fontSize:12, color:"#3d5068" }}>{horses.length} horses · updated {lastLoaded}</span>
          <button onClick={()=>{ localStorage.removeItem("rb_api_key"); setApiKey(""); }} style={{ fontSize:11, color:"#3d5068", background:"none", border:"none", cursor:"pointer" }}>Disconnect</button>
        </div>
      </div>

      <div style={{ maxWidth:1100, margin:"0 auto", padding:"32px 24px" }}>
        {view==="search" && (
          <div style={{ display:"flex", flexDirection:"column", gap:24 }}>
            <div style={{ fontSize:22, fontWeight:800, color:"#e8f0fe", fontFamily:"'Playfair Display',Georgia,serif" }}>Horse Search</div>
            <div style={{ position:"relative", maxWidth:420 }}>
              <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:"#4a6080" }}>🔍</span>
              <input value={query} onChange={e=>{ setQuery(e.target.value); setSelectedHorse(null); }} placeholder="Search horse name..." style={{ width:"100%", padding:"11px 14px 11px 38px", borderRadius:8, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"#e8f0fe", fontSize:14, outline:"none", boxSizing:"border-box" }} />
            </div>
            {!selectedHorse && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12 }}>
                {filtered.map(horse => {
                  const d = analyseHorse(horse);
                  return (
                    <button key={horse.id} onClick={()=>setSelectedHorse(horse)} style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10, padding:"16px 18px", textAlign:"left", cursor:"pointer", color:"inherit" }}
                      onMouseEnter={e=>{ e.currentTarget.style.background="rgba(34,211,160,0.05)"; e.currentTarget.style.borderColor="rgba(34,211,160,0.2)"; }}
                      onMouseLeave={e=>{ e.currentTarget.style.background="rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor="rgba(255,255,255,0.08)"; }}
                    >
                      <div style={{ fontSize:15, fontWeight:700, color:"#e8f0fe", fontFamily:"'Playfair Display',Georgia,serif" }}>{horse.name}</div>
                      <div style={{ fontSize:12, color:"#4a6080", marginTop:2, marginBottom:10 }}>{horse.sex} · {horse.country}</div>
                      <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap" }}>
                        <span style={{ fontSize:11, background:"rgba(255,255,255,0.06)", padding:"2px 8px", borderRadius:4, color:"#8aa0be" }}>{d.totalRuns} runs</span>
                        <span style={{ fontSize:11, background:d.wins>0?"rgba(34,211,160,0.1)":"rgba(255,255,255,0.06)", padding:"2px 8px", borderRadius:4, color:d.wins>0?"#22d3a0":"#8aa0be" }}>{d.wins} wins</span>
                        {d.bestOR && <span style={{ fontSize:11, background:"rgba(255,255,255,0.06)", padding:"2px 8px", borderRadius:4, color:"#8aa0be" }}>OR {d.bestOR}</span>}
                      </div>
                      <div style={{ fontSize:11, color:"#4a6080" }}>★ {d.distAnalysis[0]?.band||"—"} · {d.goingAnalysis[0]?.going||"—"} · {d.handAnalysis[0]?.handedness||"—"}</div>
                    </button>
                  );
                })}
              </div>
            )}
            {selectedHorse && (
              <div>
                <button onClick={()=>setSelectedHorse(null)} style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:6, padding:"6px 14px", color:"#8aa0be", fontSize:13, cursor:"pointer", marginBottom:20, display:"flex", alignItems:"center", gap:6 }}>
                  ← Back to search
                </button>
                <HorseProfile horse={selectedHorse} />
              </div>
            )}
          </div>
        )}
        {view==="compare" && (
          <div>
            <div style={{ fontSize:22, fontWeight:800, color:"#e8f0fe", fontFamily:"'Playfair Display',Georgia,serif", marginBottom:20 }}>Compare Horses</div>
            <CompareView horses={horses} />
          </div>
        )}
      </div>
    </div>
  );
}