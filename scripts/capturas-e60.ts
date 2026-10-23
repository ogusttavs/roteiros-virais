/**
 * Capturas da E60 (o calendário de datas), para a revisão visual: o Planejar (Semana, Mês e Dia) com o dia marcado pela data, o Hoje com "Daqui a N dias é..." e a tela de temas do
 * Criar com a data como sugestão, a 390 (celular) e 1280 (computador), claro e escuro. Nomes no padrão `Tela.Estado.Largura.Modo.png`.
 *
 * Pré-requisitos: um `npm run dev` na porta de `CAPTURAS_URL` (padrão 3000) com `AI_PROVIDER=mock`, e a pessoa `e2e-datas-dentista` (criada por `tests/e2e/calendario-de-datas.spec.ts`)
 * ou, na falta dela, a do seed de dentistas com o briefing completo. A pessoa é de odontologia de propósito: o Dia do Cirurgião-Dentista (25 de outubro) é a data do ramo.
 * O dia capturado de Semana/Mês/Dia é o próximo 25 de outubro, para a captura não depender de em que dia ela é feita.
 *
 * Uso: `npm run capturas:e60`. Grava em `entregaveis/design/capturas/e60/`.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";

import { hojeISO } from "../src/lib/config";
import { marcasDoUsuario, salvarTema } from "../src/servicos/clientes";

const SENHA = "ExemploSenha123";
const USUARIO = process.env.CAPTURAS_USUARIO ?? "e2e-datas-dentista";
const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "1280", largura: 1280, altura: 800 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

/** O próximo 25 de outubro (o de este ano se ainda não passou, senão o do ano seguinte). */
function proximo25DeOutubro(hoje: string): string {
  const ano = Number(hoje.slice(0, 4));
  const esteAno = `${ano}-10-25`;
  return esteAno >= hoje ? esteAno : `${ano + 1}-10-25`;
}

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(`${USUARIO}@exemplo.teste`);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForURL(/\/hoje/);
  await page.waitForLoadState("networkidle");
}

async function main(): Promise<void> {
  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  // `CAPTURAS_PASTA` para quem roda de uma árvore de git aninhada (`plataforma/.revisao/<árvore>`), onde `..`/`..` não é a pasta do projeto.
  const pasta = process.env.CAPTURAS_PASTA ?? path.resolve(__dirname, "..", "..", "entregaveis", "design", "capturas", "e60");
  await mkdir(pasta, { recursive: true });
  const [marca] = await marcasDoUsuario(USUARIO);
  if (!marca) throw new Error(`pessoa "${USUARIO}" não encontrada: rode antes tests/e2e/calendario-de-datas.spec.ts neste banco`);

  const dia25 = proximo25DeOutubro(hojeISO());
  const mes25 = dia25.slice(0, 7);
  const telas = [
    { tela: "Hoje", estado: "ComData", caminho: "/hoje" },
    { tela: "PlanejarSemana", estado: "ComData", caminho: `/planejamento?visao=semana&dia=${dia25}` },
    { tela: "PlanejarMes", estado: "ComData", caminho: `/planejamento?visao=mes&mes=${mes25}&dia=${dia25}` },
    { tela: "PlanejarDia", estado: "ComData", caminho: `/planejamento?visao=dia&dia=${dia25}` },
    { tela: "CriarTemas", estado: "ComData", caminho: "/criar/temas" },
  ];

  const browser = await chromium.launch();
  const gravados: string[] = [];
  try {
    for (const modo of MODOS) {
      await salvarTema(marca.id, modo.colorScheme === "dark" ? "escuro" : "claro");
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({ viewport: { width: tamanho.largura, height: tamanho.altura }, colorScheme: modo.colorScheme, timezoneId: "America/Sao_Paulo" });
        const page = await contexto.newPage();
        await entrar(page, baseUrl);
        for (const t of telas) {
          await page.goto(`${baseUrl}${t.caminho}`);
          await page.waitForLoadState("networkidle");
          const arquivo = path.join(pasta, `${t.tela}.${t.estado}.${tamanho.rotulo}.${modo.rotulo}.png`);
          await page.screenshot({ path: arquivo, fullPage: true });
          gravados.push(path.basename(arquivo));
        }
        await contexto.close();
      }
    }
  } finally {
    await browser.close();
  }
  await salvarTema(marca.id, "claro");
  console.log(`${gravados.length} capturas em ${pasta}:\n${gravados.join("\n")}`);
}

main()
  .then(() => process.exit(0))
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
