/**
 * Script de uma vez só (E44 PR 1): classifica o FORMATO (as treze chaves do estudo mais os valores que nunca servem de modelo, `config/formatos.ts`) dos vídeos já
 * analisados antes de `videos.formato_catalogo` existir (`extrairVideo`, versão 1.11.0; E49 PR 2: e agora também `videos.ficha_catalogo`, versão 1.12.0, na mesma rodada: o lote reextrai os dois campos pelo mesmo preço). Mesmo caminho de `reclassificar-evidencia.ts` (H4): o lote reextrai a ficha
 * com o prompt novo e o job `extrairColeta` grava tudo, inclusive o formato, quando o lote termina. Vídeo sem `formato_catalogo` continua passando pelo corte da H4
 * até aqui (`condicaoDeFormato`, `servicos/pesquisa.ts`: nulo passa), então rodar isto aos poucos nunca esvazia a evidência de ninguém.
 *
 * Só entra o que de fato pode virar evidência: dentro do piso de views do próprio setor, nos últimos 90 dias, com análise e transcrição guardadas (mesmo filtro de
 * `reclassificar-evidencia.ts`). Vídeo sem fala não entra (a análise dele é de quadros; o `extrair-sem-fala.ts` já grava o formato na hora).
 *
 * Por padrão roda em DRY RUN: mostra quantos vídeos entrariam no lote, por setor, e o custo estimado (a partir do custo médio real da tarefa `extrairVideo` em
 * `geracoes_ia`, em lote a metade), sem gastar nada nem tocar no banco. Só envia o lote com `--confirmar`.
 *
 * NUNCA rodar `--confirmar` contra produção sem o sim explícito do Gustavo (`CLAUDE.md`, regra 14: é gasto real de dinheiro em massa; a ordem da E44 PR 1 estimou
 * uns US$ 1,50 para uns 1.450 vídeos).
 *
 *   npx tsx scripts/reclassificar-formato.ts              # dry run, não gasta nada
 *   npx tsx scripts/reclassificar-formato.ts --confirmar   # envia o lote de verdade
 */
import "./chave-de-testes";
import { and, avg, count, eq, gte, isNotNull, isNull, lt, ne, not, or, sql, type SQL } from "drizzle-orm";

import { db } from "../src/db";
import { contas, geracoesIA, lotesIa, nichos, videos } from "../src/db/schema";
import { criarLote, type ItemLote } from "../src/ia/lote";
import * as extrairVideo from "../src/ia/prompts/extrairVideo";
import { TAMANHO_MINIMO_TRANSCRICAO } from "../src/jobs/extracao-comum";
import { condicoesSoFichaSemFala } from "../src/jobs/extrair-sem-fala";
import { boss, FILAS, garantirBossPronto } from "../src/jobs/fila";
import {
  DENTRO_DO_TETO_DE_DURACAO,
  incluirSeed,
  PERTENCE_AO_NICHO,
  reguaDoSetor,
} from "../src/servicos/pesquisa";

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

type Candidato = {
  id: number;
  titulo: string | null;
  descricao: string | null;
  handle: string | null;
  transcricao: string | null;
  nomeNicho: string;
  termosNicho: string[];
  nichoId: number;
};

const TRINTA_DIAS_MS = 30 * DIA_MS;

/** O que falta ao vídeo: o tipo ou a ficha. Cada um só é "pedido" se não foi tentado nos últimos 30 dias (um nulo devolvido pelo modelo não paga a rodada de novo todo dia). */
function faltaAlgoNaoTentado(): SQL {
  const limite = new Date(Date.now() - TRINTA_DIAS_MS);
  return or(
    and(isNull(videos.formatoCatalogo), or(isNull(videos.formatoTentadoEm), lt(videos.formatoTentadoEm, limite))),
    and(isNull(videos.fichaCatalogo), or(isNull(videos.fichaTentadaEm), lt(videos.fichaTentadaEm, limite))),
  ) as SQL;
}

/** O mesmo filtro de evidência de sempre (piso do setor, 90 dias, análise e transcrição guardadas), sem a parte de "o que falta". */
async function condicoesBase(nichoId: number): Promise<SQL[]> {
  const regua = await reguaDoSetor(nichoId);
  const condicoes: SQL[] = [
    eq(videos.nichoId, nichoId),
    gte(videos.publicadoEm, diasAtras(90)),
    gte(videos.views, regua.pisoViews),
    isNotNull(videos.analise),
    isNotNull(videos.transcricao),
    // Este script usa `extrairVideo`, que lê a transcrição; vídeo do caminho sem fala (`semFala = true`, `extrair-sem-fala.ts`, que já grava o formato na hora) ou com
    // transcrição curta demais (mesmo piso de `extracao-comum.ts`) não passa por aqui.
    sql`${videos.semFala} is not true`,
    sql`char_length(trim(${videos.transcricao})) >= ${TAMANHO_MINIMO_TRANSCRICAO}`,
    PERTENCE_AO_NICHO,
    DENTRO_DO_TETO_DE_DURACAO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));
  return condicoes;
}

/**
 * Exportada só para o teste de integração conferir o filtro e o custo sem rodar o lote.
 * E49 PR 2: uma rodada só reclassifica os dois campos (o custo é o mesmo): falta o tipo OU falta a ficha, e o que já foi tentado há menos de 30 dias fica de fora.
 */
export async function candidatosDoSetor(nichoId: number, nomeNicho: string, termosNicho: string[]): Promise<Candidato[]> {
  const condicoes = [...(await condicoesBase(nichoId)), faltaAlgoNaoTentado()];

  const linhas = await db()
    .select({ id: videos.id, titulo: videos.titulo, descricao: videos.descricao, handle: contas.handle, transcricao: videos.transcricao })
    .from(videos)
    .leftJoin(contas, eq(contas.id, videos.contaId))
    .where(and(...condicoes));

  return linhas.map((v) => ({ ...v, nomeNicho, termosNicho, nichoId }));
}

/** Quantos vídeos do setor estariam na rodada se não fossem as tentativas dos últimos 30 dias (o ensaio mostra à parte, "já tentados, fora da rodada"). */
export async function jaTentadosDoSetor(nichoId: number): Promise<number> {
  const [linha] = await db()
    .select({ total: count() })
    .from(videos)
    .where(and(...(await condicoesBase(nichoId)), or(isNull(videos.formatoCatalogo), isNull(videos.fichaCatalogo)), not(faltaAlgoNaoTentado())));
  return linha?.total ?? 0;
}

/** Os sem fala analisados antes da ficha (E49 PR 2): quantos ganhariam só a ficha, pela fila do sem fala. */
export async function candidatosSemFalaSoFicha(): Promise<{ total: number; porSetor: { nome: string; total: number }[] }> {
  const todosNichos = await db().select({ id: nichos.id, nome: nichos.nome }).from(nichos);
  const porSetor: { nome: string; total: number }[] = [];
  for (const nicho of todosNichos) {
    const regua = await reguaDoSetor(nicho.id);
    if (!regua.videoSemFalaVale) continue;
    const [linha] = await db()
      .select({ total: count() })
      .from(videos)
      .where(and(...condicoesSoFichaSemFala(nicho.id, regua.pisoViews)));
    if (linha && linha.total > 0) porSetor.push({ nome: nicho.nome, total: linha.total });
  }
  return { total: porSetor.reduce((soma, s) => soma + s.total, 0), porSetor };
}

/** O custo médio real da tarefa, já pago em produção, é a base mais honesta de estimativa (melhor que contar tokens no escuro). */
async function custoMedioHistoricoUsd(): Promise<number | null> {
  const [linha] = await db()
    .select({ media: avg(geracoesIA.custoUsd), quantos: count() })
    .from(geracoesIA)
    .where(eq(geracoesIA.tarefa, "extrairVideo"));
  if (!linha || linha.quantos === 0 || linha.media === null) return null;
  return Number(linha.media);
}

export type Plano = {
  total: number;
  porSetor: { nome: string; candidatos: Candidato[] }[];
  /** O custo médio real de `extrairVideo` fora do lote, ou nulo sem histórico. */
  custoMedioUsd: number | null;
  /** O custo estimado em lote (metade do preço), ou nulo sem histórico. */
  custoEstimadoUsd: number | null;
  /** Quantos vídeos já estão num lote em andamento (ficam de fora do plano). */
  jaEmLote: number;
  /** Quantos ainda sem tipo ou sem ficha foram tentados há menos de 30 dias e ficam fora da rodada. */
  jaTentados: number;
};

/** O que o dry run mostra, sem gastar nada: quantos vídeos entram, por setor, e o custo estimado. Exportada para o teste de integração. */
export async function planejarReclassificacao(): Promise<Plano> {
  const todosNichos = await db().select({ id: nichos.id, nome: nichos.nome, termos: nichos.termos }).from(nichos);
  const porSetor: { nome: string; candidatos: Candidato[] }[] = [];
  for (const nicho of todosNichos) {
    const candidatos = await candidatosDoSetor(nicho.id, nicho.nome, nicho.termos ?? []);
    if (candidatos.length > 0) porSetor.push({ nome: nicho.nome, candidatos });
  }
  // Vídeo que já está num lote em andamento (enviado e ainda não recolhido, até 24 h) não entra de novo: rodar `--confirmar` duas vezes seguidas gastaria em dobro.
  const emAndamento = new Set<number>();
  const lotes = await db().select({ videoIds: lotesIa.videoIds }).from(lotesIa).where(and(eq(lotesIa.tarefa, "extrairVideo"), eq(lotesIa.status, "em_andamento")));
  for (const lote of lotes) for (const id of lote.videoIds ?? []) emAndamento.add(id);
  let jaEmLote = 0;
  if (emAndamento.size > 0) {
    for (const setor of porSetor) {
      const antes = setor.candidatos.length;
      setor.candidatos = setor.candidatos.filter((c) => !emAndamento.has(c.id));
      jaEmLote += antes - setor.candidatos.length;
    }
  }
  const total = porSetor.reduce((soma, s) => soma + s.candidatos.length, 0);
  let jaTentados = 0;
  for (const nicho of todosNichos) jaTentados += await jaTentadosDoSetor(nicho.id);
  const custoMedioUsd = await custoMedioHistoricoUsd();
  // API de lote: metade do preço normal.
  const custoEstimadoUsd = custoMedioUsd !== null ? (custoMedioUsd / 2) * total : null;
  return { total, porSetor: porSetor.filter((s) => s.candidatos.length > 0), custoMedioUsd, custoEstimadoUsd, jaEmLote, jaTentados };
}

async function main() {
  const confirmar = process.argv.includes("--confirmar");
  const { total, porSetor, custoMedioUsd, custoEstimadoUsd, jaEmLote, jaTentados } = await planejarReclassificacao();
  const comSemFala = process.argv.includes("--sem-fala");

  console.log(`vídeos elegíveis a evidência, ainda sem formato_catalogo ou sem ficha_catalogo: ${total}${jaEmLote > 0 ? ` (fora ${jaEmLote} que já estão num lote em andamento)` : ""}`);
  for (const setor of porSetor) {
    console.log(`  ${setor.nome}: ${setor.candidatos.length}`);
  }

  console.log(`já tentados nos últimos 30 dias, fora da rodada: ${jaTentados}`);

  // Os sem fala analisados antes da ficha: só a ficha, pela fila do sem fala (leitura por quadros, no modelo forte; o custo vai à parte).
  const semFala = await candidatosSemFalaSoFicha();
  console.log(`\nsem fala, só a ficha (com --sem-fala, pela fila do sem fala): ${semFala.total}`);
  for (const setor of semFala.porSetor) console.log(`  ${setor.nome}: ${setor.total}`);
  if (semFala.total > 0) {
    console.log(`custo estimado dos sem fala (modelo forte, uns US$ 0,05 por vídeo): US$ ${(semFala.total * 0.05).toFixed(2)}, fora do total acima`);
  }

  if (total === 0 && !(comSemFala && semFala.total > 0)) {
    console.log("\nnada para reclassificar.");
    return;
  }

  console.log(
    custoMedioUsd !== null
      ? `\ncusto médio real de extrairVideo (fora do lote): US$ ${custoMedioUsd.toFixed(5)}/vídeo`
      : "\nsem histórico de custo de extrairVideo ainda; sem base para estimar.",
  );
  if (custoEstimadoUsd !== null) {
    console.log(`custo estimado em lote (metade do preço): US$ ${custoEstimadoUsd.toFixed(2)} no total`);
  }

  if (!confirmar) {
    console.log("\ndry run: nada foi enviado. Rode com --confirmar para enviar o lote de verdade.");
    console.log("NUNCA rodar --confirmar contra produção sem o sim explícito do Gustavo (CLAUDE.md, regra 14).");
    return;
  }

  if (comSemFala && semFala.total > 0) {
    await garantirBossPronto();
    await boss().send(FILAS.extrairSemFala, { soFicha: true });
    console.log(`\nfila do sem fala enfileirada só para a ficha (${semFala.total} vídeos, no teto diário do sem fala por rodada)`);
  }

  const candidatos = porSetor.flatMap((s) => s.candidatos);
  if (candidatos.length === 0) return;
  const itens: ItemLote<extrairVideo.SaidaExtrairVideo>[] = candidatos.map((v) => ({
    customId: String(v.id),
    tarefa: "extrairVideo",
    nivel: extrairVideo.nivel,
    schema: extrairVideo.schema,
    sistemaEstavel: extrairVideo.montarSistemaEstavel(),
    entrada: extrairVideo.montarEntrada({
      titulo: v.titulo ?? "",
      descricao: v.descricao,
      handle: v.handle,
      transcricao: v.transcricao ?? "",
      nomeNicho: v.nomeNicho,
      termosNicho: v.termosNicho,
    }),
  }));

  const loteIdExterno = await criarLote(itens);
  await db()
    .insert(lotesIa)
    .values({
      tarefa: "extrairVideo",
      loteIdExterno,
      // O lote só quer o que falta: um vídeo que já tem tipo mantém o dele e ganha só a ficha (`aplicarResultadoExtracao`, `soFicha`).
      soFicha: true,
      videoIds: candidatos.map((v) => v.id),
      status: "em_andamento",
    });

  console.log(`\nlote enviado: ${loteIdExterno} (${candidatos.length} vídeos)`);
  console.log("o job extrairColeta, já em produção, recolhe o resultado quando o lote terminar (até 24h).");
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((erro: unknown) => {
      console.error(erro);
      process.exitCode = 1;
    });
}
