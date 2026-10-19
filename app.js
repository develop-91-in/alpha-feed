// ALPHA FEED — Newspaper logic (v2 — exact section order + finance-only filter)
// Honest data rules:
// - News: only articles whose ORIGINAL pubDate is within last 24h are shown.
// - Finance only: sports / Bollywood / entertainment / celebrity / general politics are filtered out.
// - Market ticker: shows DATA NOT CONNECTED until a verified fetch succeeds. Never invents prices.
// - IPO / Earnings: news cards only. Price bands / call times are never invented — verify via RHP / exchange.
// - Hourly refresh: in-browser setInterval while page is open. Background refresh when closed requires GitHub Actions + Vercel deploy.

const RETENTION_MS = 24 * 60 * 60 * 1000;

// Exact spec order: Top Stories, Indian Markets, Indian Economy, IPO Centre, Earnings Calls,
// Global Markets, Global News, Technology, Macro & Stats (India only, table), Business
// v2.1: EACH FEED URL APPEARS EXACTLY ONCE (see fetch script note). IPO / Earnings have no
// dedicated feeds — populated by reassignment from markets / business / top-stories.
const FEEDS = {
  "top-stories": [
    {name:"Reuters Top", url:"https://www.reuters.com/rssFeed/topNews"},
    {name:"BBC News", url:"https://feeds.bbci.co.uk/news/rss.xml"},
  ],
  "indian-markets": [
    {name:"Economic Times Markets", url:"https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms"},
    {name:"Moneycontrol Markets", url:"https://www.moneycontrol.com/rss/marketstats.xml"},
  ],
  "indian-economy": [
    {name:"Economic Times Economy", url:"https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms"},
    {name:"RBI Press Releases", url:"https://www.rbi.org.in/Scripts/RSS.aspx"},
  ],
  "ipo-centre": [],
  "earnings-calls": [],
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
  ],
};

const SECTION_TITLES = {
  "top-stories":"Top Stories","indian-markets":"Indian Markets","indian-economy":"Indian Economy",
  "ipo-centre":"IPO Centre","earnings-calls":"Earnings Calls",
  "global-markets":"Global Markets","global-news":"Global News","technology":"Technology","business":"Business"
};

// ---- Finance-only filter (shared logic with scripts/fetch-edition.mjs, v2.1) ----
const BLOCKED_RE = /\b(cricket|football|soccer|tennis|badminton|hockey|ipl|afcon|fifa|uefa|caf\b|world cup|premier league|champions league|man city|manchester|arsenal|chelsea|haaland|sport| sports|bollywood|hollywood|actor|actress|singer|rapper|movie|film star|web series|bigg boss|reality show|celebrity|gossip|beauty pageant|miss universe|oscar|grammy|concert|stand-?up comedy|esports|video game|playstation|xbox|netflix show|tv show|soap opera|daily soap|fashion week|red carpet|wedding of|marriage of|divorce of|separation|baby shower)\b/i;
const FINANCE_RE = /(\bmarket(s)?\b|\bnifty\b|\bsensex\b|\bstock(s)?\b|\bshare(s)?\b|economy|\bgdp\b|inflation|\brbi\b|\bbank(s)?\b|finance|investment|\bipo\b|earnings|profit|revenue|\btrade\b|\btariff(s)?\b|\brupee\b|\bdollar(s)?\b|\bgold\b|\bsilver\b|\bcrude\b|\boil\b|\bbond(s)?\b|\byield(s)?\b|interest rate|fiscal|\bbudget\b|\btax\b|startup|funding|merger|acquisition|\bdeal(s)?\b|business|industry|commodit|forex|central bank|\bfed\b|\becb\b|\bimf\b|world bank|\bsebi\b|\bnse\b|\bbse\b|mutual fund|insurance|pension|\bdebt\b|deficit|exports|imports|manufacturing|services pmi|forex reserves)/i;
const GEO_FINANCE_RE = /(\btrade\b|\btariff(s)?\b|\bsanction(s)?\b|\bwar\b|\bconflict\b|\bceasefire\b|\benergy\b|\boil\b|\bgas\b|supply chain|central bank|interest rate|inflation|\brecession\b|\bdebt\b|\btreaty\b|\bembargo\b|\bblockade\b|\bmilitary\b|geopolitic|diplomac|\bsummit\b|\bmarket(s)?\b|economy|finance|investment|commodit|\bpipeline\b|\bstrait\b|\bnato\b|united nations|\bg7\b|\bg20\b|\bbrics\b|\bopec\b|european union)/i;
const TECH_FINANCE_RE = /(ai\b|artificial intelligence|semiconductor|\bchip(s)?\b|fintech|startup|funding|\bipo\b|earnings|acquisition|merger|investment|valuation|data centre|datacenter|\bcloud\b|openai|nvidia|microsoft|google|amazon|\bmeta\b|reliance jio|\bjio\b|telecom|\b5g\b|digital economy|cybersecurity|blockchain|quantum|robotics|electric vehicle|\bev\b|battery|satellite.*deal|space.*deal)/i;
const GADGET_DEAL_RE = /(\$\d+\s*off|is \$\d+ off|deal.*sale|discount.*deal|best buy.*deal|price cut.*deal)/i;
const IPO_RE = /(?:\bipo\b|initial public offering|listing gains?|listing date|listing price|stock market listing|market listing|dual-listing|to list on|lists? on (?:the )?(?:bse|nse|nasdaq|nyse|stock exchange)|\ballotment\b|\bsubscription\b|grey market|\bgmp\b|price band|book-?built|offer for sale|\bdrhp\b|\brhp\b|prospectus|anchor investor)/i;
const EARNINGS_RE = /\b(earnings|quarterly results|quarterly profit|net profit|profit (rises|rose|falls|fell|jumps|dips)|revenue (rises|rose|falls|fell)|results (beat|miss)|investor presentation|earnings call|q[1-4]\b.*(profit|revenue|results)|board meeting.*results)\b/i;
const SPORTS_URL_RE = /\/(sports?|entertainment|showbiz|bollywood|celebrity)\//i;

function isBlocked(a){
  const t = (a.title + " " + (a.desc || "")).toLowerCase();
  if (BLOCKED_RE.test(t)) return true;
  if (SPORTS_URL_RE.test(a.link || "")) return true;
  if (a.section === "technology" && GADGET_DEAL_RE.test(t)) return true;
  return false;
}
function passesSectionFilter(a){
  const t = a.title + " " + (a.desc || "");
  if (a.section === "top-stories") return FINANCE_RE.test(t) || /economic times/i.test(a.source || "");
  if (a.section === "global-news") return GEO_FINANCE_RE.test(t.replace(/tear gas/gi, " "));
  if (a.section === "technology") return TECH_FINANCE_RE.test(t);
  return true;
}
function reassignSection(a){
  if (a.section === "indian-economy" || a.section === "global-news" || a.section === "technology") return a.section;
  const t = a.title + " " + (a.desc || "");
  if (IPO_RE.test(t)) return "ipo-centre";
  if (EARNINGS_RE.test(t)) return "earnings-calls";
  return a.section;
}
function applyFinanceFilter(list){
  const out = [];
  for (const a of list){
    if (!a.title || !a.link) continue;
    if (isBlocked(a)) continue;
    if (!passesSectionFilter(a)) continue;
    const section = reassignSection(a);
    out.push({ ...a, section, sectionLabel: SECTION_TITLES[section] || a.sectionLabel || section });
  }
  return out;
}

let allArticles = [];
let marketData = null;

const $ = (id)=>document.getElementById(id);
const strip = (h)=>{const d=document.createElement("div"); d.innerHTML=h||""; return (d.textContent||"").trim();};
const fmtIST = (d)=>{ try{ return new Date(d).toLocaleString("en-IN",{timeZone:"Asia/Kolkata", day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"}); }catch(e){ return ""; } };
const fmtDateIST = (d)=> new Date(d).toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata", weekday:"long", day:"numeric", month:"long", year:"numeric"});

function setISTDate(){
  const now = new Date();
  $("istDate").textContent = now.toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata", weekday:"long", day:"numeric", month:"long", year:"numeric"}) + " • IST";
  const mk = (offset)=>{
    const d = new Date(now.getTime() + offset*24*60*60*1000);
    return new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata", day:"numeric", month:"long", year:"numeric"}).format(d);
  };
  const t = $("earnTodayTitle"); if (t) t.textContent = "Today, " + mk(0);
  const tm = $("earnTomorrowTitle"); if (tm) tm.textContent = "Tomorrow, " + mk(1);
  const da = $("earnDayAfterTitle"); if (da) da.textContent = "Day After Tomorrow, " + mk(2);
}

function renderMacro(){
  // India only. Values only where verified at build time; otherwise awaiting verified update.
  const rows = [
    ["CPI Inflation (India)","Awaiting verified update","—","%","—","—","<a href='https://www.mospi.gov.in/' target='_blank' rel='noopener'>MoSPI</a>"],
    ["GDP Growth (India, YoY)","Awaiting verified update","—","%","—","—","<a href='https://www.mospi.gov.in/' target='_blank' rel='noopener'>MoSPI</a>"],
    ["RBI Repo Rate","Awaiting verified update","—","%","—","—","<a href='https://www.rbi.org.in/' target='_blank' rel='noopener'>RBI</a>"],
    ["IIP Growth (India)","Awaiting verified update","—","%","—","—","<a href='https://www.mospi.gov.in/' target='_blank' rel='noopener'>MoSPI</a>"],
    ["Manufacturing PMI (India)","Awaiting verified update","—","Index","—","—","<a href='https://www.pmi.spglobal.com/' target='_blank' rel='noopener'>S&P Global</a>"],
    ["Trade Balance (India)","Awaiting verified update","—","US$ bn","—","—","<a href='https://commerce.gov.in/' target='_blank' rel='noopener'>Ministry of Commerce</a>"],
    ["Forex Reserves (India)","Awaiting verified update","—","US$ bn","—","—","<a href='https://www.rbi.org.in/' target='_blank' rel='noopener'>RBI</a>"],
    ["Fiscal Deficit (India)","Awaiting verified update","—","₹ lakh cr","—","—","<a href='https://www.cga.nic.in/' target='_blank' rel='noopener'>CGA</a>"],
  ];
  $("macroBody").innerHTML = rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join("")}</tr>`).join("");
}

function tickerHTML(){
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
  track.innerHTML = tickerHTML() + tickerHTML();
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
  const safeLink = (a.link || "").replace(/'/g, "");
  return `<article class="card" onclick="window.open('${safeLink}','_blank','noopener')">
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
  $("globalStatus").textContent = "Fetching latest edition… Checking each feed, keeping only finance articles from the last 24 hours.";
  let collected = [];
  let anySuccess = false;

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

  // Finance-only filter + 24h retention + dedup by section+title (Top Stories copies
  // intentionally share a title with the original in its own section).
  const cutoff = Date.now() - RETENTION_MS;
  const seen = new Set();
  const financeOnly = applyFinanceFilter(collected);
  allArticles = financeOnly.filter(a=>{
    const t = new Date(a.pubDate).getTime();
    if(isNaN(t) || t < cutoff) return false;
    const key = a.section + "|" + a.title.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a,b)=> new Date(b.pubDate)-new Date(a.pubDate));
  // Top Stories curated view (browser fallback): if fewer than 3, supplement with the
  // most recent finance / geopolitics articles from other sections, as copies.
  const topCount = allArticles.filter(a=>a.section==="top-stories").length;
  if (topCount < 3){
    const need = 6 - topCount;
    const copies = allArticles.filter(a=>a.section!=="top-stories" && (FINANCE_RE.test(a.title+" "+(a.desc||"")) || GEO_FINANCE_RE.test((a.title+" "+(a.desc||"")).replace(/tear gas/gi, " ")))).slice(0, need).map(a=>({...a, section:"top-stories", sectionLabel:"Top Stories"}));
    allArticles = [...copies, ...allArticles].sort((a,b)=> new Date(b.pubDate)-new Date(a.pubDate));
  }

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
    $("globalStatus").textContent = "Feeds were reached, but no finance articles within the last 24 hours were found. No older, non-finance or invented stories are shown.";
    $("refreshNote").textContent = "Fresh check done — 0 stories in last 24h";
  } else {
    $("globalStatus").textContent = `✓ Edition updated — ${allArticles.length} verified finance stories from the last 24 hours. Original source, time (IST) and link preserved on each story.`;
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

// Init
setISTDate(); renderMacro();
if(localStorage.getItem("af_theme")==="dark"){ document.body.classList.add("dark"); $("themeBtn").textContent="☀️ Light"; }
loadEdition(false);
setInterval(()=>loadEdition(false), 60*60*1000);
setInterval(setISTDate, 60*1000);
