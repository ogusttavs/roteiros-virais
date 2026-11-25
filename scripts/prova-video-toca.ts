/**
 * Prova (E68): serve um MP4 pela mesma `responderArquivo` da rota da animação e toca num `<video>` com os mesmos atributos da tela, no Chromium e no WebKit do Playwright, a 390x844.
 * Uso: npx tsx scripts/prova-video-toca.ts <mp4> <pasta-de-capturas> <rotulo> [chrome]
 */
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { Readable } from "node:stream";

import { chromium, webkit } from "@playwright/test";

import { responderArquivo } from "../src/lib/intervalo-http";

const [arquivo, pasta, rotulo] = process.argv.slice(2);
const canalChrome = process.argv[5] === "chrome";

async function main(): Promise<void> {
  const tamanho = (await stat(arquivo)).size;
  const servidor = createServer(async (req, res) => {
    if (req.url?.startsWith("/final")) { console.log("REQ", req.headers.range ?? "-", req.headers["user-agent"]?.slice(0,60));
      const cab = new Headers();
      if (req.headers.range) cab.set("range", req.headers.range);
      const r = responderArquivo(new Request("http://x/final", { headers: cab }), { caminho: arquivo, tamanho, tipo: "video/mp4" });
      res.writeHead(r.status, Object.fromEntries(r.headers));
      if (r.body) Readable.fromWeb(r.body as never).pipe(res);
      else res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end('<body style="margin:0;background:#eee"><video id="v" style="width:100%;border-radius:16px" controls playsinline preload="metadata" src="/final" data-final-da-animacao></video><p id="e"></p><script>document.getElementById("v").onerror=()=>{document.getElementById("e").textContent="ERRO "+document.getElementById("v").error.code+" Nao foi possivel tocar o video aqui"}</script></body>');
  });
  await new Promise<void>((r) => servidor.listen(0, r));
  const porta = (servidor.address() as { port: number }).port;
  for (const [nome, tipo] of [["chromium", chromium], ["webkit", webkit]] as const) {
    try {
      const nav = await tipo.launch(nome === "chromium" && canalChrome ? { channel: "chrome" } : {});
      const pag = await (await nav.newContext({ viewport: { width: 390, height: 844 } })).newPage();
      await pag.goto(`http://localhost:${porta}/`);
      await pag.waitForTimeout(500);
      const pode = await pag.evaluate(() => { const v = document.getElementById("v") as HTMLVideoElement; return { canPlayH264: v.canPlayType('video/mp4; codecs="avc1.640028"'), erro: v.error?.code ?? null }; });
      await pag.evaluate(async () => { const v = document.getElementById("v") as HTMLVideoElement; v.muted = true; try { await v.play(); } catch { /* medido abaixo */ } });
      await pag.waitForTimeout(2500);
      const m = await pag.evaluate(() => { const v = document.getElementById("v") as HTMLVideoElement; return { currentTime: v.currentTime, duration: v.duration, readyState: v.readyState, paused: v.paused, erro: v.error?.code ?? null, w: v.videoWidth }; });
      console.log(nome, canalChrome && nome === "chromium" ? "(chrome)" : "", JSON.stringify({ ...pode, ...m }));
      await pag.screenshot({ path: `${pasta}/${rotulo}-${nome}.png` });
      await nav.close();
    } catch (e) { console.log(nome, "FALHOU AO ABRIR:", String(e).slice(0, 200)); }
  }
  servidor.close();
}
main();
