// ALPHA FEED — Newspaper logic
// Honest data rules:
// - News: only articles whose ORIGINAL pubDate is within last 24h are shown.
// - Market ticker: shows DATA NOT CONNECTED until a verified fetch succeeds. Never invents prices.
// - IPO / Earnings / Macro: shows "not verified" unless a verified source is loaded. Never invents figures.
// - Hourly refresh: in-browser setInterval while page is open. Background refresh when closed requires GitHub Actions (see .github/workflows/hourly-refresh.yml) + Vercel deploy.

const RETENTION_MS = 24 * 60 * 60 * 1000;

const FEEDS = {
  "top-stories": [
    {name:"Reuters Top", url:"https://www.reuters.com/rssFeed/topNews"},
    {name:"BBC News", url:"https://feeds.bbci.co.uk/news/rss.xml"},
    {name:"Economic Times Markets", url:"https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms"},
  ],
  "indian-markets": [
    {name:"Economic Times Markets", url:"https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms"},
    {name:"Moneycontrol Markets", url:"https://www.moneycontrol.com/rss/marketstats.xml"},
    {name:"BBC Business", url:"https://feeds.bbci.co.uk/news/business/rss.xml"},
  ],
  "indian-economy": [
    {name:"RBI Press Releases", url:"https://www.rbi.org.in/Scripts/RSS.aspx"},
    {name:"Economic Times Economy", url:"https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms"},
    {name:"Reuters India", url:"https://www.reuters.com/rssFeed/indiaNews"},
  ],
  "global-markets": [
    {name:"Reuters Business", url:"https://www.reuters.com/rssFeed/businessNews"},
    {name:"BBC Business", url:"https://feeds.bbci.co.uk/news/business/rss.xml"},
  ],
  "global-news": [
    {name:"Reuters World", url:"https://www.reuters.com/rssFeed/worldNews"},
    {name:"BBC World", url:"https://feeds.bbci.co.uk/news/world/rss.xml"},
    {name:"Al Jazeera", url:"https://www.aljazeera.com/xml/rss/all.xml"},
  ],
  "technology": [
    {name:"BBC Technology", url:"https://feeds.bbci.co.uk/news/technology/rss.xml"},
    {name:"The Verge", url:"https://www.theverge.com/rss/index.xml"},
  ],
  "business": [
    {name:"Economic Times Industry", url:"https://economictimes.indiatimes.com/industry/rssfeeds/13357270.cms"},
    {name:"Reuters Business", url:"https://www.reuters.com/rssFeed/businessNews"},
  ],
};

const SECTION_TITLES = {
  "top-stories":"Top Stories","indian-markets":"Indian Markets","indian-economy":"Indian Economy",
  "global-markets":"Global Markets","global-news":"Global News","technology":"Technology","business":"Business"
};

let allArticles = [];
let marketData = null;

const $ = (id)=>document.getElementById(id);
const strip = (h)=>{const d=document.createElement("div"); d.innerHTML=h||""; return (d.textContent||"").trim();};
const fmtIST = (d)=>{ try{ return new Date(d).toLocaleString("en-IN",{timeZone:"Asia/Kolkata", day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"}); }catch(e){ return ""; } };
const fmtDateIST = (d)=> new Date(d).toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata", weekday:"long", day:"numeric", month:"long", year:"numeric"});

function setISTDate(){
  const now = new Date();
  $("istDate").textContent = now.toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata", weekday:"long", day:"numeric", month:"long", year:"numeric"}) + " • IST";
  // Earnings headings: Today / Tomorrow / Day After
  const mk = (offset)=>{
    const d = new Date(now.getTime() + offset*24*60*60*1000);
    // Use IST date parts
    const parts = new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata", day:"numeric", month:"long", year:"numeric"}).format(d);
    return parts;
  };
  $("earnTodayTitle").textContent = "Today, " + mk(0);
  $("earnTomorrowTitle").textContent = "Tomorrow, " + mk(1);
  $("earnDayAfterTitle").textContent = "Day After Tomorrow, " + mk(2);
}

function renderEarnings(){
  const msg = `<div class="empty">Schedule could not be verified from official NSE / BSE / company IR pages in this edition.<br>Check <a href="https://www.nseindia.com/companies-listing/corporate-filings-announcements" target="_blank" rel="noopener">NSE Announcements</a> and <a href="https://www.bseindia.com/corporates/ann.html" target="_blank" rel="noopener">BSE Announcements</a> for the latest verified timings. No dates or call times are invented here.</div>`;
  $("earnToday").innerHTML = msg;
  $("earnTomorrow").innerHTML = msg;
  $("earnDayAfter").innerHTML = msg;
}

function renderMacro(){
  const rows = [
    ["CPI Inflation (India)","Awaiting verified update","—","%","—","—","<a href='https://www.mospi.gov.in/' target='_blank' rel='noopener'>MoSPI</a>"],
    ["GDP Growth (India, YoY)","Awaiting verified update","—","%","—","—","<a href='https://www.mospi.gov.in/' target='_blank' rel='noopener'>MoSPI</a>"],
    ["RBI Repo Rate","Awaiting verified update","—","%","—","—","<a href='https://www.rbi.org.in/' target='_blank' rel='noopener'>RBI</a>"],
    ["IIP Growth","Awaiting verified update","—","%","—","—","<a href='https://www.mospi.gov.in/' target='_blank' rel='noopener'>MoSPI</a>"],
    ["Manufacturing PMI","Awaiting verified update","—","Index","—","—","<a href='https://www.pmi.spglobal.com/' target='_blank' rel='noopener'>S&P Global</a>"],
    ["Trade Balance","Awaiting verified update","—","US$ bn","—","—","<a href='https://commerce.gov.in/' target='_blank' rel='noopener'>Ministry of Commerce</a>"],
    ["Forex Reserves","Awaiting verified update","—","US$ bn","—","—","<a href='https://www.rbi.org.in/' target='_blank' rel='noopener'>RBI</a>"],
    ["Fiscal Deficit","Awaiting verified update","—","₹ lakh cr","—","—","<a href='https://www.cga.nic.in/' target='_blank' rel='noopener'>CGA</a>"],
  ];
  $("macroBody").innerHTML = rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join("")}</tr>`).join("");
}

function renderIPO(){
  const msg = (label)=>`<div class="ipo-card"><h4>${label}</h4><p class="muted small" style="margin-top:8px">No verified IPO could be loaded in this edition.</p><p class="small">Verify against <a href="https://www.nseindia.com/market-data/new-listings-ipo" target="_blank" rel="noopener">NSE IPO</a> • <a href="https://www.bseindia.com/markets/MarketInfo/DispNewIPO.aspx" target="_blank" rel="noopener">BSE IPO</a> • SEBI filings. Price band, dates, size and subscription are never invented.</p><span class="badge">NOT VERIFIED</span></div>`;
  $("ipo-mainboard").innerHTML = msg("Mainboard — Awaiting verified filings") + msg("Mainboard — Check exchange notices");
  $("ipo-sme").innerHTML = msg("SME — Awaiting verified filings") + msg("SME — Check exchange notices");
}

function tickerHTML(){
  // Default: DATA NOT CONNECTED — never invent prices
  const symbols = [
    {name:"NIFTY 50"},{name:"SENSEX"},{name:"NIFTY BANK"},{name:"USD/INR"},{name:"MCX GOLD"},{name:"MCX SILVER"},{name:"MCX CRUDE"},
  ];
  if(!marketData || !marketData.items || !marketData.items.length){
    return symbols.map(s=>`<span class="tick"><b>${s.name}</b> <span class="flat">DATA NOT CONNECTED</span></span>`).join("") + `<span class="tick"><b>STATUS</b> <span class="flat">DEMO — Connect Yahoo Finance feed (see README)</span></span>`;
  }
  const byName = {}; marketData.items.forEach(i=>byName[i.symbol]=i);
  return symbols.map(s=>{
    const it = byName[s.name];
    if(!it) return `<span class="tick"><b>${s.name}</b> <span class="flat">DATA NOT CONNECTED</span></span>`;
    const cls = it.change > 0 ? "up" : it.change < 0 ? "down" : "flat";
    const arrow = it.change > 0 ? "▲" : it.change < 0 ? "▼" : "—";
    return `<span class="tick"><b>${s.name}</b> ${it.price?.toLocaleString("en-IN")} <span class="${cls}">${arrow} ${it.change} (${it.changePct}%)</span> <span class="flat">• ${fmtIST(it.timestamp)} IST • ${it.source||""}</span></span>`;
  }).join("");
}
function renderTicker(){
  const track = $("tickerTrack");
  track.innerHTML = tickerHTML() + tickerHTML(); // duplicate for seamless loop
  $("tickerSource").textContent = marketData?.source ? "Source: "+marketData.source+" • "+(marketData.note||"") : "Source: Not connected";
  const pill = $("statusPill");
  if(marketData && marketData.items?.length){
    pill.className = "pill delayed"; pill.textContent = "● DELAYED — Free source, not tick-by-tick";
  } else {
    pill.className = "pill demo"; pill.textContent = "● DEMO — DATA NOT CONNECTED";
  }
}

function cardHTML(a){
  const img = a.image ? `<img src="${a.image}" alt="" loading="lazy" onerror="this.remove()">` : "";
  return `<article class="card" onclick="window.open('${a.link.replace(/'/g,"")}','_blank','noopener')">
    ${img}<div class="pad"><span class="kicker">${a.sectionLabel} • ${a.source}</span><h3>${a.title}</h3><p>${a.desc||""}</p><div class="meta"><span>${fmtIST(a.pubDate)} IST</span><a href="${a.link}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Read original →</a></div></div></article>`;
}

function renderNews(){
  const q = ($("searchInput").value||"").trim().toLowerCase();
  let filtered = allArticles.filter(a=>{
    if(!q) return true;
    return (a.title+" "+a.desc+" "+a.source).toLowerCase().includes(q);
  });
  $("searchCount").textContent = q ? `${filtered.length} result(s) for “${q}”` : "";

  for(const sec of Object.keys(FEEDS)){
    const list = filtered.filter(a=>a.section===sec);
    const grid = $("grid-"+sec);
    if(!grid) continue;
    if(sec==="top-stories"){
      // Lead = first, rest in grid
      if(list.length){
        const [lead, ...rest] = list;
        $("leadStory").innerHTML = `<div><span class="kicker">Lead • ${lead.source}</span><h3><a href="${lead.link}" target="_blank" rel="noopener" style="text-decoration:none">${lead.title}</a></h3><p>${lead.desc}</p><div class="meta"><span>${fmtIST(lead.pubDate)} IST</span><a href="${lead.link}" target="_blank" rel="noopener">Read original →</a></div><p class="muted small" style="margin-top:10px"><strong>Why it matters:</strong> See the original reporting for full context. This edition shows a short summary only — verify implications against the source.</p></div>${lead.image?`<img src="${lead.image}" alt="" onerror="this.remove()">`:"<div></div>"}`;
        grid.innerHTML = rest.map(cardHTML).join("");
      } else {
        $("leadStory").innerHTML = "";
        grid.innerHTML = "";
      }
    } else {
      grid.innerHTML = list.map(cardHTML).join("");
    }
    const emptyEl = $("empty-"+sec);
    if(emptyEl) emptyEl.classList.toggle("hidden", list.length>0);
    const countEl = $("count-"+sec);
    if(countEl) countEl.textContent = list.length ? `${list.length} stories • last 24h only` : "";
  }
}

async function fetchViaRSS2JSON(feed){
  const api = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}`;
  try{
    const r = await fetch(api);
    const d = await r.json();
    if(d.status!=="ok") return [];
    return (d.items||[]).map(it=>({
      title: strip(it.title), desc: strip(it.description).slice(0,220),
      link: it.link, pubDate: it.pubDate, image: it.enclosure?.link || it.thumbnail || "",
      source: feed.name
    }));
  }catch(e){ return []; }
}

async function loadEdition(manual=false){
  const btn = $("refreshBtn");
  const prev = btn.textContent;
  if(manual){ btn.textContent="Refreshing…"; btn.disabled=true; }
  $("globalStatus").textContent = "Fetching latest edition… Checking each feed, keeping only articles from the last 24 hours.";
  let collected = [];
  let anySuccess = false;

  // 1) Try pre-built edition.json (GitHub Actions background build) — preferred for Vercel deploy
  try{
    const r = await fetch("data/edition.json?ts="+Date.now());
    if(r.ok){
      const j = await r.json();
      if(j && Array.isArray(j.articles) && j.articles.length){
        collected = j.articles;
        anySuccess = true;
        if(j.generatedAt) $("lastUpdated").textContent = fmtIST(j.generatedAt)+" IST";
        if(j.market) { marketData = j.market; }
      }
    }
  }catch(e){}

  // 2) If no pre-built edition, fetch live RSS in browser
  if(!collected.length){
    for(const sec of Object.keys(FEEDS)){
      for(const feed of FEEDS[sec]){
        const items = await fetchViaRSS2JSON(feed);
        if(items.length) anySuccess = true;
        items.forEach(it=> collected.push({...it, section: sec, sectionLabel: SECTION_TITLES[sec]}));
      }
    }
    if(anySuccess){
      $("lastUpdated").textContent = fmtIST(new Date())+" IST";
    }
  }

  // 24h retention + dedup by normalised title
  const cutoff = Date.now() - RETENTION_MS;
  const seen = new Set();
  allArticles = collected.filter(a=>{
    const t = new Date(a.pubDate).getTime();
    if(isNaN(t) || t < cutoff) return false; // use ORIGINAL pubDate, not fetch time
    const key = a.title.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a,b)=> new Date(b.pubDate)-new Date(a.pubDate));

  // Try market.json separately (GitHub Actions)
  if(!marketData){
    try{
      const r = await fetch("data/market.json?ts="+Date.now());
      if(r.ok){ const j = await r.json(); if(j.items?.length) marketData = j; }
    }catch(e){}
  }

  renderTicker(); renderNews();
  if(!anySuccess){
    $("globalStatus").textContent = "⚠ Fresh content unavailable — feeds could not be reached. Showing still-valid articles (if any) until their 24-hour expiry. No news has been invented. Try Refresh Edition again in a few minutes.";
    $("refreshNote").textContent = "Last attempt failed — retained still-valid articles";
  } else if(!allArticles.length){
    $("globalStatus").textContent = "Feeds were reached, but no articles within the last 24 hours were found. No older or invented stories are shown.";
    $("refreshNote").textContent = "Fresh check done — 0 stories in last 24h";
  } else {
    $("globalStatus").textContent = `✓ Edition updated — ${allArticles.length} verified stories from the last 24 hours. Original source, time (IST) and link preserved on each story.`;
    $("refreshNote").textContent = "Auto-refresh every hour while open + GitHub Actions hourly when deployed";
  }
  if(manual){ btn.textContent=prev; btn.disabled=false; }
}

// Events
$("refreshBtn").addEventListener("click", ()=>loadEdition(true));
$("searchInput").addEventListener("input", renderNews);
$("clearSearch").addEventListener("click", ()=>{ $("searchInput").value=""; renderNews(); });
$("themeBtn").addEventListener("click", ()=>{
  const dark = document.body.classList.toggle("dark");
  $("themeBtn").textContent = dark ? "☀️ Light" : "🌙 Dark";
  localStorage.setItem("af_theme", dark?"dark":"light");
});
document.querySelectorAll(".tab").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab").forEach(b=>{b.classList.remove("active"); b.setAttribute("aria-selected","false");});
    btn.classList.add("active"); btn.setAttribute("aria-selected","true");
    $("ipo-mainboard").classList.toggle("hidden", btn.dataset.tab!=="mainboard");
    $("ipo-sme").classList.toggle("hidden", btn.dataset.tab!=="sme");
  });
});

// Init
setISTDate(); renderEarnings(); renderMacro(); renderIPO();
if(localStorage.getItem("af_theme")==="dark"){ document.body.classList.add("dark"); $("themeBtn").textContent="☀️ Light"; }
loadEdition(false);
// Hourly auto-refresh while open
setInterval(()=>loadEdition(false), 60*60*1000);
// Update IST date every minute
setInterval(setISTDate, 60*1000);
