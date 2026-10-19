// ALPHA FEED — Hourly edition builder (GitHub Actions) — v2
// Runs with Node 20, no API key, no AI. Parses RSS XML directly (no rss2json dependency).
// Rules: finance only (sports / Bollywood / entertainment filtered out), keep only ORIGINAL
// pubDate within last 24h, dedup by normalised title, preserve source + link.
// Market: tries Yahoo Finance unofficial chart endpoint for NIFTY/SENSEX/NIFTY BANK/USDINR + COMEX-derived MCX.
// Yahoo endpoint is UNOFFICIAL — no SLA, may change / rate-limit. If it fails, market.json keeps DATA NOT CONNECTED, never invented prices.
// MCX: Yahoo has NO official MCX symbol. MCX Gold/Silver/Crude below are DERIVED from COMEX futures (GC=F, SI=F, CL=F) × USD/INR:
//   Gold ₹/10g = GC(USD/oz) × USDINR / 31.1035 × 10 ; Silver ₹/kg = SI × USDINR / 31.1035 × 1000 ; Crude ₹/bbl = CL × USDINR.
//   They are labelled "derived from COMEX, approx — not official MCX feed" in the output. For official MCX, add a licensed feed.

import fs from "node:fs";

const RETENTION = 24*60*60*1000;
// Exact spec order (Macro & Stats is a table, not a news feed, so not in FEEDS).
// v2.1: EACH FEED URL APPEARS EXACTLY ONCE, in its primary section. Duplicate feeds across
// sections + global dedup starved later sections (v2 bug: ET Economy in Top Stories ate
// Indian Economy, ET Industry in Earnings ate Business, BBC Business in Indian Markets ate
// Global Markets). IPO / Earnings have NO dedicated feeds — they are populated by
// reassignment from markets / business / top-stories (see reassignSection).
// Reuters feeds returned HTTP 401 on 19 Oct 2026 check — kept (may recover) but BBC / ET /
// Al Jazeera carry the edition in the meantime. Do not claim Reuters is working.
const FEEDS = [
  {section:"top-stories", name:"Reuters Top", url:"https://www.reuters.com/rssFeed/topNews"},
  {section:"top-stories", name:"BBC News", url:"https://feeds.bbci.co.uk/news/rss.xml"},
  {section:"indian-markets", name:"Economic Times Markets", url:"https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms"},
  {section:"indian-markets", name:"Moneycontrol Markets", url:"https://www.moneycontrol.com/rss/marketstats.xml"},
  {section:"indian-economy", name:"Economic Times Economy", url:"https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms"},
  {section:"indian-economy", name:"RBI Press Releases", url:"https://www.rbi.org.in/Scripts/RSS.aspx"},
  {section:"global-markets", name:"Reuters Business", url:"https://www.reuters.com/rssFeed/businessNews"},
  {section:"global-markets", name:"BBC Business", url:"https://feeds.bbci.co.uk/news/business/rss.xml"},
  {section:"global-news", name:"Reuters World", url:"https://www.reuters.com/rssFeed/worldNews"},
  {section:"global-news", name:"BBC World", url:"https://feeds.bbci.co.uk/news/world/rss.xml"},
  {section:"global-news", name:"Al Jazeera", url:"https://www.aljazeera.com/xml/rss/all.xml"},
  {section:"technology", name:"BBC Technology", url:"https://feeds.bbci.co.uk/news/technology/rss.xml"},
  {section:"technology", name:"The Verge", url:"https://www.theverge.com/rss/index.xml"},
  {section:"business", name:"Economic Times Industry", url:"https://economictimes.indiatimes.com/industry/rssfeeds/13357270.cms"},
];
const LABELS = {"top-stories":"Top Stories","indian-markets":"Indian Markets","indian-economy":"Indian Economy","ipo-centre":"IPO Centre","earnings-calls":"Earnings Calls","global-markets":"Global Markets","global-news":"Global News","technology":"Technology","business":"Business"};

// ---- Finance-only filter (must stay in sync with app.js) ----
// v2.1: word boundaries on short keywords — bare "war" matched "warrant"/"awarded"
// (Catalonia warrant story, AFCON awarded story), bare "oil" matched "foil", etc.
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
  // v2.1 guard: never steal from Indian Economy, Global News or Technology — an economy
  // article mentioning "profit" is still an economy article; a geopolitics article
  // mentioning a listing is still geopolitics. Only markets / business / top-stories
  // feed IPO Centre and Earnings Calls.
  if (a.section === "indian-economy" || a.section === "global-news" || a.section === "technology") return a.section;
  const t = a.title + " " + (a.desc || "");
  if (IPO_RE.test(t)) return "ipo-centre";
  if (EARNINGS_RE.test(t)) return "earnings-calls";
  return a.section;
}

function pick(tag, xml){
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim().replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/<[^>]+>/g,"").trim() : "";
}
function pickLink(xml){
  const m = xml.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || xml.match(/<link[^>]+href="([^"]+)"/i);
  return m ? m[1].trim() : "";
}
async function fetchFeed(f){
  try{
    const r = await fetch(f.url, {headers:{"User-Agent":"AlphaFeed/1.0 (news aggregator; contact: Jatin Singh)"}});
    if(!r.ok) return [];
    const text = await r.text();
    const items = [...text.matchAll(/<item>[\s\S]*?<\/item>/gi)].map(m=>m[0]);
    const entries = [...text.matchAll(/<entry>[\s\S]*?<\/entry>/gi)].map(m=>m[0]);
    const blocks = items.length ? items : entries;
    return blocks.map(b=>({
      title: pick("title", b),
      desc: pick("description", b) || pick("summary", b),
      link: pickLink(b),
      pubDate: pick("pubDate", b) || pick("published", b) || pick("updated", b),
      image: "",
      source: f.name,
      section: f.section,
      sectionLabel: LABELS[f.section] || f.section,
    })).filter(a=>a.title && a.link);
  }catch(e){ console.warn("Feed failed", f.name, e.message); return []; }
}

async function yahooMeta(yahoo){
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${yahoo}?interval=1d&range=5d`, {headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok) return null;
  const j = await r.json();
  return j?.chart?.result?.[0]?.meta ?? null;
}
async function fetchMarket(){
  const items = [];
  const pushDirect = async (symbol, yahoo) => {
    try{
      const meta = await yahooMeta(yahoo);
      if(!meta || meta.regularMarketPrice==null) return;
      const price = meta.regularMarketPrice;
      const change = meta.fulldayChange ?? 0;
      const pct = meta.fulldayChangePercent ?? meta.regularMarketChangePercent ?? 0;
      items.push({symbol, price:+price.toFixed(2), change:+Number(change).toFixed(2), changePct:+Number(pct).toFixed(2), timestamp:new Date().toISOString(), source:"Yahoo Finance (unofficial, delayed)"});
    }catch(e){ console.warn("Market failed", symbol, e.message); }
  };
  await pushDirect("NIFTY 50", "%5ENSEI");
  await pushDirect("SENSEX", "%5EBSESN");
  await pushDirect("NIFTY BANK", "%5ENSEBANK");
  await pushDirect("USD/INR", "INR=X");
  let usdinr = items.find(i=>i.symbol==="USD/INR")?.price;
  if(!usdinr){
    const m = await yahooMeta("INR=X"); usdinr = m?.regularMarketPrice;
  }
  if(usdinr){
    try{
      const gc = await yahooMeta("GC%3DF");
      if(gc?.regularMarketPrice!=null){
        const price = gc.regularMarketPrice * usdinr / 31.1035 * 10;
        const chg = (gc.fulldayChange ?? 0) * usdinr / 31.1035 * 10;
        items.push({symbol:"MCX GOLD", price:+price.toFixed(0), change:+chg.toFixed(0), changePct:+(gc.fulldayChangePercent ?? 0).toFixed(2), timestamp:new Date().toISOString(), source:"Derived from COMEX GC=F × USD/INR — approx, not official MCX feed", unit:"₹/10g"});
      }
      const si = await yahooMeta("SI%3DF");
      if(si?.regularMarketPrice!=null){
        const price = si.regularMarketPrice * usdinr / 31.1035 * 1000;
        const chg = (si.fulldayChange ?? 0) * usdinr / 31.1035 * 1000;
        items.push({symbol:"MCX SILVER", price:+price.toFixed(0), change:+chg.toFixed(0), changePct:+(si.fulldayChangePercent ?? 0).toFixed(2), timestamp:new Date().toISOString(), source:"Derived from COMEX SI=F × USD/INR — approx, not official MCX feed", unit:"₹/kg"});
      }
      const cl = await yahooMeta("CL%3DF");
      if(cl?.regularMarketPrice!=null){
        const price = cl.regularMarketPrice * usdinr;
        const chg = (cl.fulldayChange ?? 0) * usdinr;
        items.push({symbol:"MCX CRUDE", price:+price.toFixed(0), change:+chg.toFixed(0), changePct:+(cl.fulldayChangePercent ?? 0).toFixed(2), timestamp:new Date().toISOString(), source:"Derived from WTI CL=F × USD/INR — approx, not official MCX feed", unit:"₹/bbl"});
      }
    }catch(e){ console.warn("MCX derived failed", e.message); }
  }
  return {generatedAt:new Date().toISOString(), source:"Yahoo Finance unofficial endpoint — no SLA, delayed, may change", note:"NIFTY/SENSEX/BANK/USDINR: direct Yahoo. MCX Gold/Silver/Crude: derived from COMEX futures × USD/INR, approx — not official MCX feed. For official MCX, add a licensed feed.", items};
}

const all = [];
for(const f of FEEDS){ const it = await fetchFeed(f); all.push(...it); }
const cutoff = Date.now()-RETENTION;
const seen = new Set();
const kept = all.filter(a=>{
  if (isBlocked(a)) return false;
  if (!passesSectionFilter(a)) return false;
  const section = reassignSection(a);
  a.section = section; a.sectionLabel = LABELS[section] || section;
  const t = new Date(a.pubDate).getTime();
  if(isNaN(t) || t<cutoff) return false;
  const key = a.title.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  if(seen.has(key)) return false; seen.add(key); return true;
}).sort((a,b)=>new Date(b.pubDate)-new Date(a.pubDate));

// Top Stories is a CURATED VIEW, not an exclusive bucket: the 8 most recent
// finance / geopolitics-relevant articles across all sections, copied into Top Stories
// while keeping the originals in their own sections (normal newspaper behaviour).
// This keeps Top Stories populated even when Reuters Top returns 401 and BBC News
// general feed is mostly non-finance.
const topCopies = kept.filter(a => a.section !== "top-stories" && (FINANCE_RE.test(a.title + " " + (a.desc || "")) || GEO_FINANCE_RE.test((a.title + " " + (a.desc || "")).replace(/tear gas/gi, " ")))).slice(0, 8).map(a => ({...a, section:"top-stories", sectionLabel:"Top Stories"}));
const finalArticles = [...topCopies, ...kept];

const market = await fetchMarket();
fs.mkdirSync("data",{recursive:true});
fs.writeFileSync("data/edition.json", JSON.stringify({generatedAt:new Date().toISOString(), articles:finalArticles, market}, null, 2));
fs.writeFileSync("data/market.json", JSON.stringify(market, null, 2));
console.log(`Kept ${kept.length} unique articles (24h, finance-only) + ${topCopies.length} Top Stories copies • Market items: ${market.items.length}`);
const bySec = {}; for (const a of finalArticles) bySec[a.section] = (bySec[a.section]||0)+1;
console.log("By section (incl. Top Stories copies):", JSON.stringify(bySec));
