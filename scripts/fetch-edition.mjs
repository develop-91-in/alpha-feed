// ALPHA FEED — Hourly edition builder (GitHub Actions)
// Runs with Node 20, no API key, no AI. Parses RSS XML directly (no rss2json dependency).
// Rules: keep only ORIGINAL pubDate within last 24h, dedup by normalised title, preserve source + link.
// Market: tries Yahoo Finance unofficial chart endpoint for NIFTY/SENSEX/NIFTY BANK/USDINR + COMEX-derived MCX.
// Yahoo endpoint is UNOFFICIAL — no SLA, may change / rate-limit. If it fails, market.json keeps DATA NOT CONNECTED, never invented prices.
// MCX: Yahoo has NO official MCX symbol. MCX Gold/Silver/Crude below are DERIVED from COMEX futures (GC=F, SI=F, CL=F) × USD/INR:
//   Gold ₹/10g = GC(USD/oz) × USDINR / 31.1035 × 10 ; Silver ₹/kg = SI × USDINR / 31.1035 × 1000 ; Crude ₹/bbl = CL × USDINR.
//   They are labelled "derived from COMEX, approx — not official MCX feed" in the output. For official MCX, add a licensed feed.

import fs from "node:fs";

const RETENTION = 24*60*60*1000;
const FEEDS = [
  {section:"top-stories", name:"Reuters Top", url:"https://www.reuters.com/rssFeed/topNews"},
  {section:"top-stories", name:"BBC News", url:"https://feeds.bbci.co.uk/news/rss.xml"},
  {section:"indian-markets", name:"Economic Times Markets", url:"https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms"},
  {section:"indian-economy", name:"Economic Times Economy", url:"https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms"},
  {section:"global-markets", name:"Reuters Business", url:"https://www.reuters.com/rssFeed/businessNews"},
  {section:"global-news", name:"Reuters World", url:"https://www.reuters.com/rssFeed/worldNews"},
  {section:"global-news", name:"BBC World", url:"https://feeds.bbci.co.uk/news/world/rss.xml"},
  {section:"technology", name:"BBC Technology", url:"https://feeds.bbci.co.uk/news/technology/rss.xml"},
  {section:"technology", name:"The Verge", url:"https://www.theverge.com/rss/index.xml"},
  {section:"business", name:"Reuters Business", url:"https://www.reuters.com/rssFeed/businessNews"},
];
const LABELS = {"top-stories":"Top Stories","indian-markets":"Indian Markets","indian-economy":"Indian Economy","global-markets":"Global Markets","global-news":"Global News","technology":"Technology","business":"Business"};

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
      // Yahoo v8 gives fulldayChange / fulldayChangePercent directly — use them, not previousClose (often missing)
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
  // USD/INR needed for MCX derivation — fetch it first if not already in items
  let usdinr = items.find(i=>i.symbol==="USD/INR")?.price;
  if(!usdinr){
    const m = await yahooMeta("INR=X"); usdinr = m?.regularMarketPrice;
  }
  // MCX derived from COMEX (GC=F, SI=F, CL=F) — labelled derived, never claimed as official MCX
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
  const t = new Date(a.pubDate).getTime();
  if(isNaN(t) || t<cutoff) return false;
  const key = a.title.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  if(seen.has(key)) return false; seen.add(key); return true;
}).sort((a,b)=>new Date(b.pubDate)-new Date(a.pubDate));

const market = await fetchMarket();
fs.mkdirSync("data",{recursive:true});
fs.writeFileSync("data/edition.json", JSON.stringify({generatedAt:new Date().toISOString(), articles:kept, market}, null, 2));
fs.writeFileSync("data/market.json", JSON.stringify(market, null, 2));
console.log(`Kept ${kept.length} articles (24h) • Market items: ${market.items.length}`);
