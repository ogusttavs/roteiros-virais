/**
 * Capturas da V7, celular perfeito e roteiro sem rede (definição de pronto do
 * `PROXIMO.md`): o caminho da viagem (Entrar, Hoje, "Suas marcas", Tema livre,
 * Objetivo, Roteiro, a folha de reprovar, modo gravação, Briefing,
 * Referências com as duas folhas, Histórico, Conta) a 390 x 844 e a 360 x 740,
 * claro e escuro, mais a faixa "Sem conexão" (Hoje, Roteiro, Conta, com a
 * rede cortada de verdade por `context.setOffline`) e a linha "Instalar no
 * celular" da Conta. Script próprio, fora da suíte de testes, no mesmo padrão
 * de `scripts/capturas-v6-referencias.ts`.
 *
 * As capturas usam o servidor de desenvolvimento: a faixa acende pelo evento
 * `offline` do navegador, sem precisar do service worker (que só se registra
 * em produção); a prova de que o roteiro abre sem rede é o e2e
 * (`tests/e2e/sem-rede.spec.ts`), contra `next start`.
 *
 * Pré-requisitos, antes de rodar: os mesmos de `scripts/capturas.ts`
 * (`DATABASE_URL` apontando para `roteiros_dev`, `npm run db:seed`,
 * `npm run dev` na mesma porta que `CAPTURAS_URL` aponta).
 *
 * Uso: `npm run capturas:v7-celular -- <nome-da-etapa>` (ex.: "pr-53"). Grava
 * em `entregaveis/design/capturas/<nome-da-etapa>/`.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";
import { and, desc, eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { briefings, clientes, contas, membrosMarca, temasDia, videos, type TemaDoDia } from "../src/db/schema";
import { hojeISO } from "../src/lib/config";
import { marcasDoUsuario } from "../src/servicos/clientes";
import { gerarRoteiro, roteiroDeHoje } from "../src/servicos/roteiro";
import { textosConexao } from "../src/textos/conexao";

const SENHA_SEED = "ExemploSenha123";
const USUARIO_SEED = "seed-cliente-limpeza";
const EMAIL_SEED = `${USUARIO_SEED}@exemplo.teste`;
const NOME_SEGUNDA_MARCA = "[exemplo] Marca Dois (captura V7)";

const TAMANHOS = [
  { rotulo: "390", largura: 390, altura: 844 },
  { rotulo: "360", largura: 360, altura: 740 },
];
const MODOS = [
  { rotulo: "Claro", colorScheme: "light" as const },
  { rotulo: "Escuro", colorScheme: "dark" as const },
];

async function entrar(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/entrar`);
  await page.getByLabel("E-mail").fill(EMAIL_SEED);
  await page.getByLabel("Senha").fill(SENHA_SEED);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.waitForLoadState("networkidle");
}

/** Um roteiro de hoje para a marca principal do cliente de seed, gerando um se faltar. */
async function garantirRoteiro(clienteId: number): Promise<number> {
  const existente = await roteiroDeHoje(clienteId);
  if (existente) return existente.id;
  const roteiro = await gerarRoteiro(clienteId, {
    origem: "livre",
    textoTema: "como organizar o guarda roupa em uma tarde sem gastar muito",
    objetivo: "conversao",
  });
  return roteiro.id;
}

/** Os temas de hoje do nicho, com evidência real: sem eles o Hoje cai no estado vazio. */
async function garantirTemasDeHoje(nichoId: number): Promise<void> {
  const [existente] = await db()
    .select({ data: temasDia.data })
    .from(temasDia)
    .where(and(eq(temasDia.nichoId, nichoId), eq(temasDia.data, hojeISO())));
  if (existente) return;
  const videosDoNicho = await db()
    .select({ id: videos.id })
    .from(videos)
    .where(eq(videos.nichoId, nichoId))
    .orderBy(desc(videos.foraDaCurva))
    .limit(3);
  const temas: TemaDoDia[] = [
    {
      titulo: "[exemplo] o erro que faz a mancha voltar depois da limpeza",
      descricao: "descrição do tema de exemplo",
      porQue: "está subindo mais rápido que o normal da conta",
      evidencias: videosDoNicho.map((v) => v.id).slice(0, 2),
      puxaPara: "conversao",
    },
    {
      titulo: "[exemplo] o que fazer antes de aplicar o produto",
      descricao: "descrição do tema de exemplo",
      porQue: "uma dúvida que aparece toda semana nos comentários",
      evidencias: videosDoNicho[2] ? [videosDoNicho[2].id] : [],
      puxaPara: "engajamento",
    },
    {
      titulo: "[exemplo] quanto custa limpar errado duas vezes",
      descricao: "descrição do tema de exemplo",
      porQue: "assunto de custo está subindo no setor",
      evidencias: [],
      puxaPara: "alcance",
    },
  ];
  await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas });
}

/** Um vídeo fora da curva de verdade e recente, para Referências ter cartão, "Ver detalhes" e "Filtrar" com o que mostrar. */
async function garantirVideoDeReferencia(nichoId: number): Promise<void> {
  const idExterno = "captura-v7-referencia-1";
  const [existente] = await db().select().from(videos).where(eq(videos.idExterno, idExterno));
  if (existente) return;
  const [conta] = await db().select().from(contas).where(eq(contas.nichoId, nichoId)).limit(1);
  await db().update(contas).set({ medianaViews: "5000", medianaOrigem: "conta" }).where(eq(contas.id, conta.id));
  await db()
    .insert(videos)
    .values({
      plataforma: "instagram",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      nichoId,
      contaId: conta.id,
      titulo: "a mancha que volta: o erro esta na ordem, nao no produto",
      views: 31000,
      foraDaCurva: "6.2",
      velocidade: "1200",
      publicadoEm: new Date(),
      idioma: "pt",
      analise: {
        assunto: "mancha em sofa de camurca",
        gancho: "Abre com a mao ja esfregando a mancha, sem falar por dois segundos.",
        estrutura: "Aplica o produto sem cortar o video, falando o tempo de espera em voz alta.",
        fechamento: "Resumo do antes e depois.",
        chamadaFinal: "Comenta se voce ja passou por isso.",
        formato: "fala_para_camera",
        porQueFuncionou: "A pessoa ve o problema dela na tela nos dois primeiros segundos e fica para saber se resolve.",
      } as never,
    });
}

/** A segunda marca do cliente de seed, para a folha "Suas marcas" ter o que mostrar. */
async function garantirSegundaMarca(nichoId: number): Promise<void> {
  const marcas = await marcasDoUsuario(USUARIO_SEED);
  if (marcas.some((m) => m.nome === NOME_SEGUNDA_MARCA)) return;
  const [nova] = await db()
    .insert(clientes)
    .values({ usuarioId: USUARIO_SEED, nome: NOME_SEGUNDA_MARCA, nichoId })
    .returning();
  await db().insert(membrosMarca).values({ usuarioId: USUARIO_SEED, clienteId: nova.id, papel: "dono" });
  await db()
    .insert(briefings)
    .values({
      clienteId: nova.id,
      completo: true,
      perfil: {
        fatos: {
          oQueVende: "detalhamento automotivo",
          preco: "pacote a partir de 149 reais",
          clienteIdeal: "dono de carro que cuida do proprio veiculo",
          medos: [],
          frasesDaFala: [],
          proibicoes: [],
          cenasFilmaveis: [],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo: "marca de detalhamento automotivo, exemplo para a captura",
        referencias: [],
      },
    });
}

async function main(): Promise<void> {
  const nomeEtapa = process.argv[2];
  if (!nomeEtapa) {
    console.error('uso: npm run capturas:v7-celular -- <nome-da-etapa> (ex.: "pr-53")');
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CAPTURAS_URL ?? "http://localhost:3000";
  const raizProjeto = path.resolve(__dirname, "..", "..");
  const pastaDestino = path.join(raizProjeto, "entregaveis", "design", "capturas", nomeEtapa);
  await mkdir(pastaDestino, { recursive: true });

  const marcas = await marcasDoUsuario(USUARIO_SEED);
  const principal = marcas.find((m) => m.nome !== NOME_SEGUNDA_MARCA) ?? marcas[0];
  if (!principal?.nichoId) {
    throw new Error(`cliente de seed "${USUARIO_SEED}" sem marca ou sem nicho; rode "npm run db:seed" primeiro.`);
  }
  await garantirTemasDeHoje(principal.nichoId);
  await garantirSegundaMarca(principal.nichoId);
  await garantirVideoDeReferencia(principal.nichoId);
  const roteiroId = await garantirRoteiro(principal.id);
  // A marca ativa no login e a de acesso mais recente (`marcaPadrao`): sem isto a segunda marca, criada por
  // ultimo, seria a ativa e o roteiro da marca principal nao abriria.
  await db().update(clientes).set({ ultimoAcessoEm: new Date() }).where(eq(clientes.id, principal.id));

  const gravados: string[] = [];
  const browser = await chromium.launch();

  try {
    for (const modo of MODOS) {
      for (const tamanho of TAMANHOS) {
        const contexto = await browser.newContext({
          viewport: { width: tamanho.largura, height: tamanho.altura },
          colorScheme: modo.colorScheme,
        });
        const page = await contexto.newPage();

        async function capturar(tela: string, estado: string): Promise<void> {
          const arquivo = path.join(pastaDestino, `${tela}.${estado}.${tamanho.rotulo}.${modo.rotulo}.png`);
          await page.screenshot({ path: arquivo, fullPage: true });
          gravados.push(path.relative(raizProjeto, arquivo));
        }

        async function ir(rota: string): Promise<void> {
          await page.goto(`${baseUrl}${rota}`);
          await page.waitForLoadState("networkidle");
        }

        // Entrar, sem sessão.
        await ir("/entrar");
        await capturar("Entrar", "Normal");

        await entrar(page, baseUrl);
        await ir("/hoje");
        await capturar("Hoje", "Normal");

        // "Suas marcas": a folha aberta pela pílula.
        await page.getByRole("button", { name: /^Trocar de marca/ }).click();
        await page.getByRole("dialog", { name: "Suas marcas" }).waitFor({ state: "visible" });
        await capturar("Hoje", "SuasMarcas");
        await page.keyboard.press("Escape");

        await ir("/hoje/tema-livre");
        await capturar("TemaLivre", "Proposta");

        await ir(`/hoje/objetivo?livre=${encodeURIComponent("um assunto de teste para o celular")}`);
        await capturar("Objetivo", "Normal");

        await ir(`/roteiros/${roteiroId}`);
        await capturar("Roteiro", "Normal");

        await page.getByRole("button", { name: "Mais opções" }).click();
        await page.getByRole("menuitem", { name: "Reprovar" }).click();
        await page.getByRole("dialog", { name: "O que não ficou bom?" }).waitFor({ state: "visible" });
        await capturar("Roteiro", "Reprovar");
        await page.keyboard.press("Escape");

        await ir(`/roteiros/${roteiroId}/gravar`);
        await capturar("Gravacao", "Normal");

        await ir("/briefing");
        await capturar("Briefing", "Normal");

        await ir("/referencias");
        await capturar("Referencias", "Normal");
        await page.getByRole("button", { name: "Filtrar" }).click();
        await page.getByRole("dialog", { name: "Filtrar" }).waitFor({ state: "visible" });
        await capturar("Referencias", "Filtrar");
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Ver detalhes" }).first().click();
        await page.getByRole("dialog", { name: "Por que esse funcionou" }).waitFor({ state: "visible" });
        await capturar("Referencias", "Detalhes");
        await page.keyboard.press("Escape");

        await ir("/historico");
        await capturar("Historico", "Normal");

        // Conta, com a linha "Instalar no celular" (o navegador de teste não está instalado).
        await ir("/conta");
        await page.getByTestId("instalar-no-celular").waitFor({ state: "visible" });
        await capturar("Conta", "Instalar");

        // A faixa "Sem conexão", com a rede cortada de verdade, em três telas.
        for (const { tela, rota } of [
          { tela: "Hoje", rota: "/hoje" },
          { tela: "Roteiro", rota: `/roteiros/${roteiroId}` },
          { tela: "Conta", rota: "/conta" },
        ]) {
          await ir(rota);
          await contexto.setOffline(true);
          await page.getByRole("status").filter({ hasText: textosConexao.faixa }).waitFor({ state: "visible" });
          await capturar(tela, "SemConexao");
          await contexto.setOffline(false);
          await page.getByRole("status").filter({ hasText: textosConexao.faixa }).waitFor({ state: "detached" });
        }

        await contexto.close();
      }
    }
  } finally {
    await browser.close();
    await getPool().end();
  }

  console.log(`${gravados.length} capturas gravadas em entregaveis/design/capturas/${nomeEtapa}/`);
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
