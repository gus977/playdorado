import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Cache for lottery data
  let lotteryCache = {
    manana: { last: null, history: [] },
    tarde: { last: null, history: [] },
    noche: { last: null, history: [] },
    lastUpdated: 0
  };

  async function scrapeDorado(url: string) {
    try {
      const { data } = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      const $ = cheerio.load(data);
      
      const results: string[] = [];
      
      // Look for the specific pattern on resultadodelaloteria.com
      // Often numbers are in spans with class 'num' or inside a result container
      $('.resultado .num, .numero-resultado, .box-resultado .num').each((_, el) => {
        const text = $(el).text().trim();
        if (/^\d$/.test(text)) {
          // If it's single digits, we need to group them.
          // But usually they are in a 4-digit string or grouped in a parent
        }
      });

      // Wide search: Find any 4-digit string in potentially relevant containers
      $('div, span, td, b, strong').each((_, el) => {
        const text = $(el).text().trim().replace(/\s+/g, '');
        // Check for exactly 4 digits
        if (/^\d{4}$/.test(text)) {
          // Avoid years or common numbers if possible, but for lottery these are the results
          if (text !== '2024' && text !== '2025' && text !== '2026') {
             results.push(text);
          }
        }
      });

      // Special handling for the site's common table of historical results
      $('tr, div, p').each((_, el) => {
        const text = $(el).text();
        const matches = text.match(/\b\d{4}\b/g);
        if (matches) {
          matches.forEach(m => {
            const num = parseInt(m);
            // Ignore years 1900-2099 to avoid common false positives
            if (num < 1900 || num > 2099) {
              results.push(m);
            } else {
              // If it's a year, we only add if it's the only thing there or specifically looks like a result
              // But safer to ignore common years for lottery
            }
          });
        }
      });

      // Filter duplicates and keep order
      const uniqueResults = Array.from(new Set(results)).filter(n => /^\d{4}$/.test(n));

      return {
        last: uniqueResults[0] || null,
        history: uniqueResults.slice(0, 100)
      };
    } catch (error) {
      console.error(`Error scraping ${url}:`, error);
      return { last: null, history: [] };
    }
  }

  app.get("/api/results", async (req, res) => {
    const now = Date.now();
    // Cache for 1 hour
    if (now - lotteryCache.lastUpdated > 3600000) {
      const [manana, tarde, noche] = await Promise.all([
        scrapeDorado("https://resultadodelaloteria.com/colombia/dorado-manana"),
        scrapeDorado("https://resultadodelaloteria.com/colombia/dorado-tarde"),
        scrapeDorado("https://resultadodelaloteria.com/colombia/dorado-noche")
      ]);
      
      lotteryCache = {
        manana,
        tarde,
        noche,
        lastUpdated: now
      };
    }
    res.json(lotteryCache);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    
    // Add a catch-all for dev mode to handle SPA routing if Vite fails to fallback
    app.get("*", async (req, res, next) => {
      try {
        const url = req.originalUrl;
        const template = await vite.transformIndexHtml(url, `
          <!doctype html>
          <html lang="en">
            <head>
              <meta charset="UTF-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <title>Dorado Pro</title>
            </head>
            <body>
              <div id="root"></div>
              <script type="module" src="/src/main.tsx"></script>
            </body>
          </html>
        `);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
