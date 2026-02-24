import express from "express";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API route to check if a link is dead
  app.post("/api/verify-link", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    const verify = async (targetUrl: string, method: string) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(targetUrl, { 
          method, 
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          },
          signal: controller.signal
        });
        return response;
      } finally {
        clearTimeout(timeout);
      }
    };

    try {
      let response = await verify(url, 'HEAD');
      
      // Some sites return 405 for HEAD, try GET if so
      if (response.status === 405 || response.status === 403) {
        response = await verify(url, 'GET');
      }

      res.json({ 
        ok: response.ok, 
        status: response.status,
        isDead: response.status === 404
      });
    } catch (error: any) {
      console.error(`Error verifying link ${url}:`, error.name === 'AbortError' ? 'Timeout' : error);
      res.json({ ok: false, error: error.name === 'AbortError' ? "Timeout" : "Connection failed", isDead: error.name !== 'AbortError' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
