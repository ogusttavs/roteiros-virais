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
import { and, eq, gte, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { clientes, nichos, noticias, roteiros, temasDia, type TemaDoDia } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as filtrarNoticiasIA from "@/ia/prompts/filtrarNoticias";
import * as temasDoDiaIA from "@/ia/prompts/temasDoDia";
import { registrarGeracao } from "@/ia/registro";
import { hojeISO } from "@/lib/config";
import {
  formatarModeloNicho,
  modeloNichoAtual,
  reguaDoSetor,
  semDonoComAnalise,
  subindoHojeComAnalise,
} from "@/servicos/pesquisa";
import { buscarVideosParaProva, janelaDeProva, minimoBrasileirosNaProva, motivoSemProva } from "@/servicos/prova-tema";

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
  proporcaoBrasil: number,
): Promise<{ temasComProva: TemaDoDia[]; temasSemProva: number; barrados: { titulo: string; motivo: string }[] }> {
  const idsVideo = [...new Set(temas.flatMap((t) => t.evidencias))];
  const videosPorId = await buscarVideosParaProva(idsVideo);
  const janela = janelaDeProva(nicho.criadoEm, agora);

  const temasComProva: TemaDoDia[] = [];
  const barrados: { titulo: string; motivo: string }[] = [];
  for (const tema of temas) {
    const motivo = motivoSemProva(tema.evidencias, videosPorId, agora, janela, proporcaoBrasil);
    if (motivo === null) temasComProva.push(tema);
    else barrados.push({ titulo: tema.titulo, motivo });
  }
  return { temasComProva, temasSemProva: barrados.length, barrados };
}

/** Quantos temas o dia fecha (os "três temas" do produto). */
const TEMAS_POR_DIA = 3;

/**
 * R1, item 0 (achado de produção em 01/10, `temas-do-dia`): rodar o job de novo no mesmo dia
 * não pode piorar o que já está lá. Duas condições, qualquer uma basta para não sobrescrever:
 * (1) o conjunto novo tem menos temas com prova que o que já existe (o setor 5 caiu de 2 para 1,
 * o Fable restaurou à mão); (2) algum roteiro de hoje já nasceu de um dos temas que estão lá
 * agora (sobrescrever trocaria a evidência debaixo de um roteiro que a pessoa já recebeu).
 */
/** Exportada para o teste de integração exercitar as duas condições direto, sem depender de como o mock gera candidatos. */
export async function podeSobrescreverTemasDoDia(nichoId: number, temasNovos: TemaDoDia[]): Promise<boolean> {
  const [existente] = await db()
    .select({ temas: temasDia.temas })
    .from(temasDia)
    .where(and(eq(temasDia.nichoId, nichoId), eq(temasDia.data, hojeISO())));
  if (!existente) return true;

  if (temasNovos.length < existente.temas.length) return false;

  const titulosExistentes = existente.temas.map((t) => t.titulo);
  if (titulosExistentes.length === 0) return true;

  const [roteiroJaUsou] = await db()
    .select({ id: roteiros.id })
    .from(roteiros)
    .innerJoin(clientes, eq(clientes.id, roteiros.clienteId))
    .where(
      and(
        eq(clientes.nichoId, nichoId),
        eq(roteiros.data, hojeISO()),
        eq(roteiros.origem, "sugerido"),
        inArray(roteiros.tema, titulosExistentes),
      ),
    )
    .limit(1);

  return !roteiroJaUsou;
}

async function gerarTemasDoNicho(
  nicho: NichoAtivo,
): Promise<{ status: "gerado" | "sem_evidencia" | "sem_prova" | "sem_novidade" | "mantido"; temasSemProva: number }> {
  const [regua, subindo, semDono, candidatasNoticias, existente] = await Promise.all([
    reguaDoSetor(nicho.id),
    // Hotfix de 02/10/2026: brasileiro primeiro na lista que o modelo recebe, senão o tema não tem
    // como montar a prova num setor com muita conta de fora.
    subindoHojeComAnalise(nicho.id, LIMITE_SUBINDO, { brasilPrimeiro: true }),
    semDonoComAnalise(nicho.id),
    noticiasCandidatas(nicho.id),
    db()
      .select({ temas: temasDia.temas, candidatosNaUltimaTentativa: temasDia.candidatosNaUltimaTentativa })
      .from(temasDia)
      .where(and(eq(temasDia.nichoId, nicho.id), eq(temasDia.data, hojeISO())))
      .then((linhas) => linhas[0]),
  ]);

  /**
   * M5b, item 3, resto do achado 9: o setor que já tentou hoje e ficou sem prova (`temas: []`,
   * `candidatosNaUltimaTentativa` gravado lá embaixo) só tenta de novo quando a lista de vídeos
   * cresceu desde a última tentativa; notícia nova sozinha nunca ajuda a prova (ela não conta como
   * evidência da prova, só como evidência de tema), por isso a contagem é só de vídeo. Sem isso,
   * cada lote de análise que termina ao longo do dia disparava outra rodada inteira no modelo
   * forte para um setor que continuava sem o vídeo a mais que faltava.
   */
  const candidatosAgora = subindo.length + semDono.length;
  if (
    existente &&
    existente.temas.length === 0 &&
    existente.candidatosNaUltimaTentativa !== null &&
    candidatosAgora <= existente.candidatosNaUltimaTentativa
  ) {
    return { status: "sem_novidade", temasSemProva: 0 };
  }

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
  const dadosEntrada = {
    subindoHoje: subindo,
    semDono,
    noticias: noticiasRelevantes.map((n) => ({ id: n.id, titulo: n.titulo, resumo: n.resumo ?? "" })),
    minimoBrasilEmTres: minimoBrasileirosNaProva(3, regua.proporcaoBrasil),
  };
  const entrada = temasDoDiaIA.montarEntrada(dadosEntrada);

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

  const primeira = await filtrarTemasComProva(tentativa.temas, nicho, new Date(), regua.proporcaoBrasil);
  let temasComProva = primeira.temasComProva;
  let temasSemProva = primeira.temasSemProva;

  /**
   * Hotfix de 02/10/2026: tema barrado na prova deixava o setor com menos de três temas, ou sem
   * nenhum (Overtake e o perfil do Bruno em 02/10), sem segunda chance. Agora o gerador recebe de
   * volta o que foi barrado e por quê, e refaz uma vez; os temas com prova das duas tentativas se
   * somam, até três. Só refaz quando existe vídeo na lista (tema só de notícia nunca tem prova, e
   * refazer não mudaria isso).
   */
  if (temasComProva.length < TEMAS_POR_DIA && idsValidos.size > 0) {
    const jaAprovados = temasComProva.map((t) => `"${t.titulo}"`).join(", ");
    const ajuste = [
      "Segunda tentativa. Na primeira, estes temas foram descartados por não cumprirem a regra da prova:",
      ...primeira.barrados.map((b) => `- "${b.titulo}": ${b.motivo}.`),
      jaAprovados ? `Estes já foram aprovados, não repita o assunto deles: ${jaAprovados}.` : "",
      "Proponha três temas de novo, cada um apoiado num grupo de vídeos da lista que cumpra a regra da prova. Confira conta e origem de cada id antes de citar.",
    ]
      .filter(Boolean)
      .join("\n");
    const segunda = await tentarGerarTemas({
      ...parametrosTentativa,
      entrada: temasDoDiaIA.montarEntrada({ ...dadosEntrada, ajuste }),
    });
    if (segunda.valido) {
      const refeita = await filtrarTemasComProva(segunda.temas, nicho, new Date(), regua.proporcaoBrasil);
      const titulos = new Set(temasComProva.map((t) => t.titulo));
      for (const tema of refeita.temasComProva) {
        if (temasComProva.length >= TEMAS_POR_DIA) break;
        if (titulos.has(tema.titulo)) continue;
        temasComProva = [...temasComProva, tema];
        titulos.add(tema.titulo);
      }
      temasSemProva = TEMAS_POR_DIA - temasComProva.length;
    }
  }

  if (temasComProva.length === 0) {
    /**
     * M5b, item 3: marca a tentativa (nunca por cima de um dia que já tinha tema de verdade; essa
     * defesa é só por segurança, porque o `existente` já buscado acima teria desviado para
     * "sem_novidade" antes de chegar aqui quando havia um tema real e nenhum vídeo novo).
     */
    if (!existente || existente.temas.length === 0) {
      await db()
        .insert(temasDia)
        .values({ nichoId: nicho.id, data: hojeISO(), temas: [], candidatosNaUltimaTentativa: candidatosAgora })
        .onConflictDoUpdate({
          target: [temasDia.nichoId, temasDia.data],
          set: { temas: [], candidatosNaUltimaTentativa: candidatosAgora },
        });
    }
    return { status: "sem_prova", temasSemProva };
  }

  if (!(await podeSobrescreverTemasDoDia(nicho.id, temasComProva))) {
    return { status: "mantido", temasSemProva };
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

/**
 * M1, item 2: os temas nascem quando a análise chega, não só às 06:30. Sem `nichoId`, o
 * comportamento de sempre (o cron das 06:30): todo nicho ativo, sempre tentando (a escrita em si
 * respeita `podeSobrescreverTemasDoDia`, item 0 da R1). Com `nichoId` (chamado por
 * `extrairColeta` ou `extrairAgora` depois de analisar vídeo novo), só aquele setor, e só se ele
 * ainda não tem tema **de verdade** hoje: nunca regenera o tema de quem já escolheu. Uma linha
 * com `temas: []` (M5b, item 3: tentou e ficou sem prova) não conta como "já tem hoje" aqui; quem
 * decide se vale tentar de novo é `gerarTemasDoNicho`, que sabe se chegou vídeo novo desde a
 * última tentativa.
 *
 * R1, item 0: `opts.forcar` pula esse "já tem hoje, não regenera" (`npm run job --
 * temas-do-dia <nichoId> --refazer`, `rodar.ts`), para refazer um setor só sob pedido; a
 * segurança de não piorar o que já está lá continua em `podeSobrescreverTemasDoDia`, que roda
 * de qualquer jeito na escrita.
 */
export async function rodarTemasDoDia(
  nichoId?: number,
  opts?: { forcar?: boolean },
): Promise<Record<string, unknown>> {
  if (nichoId !== undefined && !opts?.forcar) {
    const [existente] = await db()
      .select({ temas: temasDia.temas })
      .from(temasDia)
      .where(and(eq(temasDia.nichoId, nichoId), eq(temasDia.data, hojeISO())));
    if (existente && existente.temas.length > 0) {
      return {
        nichos: 1,
        gerados: 0,
        mantidos: 0,
        semEvidencia: 0,
        semProva: 0,
        semNovidade: 0,
        temasSemProva: 0,
        falhas: 0,
        jaTinhaTemaHoje: true,
      };
    }
  }

  const condicoes = [eq(nichos.ativo, true)];
  if (nichoId !== undefined) condicoes.push(eq(nichos.id, nichoId));
  const nichosAtivos = await db()
    .select()
    .from(nichos)
    .where(and(...condicoes));

  let gerados = 0;
  let mantidos = 0;
  let semEvidencia = 0;
  let semProva = 0;
  let semNovidade = 0;
  let temasSemProva = 0;
  let falhas = 0;
  const erros: string[] = [];

  for (const nicho of nichosAtivos) {
    try {
      const resultado = await gerarTemasDoNicho(nicho);
      temasSemProva += resultado.temasSemProva;
      if (resultado.status === "gerado") gerados += 1;
      else if (resultado.status === "mantido") mantidos += 1;
      else if (resultado.status === "sem_prova") semProva += 1;
      else if (resultado.status === "sem_novidade") semNovidade += 1;
      else semEvidencia += 1;
    } catch (erro) {
      falhas += 1;
      erros.push(`nicho "${nicho.slug}": ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  return {
    nichos: nichosAtivos.length,
    gerados,
    mantidos,
    semEvidencia,
    semProva,
    semNovidade,
    temasSemProva,
    falhas,
    erros: erros.length > 0 ? erros : undefined,
  };
}
