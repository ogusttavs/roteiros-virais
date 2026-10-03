/**
 * Capturas do PR 2 da E48 (o aviso de manhã por push): a folha do pedido de permissão no aplicativo instalado (Android) e o cartão "Aviso de manhã" da
 * Conta nos estados desligado, ligado, sem permissão e "precisa instalar", em 390, claro e escuro. Nenhum dado de cliente: a marca é a do seed.
 *
 * O navegador do teste finge o aplicativo instalado (`navigator.standalone`) e um `pushManager` e uma permissão falsos, como o e2e (o serviço de push de
 * verdade não existe aqui). Cada combinação zera o pedido, a instalação e as inscrições da pessoa antes e ao fim.
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:seed`,
 * `npm run dev` na porta de `CAPTURAS_URL`, `AI_PROVIDER=mock`), com `VAPID_PUBLIC_KEY` no `.env` local (a chave pública de teste serve; sem ela a tela não pede nada).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-e48-pr2.ts <nome-da-pasta>` (ex.: "pr-114").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Locator, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { inscricoesPush, preferenciasUsuario, user } from "../src/db/schema";

const SENHA_SEED = "ExemploSenha123";
const USUARIO = "seed-cliente-limpeza";
const EMAIL = `${USUARIO}@exemplo.teste`;

const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

async function esconderPortal(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function fotografarElemento(page: Page, alvo: Locator, arquivo: string): Promise<void> {
  await esconderPortal(page);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (getComputedStyle(el).position === "fixed") el.style.visibility = "hidden";
    }
    window.scrollTo(0, 0);
  });
  const caixa = await alvo.boundingBox();
  if (!caixa) throw new Error(`elemento sem caixa para ${arquivo}`);
  const rolagem = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path: arquivo, fullPage: true, clip: { x: caixa.x, y: caixa.y + rolagem, width: caixa.width, height: caixa.height } });
}

/**
 * O aplicativo instalado (ou não), a permissão do aviso e um `pushManager` falso que guarda a inscrição em `localStorage`. O script vai como texto: o `tsx`
 * injeta ajudantes de nome (`__name`) em funções passadas ao navegador, e eles não existem lá (o script abortava no primeiro arrow function).
 */
async function prepararAparelho(page: Page, opcoes: { instalado: boolean; permissao: "default" | "granted" | "denied"; inscrito: boolean }) {
  await page.addInitScript({
    content: `(function () {
      var o = ${JSON.stringify(opcoes)};
      if (o.instalado) Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true });
      Object.defineProperty(Notification, "permission", { get: function () { return o.permissao; }, configurable: true });
      Notification.requestPermission = function () { return Promise.resolve(o.permissao); };
      var chave = "capturas-push-inscricao";
      if (o.inscrito) localStorage.setItem(chave, "1");
      function montar() {
        return {
          endpoint: "https://push.exemplo.test/capturas",
          toJSON: function () { return { endpoint: this.endpoint, keys: { p256dh: "chave-publica-de-teste-longa", auth: "auth-de-teste" } }; },
          unsubscribe: function () { return Promise.resolve(true); }
        };
      }
      var falso = {
        getSubscription: function () { return Promise.resolve(localStorage.getItem(chave) ? montar() : null); },
        subscribe: function () { return Promise.resolve(montar()); }
      };
      Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", { get: function () { return falso; }, configurable: true });
    })();`,
  });
}

async function zerar(): Promise<void> {
  const [pessoa] = await db().select({ id: user.id }).from(user).where(eq(user.email, EMAIL));
  if (!pessoa) throw new Error('cliente de seed nao encontrado; rode "npm run db:seed" contra roteiros_dev (nunca roteiros).');
  await db().delete(inscricoesPush).where(eq(inscricoesPush.usuarioId, pessoa.id));
  await db()
    .update(preferenciasUsuario)
    .set({ pushAdiadoAte: null, instaladoEm: null, instaladoEmSistema: null, conviteInstalarAdiadoAte: null })
    .where(eq(preferenciasUsuario.usuarioId, pessoa.id));
}

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForURL(/\/hoje/);
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-e48-pr2.ts <nome-da-pasta> (ex.: "pr-114")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const pastaDestino = path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", nomePasta);
  await mkdir(pastaDestino, { recursive: true });

  const gravados: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const modo of MODOS) {
      const nomeDe = (tela: string, estado: string) => path.join(pastaDestino, `${tela}.${estado}.390.${modo.rotulo}.png`);
      const celular = () =>
        browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: modo.colorScheme, userAgent: UA_ANDROID, isMobile: true, hasTouch: true });

      // ---------------------------------------------------------------- A folha do pedido, na primeira abertura do aplicativo instalado
      {
        await zerar();
        const contexto = await celular();
        const page = await contexto.newPage();
        await prepararAparelho(page, { instalado: true, permissao: "default", inscrito: false });
        await entrar(page, baseUrl);
        await page.getByRole("dialog", { name: "Quer o aviso de manhã?" }).waitFor({ state: "visible", timeout: 15_000 });
        await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
        await esconderPortal(page);
        const arquivo = nomeDe("Aviso.PedidoDePermissao", "Android");
        await page.screenshot({ path: arquivo });
        gravados.push(arquivo);
        await contexto.close();
      }

      // ---------------------------------------------------------------- O cartão da Conta, nos estados
      const estados = [
        { estado: "Desligado", opcoes: { instalado: true, permissao: "default" as const, inscrito: false }, atributo: "desligado" },
        { estado: "Ligado", opcoes: { instalado: true, permissao: "granted" as const, inscrito: true }, atributo: "ligado" },
        { estado: "SemPermissao", opcoes: { instalado: true, permissao: "denied" as const, inscrito: false }, atributo: "sem_permissao" },
        { estado: "PrecisaInstalar", opcoes: { instalado: false, permissao: "default" as const, inscrito: false }, atributo: "precisa_instalar" },
      ];
      for (const { estado, opcoes, atributo } of estados) {
        await zerar();
        // O pedido da folha já foi dito "agora não" (o cartão é o que se fotografa aqui).
        const [pessoa] = await db().select({ id: user.id }).from(user).where(eq(user.email, EMAIL));
        await db().update(preferenciasUsuario).set({ pushAdiadoAte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }).where(eq(preferenciasUsuario.usuarioId, pessoa.id));
        const contexto = await celular();
        const page = await contexto.newPage();
        await prepararAparelho(page, opcoes);
        await entrar(page, baseUrl);
        // No servidor de desenvolvimento o service worker pode não estar registrado ainda (o cartão lê a inscrição por ele): registra e espera ficar pronto.
        await page.evaluate("navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function () { return navigator.serviceWorker.ready; }).then(function () { return true; })");
        await page.goto(`${baseUrl}/conta`);
        const cartao = page.getByTestId("aviso-de-manha");
        await cartao.waitFor({ state: "visible", timeout: 15_000 });
        await page.waitForSelector(`[data-testid="aviso-de-manha"][data-estado-do-aviso="${atributo}"]`);
        await page.waitForLoadState("networkidle");
        const arquivo = nomeDe("Conta.AvisoDeManha", estado);
        await fotografarElemento(page, cartao, arquivo);
        gravados.push(arquivo);
        await contexto.close();
      }
    }
  } finally {
    await zerar().catch(() => undefined);
    await browser.close();
    await getPool().end();
  }
  console.log(`${gravados.length} capturas em ${pastaDestino}`);
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
