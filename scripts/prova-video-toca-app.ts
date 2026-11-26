/** Prova (E68): o vídeo final tocando na tela real do roteiro (servidor de desenvolvimento), a 390x844, no Chromium e no WebKit. Uso: npx tsx scripts/prova-video-toca-app.ts <porta> <roteiroId> <pasta> <rotulo> */
import { chromium, webkit } from "@playwright/test";
const [porta, roteiro, pasta, rotulo] = process.argv.slice(2);
async function main() {
  for (const [nome, tipo] of [["chromium", chromium], ["webkit", webkit]] as const) {
    const nav = await tipo.launch();
    const pag = await (await nav.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    const respostas: string[] = [];
    pag.on("response", (r) => { if (r.url().includes("/api/animacao/")) respostas.push(`${r.status()} ${r.headers()["content-type"]} range=${r.request().headers()["range"] ?? "-"} cr=${r.headers()["content-range"] ?? "-"}`); });
    await pag.goto(`http://localhost:${porta}/entrar`); await pag.waitForLoadState("networkidle"); await pag.waitForTimeout(1500);
    await pag.getByLabel("E-mail").fill("seed-cliente-limpeza@exemplo.teste");
    await pag.getByLabel("Senha").fill("ExemploSenha123");
    await pag.getByRole("button", { name: "entrar", exact: true }).click();
    await pag.waitForURL(/\/hoje/);
    await pag.goto(`http://localhost:${porta}/roteiros/${roteiro}`);
    const v = pag.locator("video[data-final-da-animacao]");
    await v.waitFor({ timeout: 30000 });
    await v.scrollIntoViewIfNeeded();
    await pag.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await pag.waitForTimeout(1500);
    await pag.evaluate(async () => { const el = document.querySelector("video[data-final-da-animacao]") as HTMLVideoElement; el.muted = true; try { await el.play(); } catch { /* medido abaixo */ } });
    await pag.waitForTimeout(2500);
    const m = await pag.evaluate(() => { const el = document.querySelector("video[data-final-da-animacao]") as HTMLVideoElement; return { currentTime: el.currentTime, duration: el.duration, readyState: el.readyState, paused: el.paused, erroDoVideo: el.error?.code ?? null, avisoNaTela: document.body.innerText.includes("Não foi possível tocar") }; });
    console.log(nome, JSON.stringify(m), respostas.slice(0, 4).join(" | "));
    await pag.screenshot({ path: `${pasta}/${rotulo}-${nome}.png` });
    await nav.close();
  }
}
main();
