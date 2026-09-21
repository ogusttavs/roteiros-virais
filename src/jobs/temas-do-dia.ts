/**
 * Job `temasDoDia` (etapa 10, fila `temas-do-dia`, diário 06:30 de
 * Brasília, decisão 2 do `PROXIMO.md`, depois do resultado da extração):
 * por nicho ativo, filtra as notícias das últimas 24h com a tarefa barata
 * `filtrarNoticias`, junta com o que está subindo hoje (com análise) e com
 * os vídeos sem conta dona da Hashtag Search da Meta (`semDonoComAnalise`,
 * achado da leitura prévia do Fable, 09/09/2026, correção 3 do
 * `PROXIMO.md`: sem isso, esses vídeos nunca tinham velocidade nem múltiplo
 * e a Hashtag Search virava custo de transcrição sem efeito no tema), e
 * chama a tarefa `temasDoDia` (modelo forte, com o modelo do nicho no bloco
 * estável, cache de prompt). Cada tema precisa citar pelo menos um id de
 * evidência (vídeo ou notícia) que de fato foi enviado; se algum tema não
 * citar, refaz a chamada uma vez, e se falhar de novo o nicho fica sem tema
 * novo (a regra de estabilidade em `src/servicos/temas.ts` usa o de um dos
 * últimos 3 dias). Sem `subindoHoje`, sem vídeo sem dono e sem notícia
 * relevante, o nicho não gera tema (sem chamar a IA), e o resumo diz por quê.
 *
 * Correção do dia 1 da etapa 14 (`PROXIMO.md`): antes, só vídeo contava como
 * evidência válida, então um nicho novo com notícia mas sem vídeo com
 * análise ainda madrugada chamava o modelo forte pedindo evidência de uma
 * lista de ids vazia, reprovava as duas tentativas por definição, e as duas
 * gerações ficavam fora do registro de custo (a validação só registrava
 * depois de aprovar). Agora notícia é evidência válida também, e toda
 * geração é registrada, aprovada ou não.
 *
 * V2b, item 8 (escopo 5.12, passo 6: tema só nasce com prova). Depois que
 * `evidenciaValida` confirma que os ids existem, uma segunda checagem, por
 * código, exige prova de verdade: pelo menos 3 vídeos analisados dentro da
 * janela, de pelo menos 2 contas diferentes, com maioria brasileira.
 * `evidenciasNoticias` nunca conta para essa prova (a regra fala em vídeos
 * analisados); um tema evidenciado só por notícia é sempre descartado por
 * ela. Tema que não passa é descartado, não corrigido: o nicho fecha o dia
 * com menos de três temas quando for o caso.
 */
import { and, eq, gte, isNull } from "drizzle-orm";

import { db } from "@/db";
import { nichos, noticias, temasDia, type TemaDoDia } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as filtrarNoticiasIA from "@/ia/prompts/filtrarNoticias";
import * as temasDoDiaIA from "@/ia/prompts/temasDoDia";
import { registrarGeracao } from "@/ia/registro";
import { hojeISO } from "@/lib/config";
import { formatarModeloNicho, modeloNichoAtual, semDonoComAnalise, subindoHojeComAnalise } from "@/servicos/pesquisa";
import { buscarVideosParaProva, janelaDeProva, temaTemProvaSuficiente } from "@/servicos/prova-tema";

const VINTE_QUATRO_HORAS_MS = 24 * 60 * 60 * 1000;
const LIMITE_NOTICIAS = 60;
const LIMITE_SUBINDO = 30;

type NoticiaCandidata = { id: number; titulo: string; resumo: string | null };
type NichoAtivo = { id: number; slug: string; nome: string; termos: string[]; criadoEm: Date };

async function noticiasCandidatas(nichoId: number): Promise<NoticiaCandidata[]> {
  return db()
    .select({ id: noticias.id, titulo: noticias.titulo, resumo: noticias.resumo })
    .from(noticias)
    .where(
      and(
        eq(noticias.nichoId, nichoId),
        gte(noticias.coletadoEm, new Date(Date.now() - VINTE_QUATRO_HORAS_MS)),
        isNull(noticias.relevante),
      ),
    )
    .limit(LIMITE_NOTICIAS);
}

/**
 * Chama `filtrarNoticias`, grava `relevante`/`angulo` em cada notícia (para
 * nunca reprocessar a mesma notícia dia depois de dia) e devolve só as
 * relevantes, com o id delas no banco (correção do dia 1 da etapa 14): é o
 * id que `temasDoDia` cita como evidência.
 */
async function filtrarEGravarNoticias(
  nicho: NichoAtivo,
  candidatas: NoticiaCandidata[],
): Promise<NoticiaCandidata[]> {
  if (candidatas.length === 0) return [];

  const resultado = await gerarEstruturado({
    tarefa: "filtrarNoticias",
    nivel: filtrarNoticiasIA.nivel,
    effort: filtrarNoticiasIA.esforco,
    schema: filtrarNoticiasIA.schema,
    sistemaEstavel: filtrarNoticiasIA.montarSistemaEstavel(),
    entrada: filtrarNoticiasIA.montarEntrada({
      nomeNicho: nicho.nome,
      termosNicho: nicho.termos,
      noticias: candidatas.map((n) => ({ titulo: n.titulo, resumo: n.resumo })),
    }),
  });

  await registrarGeracao({
    tarefa: "filtrarNoticias",
    versaoPrompt: filtrarNoticiasIA.versao,
    modelo: resultado.modelo,
    nivel: filtrarNoticiasIA.nivel,
    entradas: { nichoId: nicho.id, noticias: candidatas.length },
    saida: resultado.dados,
    uso: {
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
      tokensCacheLeitura: resultado.tokensCacheLeitura,
      tokensCacheEscrita: resultado.tokensCacheEscrita,
    },
  });

  const anguloPorIndice = new Map(resultado.dados.relevantes.map((r) => [r.indice, r.angulo]));

  for (const [i, candidata] of candidatas.entries()) {
    const angulo = anguloPorIndice.get(i + 1) ?? null;
    await db()
      .update(noticias)
      .set({ relevante: angulo !== null, angulo })
      .where(eq(noticias.id, candidata.id));
  }

  return candidatas.filter((_, i) => anguloPorIndice.has(i + 1));
}

/**
 * Todo tema precisa citar ao menos uma evidencia (video ou noticia) que de
 * fato foi enviada ao modelo; nenhum id fora do que foi enviado pode ser
 * citado, em nenhuma das duas listas. Exportada para teste unitario
 * (correcao do dia 1 da etapa 14, `PROXIMO.md`).
 */
export function evidenciaValida(
  temas: TemaDoDia[],
  idsValidos: Set<number>,
  idsValidosNoticias: Set<number>,
): boolean {
  return temas.every((tema) => {
    const evidenciasNoticias = tema.evidenciasNoticias ?? [];
    const temEvidencia = tema.evidencias.length > 0 || evidenciasNoticias.length > 0;
    return (
      temEvidencia &&
      tema.evidencias.every((id) => idsValidos.has(id)) &&
      evidenciasNoticias.every((id) => idsValidosNoticias.has(id))
    );
  });
}

/**
 * Uma tentativa de gerar os temas: gera, confere a evidencia e registra a
 * geracao, aprovada ou nao (correcao do dia 1 da etapa 14: antes o registro
 * so acontecia depois de aprovar, e as tentativas reprovadas sumiam do
 * painel de custo).
 */
async function tentarGerarTemas(dados: {
  nicho: NichoAtivo;
  sistemaEstavel: string;
  entrada: string;
  idsValidos: Set<number>;
  idsValidosNoticias: Set<number>;
  subindoCount: number;
  noticiasCount: number;
}): Promise<{ valido: boolean; temas: TemaDoDia[] }> {
  const resultado = await gerarEstruturado({
    tarefa: "temasDoDia",
    nivel: temasDoDiaIA.nivel,
    effort: temasDoDiaIA.esforco,
    schema: temasDoDiaIA.schema,
    sistemaEstavel: dados.sistemaEstavel,
    entrada: dados.entrada,
  });

  const valido = evidenciaValida(resultado.dados.temas, dados.idsValidos, dados.idsValidosNoticias);

  await registrarGeracao({
    tarefa: "temasDoDia",
    versaoPrompt: temasDoDiaIA.versao,
    modelo: resultado.modelo,
    nivel: temasDoDiaIA.nivel,
    entradas: {
      nichoId: dados.nicho.id,
      subindoHoje: dados.subindoCount,
      noticias: dados.noticiasCount,
      evidenciaValida: valido,
    },
    saida: resultado.dados,
    uso: {
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
      tokensCacheLeitura: resultado.tokensCacheLeitura,
      tokensCacheEscrita: resultado.tokensCacheEscrita,
    },
  });

  return { valido, temas: resultado.dados.temas };
}

/**
 * Busca os vídeos citados (`tema.evidencias` de todos os temas de uma vez,
 * sem duplicar consulta por tema) e filtra os que têm prova suficiente
 * (V2b, item 8). Tema evidenciado só por notícia (`evidencias` vazio) nunca
 * passa: a prova exige vídeo analisado, notícia não conta.
 */
async function filtrarTemasComProva(
  temas: TemaDoDia[],
  nicho: NichoAtivo,
  agora: Date,
): Promise<{ temasComProva: TemaDoDia[]; temasSemProva: number }> {
  const idsVideo = [...new Set(temas.flatMap((t) => t.evidencias))];
  if (idsVideo.length === 0) {
    return { temasComProva: [], temasSemProva: temas.length };
  }

  const videosPorId = await buscarVideosParaProva(idsVideo);
  const janela = janelaDeProva(nicho.criadoEm, agora);

  const temasComProva = temas.filter((tema) => temaTemProvaSuficiente(tema.evidencias, videosPorId, agora, janela));
  return { temasComProva, temasSemProva: temas.length - temasComProva.length };
}

async function gerarTemasDoNicho(
  nicho: NichoAtivo,
): Promise<{ status: "gerado" | "sem_evidencia" | "sem_prova"; temasSemProva: number }> {
  const [subindo, semDono, candidatasNoticias] = await Promise.all([
    subindoHojeComAnalise(nicho.id, LIMITE_SUBINDO),
    semDonoComAnalise(nicho.id),
    noticiasCandidatas(nicho.id),
  ]);

  const noticiasRelevantes = await filtrarEGravarNoticias(nicho, candidatasNoticias);

  if (subindo.length === 0 && semDono.length === 0 && noticiasRelevantes.length === 0) {
    return { status: "sem_evidencia", temasSemProva: 0 };
  }

  const modeloNicho = await modeloNichoAtual(nicho.id);
  const idsValidos = new Set([...subindo.map((v) => v.id), ...semDono.map((v) => v.id)]);
  const idsValidosNoticias = new Set(noticiasRelevantes.map((n) => n.id));
  const sistemaEstavel = temasDoDiaIA.montarSistemaEstavel({
    modeloNicho: formatarModeloNicho(modeloNicho?.modelo ?? null),
  });
  const entrada = temasDoDiaIA.montarEntrada({
    subindoHoje: subindo,
    semDono,
    noticias: noticiasRelevantes.map((n) => ({ id: n.id, titulo: n.titulo, resumo: n.resumo ?? "" })),
  });

  const parametrosTentativa = {
    nicho,
    sistemaEstavel,
    entrada,
    idsValidos,
    idsValidosNoticias,
    subindoCount: subindo.length + semDono.length,
    noticiasCount: noticiasRelevantes.length,
  };

  let tentativa = await tentarGerarTemas(parametrosTentativa);
  if (!tentativa.valido) {
    tentativa = await tentarGerarTemas(parametrosTentativa);
    if (!tentativa.valido) {
      throw new Error("tema sem evidencia valida depois de refazer a chamada uma vez");
    }
  }

  const { temasComProva, temasSemProva } = await filtrarTemasComProva(tentativa.temas, nicho, new Date());
  if (temasComProva.length === 0) {
    return { status: "sem_prova", temasSemProva };
  }

  await db()
    .insert(temasDia)
    .values({ nichoId: nicho.id, data: hojeISO(), temas: temasComProva })
    .onConflictDoUpdate({
      target: [temasDia.nichoId, temasDia.data],
      set: { temas: temasComProva },
    });

  return { status: "gerado", temasSemProva };
}

export async function rodarTemasDoDia(): Promise<Record<string, unknown>> {
  const nichosAtivos = await db().select().from(nichos).where(eq(nichos.ativo, true));

  let gerados = 0;
  let semEvidencia = 0;
  let semProva = 0;
  let temasSemProva = 0;
  let falhas = 0;
  const erros: string[] = [];

  for (const nicho of nichosAtivos) {
    try {
      const resultado = await gerarTemasDoNicho(nicho);
      temasSemProva += resultado.temasSemProva;
      if (resultado.status === "gerado") gerados += 1;
      else if (resultado.status === "sem_prova") semProva += 1;
      else semEvidencia += 1;
    } catch (erro) {
      falhas += 1;
      erros.push(`nicho "${nicho.slug}": ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  return {
    nichos: nichosAtivos.length,
    gerados,
    semEvidencia,
    semProva,
    temasSemProva,
    falhas,
    erros: erros.length > 0 ? erros : undefined,
  };
}
