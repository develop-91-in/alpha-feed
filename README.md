# ALPHA FEED — The World of Money, Decoded.
A financial newspaper by Jatin Singh. Designed & Developed by Jatin Singh.

Premium, editorial-style, single-page financial newspaper for Indian readers.

## Sections — exact order (v2)
1. Top Stories • 2. Indian Markets • 3. Indian Economy • 4. IPO Centre • 5. Earnings Calls
6. Global Markets • 7. Global News • 8. Technology • 9. Macro & Stats (India only) • 10. Business

Finance and economy only. Sports, Bollywood, entertainment, celebrity and general politics are
filtered out in both `app.js` and `scripts/fetch-edition.mjs`. Global News covers geopolitics
only where it has financial consequences. Technology covers AI / chips / fintech / deals with
business significance — no gadget deals or reviews.

IPO Centre and Earnings Calls are news feeds (IPO / earnings keyword-filtered), not invented
term sheets. Price bands, subscription, allotment and call times are never invented — verify
via the RHP / NSE / BSE link in each story.

## Files
```
index.html — Masthead, ticker, 10 sections in exact order, footer
styles.css — Paper-like light mode + dark mode, Playfair Display headlines
app.js — Search, refresh, 24h retention, ticker, finance-only filter, Earnings dates (IST)
scripts/fetch-edition.mjs — Node script: fetches RSS directly (no API key), prunes >24h, dedups, writes data/
data/edition.json — Latest edition built by the script (articles + market)
data/market.json — Latest market snapshot
.github/workflows/hourly-refresh.yml — GitHub Actions: runs fetch script every hour, even when browser is closed
vercel.json — Static hosting config (no-cache for /data/*)
```

## How to open locally
Double-click `index.html`, or:
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## How background hourly refresh REALLY works (read this)
- **While the page is open:** `app.js` auto-refreshes every hour via `setInterval`, plus the Refresh Edition button.
- **When the page is closed:** The browser cannot refresh. Muse also cannot run background jobs by itself.
- **True background refresh** requires the included GitHub Actions workflow + deploy:
  1. Push this folder to GitHub (see below).
  2. GitHub Actions runs `scripts/fetch-edition.mjs` every hour (cron `0 * * * *`), commits `data/edition.json`.
  3. Connect the repo to Vercel (Import Project). Vercel redeploys on every push, so visitors always see the latest committed edition.
  4. Do NOT claim background refresh works until you see a successful Actions run + a new commit + Vercel deploy.

## GitHub → Vercel deploy (simplest)
1. Create a repo on GitHub (e.g. `alpha-feed`). Do NOT paste any API key in chat or in the repo.
2. Push:
```bash
git init && git add . && git commit -m "ALPHA FEED v1"
git branch -M main && git remote add origin https://github.com/<you>/alpha-feed.git && git push -u origin main
```
3. Go to vercel.com → Add New → Project → Import the repo → Deploy. No build command needed (static).
4. In GitHub repo → Actions → enable the `ALPHA FEED — Hourly Edition Refresh` workflow → Run workflow once to test.
5. Check `data/edition.json` updated, then open your Vercel link.

## Market ticker — honest status
- Ticker shows **DATA NOT CONNECTED** until `data/market.json` contains verified items.
- Market source in the script: Yahoo Finance **unofficial** chart endpoint (`query1.finance.yahoo.com/v8/finance/chart/...`). Unofficial = no SLA, may change / rate-limit / block. It is NOT a licensed NSE/BSE feed.
- Symbols attempted: NIFTY 50 (`^NSEI`), SENSEX (`^BSESN`), NIFTY BANK (`^NSEBANK`), USD/INR (`INR=X`) — all direct Yahoo.
- **MCX GOLD / SILVER / CRUDE: CONNECTED via COMEX derivation (not official MCX).** Yahoo has no official MCX symbol, so the script derives: Gold ₹/10g = GC=F (COMEX Gold USD/oz) × USD/INR / 31.1035 × 10; Silver ₹/kg = SI=F × USD/INR / 31.1035 × 1000; Crude ₹/bbl = CL=F (WTI USD/bbl) × USD/INR. Each ticker item is labelled “Derived from COMEX … — approx, not official MCX feed”. Do NOT relabel these as official MCX. For official MCX, add a licensed feed.
- All ticker data is **delayed**, not tick-by-tick. Label in the UI is DELAYED when connected.

## News sources
RSS feeds directly from publishers (Reuters, BBC, Economic Times, RBI, Al Jazeera, The Verge, etc.) in `app.js` + `scripts/fetch-edition.mjs`. Summaries are short excerpts with original source, IST publication time and link. No full copyrighted articles are reproduced.

If a feed blocks or fails, the edition retains still-valid (<24h) articles and shows a stale-data warning. No news is invented.

## IPO / Earnings / Macro — never invented
- **IPO Centre:** News feed filtered to IPO / listing / allotment / subscription / GMP / RHP. Never invent band, dates, size or subscription. Verify via RHP / NSE / BSE.
- **Earnings Calls:** News feed filtered to earnings / quarterly results / net profit / earnings call. Today / Tomorrow / Day After Tomorrow headings use IST dates automatically. Never invent call times. Results announcement ≠ call time ≠ board meeting.
- **Macro & Stats:** Rows show “Awaiting verified update” with official source links unless a verified value is entered with a release date. Never show unreleased data as confirmed.

## Limits — verified vs estimate (checked 19 Oct 2026 via web search, re-check vendor pages before relying)
- **GitHub Actions:** Third-party summaries report Free = 2,000 min/month (private repos), unlimited on public repos. Overage Linux ~$0.006/min. This workflow ~30–60 sec/run. Estimate (private, hourly): 720 runs/month × ~1 min = ~720 min/month — inside 2,000 min, **estimate only**. Re-check https://github.com/pricing
- **Vercel Hobby:** Third-party summaries report free, personal non-commercial only, 100 GB data transfer, 1M edge requests, 1M function invocations. **Vercel Cron on Hobby: once per day only** — so do NOT use Vercel Cron for hourly. Use GitHub Actions for hourly (above). Pro (~$20/seat/month per summaries) allows per-minute cron + commercial use. Re-check https://vercel.com/pricing
- **rss2json:** Used only for in-browser fallback. Official free limit **not verified** in search — treat as unverified, rate-limited. The GitHub Actions script avoids rss2json by parsing RSS XML directly.
- **Yahoo Finance unofficial:** No official limits page, no SLA. Treat delay as unverified, rate limit unknown, change risk high.
- **Muse tokens after deploy:** 0 — refresh is plain Node code in GitHub Actions, not AI. One-time build cost only.

## What is still missing (not connected)
- [ ] GitHub repo + Vercel project (you must create / connect — Muse cannot push until GitHub is connected and you give a repo name)
- [ ] Verified IPO data feed / manual verification against RHPs
- [ ] Verified earnings-call schedule feed (NSE/BSE/company IR — manual or scraper you have rights to use)
- [ ] MCX official feed (licensed) — only if you want official MCX instead of the current COMEX-derived approx.
- [ ] Any paid NewsAPI / subscription source (would need key in GitHub Secrets only, never in code/chat)

## Accessibility
Skip link, keyboard-focus outlines, pause-on-hover ticker, `prefers-reduced-motion` disables ticker animation, sufficient contrast in both themes.
