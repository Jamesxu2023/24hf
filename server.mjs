import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import synthesize from "./netlify/functions/synthesize.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname === "/api/synthesize") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await synthesize(new Request("http://127.0.0.1/api/synthesize", {
      method: req.method,
      headers: { "content-type": req.headers["content-type"] || "application/json" },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
    }));
    const headers = Object.fromEntries(response.headers);
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const file = path.join(root, requested);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("没有这页");
    return;
  }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

const port = Number(process.env.PORT || 4321);
server.listen(port, "127.0.0.1", () => {
  console.log(`desk http://127.0.0.1:${port}`);
});
