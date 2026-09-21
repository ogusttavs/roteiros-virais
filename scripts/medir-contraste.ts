/**
 * Contraste de texto (V5, definição de pronto do `PROXIMO.md`): mede a
 * razão WCAG entre a cor do texto e a cor efetiva do que está atrás, em
 * Hoje, Roteiro e Entrar, nos dois modos, incluindo os casos sobre vidro
 * (a cápsula das abas, a barra de ações, o cartão de entrar). Script
 * próprio, fora da suíte de testes, no mesmo padrão dos `capturas-*.ts`.
 *
 * O vidro tem `backdrop-filter`, que este script não simula (não há como
 * ler o pixel final sem uma lib de imagem); em vez disso resolve a cor de
 * fundo efetiva compondo, por alpha blending, o `background-color`
 * computado de cada ancestral até achar uma camada opaca. É uma
 * aproximação (o desfoque não muda a cor média quando o que está atrás é
 * relativamente uniforme, que é o caso aqui), suficiente para checar a
 * meta de 4,5:1.
 *
 * Uso: `npx tsx scripts/medir-contraste.ts` (precisa de `npm run dev`
 * rodando; `CAPTURAS_URL` para apontar para outra porta).
 */
import { chromium, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { roteiros } from "../src/db/schema";
import { marcasDoUsuario } from "../src/servicos/clientes";

const SENHA_SEED = "ExemploSenha123";
const USUARIO_SEED = "seed-cliente-limpeza";
const EMAIL_SEED = `${USUARIO_SEED}@exemplo.teste`;

type RGBA = { r: number; g: number; b: number; a: number };

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`, { timeout: 15000 });
  await page.getByLabel("E-mail").fill(EMAIL_SEED);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForURL(/\/hoje/, { timeout: 15000 });
}

/**
 * Roda no browser: resolve a cor do texto e a cor efetiva atrás dele (alpha
 * blending pelos ancestrais). Passada como STRING para `page.evaluate`, não
 * como função: o `tsx` (esbuild) injeta um helper `__name` ao compilar
 * funções nomeadas aninhadas, e esse helper não existe no lado do browser
 * quando o Playwright serializa uma função via `toString()` (achado rodando
 * este script: `ReferenceError: __name is not defined`). Uma string de
 * código é avaliada direto, sem esse passo de serialização.
 */
async function medirElemento(page: Page, seletor: string): Promise<{ texto: RGBA; fundo: RGBA } | null> {
  const codigo = `(() => {
    const corParaRGBA = (str) => {
      const m = str.match(/rgba?\\(([^)]+)\\)/);
      if (!m) return null;
      const partes = m[1].split(",").map((s) => parseFloat(s.trim()));
      const [r, g, b, a = 1] = partes;
      if ([r, g, b].some((v) => Number.isNaN(v))) return null;
      return { r, g, b, a };
    };
    const compor = (topo, fundo) => {
      const a = topo.a + fundo.a * (1 - topo.a);
      if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (topo.r * topo.a + fundo.r * fundo.a * (1 - topo.a)) / a,
        g: (topo.g * topo.a + fundo.g * fundo.a * (1 - topo.a)) / a,
        b: (topo.b * topo.a + fundo.b * fundo.a * (1 - topo.a)) / a,
        a,
      };
    };

    const el = document.querySelector(${JSON.stringify(seletor)});
    if (!el) return null;

    const corTexto = corParaRGBA(getComputedStyle(el).color);
    if (!corTexto) return null;

    let atual = el;
    let composto = { r: 0, g: 0, b: 0, a: 0 };
    while (atual && composto.a < 0.999) {
      const bg = corParaRGBA(getComputedStyle(atual).backgroundColor);
      if (bg && bg.a > 0) composto = compor(composto, bg);
      atual = atual.parentElement;
    }
    if (composto.a < 0.999) composto = compor(composto, { r: 255, g: 255, b: 255, a: 1 });

    return { texto: { ...corTexto, a: 1 }, fundo: { ...composto, a: 1 } };
  })()`;
  return page.evaluate(codigo);
}

function luminancia({ r, g, b }: RGBA): number {
  const canal = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function razaoContraste(c1: RGBA, c2: RGBA): number {
  const L1 = luminancia(c1) + 0.05;
  const L2 = luminancia(c2) + 0.05;
  return L1 > L2 ? L1 / L2 : L2 / L1;
}

function rgbString(c: RGBA): string {
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}

type Alvo = { rotulo: string; caminho: string; precisaLogin: boolean; seletores: { nome: string; seletor: string }[] };

const ALVOS: Alvo[] = [
  {
    rotulo: "Entrar",
    caminho: "/entrar",
    precisaLogin: false,
    seletores: [
      { nome: "titulo (sobre o cartao de vidro)", seletor: "h1" },
      { nome: "botao entrar (solido)", seletor: "form button" },
      { nome: "link magico (sobre o cartao de vidro)", seletor: "button[type=button]" },
    ],
  },
  {
    rotulo: "Hoje",
    caminho: "/hoje",
    precisaLogin: true,
    seletores: [
      { nome: "titulo (fundo da pagina)", seletor: "h1" },
      { nome: "rotulo ativo na capsula (sobre vidro)", seletor: 'nav a[href="/hoje"]' },
    ],
  },
  {
    rotulo: "Roteiro",
    caminho: "",
    precisaLogin: true,
    seletores: [{ nome: "titulo (fundo da pagina)", seletor: "h1" }],
  },
];

async function main(): Promise<void> {
  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";

  const [cliente] = await marcasDoUsuario(USUARIO_SEED);
  if (!cliente) throw new Error(`cliente de seed "${USUARIO_SEED}" nao encontrado; rode "npm run db:seed".`);
  const [roteiro] = await db().select().from(roteiros).where(eq(roteiros.clienteId, cliente.id)).limit(1);
  const roteiroPath = roteiro ? `/roteiros/${roteiro.id}` : null;
  await getPool().end();

  const browser = await chromium.launch();

  for (const modo of ["light", "dark"] as const) {
    console.log(`\n=== modo ${modo} ===`);

    for (const alvo of ALVOS) {
      if (alvo.rotulo === "Roteiro" && !roteiroPath) {
        console.log(`Roteiro: nenhum roteiro encontrado para "${USUARIO_SEED}", pulando.`);
        continue;
      }
      // Contexto novo por tela (nunca "logado por acidente" ao medir Entrar,
      // achado rodando este script: /entrar redireciona para /hoje quando
      // ja existe sessao, e os seletores genericos de Entrar acabavam
      // medindo a tela de Hoje sem avisar).
      const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: modo });
      const page = await contexto.newPage();
      page.setDefaultTimeout(15000);

      if (alvo.precisaLogin) await entrar(page, baseUrl);

      const caminho = alvo.rotulo === "Roteiro" ? roteiroPath! : alvo.caminho;
      await page.goto(`${baseUrl}${caminho}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(800);

      console.log(`-- ${alvo.rotulo} --`);
      for (const { nome, seletor } of alvo.seletores) {
        const resultado = await medirElemento(page, seletor);
        if (!resultado) {
          console.log(`  ${nome}: elemento nao encontrado (${seletor})`);
          continue;
        }
        const razao = razaoContraste(resultado.texto, resultado.fundo);
        const status = razao >= 4.5 ? "OK" : "ABAIXO DE 4.5";
        console.log(
          `  ${nome}: ${razao.toFixed(2)}:1 [${status}] (texto ${rgbString(resultado.texto)} sobre ${rgbString(resultado.fundo)})`,
        );
      }

      await contexto.close();
    }
  }

  await browser.close();
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
