import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "cave-a-vin-ios-v2";

const systemPrompt = `Tu es un sommelier expert et spécialiste en valorisation des vins. Analyse l'étiquette et réponds UNIQUEMENT avec un objet JSON valide (sans backticks, sans markdown) :
{
  "nom": "Nom du vin",
  "domaine": "Domaine / Château",
  "appellation": "Appellation AOC/AOP",
  "millesime": 2019,
  "couleur": "rouge|blanc|rosé|pétillant",
  "region": "Région viticole",
  "apogee": "2026–2032",
  "valeur_unitaire": "45€",
  "tendance": "hausse|stable|baisse",
  "tendance_pct": "+12% / an",
  "conseil": "boire|garder",
  "note_degustation": "Description aromatique courte et précise",
  "accord_mets": "Accord mets-vins suggéré"
}
Si ce n'est pas une étiquette de vin : {"erreur": "Image non reconnue"}`;

const COULEUR_DOT   = { rouge: "#8B1A1A", blanc: "#C9933A", rosé: "#E07E95", pétillant: "#4A9CB5" };
const COULEUR_LABEL = { rouge: "Rouge", blanc: "Blanc", rosé: "Rosé", pétillant: "Pétillant" };
const CONSEIL_CFG   = {
  boire:  { label: "À boire",  bg: "#E6F9F0", color: "#0D7A4E", icon: "🥂" },
  garder: { label: "À garder", bg: "#E8F0FE", color: "#1A56DB", icon: "⏳" },
};
const TENDANCE_CFG  = {
  hausse: { color: "#34C759", arrow: "↑" },
  stable: { color: "#FF9F0A", arrow: "→" },
  baisse: { color: "#FF3B30", arrow: "↓" },
};
const EMPLACEMENTS  = ["1", "2", "3", "4"];

const parseVal = (v) => parseInt((v || "0").replace(/[^\d]/g, "")) || 0;

/* ─── Small reusable components ─── */
const Pill = ({ children, bg = "rgba(118,118,128,0.12)", color = "#000", style = {} }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 9px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: bg, color, ...style }}>{children}</span>
);

const Chevron = () => (
  <svg width="7" height="12" viewBox="0 0 7 12" fill="none" style={{ opacity: 0.25, flexShrink: 0 }}>
    <path d="M1 1L6 6L1 11" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export default function CaveAVin() {
  const [view, setView]               = useState("cave");
  const [inventory, setInventory]     = useState([]);
  const [scanning, setScanning]       = useState(false);
  const [scanResult, setScanResult]   = useState(null);
  const [scanError, setScanError]     = useState(null);
  const [pendingImg, setPendingImg]   = useState(null);
  const [addQty, setAddQty]           = useState(1);
  const [addEmpl, setAddEmpl]         = useState("1");
  const [selected, setSelected]       = useState(null);
  const [filter, setFilter]           = useState("tous");
  const [chatOpen, setChatOpen]       = useState(false);
  const [messages, setMessages]       = useState([]);
  const [chatInput, setChatInput]     = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const fileRef    = useRef(null);
  const chatEndRef = useRef(null);

  useEffect(() => { loadData(); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, chatLoading]);

  const loadData = async () => {
    try { const r = await window.storage.get(STORAGE_KEY); if (r?.value) setInventory(JSON.parse(r.value)); } catch {}
  };
  const saveData = async (inv) => { try { await window.storage.set(STORAGE_KEY, JSON.stringify(inv)); } catch {} };

  const handleFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { analyzeLabel(ev.target.result.split(",")[1], file.type, ev.target.result); };
    reader.readAsDataURL(file); e.target.value = "";
  };

  const analyzeLabel = async (b64, mtype, preview) => {
    setScanning(true); setScanError(null); setScanResult(null); setPendingImg(preview);
    try {
      const res = await fetch("/api/anthropic", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 1000, system: systemPrompt,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: mtype, data: b64 } },
            { type: "text", text: "Analyse cette étiquette de vin." }
          ]}]
        })
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("").trim();
      const parsed = JSON.parse(text);
      if (parsed.erreur) setScanError(parsed.erreur);
      else { setScanResult(parsed); setAddQty(1); setAddEmpl("1"); }
    } catch { setScanError("Analyse impossible. Essaie avec une photo plus nette."); }
    setScanning(false);
  };

  const addWine = () => {
    if (!scanResult) return;
    const entry = { id: Date.now(), ...scanResult, quantite: addQty, emplacement: addEmpl, image: pendingImg, dateAjout: new Date().toLocaleDateString("fr-FR") };
    const next = [...inventory, entry]; setInventory(next); saveData(next);
    setScanResult(null); setPendingImg(null); setView("cave");
  };

  const openBottle = (id) => {
    const next = inventory.map(w => w.id === id ? { ...w, quantite: w.quantite - 1 } : w).filter(w => w.quantite > 0);
    setInventory(next); saveData(next); setSelected(null);
  };

  /* ─── Derived stats ─── */
  const totalBtl   = inventory.reduce((s, w) => s + w.quantite, 0);
  const totalVal   = inventory.reduce((s, w) => s + parseVal(w.valeur_unitaire) * w.quantite, 0);
  const aBoire     = inventory.filter(w => w.conseil === "boire").reduce((s, w) => s + w.quantite, 0);

  const filtered = filter === "tous"   ? inventory
    : filter === "boire" || filter === "garder" ? inventory.filter(w => w.conseil === filter)
    : filter.startsWith("e") ? inventory.filter(w => w.emplacement === filter.slice(1))
    : inventory.filter(w => w.couleur === filter);

  /* ─── Chat ─── */
  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = { role: "user", content: chatInput };
    const next = [...messages, userMsg]; setMessages(next); setChatInput(""); setChatLoading(true);
    const ctx = inventory.length
      ? `Cave (${totalBtl} bouteilles, valeur ~${totalVal}€) : ${inventory.map(w => `${w.quantite}× ${w.nom} ${w.millesime} emplacement ${w.emplacement} (${w.conseil})`).join(", ")}.`
      : "Cave vide.";
    try {
      const res = await fetch("/api/anthropic", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 800,
          system: `Tu es un sommelier expert. ${ctx} Réponds en français, concis et précis.`,
          messages: next.map(m => ({ role: m.role, content: m.content }))
        })
      });
      const data = await res.json();
      setMessages([...next, { role: "assistant", content: data.content?.map(b => b.text || "").join("") || "" }]);
    } catch { setMessages([...next, { role: "assistant", content: "Une erreur s'est produite." }]); }
    setChatLoading(false);
  };

  /* ─── Tab bar ─── */
  const TabBar = () => (
    <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "rgba(242,242,247,0.92)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderTop: "0.5px solid rgba(0,0,0,0.15)", padding: "10px 0 28px", zIndex: 50 }}>
      <div style={{ display: "flex", justifyContent: "space-around" }}>
        {[
          { id: "cave",    label: "Cave",
            icon: (a) => <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 12H3L12 3L21 12H19" stroke={a?"#007AFF":"rgba(60,60,67,0.4)"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M5 12V19C5 19.6 5.4 20 6 20H9V16H15V20H18C18.6 20 19 19.6 19 19V12" stroke={a?"#007AFF":"rgba(60,60,67,0.4)"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> },
          { id: "scanner", label: "Scanner",
            icon: (a) => <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke={a?"#007AFF":"rgba(60,60,67,0.4)"} strokeWidth="1.8"/><line x1="16" y1="16" x2="21" y2="21" stroke={a?"#007AFF":"rgba(60,60,67,0.4)"} strokeWidth="1.8" strokeLinecap="round"/><circle cx="11" cy="11" r="3" stroke={a?"#007AFF":"rgba(60,60,67,0.4)"} strokeWidth="1.8"/></svg> },
          { id: "stats",   label: "Stats",
            icon: (a) => <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke={a?"#007AFF":"rgba(60,60,67,0.4)"} strokeWidth="1.8"/><path d="M7 15L10 12L13 14L17 9" stroke={a?"#007AFF":"rgba(60,60,67,0.4)"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> },
        ].map(t => (
          <button key={t.id} onClick={() => setView(t.id)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 70, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            {t.icon(view === t.id)}
            <span style={{ fontSize: 10, color: view === t.id ? "#007AFF" : "rgba(60,60,67,0.4)", fontWeight: view === t.id ? 600 : 400 }}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  /* ═══════════════════════════════════════════
     CAVE VIEW
  ═══════════════════════════════════════════ */
  if (view === "cave") return (
    <div style={{ background: "#F2F2F7", minHeight: "100vh", fontFamily: "-apple-system,'SF Pro Display',sans-serif", maxWidth: 480, margin: "0 auto", color: "#000" }}>
      <style>{css}</style>

      {/* Sticky header */}
      <div style={{ background: "rgba(242,242,247,0.95)", position: "sticky", top: 0, zIndex: 99, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
        <div style={{ padding: "14px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{time()}</span>
          <button onClick={() => setChatOpen(true)} style={{ background: "none", border: "none", cursor: "pointer", color: "#007AFF", fontSize: 15, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>🍷 Sommelier</button>
        </div>
        <div style={{ padding: "4px 20px 0" }}>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.5px", paddingBottom: 10 }}>Ma Cave</div>
          <div style={{ background: "rgba(118,118,128,0.12)", borderRadius: 12, padding: "8px 12px", display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="5" stroke="rgba(60,60,67,0.6)" strokeWidth="1.5"/><path d="M10.5 10.5L13 13" stroke="rgba(60,60,67,0.6)" strokeWidth="1.5" strokeLinecap="round"/></svg>
            <span style={{ fontSize: 15, color: "rgba(60,60,67,0.6)" }}>Rechercher</span>
          </div>
        </div>
      </div>

      <div style={{ padding: "0 16px 110px" }}>
        {/* Stats cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 6, marginBottom: 14 }}>
          <div style={{ background: "linear-gradient(145deg,#1C1C1E,#2C2C2E)", borderRadius: 18, padding: "14px 12px" }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: "#fff", letterSpacing: "-0.5px", lineHeight: 1 }}>{totalBtl}</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Bouteilles</div>
          </div>
          <div style={{ background: "linear-gradient(145deg,#00C875,#00A65E)", borderRadius: 18, padding: "14px 12px" }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: "#fff", letterSpacing: "-0.5px", lineHeight: 1 }}>{aBoire}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", marginTop: 4 }}>À boire</div>
          </div>
          <div style={{ background: "linear-gradient(145deg,#5E5CE6,#3A38B0)", borderRadius: 18, padding: "14px 12px" }}>
            <div style={{ fontSize: totalVal > 9999 ? 17 : 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.5px", lineHeight: 1, paddingTop: totalVal > 9999 ? 4 : 0 }}>{totalVal > 0 ? totalVal + "€" : "—"}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", marginTop: 4 }}>Valeur cave</div>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 7, overflowX: "auto", marginBottom: 14, paddingBottom: 2 }}>
          {[
            { id: "tous", l: "Tous" },
            { id: "boire", l: "🥂 Boire" },
            { id: "garder", l: "⏳ Garder" },
            { id: "e1", l: "📦 Empl. 1" },
            { id: "e2", l: "📦 Empl. 2" },
            { id: "e3", l: "📦 Empl. 3" },
            { id: "e4", l: "📦 Empl. 4" },
            { id: "rouge", l: "Rouge" },
            { id: "blanc", l: "Blanc" },
            { id: "rosé",  l: "Rosé" },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} className="p" style={{ flexShrink: 0, padding: "5px 14px", borderRadius: 20, border: "none", background: filter === f.id ? "#007AFF" : "rgba(118,118,128,0.12)", color: filter === f.id ? "#fff" : "#000", fontSize: 13, fontWeight: filter === f.id ? 600 : 400, cursor: "pointer", whiteSpace: "nowrap" }}>
              {f.l}
            </button>
          ))}
        </div>

        {/* Wine list */}
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 52, marginBottom: 12 }}>🍾</div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.3px", marginBottom: 6 }}>Cave vide</div>
            <div style={{ fontSize: 14, color: "rgba(60,60,67,0.6)", marginBottom: 20 }}>Scanner ta première bouteille</div>
            <button onClick={() => setView("scanner")} className="p" style={{ background: "#007AFF", color: "#fff", border: "none", borderRadius: 14, padding: "12px 28px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Scanner</button>
          </div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 20, overflow: "hidden", boxShadow: "0 1px 0 rgba(0,0,0,0.06)" }}>
            {filtered.map((w, i) => {
              const cc = CONSEIL_CFG[w.conseil] || CONSEIL_CFG.garder;
              const tc = TENDANCE_CFG[w.tendance] || TENDANCE_CFG.stable;
              return (
                <div key={w.id} className="card" onClick={() => setSelected(w)} style={{ padding: "13px 16px", borderBottom: i < filtered.length - 1 ? "0.5px solid rgba(0,0,0,0.08)" : "none", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: (COULEUR_DOT[w.couleur] || "#888") + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <div style={{ width: 9, height: 9, borderRadius: "50%", background: COULEUR_DOT[w.couleur] || "#888" }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.nom}</div>
                      <div style={{ fontSize: 12, color: "rgba(60,60,67,0.55)", marginTop: 1 }}>{w.appellation} · {w.millesime} · {w.quantite} btl.</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.3px" }}>{w.valeur_unitaire || "—"}</div>
                      {w.tendance && <div style={{ fontSize: 11, color: tc.color, fontWeight: 600 }}>{tc.arrow} {w.tendance_pct}</div>}
                    </div>
                    <Chevron />
                  </div>
                  <div style={{ display: "flex", gap: 5, paddingLeft: 46 }}>
                    <Pill bg={cc.bg} color={cc.color}>{cc.icon} {cc.label}</Pill>
                    <Pill bg="rgba(0,0,0,0.05)" color="rgba(60,60,67,0.7)">📦 Empl. {w.emplacement}</Pill>
                    {w.valeur_unitaire && <Pill bg="rgba(94,92,230,0.1)" color="#5E5CE6">💶 {parseVal(w.valeur_unitaire) * w.quantite}€</Pill>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <TabBar />

      {/* Detail sheet */}
      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "flex-end", backdropFilter: "blur(6px)" }}>
          <div onClick={e => e.stopPropagation()} className="fd" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: "24px 20px 44px", width: "100%", maxWidth: 480, margin: "0 auto" }}>
            <div style={{ width: 36, height: 4, background: "#E2E2DF", borderRadius: 2, margin: "0 auto 20px" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px", marginBottom: 2 }}>{selected.nom}</div>
                <div style={{ fontSize: 14, color: "rgba(60,60,67,0.6)" }}>{selected.domaine} · {selected.millesime}</div>
                <div style={{ fontSize: 13, color: "rgba(60,60,67,0.4)", marginTop: 1 }}>{selected.appellation}{selected.region ? ` · ${selected.region}` : ""}</div>
              </div>
              <div style={{ textAlign: "center", marginLeft: 16 }}>
                <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: "-0.5px", lineHeight: 1 }}>{selected.quantite}</div>
                <div style={{ fontSize: 11, color: "rgba(60,60,67,0.4)", marginTop: 1 }}>bouteilles</div>
              </div>
            </div>

            {/* Value row */}
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1, background: "rgba(94,92,230,0.08)", borderRadius: 14, padding: "11px 14px" }}>
                <div style={{ fontSize: 11, color: "#5E5CE6", fontWeight: 600, marginBottom: 3 }}>💶 Valeur unitaire</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{selected.valeur_unitaire || "—"}</div>
              </div>
              <div style={{ flex: 1, background: "rgba(94,92,230,0.08)", borderRadius: 14, padding: "11px 14px" }}>
                <div style={{ fontSize: 11, color: "#5E5CE6", fontWeight: 600, marginBottom: 3 }}>📈 Évolution</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: (TENDANCE_CFG[selected.tendance] || TENDANCE_CFG.stable).color }}>
                  {(TENDANCE_CFG[selected.tendance] || TENDANCE_CFG.stable).arrow} {selected.tendance_pct || "—"}
                </div>
              </div>
            </div>

            {/* Conseil block */}
            {(() => { const cc = CONSEIL_CFG[selected.conseil] || CONSEIL_CFG.garder; return (
              <div style={{ background: cc.bg, borderRadius: 14, padding: "13px 15px", marginBottom: 14 }}>
                <div style={{ color: cc.color, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{cc.icon} {cc.label}</div>
                <div style={{ fontSize: 13, color: "#444", lineHeight: 1.65, fontStyle: "italic" }}>{selected.note_degustation}</div>
                {selected.accord_mets && <div style={{ fontSize: 12, color: "rgba(60,60,67,0.6)", marginTop: 5 }}>🍽️ {selected.accord_mets}</div>}
              </div>
            );})()}

            {/* Meta tags */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
              <Pill>📦 Emplacement {selected.emplacement}</Pill>
              {selected.apogee && <Pill>⌛ Apogée {selected.apogee}</Pill>}
              {selected.dateAjout && <Pill>📅 {selected.dateAjout}</Pill>}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => openBottle(selected.id)} className="p" style={{ flex: 1, background: "#FFF3F3", border: "1.5px solid #F5CECE", borderRadius: 14, padding: 14, color: "#C0392B", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>🥂 Ouvrir une bouteille</button>
              <button onClick={() => setSelected(null)} className="p" style={{ flex: 1, background: "#007AFF", border: "none", borderRadius: 14, padding: 14, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Fermer</button>
            </div>
          </div>
        </div>
      )}

      {/* Sommelier chat */}
      <ChatModal open={chatOpen} onClose={() => setChatOpen(false)} messages={messages} chatInput={chatInput} setChatInput={setChatInput} sendChat={sendChat} chatLoading={chatLoading} chatEndRef={chatEndRef} inventory={inventory} />
    </div>
  );

  /* ═══════════════════════════════════════════
     SCANNER VIEW
  ═══════════════════════════════════════════ */
  if (view === "scanner") return (
    <div style={{ background: "#F2F2F7", minHeight: "100vh", fontFamily: "-apple-system,'SF Pro Display',sans-serif", maxWidth: 480, margin: "0 auto", color: "#000" }}>
      <style>{css}</style>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: "none" }} />

      <div style={{ background: "rgba(242,242,247,0.95)", padding: "14px 20px 16px", position: "sticky", top: 0, zIndex: 99, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{time()}</div>
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.5px" }}>Scanner</div>
      </div>

      <div style={{ padding: "16px 16px 110px" }}>
        {/* Idle state */}
        {!scanResult && !scanning && (
          <div className="fd">
            <div style={{ fontSize: 14, color: "rgba(60,60,67,0.6)", marginBottom: 28, lineHeight: 1.65 }}>
              Prends une photo de l'étiquette. L'IA identifie le vin, son apogée, sa valeur et son évolution.
            </div>
            <button onClick={() => fileRef.current?.click()} className="p" style={{ width: "100%", background: "#007AFF", color: "#fff", border: "none", borderRadius: 16, padding: 18, fontSize: 16, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 22 }}>📸</span> Photographier l'étiquette
            </button>
            <button onClick={() => fileRef.current?.click()} className="p" style={{ width: "100%", background: "#fff", color: "#000", border: "none", borderRadius: 16, padding: 14, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
              🖼️ Importer depuis la galerie
            </button>
            {scanError && (
              <div style={{ marginTop: 16, background: "#FFF3F3", border: "1.5px solid #F5CECE", borderRadius: 14, padding: "13px 16px", color: "#C0392B", fontSize: 14 }}>⚠️ {scanError}</div>
            )}
          </div>
        )}

        {/* Loading */}
        {scanning && (
          <div style={{ textAlign: "center", paddingTop: 10 }} className="fd">
            {pendingImg && <img src={pendingImg} alt="" style={{ width: "100%", maxHeight: 240, objectFit: "cover", borderRadius: 18, marginBottom: 24, opacity: 0.45 }} />}
            {[75, 55, 65].map((w, i) => (
              <div key={i} className="pl" style={{ height: 14, borderRadius: 7, background: "#E2E2DF", width: `${w}%`, margin: `0 auto ${i < 2 ? 10 : 0}px`, animationDelay: `${i * 0.18}s` }} />
            ))}
            <div style={{ marginTop: 18, color: "rgba(60,60,67,0.5)", fontSize: 14 }}>Analyse en cours…</div>
          </div>
        )}

        {/* Result */}
        {scanResult && !scanning && (
          <div className="fd">
            {pendingImg && <img src={pendingImg} alt="" style={{ width: "100%", maxHeight: 200, objectFit: "cover", borderRadius: 18, marginBottom: 16 }} />}
            <div style={{ background: "#fff", borderRadius: 20, padding: 20, boxShadow: "0 2px 16px rgba(0,0,0,0.07)" }}>

              {/* Wine identity */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.3px", marginBottom: 2 }}>{scanResult.nom}</div>
                  <div style={{ fontSize: 13, color: "rgba(60,60,67,0.6)" }}>{scanResult.domaine}</div>
                </div>
                {scanResult.couleur && (
                  <Pill bg={(COULEUR_DOT[scanResult.couleur] || "#888") + "18"} color={COULEUR_DOT[scanResult.couleur] || "#888"} style={{ flexShrink: 0, marginLeft: 10 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: COULEUR_DOT[scanResult.couleur] || "#888", display: "inline-block" }} />
                    {COULEUR_LABEL[scanResult.couleur] || scanResult.couleur}
                  </Pill>
                )}
              </div>

              {/* Info grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                {[["📍","Appellation",scanResult.appellation],["🗓️","Millésime",scanResult.millesime],["⌛","Apogée",scanResult.apogee],["💶","Valeur/btl.",scanResult.valeur_unitaire]].map(([icon,label,val]) => val && (
                  <div key={label} style={{ background: "#F7F7F5", borderRadius: 12, padding: "10px 12px" }}>
                    <div style={{ fontSize: 11, color: "rgba(60,60,67,0.5)", marginBottom: 3 }}>{icon} {label}</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Tendance */}
              {scanResult.tendance && (() => { const tc = TENDANCE_CFG[scanResult.tendance] || TENDANCE_CFG.stable; return (
                <div style={{ background: tc.color + "12", borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 22, color: tc.color, fontWeight: 700 }}>{tc.arrow}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: tc.color }}>Tendance du marché</div>
                    <div style={{ fontSize: 13, color: "rgba(60,60,67,0.7)" }}>{scanResult.tendance_pct}</div>
                  </div>
                </div>
              );})()}

              {/* Conseil */}
              {(() => { const cc = CONSEIL_CFG[scanResult.conseil] || CONSEIL_CFG.garder; return (
                <div style={{ background: cc.bg, borderRadius: 14, padding: "13px 15px", marginBottom: 16 }}>
                  <div style={{ color: cc.color, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{cc.icon} {cc.label}</div>
                  <div style={{ fontSize: 13, color: "#444", lineHeight: 1.65, fontStyle: "italic" }}>{scanResult.note_degustation}</div>
                  {scanResult.accord_mets && <div style={{ fontSize: 12, color: "rgba(60,60,67,0.6)", marginTop: 5 }}>🍽️ {scanResult.accord_mets}</div>}
                </div>
              );})()}

              {/* Quantity + Emplacement */}
              <div style={{ background: "#F7F7F5", borderRadius: 14, padding: "14px 16px", marginBottom: 14 }}>
                {/* Qty */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{ fontSize: 14, color: "#333" }}>Nombre de bouteilles</span>
                  <div style={{ display: "flex", alignItems: "center", background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
                    <button onClick={() => setAddQty(Math.max(1, addQty - 1))} style={{ background: "none", border: "none", color: "#007AFF", fontSize: 20, padding: "5px 14px", cursor: "pointer", fontWeight: 700 }}>−</button>
                    <span style={{ fontSize: 18, fontWeight: 700, minWidth: 26, textAlign: "center" }}>{addQty}</span>
                    <button onClick={() => setAddQty(addQty + 1)} style={{ background: "none", border: "none", color: "#007AFF", fontSize: 20, padding: "5px 14px", cursor: "pointer", fontWeight: 700 }}>+</button>
                  </div>
                </div>

                {/* Emplacement */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14, color: "#333" }}>📦 Emplacement</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {EMPLACEMENTS.map(e => (
                      <button key={e} onClick={() => setAddEmpl(e)} style={{ width: 36, height: 36, borderRadius: 10, border: "none", background: addEmpl === e ? "#007AFF" : "#fff", color: addEmpl === e ? "#fff" : "#333", fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", transition: "all 0.15s" }}>
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => { setScanResult(null); setPendingImg(null); setScanError(null); }} className="p" style={{ flex: 1, background: "rgba(118,118,128,0.12)", border: "none", borderRadius: 14, padding: 14, color: "#333", fontSize: 14, cursor: "pointer" }}>Annuler</button>
                <button onClick={addWine} className="p" style={{ flex: 2, background: "#007AFF", border: "none", borderRadius: 14, padding: 14, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>Ajouter à la cave</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <TabBar />
    </div>
  );

  /* ═══════════════════════════════════════════
     STATS VIEW
  ═══════════════════════════════════════════ */
  if (view === "stats") return (
    <div style={{ background: "#F2F2F7", minHeight: "100vh", fontFamily: "-apple-system,'SF Pro Display',sans-serif", maxWidth: 480, margin: "0 auto", color: "#000" }}>
      <style>{css}</style>
      <div style={{ background: "rgba(242,242,247,0.95)", padding: "14px 20px 16px", position: "sticky", top: 0, zIndex: 99, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{time()}</div>
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.5px" }}>Stats</div>
      </div>

      <div style={{ padding: "8px 16px 110px" }} className="fd">
        {/* KPI grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          {[
            { l: "Total", v: totalBtl, i: "🍾", bg: "linear-gradient(145deg,#1C1C1E,#2C2C2E)", tc: "#fff", sc: "#888" },
            { l: "À boire", v: aBoire, i: "🥂", bg: "linear-gradient(145deg,#00C875,#00A65E)", tc: "#fff", sc: "rgba(255,255,255,0.7)" },
            { l: "À garder", v: inventory.filter(w=>w.conseil==="garder").reduce((s,w)=>s+w.quantite,0), i: "⏳", bg: "linear-gradient(145deg,#3478F6,#1A56DB)", tc: "#fff", sc: "rgba(255,255,255,0.7)" },
            { l: "Valeur totale", v: totalVal > 0 ? totalVal + "€" : "—", i: "💶", bg: "linear-gradient(145deg,#5E5CE6,#3A38B0)", tc: "#fff", sc: "rgba(255,255,255,0.7)" },
          ].map(s => (
            <div key={s.l} style={{ background: s.bg, borderRadius: 18, padding: "16px 14px" }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>{s.i}</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: s.tc, letterSpacing: "-0.5px", lineHeight: 1 }}>{s.v}</div>
              <div style={{ fontSize: 12, color: s.sc, marginTop: 4 }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Par emplacement */}
        <div style={{ background: "#fff", borderRadius: 18, padding: "16px 18px", marginBottom: 12, boxShadow: "0 1px 0 rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(60,60,67,0.5)", letterSpacing: "0.04em", marginBottom: 14 }}>EMPLACEMENTS</div>
          {EMPLACEMENTS.map(e => {
            const btl = inventory.filter(w => w.emplacement === e).reduce((s, w) => s + w.quantite, 0);
            const val = inventory.filter(w => w.emplacement === e).reduce((s, w) => s + parseVal(w.valeur_unitaire) * w.quantite, 0);
            return (
              <div key={e} style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: e !== "4" ? "0.5px solid rgba(0,0,0,0.07)" : "none" }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "#F2F2F7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0, marginRight: 12 }}>📦</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>Emplacement {e}</div>
                  <div style={{ fontSize: 12, color: "rgba(60,60,67,0.5)", marginTop: 1 }}>{btl} bouteille{btl !== 1 ? "s" : ""}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{val > 0 ? val + "€" : "—"}</div>
                  <div style={{ fontSize: 11, color: "rgba(60,60,67,0.4)" }}>valeur</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Par couleur */}
        <div style={{ background: "#fff", borderRadius: 18, padding: "16px 18px", boxShadow: "0 1px 0 rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(60,60,67,0.5)", letterSpacing: "0.04em", marginBottom: 14 }}>COULEURS</div>
          {Object.entries(COULEUR_DOT).map(([couleur, color]) => {
            const total = inventory.filter(w => w.couleur === couleur).reduce((s, w) => s + w.quantite, 0);
            if (!total) return null;
            const pct = totalBtl ? Math.round(total / totalBtl * 100) : 0;
            return (
              <div key={couleur} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                    <span style={{ fontSize: 14 }}>{COULEUR_LABEL[couleur]}</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{total} <span style={{ color: "rgba(60,60,67,0.4)", fontWeight: 400 }}>({pct}%)</span></span>
                </div>
                <div style={{ height: 5, background: "#F2F2F0", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4 }} />
                </div>
              </div>
            );
          })}
          {!totalBtl && <div style={{ textAlign: "center", color: "#ccc", fontSize: 14, padding: "12px 0" }}>Aucune bouteille</div>}
        </div>
      </div>
      <TabBar />
    </div>
  );

  return null;
}

/* ─── Sommelier chat modal ─── */
function ChatModal({ open, onClose, messages, chatInput, setChatInput, sendChat, chatLoading, chatEndRef, inventory }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 300, maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", fontFamily: "-apple-system,'SF Pro Display',sans-serif" }}>
      <div style={{ borderBottom: "0.5px solid rgba(0,0,0,0.15)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 13, background: "#1C1C1E", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>🍷</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.2px" }}>Sommelier IA</div>
          <div style={{ fontSize: 12, color: "rgba(60,60,67,0.5)" }}>Expert cave personnel</div>
        </div>
        <button onClick={onClose} style={{ background: "rgba(118,118,128,0.12)", border: "none", borderRadius: 10, width: 34, height: 34, cursor: "pointer", fontSize: 16, color: "#555", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ paddingTop: 8 }}>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.3px", marginBottom: 4 }}>Bonsoir 👋</div>
            <div style={{ fontSize: 14, color: "rgba(60,60,67,0.6)", marginBottom: 18, lineHeight: 1.6 }}>Que puis-je vous conseiller ?</div>
            {[inventory.length ? "Que boire ce soir ?" : "Comment débuter une cave ?", "Quel vin avec un gigot d'agneau ?", "Explique-moi l'appellation Pomerol"].map(q => (
              <button key={q} onClick={() => setChatInput(q)} style={{ display: "block", width: "100%", background: "#F7F7F5", border: "1.5px solid #EBEBEA", borderRadius: 12, padding: "11px 14px", color: "#444", fontSize: 14, cursor: "pointer", marginBottom: 8, textAlign: "left" }}>{q}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth: "80%", background: m.role === "user" ? "#007AFF" : "#F2F2F7", color: m.role === "user" ? "#fff" : "#000", borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px", padding: "11px 15px", fontSize: 15, lineHeight: 1.55 }}>{m.content}</div>
          </div>
        ))}
        {chatLoading && (
          <div style={{ display: "flex" }}>
            <div style={{ background: "#F2F2F7", borderRadius: "18px 18px 18px 4px", padding: "12px 16px", display: "flex", gap: 5, alignItems: "center" }}>
              {[0, 0.18, 0.36].map((d, i) => <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#C7C7CC", animation: "pl 1.3s ease-in-out infinite", animationDelay: `${d}s` }} />)}
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div style={{ borderTop: "0.5px solid rgba(0,0,0,0.1)", padding: "12px 14px", display: "flex", gap: 8, background: "#fff" }}>
        <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChat()} placeholder="Message…" style={{ flex: 1, background: "#F2F2F7", border: "none", borderRadius: 22, padding: "10px 16px", fontSize: 15, outline: "none", color: "#000" }} />
        <button onClick={sendChat} disabled={!chatInput.trim() || chatLoading} style={{ background: chatInput.trim() ? "#007AFF" : "#E5E5EA", border: "none", borderRadius: "50%", width: 36, height: 36, color: chatInput.trim() ? "#fff" : "#C7C7CC", fontSize: 16, cursor: chatInput.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, alignSelf: "flex-end", marginBottom: 1 }}>↑</button>
      </div>
    </div>
  );
}

const time = () => { const n = new Date(); return `${n.getHours()}:${String(n.getMinutes()).padStart(2,"0")}`; };

const css = `
  * { box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent; }
  .p:active { opacity:0.65; transition:opacity 0.1s; }
  .card:active { transform:scale(0.987); transition:transform 0.12s; }
  input { -webkit-appearance:none; }
  .fd { animation:fd 0.28s ease; }
  @keyframes fd { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  .pl { animation:pl 1.3s ease-in-out infinite; }
  @keyframes pl { 0%,100%{opacity:0.3} 50%{opacity:1} }
  ::-webkit-scrollbar { display:none; }
  button { font-family:-apple-system,'SF Pro Display',sans-serif; }
`;
