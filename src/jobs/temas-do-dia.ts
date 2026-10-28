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
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { clientes, nichos, ramosDaConta, roteiros, temasDia, type TemaDoDia } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as temasDoDiaIA from "@/ia/prompts/temasDoDia";
import { registrarGeracao } from "@/ia/registro";
import { hojeISO } from "@/lib/config";
import { logger } from "@/lib/log";
import { registrarMarcasPuladas, resumoDasMarcasPuladas, separarMarcasPorAssinatura } from "@/servicos/assinatura-tarefas";
import { filtrarNoticiasDoRamo, relevantesDoRamo, type NoticiaCandidata } from "@/servicos/filtro-de-noticias";
import { diaPorExtenso } from "@/servicos/noticias-assuntos";
import {
  formatarModeloNicho,
  modeloNichoAtual,
  reguaDoSetor,
  semDonoComAnalise,
  subindoHojeComAnalise,
} from "@/servicos/pesquisa";
import { buscarVideosParaProva, janelaDeProva, minimoBrasileirosNaProva, motivoSemProva, provaDeVideoEhPossivel } from "@/servicos/prova-tema";
import { listaDeTendenciasDeAgora, temasQueAindaValem } from "@/servicos/tendencias";
import { vozesDoSetor, vozesParaOPrompt, type VozNumerada } from "@/servicos/vozes-do-publico";

import { atualizarTemaDoMomento } from "./tema-do-momento";

const VINTE_QUATRO_HORAS_MS = 24 * 60 * 60 * 1000;
/** Quantas notícias relevantes, no máximo, vão como evidência na chamada forte dos temas. */
const LIMITE_NOTICIAS_NO_TEMA = 12;
const LIMITE_SUBINDO = 30;
/** Hotfix de 23/10/2026: quantas notícias relevantes da semana o modelo vê quando a notícia completa o dia (as mais recentes primeiro). */
const LIMITE_NOTICIAS_PARA_COMPLETAR = 15;
const SETE_DIAS_MS = 7 * VINTE_QUATRO_HORAS_MS;

type NichoAtivo = { id: number; slug: string; nome: string; termos: string[]; criadoEm: Date };

/**
 * As notícias do ramo que servem de evidência de tema: as relevantes que a coleta trouxe nas últimas 24 horas. O filtro (`servicos/filtro-de-noticias.ts`) já roda sozinho depois de cada
 * coleta e quando a marca chega; aqui ele só fecha o que ainda ficou sem veredito (uma única chamada, o limite que este job sempre teve), e a lista vem do banco, relevantes de rodadas
 * anteriores incluídas (antes só as do lote filtrado agora entravam, e o segundo `temas-do-dia` do dia ficava sem notícia). Notícia publicada há mais de 7 dias nunca entra.
 */
async function noticiasRelevantesDoDia(nicho: NichoAtivo): Promise<NoticiaCandidata[]> {
  const desde = new Date(Date.now() - VINTE_QUATRO_HORAS_MS);
  await filtrarNoticiasDoRamo(nicho, { coletadasDesde: desde, lotes: 1 });
  return relevantesDoRamo(nicho.id, { coletadasDesde: desde, limite: LIMITE_NOTICIAS_NO_TEMA });
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
  /** E28: as vozes que foram para a entrada, para traduzir de volta o número que o modelo devolveu. */
  vozes?: VozNumerada[];
}): Promise<{ valido: boolean; temas: TemaDoDia[] }> {
  const resultado = await gerarEstruturado({
    tarefa: "temasDoDia",
    nivel: temasDoDiaIA.nivel,
    effort: temasDoDiaIA.esforco,
    schema: temasDoDiaIA.schema,
    sistemaEstavel: dados.sistemaEstavel,
    entrada: dados.entrada,
  });

  // E28: o número da pergunta vira a pergunta que vimos (frase, vezes, plataformas); número que não está na lista é descartado, e o tema segue sem ela.
  const porNumero = new Map((dados.vozes ?? []).map((v) => [v.numero, v]));
  const temasDoModelo: TemaDoDia[] = resultado.dados.temas.map(({ perguntaNumero, ...tema }) => {
    const voz = perguntaNumero === null ? undefined : porNumero.get(perguntaNumero);
    return voz ? { ...tema, perguntaDoPublico: { chave: voz.chave, tipo: voz.tipo, texto: voz.texto, vezes: voz.vezes, plataformas: voz.plataformas } } : tema;
  });

  const valido = evidenciaValida(temasDoModelo, dados.idsValidos, dados.idsValidosNoticias);

  await registrarGeracao({
    tarefa: "temasDoDia",
    versaoPrompt: temasDoDiaIA.versao,
    modelo: resultado.modelo,
    nivel: temasDoDiaIA.nivel,
    entradas: {
      nichoId: dados.nicho.id,
      subindoHoje: dados.subindoCount,
      noticias: dados.noticiasCount,
      // E28: quantas perguntas do público foram para a entrada (zero sem leitura da semana).
      vozesDoPublico: dados.vozes?.length ?? 0,
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

  return { valido, temas: temasDoModelo };
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
 * Hotfix de 23/10/2026 ("os temas de hoje só tá vindo 1"): o ramo com pouco vídeo de prova fechava o dia sem tema de verdade (o setor 5 tinha 5 vídeos, todos da mesma conta, e a prova pede
 * 2 contas; a regra não mudou). Quando os temas com prova de vídeo não fecham o dia, o que falta é completado com temas ancorados numa notícia relevante recente do setor (fonte que o projeto já
 * aceita, E43). O tema guarda só o id da notícia em `evidenciasNoticias` (`evidencias` fica vazio: nenhum vídeo é citado como prova) e a tela diz de onde ele veio. Nunca inventa: o código só
 * aceita tema que cita uma notícia que foi de fato enviada, uma notícia por tema, sem repetir título. Falha da chamada nunca derruba o que o dia já tem.
 */
export function aceitarTemasDeNoticia(
  temas: TemaDoDia[],
  idsValidosNoticias: Set<number>,
  jaTem: TemaDoDia[],
  vagas: number,
): TemaDoDia[] {
  const titulos = new Set(jaTem.map((t) => t.titulo.trim().toLowerCase()));
  const noticiasUsadas = new Set(jaTem.flatMap((t) => t.evidenciasNoticias ?? []));
  const aceitos: TemaDoDia[] = [];
  for (const tema of temas) {
    if (aceitos.length >= vagas) break;
    const titulo = tema.titulo.trim();
    if (titulo === "" || titulos.has(titulo.toLowerCase())) continue;
    const idNoticia = (tema.evidenciasNoticias ?? []).find((id) => idsValidosNoticias.has(id) && !noticiasUsadas.has(id));
    if (idNoticia === undefined) continue;
    titulos.add(titulo.toLowerCase());
    noticiasUsadas.add(idNoticia);
    // Só o que um tema de notícia carrega: nenhuma pergunta do público nem assunto em alta, e nenhum vídeo citado como prova.
    aceitos.push({ titulo, descricao: tema.descricao, porQue: tema.porQue, evidencias: [], evidenciasNoticias: [idNoticia], puxaPara: tema.puxaPara });
  }
  return aceitos;
}

/** Os temas da linha do dia sem os do momento cujo assunto já saiu da lista de agora (só consulta a lista quando há tema do momento). */
async function temasQueAindaValemAgora(temas: TemaDoDia[]): Promise<TemaDoDia[]> {
  if (!temas.some((t) => t.doMomento)) return temas;
  return temasQueAindaValem(temas, await listaDeTendenciasDeAgora());
}

async function completarComNoticias(dados: {
  nicho: NichoAtivo;
  sistemaEstavel: string;
  noticias: NoticiaCandidata[];
  jaTem: TemaDoDia[];
  vagas: number;
}): Promise<TemaDoDia[]> {
  const usadas = new Set(dados.jaTem.flatMap((t) => t.evidenciasNoticias ?? []));
  const disponiveis = dados.noticias.filter((n) => !usadas.has(n.id));
  if (dados.vagas <= 0 || disponiveis.length === 0) return [];

  try {
    const resultado = await gerarEstruturado({
      tarefa: "temasDoDia",
      nivel: temasDoDiaIA.nivel,
      effort: temasDoDiaIA.esforco,
      schema: temasDoDiaIA.schema,
      sistemaEstavel: dados.sistemaEstavel,
      entrada: temasDoDiaIA.montarEntrada({
        subindoHoje: [],
        noticias: disponiveis.map((n) => ({ id: n.id, titulo: n.titulo, resumo: n.resumo ?? "" })),
        completarComNoticias: { vagas: dados.vagas, jaTem: dados.jaTem.map((t) => t.titulo) },
      }),
    });

    const temas: TemaDoDia[] = resultado.dados.temas.map((t) => ({
      titulo: t.titulo,
      descricao: t.descricao,
      porQue: t.porQue,
      evidencias: t.evidencias,
      evidenciasNoticias: t.evidenciasNoticias,
      puxaPara: t.puxaPara,
    }));
    const aceitos = aceitarTemasDeNoticia(temas, new Set(disponiveis.map((n) => n.id)), dados.jaTem, dados.vagas);

    await registrarGeracao({
      tarefa: "temasDoDia",
      versaoPrompt: temasDoDiaIA.versao,
      modelo: resultado.modelo,
      nivel: temasDoDiaIA.nivel,
      entradas: { nichoId: dados.nicho.id, modo: "completarComNoticias", noticias: disponiveis.length, vagas: dados.vagas, aceitos: aceitos.length },
      saida: resultado.dados,
      uso: {
        tokensEntrada: resultado.tokensEntrada,
        tokensSaida: resultado.tokensSaida,
        tokensCacheLeitura: resultado.tokensCacheLeitura,
        tokensCacheEscrita: resultado.tokensCacheEscrita,
      },
    });
    return aceitos;
  } catch (erro) {
    logger.warn({ err: erro, nichoId: dados.nicho.id }, "nao foi possivel completar os temas do dia com noticias");
    return [];
  }
}

/**
 * E55: o tema "do momento" (`doMomento`) vive na mesma linha do dia, mas não é um dos temas com prova de vídeo: gerar os três de novo nunca o apaga (ele sai quando o assunto sai da lista de
 * tendências, `tema-do-momento.ts`), e a contagem de "já tem tema" olha só os temas de verdade.
 */
export function semOMomento(temas: TemaDoDia[]): TemaDoDia[] {
  return temas.filter((t) => !t.doMomento);
}

/** Os temas novos com o do momento que já estava na linha do dia na terceira vaga (no máximo três ao todo). */
export function comOMomentoQueJaEstava(novos: TemaDoDia[], existentes: TemaDoDia[]): TemaDoDia[] {
  const momento = existentes.filter((t) => t.doMomento);
  if (momento.length === 0) return novos;
  return [...novos.slice(0, TEMAS_POR_DIA - momento.length), ...momento];
}

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

  const reais = semOMomento(existente.temas);
  if (temasNovos.length < reais.length) return false;

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
): Promise<{ status: "gerado" | "sem_evidencia" | "sem_prova" | "sem_novidade" | "mantido"; temasSemProva: number; deNoticia: number }> {
  const [regua, subindo, semDono, noticiasDaSemana, existente] = await Promise.all([
    reguaDoSetor(nicho.id),
    // Hotfix de 02/10/2026: brasileiro primeiro na lista que o modelo recebe, senão o tema não tem
    // como montar a prova num setor com muita conta de fora.
    subindoHojeComAnalise(nicho.id, LIMITE_SUBINDO, { brasilPrimeiro: true }),
    semDonoComAnalise(nicho.id),
    // Hotfix de 23/10/2026: as notícias relevantes da semana, que completam o dia quando falta vídeo de prova (as mais recentes primeiro).
    relevantesDoRamo(nicho.id, { coletadasDesde: new Date(Date.now() - SETE_DIAS_MS), limite: LIMITE_NOTICIAS_PARA_COMPLETAR }),
    db()
      .select({
        temas: temasDia.temas,
        candidatosNaUltimaTentativa: temasDia.candidatosNaUltimaTentativa,
        noticiaMaisNovaNaTentativa: temasDia.noticiaMaisNovaNaTentativa,
      })
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
  /**
   * Hotfix de 23/10/2026: notícia nova passa a contar (ela completa o dia quando falta vídeo de prova). Uma linha de antes do hotfix (`noticiaMaisNovaNaTentativa` nulo) tenta uma vez com notícia,
   * se o setor tem alguma relevante na semana.
   */
  const noticiaMaisNovaAgora = noticiasDaSemana.reduce<number | null>((maior, n) => (maior === null || n.id > maior ? n.id : maior), null);
  const chegouNoticiaNova =
    noticiaMaisNovaAgora !== null &&
    (existente?.noticiaMaisNovaNaTentativa === null || existente?.noticiaMaisNovaNaTentativa === undefined || noticiaMaisNovaAgora > existente.noticiaMaisNovaNaTentativa);
  if (
    existente &&
    semOMomento(existente.temas).length === 0 &&
    existente.candidatosNaUltimaTentativa !== null &&
    candidatosAgora <= existente.candidatosNaUltimaTentativa &&
    !chegouNoticiaNova
  ) {
    return { status: "sem_novidade", temasSemProva: 0, deNoticia: 0 };
  }

  const noticiasRelevantes = await noticiasRelevantesDoDia(nicho);
  // O filtro acima pode ter marcado notícias novas agora: as da semana valem pelas duas listas (sem repetir id), as de hoje primeiro.
  const idsDeHoje = new Set(noticiasRelevantes.map((n) => n.id));
  const noticiasParaCompletar = [...noticiasRelevantes, ...noticiasDaSemana.filter((n) => !idsDeHoje.has(n.id))].slice(0, LIMITE_NOTICIAS_PARA_COMPLETAR);

  if (subindo.length === 0 && semDono.length === 0 && noticiasRelevantes.length === 0 && noticiasParaCompletar.length === 0) {
    return { status: "sem_evidencia", temasSemProva: 0, deNoticia: 0 };
  }

  const modeloNicho = await modeloNichoAtual(nicho.id);
  const idsValidos = new Set([...subindo.map((v) => v.id), ...semDono.map((v) => v.id)]);
  const idsValidosNoticias = new Set(noticiasRelevantes.map((n) => n.id));
  // E28: o que o público do setor perguntou nos comentários do YouTube esta semana (vazio sem leitura ou com a leitura velha: a entrada é a de antes).
  // O tema do dia responde a pergunta ou reclamação (pedido não entra), e a voz vai datada ("lido em 11 de outubro").
  const vozesLidas = await vozesDoSetor(nicho.id);
  const vozesDoPublico = vozesParaOPrompt(vozesLidas?.vozes ?? null, { pedidos: false });
  const lidasEm = vozesLidas && vozesDoPublico.length > 0 ? diaPorExtenso(vozesLidas.em) : undefined;
  const sistemaEstavel = temasDoDiaIA.montarSistemaEstavel({
    modeloNicho: formatarModeloNicho(modeloNicho?.modelo ?? null),
  });
  const dadosEntrada = {
    subindoHoje: subindo,
    semDono,
    noticias: noticiasRelevantes.map((n) => ({ id: n.id, titulo: n.titulo, resumo: n.resumo ?? "" })),
    vozesDoPublico,
    lidasEm,
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
    vozes: vozesDoPublico,
  };

  // Sem como existir prova de vídeo (menos de 3 vídeos, ou todos de uma conta só), as duas chamadas de vídeo seriam gasto à toa (todo tema seria barrado), e o dia vai direto para a notícia.
  const temVideo = provaDeVideoEhPossivel(subindo, semDono.length);
  let primeira: Awaited<ReturnType<typeof filtrarTemasComProva>> = { temasComProva: [], temasSemProva: 0, barrados: [] };
  if (temVideo) {
    let tentativa = await tentarGerarTemas(parametrosTentativa);
    if (!tentativa.valido) {
      tentativa = await tentarGerarTemas(parametrosTentativa);
      if (!tentativa.valido) {
        throw new Error("tema sem evidencia valida depois de refazer a chamada uma vez");
      }
    }
    primeira = await filtrarTemasComProva(tentativa.temas, nicho, new Date(), regua.proporcaoBrasil);
  }
  let temasComProva = primeira.temasComProva;
  let temasSemProva = primeira.temasSemProva;

  /**
   * Hotfix de 02/10/2026: tema barrado na prova deixava o setor com menos de três temas, ou sem
   * nenhum (Overtake e o perfil do Bruno em 02/10), sem segunda chance. Agora o gerador recebe de
   * volta o que foi barrado e por quê, e refaz uma vez; os temas com prova das duas tentativas se
   * somam, até três. Só refaz quando existe vídeo na lista (tema só de notícia nunca tem prova, e
   * refazer não mudaria isso).
   */
  if (temVideo && temasComProva.length < TEMAS_POR_DIA) {
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

  /**
   * Hotfix de 23/10/2026: o que a prova de vídeo não fechou é completado com temas ancorados numa notícia relevante recente do setor. A vaga do tema do momento (E55) que já está na linha
   * do dia não é tomada: o dia fecha três ao todo. Só o que sobrar sem notícia que sirva fica vazio (último recurso: menos de três, e a tela diz isso com calma).
   */
  // Só o tema do momento que ainda vale (o assunto segue na lista de agora) ocupa vaga: o que já saiu da lista é tirado logo depois por `atualizarTemaDoMomento`, e contá-lo deixaria o dia com dois.
  const existentesQueValem = existente ? await temasQueAindaValemAgora(existente.temas) : [];
  const vagasDeNoticia = TEMAS_POR_DIA - existentesQueValem.filter((t) => t.doMomento).length - temasComProva.length;
  let deNoticia = 0;
  if (vagasDeNoticia > 0) {
    const daNoticia = await completarComNoticias({
      nicho,
      sistemaEstavel,
      noticias: noticiasParaCompletar,
      jaTem: temasComProva,
      vagas: vagasDeNoticia,
    });
    deNoticia = daNoticia.length;
    temasComProva = [...temasComProva, ...daNoticia];
    temasSemProva = Math.max(0, temasSemProva - deNoticia);
  }
  const noticiaMaisNovaGravada = noticiasParaCompletar.reduce<number | null>((maior, n) => (maior === null || n.id > maior ? n.id : maior), null);

  if (temasComProva.length === 0) {
    /**
     * M5b, item 3: marca a tentativa (nunca por cima de um dia que já tinha tema de verdade; essa
     * defesa é só por segurança, porque o `existente` já buscado acima teria desviado para
     * "sem_novidade" antes de chegar aqui quando havia um tema real e nenhum vídeo novo).
     */
    if (!existente || semOMomento(existente.temas).length === 0) {
      // E55: o tema do momento que já estava na linha do dia continua (só os temas de verdade ficam vazios).
      const momentoQueJaEstava = existente ? existente.temas.filter((t) => t.doMomento) : [];
      await db()
        .insert(temasDia)
        .values({
          nichoId: nicho.id,
          data: hojeISO(),
          temas: momentoQueJaEstava,
          candidatosNaUltimaTentativa: candidatosAgora,
          noticiaMaisNovaNaTentativa: noticiaMaisNovaGravada,
        })
        .onConflictDoUpdate({
          target: [temasDia.nichoId, temasDia.data],
          set: { temas: momentoQueJaEstava, candidatosNaUltimaTentativa: candidatosAgora, noticiaMaisNovaNaTentativa: noticiaMaisNovaGravada },
        });
    }
    return { status: "sem_prova", temasSemProva, deNoticia: 0 };
  }

  if (!(await podeSobrescreverTemasDoDia(nicho.id, temasComProva))) {
    return { status: "mantido", temasSemProva, deNoticia: 0 };
  }

  const temasDaLinha = comOMomentoQueJaEstava(temasComProva, existentesQueValem);
  await db()
    .insert(temasDia)
    .values({ nichoId: nicho.id, data: hojeISO(), temas: temasDaLinha, noticiaMaisNovaNaTentativa: noticiaMaisNovaGravada })
    .onConflictDoUpdate({
      target: [temasDia.nichoId, temasDia.data],
      set: { temas: temasDaLinha, noticiaMaisNovaNaTentativa: noticiaMaisNovaGravada },
    });

  return { status: "gerado", temasSemProva, deNoticia };
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
/**
 * Há quantos dias, no máximo, alguém com acesso a uma marca do setor pode ficar sem abrir o aplicativo para o setor continuar ganhando tema de madrugada. Decisão do Gustavo em
 * 27/10/2026: conta acesso ao aplicativo (`clientes.ultimoAcessoEm`, gravado pelo layout do painel uma vez por dia por qualquer pessoa com acesso), não roteiro gerado, e a janela
 * passou de 3 para 5 dias (05/10/2026 era "roteiro em 3 dias"; quem lê o tema mas ainda não gerou roteiro estava sendo tratado como parado).
 */
export const DIAS_DE_USO_PARA_TEMA = 5;

/** A frase do resumo da rotina quando um setor fica sem tema por falta de uso (o cartão de Rotinas a mostra em língua de gente). */
export const MOTIVO_SEM_USO = "sem tema hoje: ninguém abriu o aplicativo em 5 dias";

/**
 * Os setores "em uso": os que têm ao menos uma marca ATIVA que alguém abriu nos últimos `DIAS_DE_USO_PARA_TEMA` dias (a marca conta pelo ramo principal e pelos alternativos que o
 * admin ligou). Só esses ganham tema novo de madrugada (o tema é o item mais caro do dia e ninguém lê o de um setor que ninguém abre); a coleta, a transcrição, a extração e o modelo
 * do setor continuam todos os dias, porque a base não pode envelhecer. Quem abre os temas ou o Criar num setor sem tema gera na hora (`opts.aoAbrir`, `pedirTemaDeHoje`).
 */
export async function setoresEmUso(agora: Date = new Date()): Promise<Set<number>> {
  return (await setoresEmUsoComContagem(agora)).setores;
}

/**
 * Os setores em uso e quantas marcas ficaram de fora por falta de assinatura (E22 PR 3). Com a cobrança ligada, a marca sem assinatura que vale e sem cortesia não conta para pôr o
 * setor "em uso": o setor só entra com ao menos uma marca que não precisa assinar. Com a cobrança desligada, é exatamente o critério de sempre.
 */
export async function setoresEmUsoComContagem(agora: Date = new Date()): Promise<{ setores: Set<number>; marcasPuladasPorAssinatura: number; idsDasMarcasPuladas: number[] }> {
  const desde = new Date(agora.getTime() - DIAS_DE_USO_PARA_TEMA * 24 * 60 * 60 * 1000);
  // Acesso ao aplicativo da marca inteira: qualquer pessoa com acesso que abriu o painel (a visita do admin no "ver como" não grava, `layout.tsx`).
  const marcasComAcesso = db().select({ clienteId: clientes.id }).from(clientes).where(gte(clientes.ultimoAcessoEm, desde));
  const principais = await db()
    .selectDistinct({ id: clientes.id, nichoId: clientes.nichoId })
    .from(clientes)
    .where(and(eq(clientes.ativo, true), isNotNull(clientes.nichoId), inArray(clientes.id, marcasComAcesso)));
  const alternativos = await db()
    .selectDistinct({ id: clientes.id, nichoId: ramosDaConta.nichoId })
    .from(ramosDaConta)
    .innerJoin(clientes, eq(clientes.id, ramosDaConta.clienteId))
    .where(and(eq(clientes.ativo, true), inArray(clientes.id, marcasComAcesso)));
  const { liberadas, puladas } = await separarMarcasPorAssinatura([...principais, ...alternativos].map((l) => l.id), { agora });
  const setores = new Set([...principais, ...alternativos].filter((l) => liberadas.has(l.id)).map((l) => l.nichoId).filter((id): id is number => id !== null));
  return { setores, marcasPuladasPorAssinatura: puladas.length, idsDasMarcasPuladas: puladas };
}

export async function rodarTemasDoDia(
  nichoId?: number,
  opts?: { forcar?: boolean; aoAbrir?: boolean },
): Promise<Record<string, unknown>> {
  if (nichoId !== undefined && !opts?.forcar) {
    const [existente] = await db()
      .select({ temas: temasDia.temas })
      .from(temasDia)
      .where(and(eq(temasDia.nichoId, nichoId), eq(temasDia.data, hojeISO())));
    if (existente && semOMomento(existente.temas).length > 0) {
      return {
        nichos: 1,
        gerados: 0,
        mantidos: 0,
        semEvidencia: 0,
        semProva: 0,
        semNovidade: 0,
        temasSemProva: 0,
        deNoticia: 0,
        falhas: 0,
        jaTinhaTemaHoje: true,
      };
    }
  }

  const condicoes = [eq(nichos.ativo, true)];
  if (nichoId !== undefined) condicoes.push(eq(nichos.id, nichoId));
  const todosAtivos = await db()
    .select()
    .from(nichos)
    .where(and(...condicoes));
  // Só a rodada da madrugada (e o tema imediato que a cadeia da análise enfileira) respeita o uso; quem pediu à mão (`forcar`) ou quem abriu a tela (`aoAbrir`) tem tema na hora.
  const respeitaUso = !opts?.forcar && !opts?.aoAbrir;
  const uso = respeitaUso ? await setoresEmUsoComContagem() : null;
  const emUso = uso?.setores ?? null;
  const marcasPuladasPorAssinatura = uso?.marcasPuladasPorAssinatura ?? 0;
  registrarMarcasPuladas("temas-do-dia", marcasPuladasPorAssinatura);
  const nichosAtivos = emUso ? todosAtivos.filter((n) => emUso.has(n.id)) : todosAtivos;
  const semUso = todosAtivos.length - nichosAtivos.length;

  let gerados = 0;
  let mantidos = 0;
  let semEvidencia = 0;
  let semProva = 0;
  let semNovidade = 0;
  let temasSemProva = 0;
  let deNoticia = 0;
  let falhas = 0;
  const erros: string[] = [];
  const temasDoMomento: Record<string, number> = {};

  for (const nicho of nichosAtivos) {
    try {
      const resultado = await gerarTemasDoNicho(nicho);
      // E55: depois dos temas do dia, o tema do momento (tira o que saiu da lista de tendências e, sem um, tenta criar). Falha dele nunca derruba os temas.
      try {
        const momento = await atualizarTemaDoMomento(nicho);
        temasDoMomento[momento] = (temasDoMomento[momento] ?? 0) + 1;
      } catch (erro) {
        erros.push(`tema do momento do nicho "${nicho.slug}": ${erro instanceof Error ? erro.message : String(erro)}`);
      }
      temasSemProva += resultado.temasSemProva;
      deNoticia += resultado.deNoticia;
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
    // Hotfix de 23/10/2026: quantos temas do dia nasceram de notícia (completam o que a prova de vídeo não fechou).
    deNoticia,
    falhas,
    // Os setores que ficaram sem tema novo por falta de uso (ninguém abriu o aplicativo em 5 dias): o admin vê quantos em Rotinas.
    semUso,
    ...resumoDasMarcasPuladas(marcasPuladasPorAssinatura),
    temasDoMomento,
    motivoSemUso: semUso > 0 ? MOTIVO_SEM_USO : undefined,
    erros: erros.length > 0 ? erros : undefined,
  };
}
