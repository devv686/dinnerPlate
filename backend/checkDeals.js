// backend/checkDeals.js
import { fetch } from "undici";
import * as cheerio from "cheerio";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// -------- Helpers --------
function unwrapDDG(href) {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    if (u.hostname.endsWith("duckduckgo.com")) {
      const raw = u.searchParams.get("uddg");
      if (raw) return decodeURIComponent(raw);
    }
    return href;
  } catch {
    return href;
  }
}

function parseDDG(html) {
  const $ = cheerio.load(html);
  const items = [];
  $("a.result__a, a.result__title").each((_, el) => {
    const title = $(el).text().trim();
    const href = $(el).attr("href");
    if (title && href) {
      items.push({ title, url: unwrapDDG(href) });
    }
  });
  return items;
}

function jaccard(a, b) {
  const A = new Set((a || "").toLowerCase().split(/\s+/).filter(Boolean));
  const B = new Set((b || "").toLowerCase().split(/\s+/).filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

async function getHtml(url) {
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9"
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await sleep(400);
    }
  }
  throw lastErr;
}

// -------- Core check --------
async function checkPlatform(name, city, domain) {
  const q = `${name} ${city} site:${domain}`;
  try {
    const html = await getHtml(`https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
    const results = parseDDG(html).slice(0, 6);
    let best = null;

    for (const r of results) {
      const sim = jaccard(`${name} ${city}`, r.title);
      const hasDomain = (() => {
        try { return new URL(r.url).hostname.includes(domain); }
        catch { return r.url.includes(domain); }
      })();

      const score = (hasDomain ? 0.5 : 0) + sim * 0.5;
      if (!best || score > best.score) best = { ...r, sim, hasDomain, score };
    }

    const isSure = best && best.hasDomain && best.sim >= 0.3;
    return {
      status: isSure ? "sure" : "unknown",
      confidence: best ? best.score : 0,
      sample: best || null
    };
  } catch (e) {
    return { status: "unknown", confidence: 0, error: String(e) };
  }
}

// -------- Express handler --------
export default async function handler(req, res) {
  try {
    const name = (req.query.name || "").trim();
    const city = (req.query.city || "").trim();

    if (!name) {
      return res.json({
        place: { name, city },
        platforms: {
          toogoodtogo: { status: "unknown" },
          flashfood:   { status: "unknown" },
          foodhero:    { status: "unknown" }
        }
      });
    }

    const [tgtg, flash, hero] = await Promise.all([
      checkPlatform(name, city, "toogoodtogo.com"),
      checkPlatform(name, city, "flashfood.com"),
      checkPlatform(name, city, "foodhero.com")
    ]);

    res.json({
      place: { name, city },
      platforms: {
        toogoodtogo: tgtg,
        flashfood: flash,
        foodhero: hero
      }
    });
  } catch (e) {
    res.json({
      error: String(e),
      platforms: {
        toogoodtogo: { status: "unknown" },
        flashfood:   { status: "unknown" },
        foodhero:    { status: "unknown" }
      }
    });
  }
}
