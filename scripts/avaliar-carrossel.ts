/**
 * Golden set do carrossel (antes e depois de mexer no prompt). Cada caso do conjunto vira uma marca de mentira no banco (usuário, marca e briefing compilado, fictícios) e o carrossel é gerado
 * pelo serviço de verdade (`gerarCarrossel`, `src/servicos/carrossel.ts`): o mesmo caminho do app, com o verificador, as duas tentativas e as travas de texto. Um caso por vez, pelo preço cheio
 * (nada de lote: o serviço de produção é chamada direta). O resultado de cada caso (pronto na 1ª, na 2ª ou falhou, motivos de reprova, custo, tempo, texto) vai para um JSON com a data e a versão
 * do prompt; `avaliar-carrossel-comparar.ts` compara dois deles.
 *
 * Uso: `npm run avaliar:carrossel -- [--casos id1,id2] [--saida arquivo.json] [--teto 5] [--manter]`
 *   --casos  só esses ids (padrão: todos)
 *   --saida  o arquivo do resultado (padrão: avaliacoes-saida/carrossel-<data>-v<versao>.json; a pasta fica fora do Git)
 *   --teto   teto de gasto em dólar: antes de cada caso confere o gasto acumulado e para a rodada ao chegar nele (padrão 5; "0" ou "sem" tira o teto)
 *   --manter não apaga do banco as marcas de mentira ao fim (padrão: apaga)
 *
 * O arquivo real do conjunto fica fora do repositório: `GOLDEN_SET_DIR/carrossel.json` (padrão `../avaliacoes-privadas`); sem ele, usa `avaliacoes/carrossel.exemplo.json` (marcas inventadas).
 * Custo: o que `geracoes_ia` registrou (tokens da API vezes os preços de `src/config/precos-ia.ts`, datados no resultado). A chave vem de `./chave-de-testes` e nunca é impressa.
 */
import "./chave-de-testes";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { textoDoSlide } from "../src/carrossel/regras";
import { DATA_PRECOS_IA, PRECOS_POR_NIVEL } from "../src/config/precos-ia";
import { ramoPorSlug } from "../src/config/ramos";
import { db, getPool } from "../src/db";
import { briefings, carrosseis, clientes, geracoesIA, nichos, user, type PerfilCompilado } from "../src/db/schema";
import { versao as versaoDoPrompt } from "../src/ia/prompts/carrossel";
import { gerarCarrossel } from "../src/servicos/carrossel";

import { desfechoDasTentativas, lerTeto, motivosDoTexto, rodarComTeto, type Rodada, type ResultadoDoCaso } from "./avaliar-carrossel-regras";

const marcaSchema = z.object({
  nome: z.string(),
  ramo: z.string(),
  cidade: z.string(),
  bairro: z.string().optional(),
  instagram: z.string().optional(),
  corMarca: z.string().optional(),
  servicos: z.array(z.string()),
  tom: z.string(),
  resumo: z.string(),
  fatos: z.object({
    oQueVende: z.string(),
    preco: z.string(),
    clienteIdeal: z.string(),
    medos: z.array(z.string()),
    frasesDaFala: z.array(z.string()),
    proibicoes: z.array(z.string()),
    cenasFilmaveis: z.array(z.string()),
  }),
});
const casoSchema = z.object({
  id: z.string(),
  nome: z.string(),
  marca: marcaSchema,
  quantidade: z.union([z.literal(5), z.literal(7), z.literal(9)]),
  tema: z.string(),
  /** O que a pessoa quer com o carrossel, em linguagem de cliente. */
  objetivo: z.string(),
  fotos: z.number().int().min(0).max(9).optional(),
});
export type CasoDeCarrossel = z.infer<typeof casoSchema>;
const conjuntoSchema = z.array(casoSchema);

function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function caminhoDoConjunto(): { caminho: string; ehExemplo: boolean } {
  const dir = process.env.GOLDEN_SET_DIR ?? "../avaliacoes-privadas";
  const real = path.resolve(process.cwd(), dir, "carrossel.json");
  if (existsSync(real)) return { caminho: real, ehExemplo: false };
  return { caminho: path.resolve(process.cwd(), "avaliacoes/carrossel.exemplo.json"), ehExemplo: true };
}

async function nichoDoRamo(slug: string): Promise<number> {
  const [existente] = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, slug));
  if (existente) return existente.id;
  const ramo = ramoPorSlug(slug);
  if (!ramo) throw new Error(`ramo "${slug}" nao existe no catalogo`);
  // Sem o setor no banco de avaliação: nasce vazio (sem fila de pesquisa), então o caso roda sem base de vídeos, como um setor novo.
  const [novo] = await db().insert(nichos).values({ slug, nome: ramo.nome, descricao: ramo.exemplos, termos: [...ramo.palavras], ramoCatalogo: slug, ativo: true }).onConflictDoNothing().returning();
  if (novo) return novo.id;
  const [outro] = await db().select().from(nichos).where(eq(nichos.ramoCatalogo, slug));
  return outro.id;
}

function perfilDoCaso(caso: CasoDeCarrossel): PerfilCompilado {
  const m = caso.marca;
  return {
    fatos: { ...m.fatos, concorrentes: [], perfisAdmirados: [] },
    resumo: `${m.resumo} Serviços: ${m.servicos.join(", ")}. Cidade: ${m.cidade}. Tom: ${m.tom}.`,
    referencias: [],
  };
}

async function prepararMarca(caso: CasoDeCarrossel, rodadaId: string): Promise<{ clienteId: number; usuarioId: string }> {
  const m = caso.marca;
  const usuarioId = `avaliar-carrossel-${rodadaId}-${caso.id}`;
  const nichoId = await nichoDoRamo(m.ramo);
  await db().insert(user).values({ id: usuarioId, name: m.nome, email: `${usuarioId}@exemplo.test` });
  const [c] = await db()
    .insert(clientes)
    .values({
      usuarioId,
      nome: m.nome,
      nichoId,
      cidade: m.cidade,
      bairro: m.bairro,
      corMarca: m.corMarca,
      perfis: { instagram: m.instagram ?? null, tiktok: null, youtube: null },
    })
    .returning();
  await db().insert(briefings).values({ clienteId: c.id, completo: true, perfil: perfilDoCaso(caso) });
  return { clienteId: c.id, usuarioId };
}

async function apagarMarca(clienteId: number, usuarioId: string): Promise<void> {
  await db().delete(geracoesIA).where(eq(geracoesIA.clienteId, clienteId));
  await db().delete(carrosseis).where(eq(carrosseis.clienteId, clienteId));
  await db().delete(briefings).where(eq(briefings.clienteId, clienteId));
  await db().delete(clientes).where(eq(clientes.id, clienteId));
  await db().delete(user).where(eq(user.id, usuarioId));
}

async function rodarCaso(caso: CasoDeCarrossel, rodadaId: string, manter: boolean): Promise<ResultadoDoCaso> {
  const { clienteId, usuarioId } = await prepararMarca(caso, rodadaId);
  const base: ResultadoDoCaso = { id: caso.id, nome: caso.nome, ramo: caso.marca.ramo, quantidade: caso.quantidade, desfecho: "falhou", motivos: [], custoUsd: 0, tempoS: 0, slides: [], legenda: "", hashtags: [], avisos: [] };
  const t0 = Date.now();
  let deuCerto = false;
  try {
    const c = await gerarCarrossel(clienteId, { quantidade: caso.quantidade, de: { origem: "tema", texto: caso.tema }, observacao: `O que eu quero com este carrossel: ${caso.objetivo}.`, fotos: caso.fotos });
    deuCerto = true;
    base.slides = c.slides.map((s) => textoDoSlide(s));
    base.legenda = c.legenda;
    base.hashtags = c.hashtags;
    base.avisos = c.avisos;
  } catch (e) {
    base.erro = String((e as Error)?.message ?? e).slice(0, 1500);
  }
  base.tempoS = (Date.now() - t0) / 1000;
  const geracoes = await db().select().from(geracoesIA).where(eq(geracoesIA.clienteId, clienteId)).orderBy(geracoesIA.id);
  base.custoUsd = geracoes.reduce((s, g) => s + Number(g.custoUsd), 0);
  const tentativas = geracoes.filter((g) => g.tarefa === "carrossel");
  base.motivos = tentativas.flatMap((g) => motivosDoTexto(g.motivoAvaliacao));
  base.desfecho = desfechoDasTentativas(deuCerto, tentativas.length);
  if (!manter) await apagarMarca(clienteId, usuarioId);
  return base;
}

async function main() {
  const args = process.argv.slice(2);
  const teto = lerTeto(opcao(args, "teto"));
  const manter = args.includes("--manter");
  const { caminho, ehExemplo } = caminhoDoConjunto();
  let casos = conjuntoSchema.parse(JSON.parse(readFileSync(caminho, "utf8")));
  const filtro = opcao(args, "casos");
  if (filtro) {
    const ids = filtro.split(",").map((s) => s.trim());
    const faltam = ids.filter((id) => !casos.some((c) => c.id === id));
    if (faltam.length) throw new Error(`caso(s) que nao existem: ${faltam.join(", ")}. Os ids: ${casos.map((c) => c.id).join(", ")}`);
    casos = casos.filter((c) => ids.includes(c.id));
  }
  const data = new Date().toISOString();
  const rodadaId = data.replace(/\D/g, "").slice(0, 14);
  const saida = opcao(args, "saida") ?? path.join("avaliacoes-saida", `carrossel-${data.slice(0, 10)}-v${versaoDoPrompt}.json`);

  console.log(`conjunto: ${caminho}${ehExemplo ? " (exemplo, nao e o golden set real)" : ""}`);
  console.log(`${casos.length} caso(s), prompt do carrossel ${versaoDoPrompt}, teto ${teto === null ? "sem teto" : `US$ ${teto.toFixed(2)}`}\n`);

  const r = await rodarComTeto(
    casos.map((c) => ({ ...c, ramo: c.marca.ramo })),
    async (caso) => {
      const res = await rodarCaso(caso, rodadaId, manter);
      console.log(`${caso.id}: ${res.desfecho}, US$ ${res.custoUsd.toFixed(4)}, ${res.tempoS.toFixed(1)} s${res.erro ? ` (${res.erro.slice(0, 120)})` : ""}`);
      return res;
    },
    teto,
  );
  for (const c of r.casos) if (c.desfecho === "nao-rodou") console.log(`${c.id}: nao rodou (teto de gasto)`);

  const rodada: Rodada = {
    data,
    versaoPrompt: versaoDoPrompt,
    conjunto: ehExemplo ? "avaliacoes/carrossel.exemplo.json" : "golden set real (fora do repositorio)",
    precos: { ...PRECOS_POR_NIVEL, datados: DATA_PRECOS_IA },
    tetoUsd: teto,
    gastoUsd: r.gastoUsd,
    parouPeloTeto: r.parouPeloTeto,
    casos: r.casos,
  };
  mkdirSync(path.dirname(path.resolve(saida)), { recursive: true });
  writeFileSync(saida, JSON.stringify(rodada, null, 2));
  const conta = (d: string) => r.casos.filter((c) => c.desfecho === d).length;
  console.log(`\nprontos na 1a: ${conta("1a")}, na 2a: ${conta("2a")}, falhas: ${conta("falhou")}, nao rodados: ${conta("nao-rodou")}`);
  console.log(`gasto: US$ ${r.gastoUsd.toFixed(4)}${r.parouPeloTeto ? " (a rodada parou no teto)" : ""}; precos de ${DATA_PRECOS_IA}`);
  console.log(`resultado: ${saida}`);
}

if (process.argv[1]?.endsWith("avaliar-carrossel.ts")) {
  main()
    .then(async () => {
      await getPool().end();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error(String(e?.message ?? e));
      await getPool().end();
      process.exit(1);
    });
}
