/**
 * Capturas do A3 (o celular na mão): o Planejar na visão Semana (hoje na primeira linha, o título do intervalo, as setas fixas), o Hoje com a faixa de
 * "Próximos 7 dias", e a cápsula de baixo nos três estados do passo 16 (cheia, encolhida depois de rolar, e o ativo deslizando para outra aba), em 390, claro e
 * escuro. Nenhum dado de cliente: a marca é a do seed.
 *
 * Pré-requisitos: os mesmos de `scripts/capturas.ts` (`DATABASE_URL` apontando para `roteiros_dev`, nunca `roteiros`, `npm run db:reset`, `npm run dev` na
 * porta de `CAPTURAS_URL`, `AI_PROVIDER=mock`).
 *
 * Uso: `AI_PROVIDER=mock npx tsx scripts/capturas-a3.ts <nome-da-pasta>` (ex.: "pr-116").
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";

const SENHA_SEED = "ExemploSenha123";
const EMAIL = "seed-cliente-limpeza@exemplo.teste";

const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

async function esconderPortal(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForURL(/\/hoje/);
}

async function assentar(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  await esconderPortal(page);
}

/** Rola em passos curtos, como o dedo, para a regra da cápsula somar a descida. */
async function rolarAte(page: Page, y: number): Promise<void> {
  for (let atual = 0; atual < y; atual += 40) {
    await page.evaluate((alvo) => window.scrollTo(0, alvo), Math.min(atual + 40, y));
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(500);
}

async function main(): Promise<void> {
  const nomePasta = process.argv[2];
  if (!nomePasta) {
    console.error('uso: AI_PROVIDER=mock npx tsx scripts/capturas-a3.ts <nome-da-pasta> (ex.: "pr-116")');
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
      const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: modo.colorScheme, isMobile: true, hasTouch: true });
      const page = await contexto.newPage();
      await entrar(page, baseUrl);

      await page.goto(`${baseUrl}/planejamento?visao=semana`);
      await assentar(page);
      const arquivoPlanejar = nomeDe("Planejar", "Semana");
      await page.screenshot({ path: arquivoPlanejar });
      gravados.push(arquivoPlanejar);

      await page.getByRole("button", { name: "Próxima semana" }).click();
      await page.waitForURL(/dia=/);
      await assentar(page);
      const arquivoSeguinte = nomeDe("Planejar", "SemanaSeguinte");
      await page.screenshot({ path: arquivoSeguinte });
      gravados.push(arquivoSeguinte);

      await page.goto(`${baseUrl}/hoje`);
      await assentar(page);
      const arquivoHoje = nomeDe("Hoje", "Faixa");
      await page.screenshot({ path: arquivoHoje });
      gravados.push(arquivoHoje);

      // A cápsula, nos três estados, numa página comprida (Referências; se couber na tela, um espaço de rolagem é acrescentado só para a captura).
      await page.goto(`${baseUrl}/referencias`);
      await assentar(page);
      await page.addStyleTag({ content: "body { padding-bottom: 1600px !important; }" });
      const cheia = nomeDe("Capsula", "Cheia");
      await page.screenshot({ path: cheia, clip: { x: 0, y: 844 - 120, width: 390, height: 120 } });
      gravados.push(cheia);

      await rolarAte(page, 320);
      const encolhida = nomeDe("Capsula", "Encolhida");
      await page.screenshot({ path: encolhida, clip: { x: 0, y: 844 - 120, width: 390, height: 120 } });
      gravados.push(encolhida);

      // Ainda encolhida ao parar de rolar (o dedo saiu): a mesma foto, meio segundo depois.
      await page.waitForTimeout(600);
      const parada = nomeDe("Capsula", "EncolhidaAoSoltar");
      await page.screenshot({ path: parada, clip: { x: 0, y: 844 - 120, width: 390, height: 120 } });
      gravados.push(parada);

      // O toque no ícone abre a cápsula e leva ao destino: a seleção desliza para a aba nova.
      await page.getByRole("link", { name: "Criar" }).click();
      await page.waitForURL(/\/criar/);
      await assentar(page);
      const ativo = nomeDe("Capsula", "AtivoCriar");
      await page.screenshot({ path: ativo, clip: { x: 0, y: 844 - 120, width: 390, height: 120 } });
      gravados.push(ativo);

      await contexto.close();
    }
  } finally {
    await browser.close();
  }
  for (const arquivo of gravados) console.log(arquivo);
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
