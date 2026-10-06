/**
 * O que `/criar/temas` e `/criar/tema-livre` precisam (etapa 10, decisões 3,
 * 4 e 5 do `PROXIMO.md`; E39a: migrado de `/hoje`, a agenda não escolhe
 * tema): os temas do dia com a regra de estabilidade e o aviso da linha
 * editorial, e a nota em cinco pilares de um tema livre.
 */
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  avaliacoesTema,
  nichos,
  rascunhosTemaLivre,
  roteiros,
  temasDia,
  type Cliente,
  type Objetivo,
  type TemaDoDia,
} from "@/db/schema";
import * as avaliarTemaIA from "@/ia/prompts/avaliarTema";
import { gerarComVerificacao } from "@/ia/verificador";
import { boss, existeJobPendente, FILAS, garantirBossPronto } from "@/jobs/fila";
import { hojeISO } from "@/lib/config";
import { logger } from "@/lib/log";
import { evidenciaParaTema, formatarModeloNicho, modeloNichoAtual, reguaDoSetor } from "@/servicos/pesquisa";
import { buscarVideosParaProva, janelaDeProva, temaTemProvaSuficiente, type RegraDoSetor } from "@/servicos/prova-tema";
import { ramosAlternativosDaMarca } from "@/servicos/ramos-da-conta";

import { regrasAtivasDoCliente } from "./aprendizado";
import { formatarPerfilCompilado, perfilDoCliente } from "./briefing";
import { filtroDeFormatosDaMarca } from "./formatos";
import { avisoLinhaEditorial, fraseAvisoLinhaEditorial } from "./linha-editorial";
import { noticiasQueTocamOTema } from "./noticias-do-tema";

export class ErroTemas extends Error {}

const JANELA_LINHA_EDITORIAL = 15;
const STATUS_GRAVADO_OU_POSTADO: ("gravado" | "postado")[] = ["gravado", "postado"];
const DIAS_REGRA_ESTABILIDADE = 3;
const DIA_MS = 24 * 60 * 60 * 1000;

function diasAtrasISO(dias: number, base = new Date()): string {
  return hojeISO(new Date(base.getTime() - dias * DIA_MS));
}

/**
 * Subtrai dias de uma data "AAAA-MM-DD" em espaço de calendario puro (UTC),
 * sem passar por `Date.now()`: usado por `temasDoDiaOuRecente` para a regra
 * de estabilidade valer tambem para uma data arbitraria (nao so "agora"),
 * sem risco de fuso horario deslocar o dia (`diasAtrasISO` acima resolve
 * pelo relogio real, correto para `constanciaDoCliente`, mas erraria aqui).
 */
function diasAtrasIsoDe(dataBase: string, dias: number): string {
  const [ano, mes, dia] = dataBase.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  data.setUTCDate(data.getUTCDate() - dias);
  return data.toISOString().slice(0, 10);
}

async function historicoDeObjetivos(clienteId: number): Promise<Objetivo[]> {
  const linhas = await db()
    .select({ objetivo: roteiros.objetivo, data: roteiros.data })
    .from(roteiros)
    .where(and(eq(roteiros.clienteId, clienteId), inArray(roteiros.status, STATUS_GRAVADO_OU_POSTADO)))
    .orderBy(desc(roteiros.data), desc(roteiros.criadoEm))
    .limit(JANELA_LINHA_EDITORIAL);

  return linhas.map((l) => l.objetivo);
}

export type Constancia = { tipo: "primeiro_dia" } | { tipo: "seguidos"; dias: number } | { tipo: "parado"; dias: number };

/**
 * Dias seguidos gravando, ou há quantos dias o cliente não grava, a partir
 * das datas de `roteiros` gravados ou postados. `roteiros` só passa a ser
 * preenchida na etapa 11; até lá (e para todo cliente novo) o caso é
 * sempre "primeiro_dia".
 */
export async function constanciaDoCliente(clienteId: number): Promise<Constancia> {
  const linhas = await db()
    .select({ data: roteiros.data })
    .from(roteiros)
    .where(and(eq(roteiros.clienteId, clienteId), inArray(roteiros.status, STATUS_GRAVADO_OU_POSTADO)))
    .orderBy(desc(roteiros.data));

  if (linhas.length === 0) return { tipo: "primeiro_dia" };

  const diasUnicos = [...new Set(linhas.map((l) => l.data))].sort().reverse();
  const hoje = hojeISO();
  const ontem = diasAtrasISO(1);

  if (diasUnicos[0] !== hoje && diasUnicos[0] !== ontem) {
    const dias = Math.round((Date.now() - new Date(`${diasUnicos[0]}T00:00:00Z`).getTime()) / DIA_MS);
    return { tipo: "parado", dias };
  }

  let seguidos = 1;
  for (let i = 1; i < diasUnicos.length; i += 1) {
    const atual = new Date(`${diasUnicos[i - 1]}T00:00:00Z`).getTime();
    const anterior = new Date(`${diasUnicos[i]}T00:00:00Z`).getTime();
    if (Math.round((atual - anterior) / DIA_MS) === 1) {
      seguidos += 1;
    } else {
      break;
    }
  }
  return { tipo: "seguidos", dias: seguidos };
}

/** V12, item 1: os três estados do dia na semana do Hoje; "postou" vale mais que "gravou" no mesmo dia. */
export type EstadoDia = "gravou" | "postou" | "nada";

export type ResumoHistorico = {
  diasSeguidos: number;
  gravadosNoMes: number;
  postadosNoMes: number;
  /** Um por dia, dos últimos 30 (mais antigo primeiro, hoje por último). */
  ultimos30Dias: boolean[];
  /**
   * V12, item 1: os últimos 7 dias com os três estados (gravou, postou,
   * nada), para "sua semana" no topo do Hoje (design v2, `Hoje.dc.html`,
   * `.legenda-semana`). `ultimos30Dias` continua como está, para
   * `/historico` (regra 6 do `PROXIMO.md`: o que não muda).
   */
  ultimos7DiasEstado: EstadoDia[];
};

const DIAS_JANELA_HISTORICO = 35;

/**
 * O topo de `/historico` (etapa 12, decisão 3 do `PROXIMO.md`): dias
 * seguidos reusa `constanciaDoCliente` (0 quando o cliente está parado ou é
 * o primeiro dia); gravados e postados no mês e a linha de 30 dias vêm de
 * `gravadoEm`/`postadoEm` (quando aconteceu de verdade), não de `data` (o
 * dia do tema, que pode ser diferente do dia em que gravou).
 */
export async function resumoHistorico(clienteId: number): Promise<ResumoHistorico> {
  const constancia = await constanciaDoCliente(clienteId);
  const diasSeguidos = constancia.tipo === "seguidos" ? constancia.dias : 0;

  const linhas = await db()
    .select({ gravadoEm: roteiros.gravadoEm, postadoEm: roteiros.postadoEm })
    .from(roteiros)
    .where(and(eq(roteiros.clienteId, clienteId), gte(roteiros.data, diasAtrasISO(DIAS_JANELA_HISTORICO))));

  const mesAtual = hojeISO().slice(0, 7);
  const gravadosNoMes = linhas.filter((l) => l.gravadoEm && hojeISO(l.gravadoEm).slice(0, 7) === mesAtual).length;
  const postadosNoMes = linhas.filter((l) => l.postadoEm && hojeISO(l.postadoEm).slice(0, 7) === mesAtual).length;

  const diasGravados = new Set(
    linhas.filter((l): l is typeof l & { gravadoEm: Date } => l.gravadoEm !== null).map((l) => hojeISO(l.gravadoEm)),
  );
  const ultimos30Dias = Array.from({ length: 30 }, (_, i) => diasGravados.has(diasAtrasISO(29 - i)));

  const diasPostados = new Set(
    linhas.filter((l): l is typeof l & { postadoEm: Date } => l.postadoEm !== null).map((l) => hojeISO(l.postadoEm)),
  );
  const ultimos7DiasEstado: EstadoDia[] = Array.from({ length: 7 }, (_, i) => {
    const dia = diasAtrasISO(6 - i);
    if (diasPostados.has(dia)) return "postou";
    if (diasGravados.has(dia)) return "gravou";
    return "nada";
  });

  return { diasSeguidos, gravadosNoMes, postadosNoMes, ultimos30Dias, ultimos7DiasEstado };
}

/**
 * Exportada para `lembrete.ts` usar a mesma regra de estabilidade de
 * `/hoje` (etapa 13, ajuste 1 da revisão da parte 2 do `PROXIMO.md`): o
 * lembrete não pode ficar mais estrito que a tela para a qual ele manda a
 * pessoa. Antes disso o job usava uma checagem estrita, só de hoje
 * (`temaDeHojeExisteParaNicho`, removida), e um nicho cuja coleta de hoje
 * falhasse deixava de mandar o lembrete mesmo com o tema de ontem ainda
 * valendo em `/hoje`.
 */
export async function temasDoDiaOuRecente(
  nichoId: number,
  data: string,
): Promise<{ temas: TemaDoDia[]; dataUsada: string } | null> {
  const [linha] = await db()
    .select({ data: temasDia.data, temas: temasDia.temas })
    .from(temasDia)
    .where(
      and(
        eq(temasDia.nichoId, nichoId),
        gte(temasDia.data, diasAtrasIsoDe(data, DIAS_REGRA_ESTABILIDADE)),
        lte(temasDia.data, data),
        // M5b, item 3 (revisão do Fable no PR #101): a linha vazia é só a marca de "tentou hoje e
        // ficou sem prova" do `temas-do-dia`; nunca pode esconder o tema de ontem, que continua
        // valendo em `/hoje` e no lembrete.
        sql`jsonb_array_length(${temasDia.temas}) > 0`,
      ),
    )
    .orderBy(desc(temasDia.data))
    .limit(1);

  if (!linha) return null;
  return { temas: linha.temas, dataUsada: linha.data };
}

/**
 * Quem abre o Criar num setor sem tema de hoje (o tema de madrugada só sai para setor em uso, decisão do Gustavo de 05/10/2026) faz o tema nascer na hora, pelo mesmo caminho do tema
 * imediato da M1: enfileira `temas-do-dia` para o setor, com `aoAbrir` (que não respeita o critério de uso). Devolve "gerando" quando há um pedido em andamento (a tela espera e
 * se atualiza) e "nao" quando nada foi pedido: o setor já tentou hoje (existe a linha do dia, inclusive a vazia que marca "ficou sem prova"), ou a fila não respondeu.
 * No máximo um pedido por setor a cada 10 minutos, para uma tela que se atualiza sozinha nunca encher a fila.
 */
export async function pedirTemaDeHoje(nichoId: number, data: string = hojeISO()): Promise<"gerando" | "nao"> {
  const [jaTentou] = await db().select({ id: temasDia.id }).from(temasDia).where(and(eq(temasDia.nichoId, nichoId), eq(temasDia.data, data)));
  if (jaTentou) return "nao";
  try {
    await garantirBossPronto();
    if (await existeJobPendente(FILAS.temasDoDia, nichoId)) return "gerando";
    const id = await boss().send(FILAS.temasDoDia, { nichoId, aoAbrir: true }, { singletonKey: `tema-ao-abrir-${nichoId}`, singletonSeconds: 600 });
    return id === null ? "nao" : "gerando";
  } catch (erro) {
    logger.error({ err: erro, nichoId }, "nao foi possivel pedir o tema de hoje ao abrir a tela");
    return "nao";
  }
}

export type ResultadoTemasHoje =
  | { status: "sem_tema"; constancia: Constancia }
  | {
      status: "ok";
      temas: TemaDoDia[];
      dataUsada: string;
      avisoLinhaEditorial: string | null;
      /**
       * O objetivo que a linha editorial recomenda hoje (etapa 11,
       * `ObjetivoFluxo.dc.html`, "Recomendado hoje"), quando há aviso.
       * `null` sem aviso, mesmo que o tema não tenha sido reordenado.
       */
      objetivoRecomendado: Objetivo | null;
      constancia: Constancia;
    };

/**
 * Temas do dia para o cliente ver em `/hoje` (etapa 10, decisões 3 e 4 do
 * `PROXIMO.md`): regra de estabilidade (a data pedida, ou o mais recente
 * dos últimos 3 dias antes dela) e o aviso da linha editorial, que reordena
 * o primeiro tema para o que puxa para o objetivo em falta quando um dos
 * três serve. `data` é opcional (hoje por padrão); existe para permitir ver
 * o que o cliente veria num dia específico (ex.: o admin auditando), sem
 * depender do relógio real no caminho comum.
 */
export async function temasParaCliente(cliente: Cliente, data: string = hojeISO()): Promise<ResultadoTemasHoje> {
  const constancia = await constanciaDoCliente(cliente.id);

  if (!cliente.nichoId) return { status: "sem_tema", constancia };

  const [encontrado, historico] = await Promise.all([
    temasDoDiaOuRecente(cliente.nichoId, data),
    historicoDeObjetivos(cliente.id),
  ]);

  if (!encontrado) return { status: "sem_tema", constancia };

  const aviso = avisoLinhaEditorial(historico, cliente.persona);
  if (!aviso) {
    return {
      status: "ok",
      temas: encontrado.temas,
      dataUsada: encontrado.dataUsada,
      avisoLinhaEditorial: null,
      objetivoRecomendado: null,
      constancia,
    };
  }

  const indice = encontrado.temas.findIndex((t) => t.puxaPara === aviso.objetivoEmFalta);
  const existeTemaQuePuxa = indice !== -1;
  const temas =
    indice > 0 ? [encontrado.temas[indice], ...encontrado.temas.filter((_, i) => i !== indice)] : encontrado.temas;

  return {
    status: "ok",
    temas,
    dataUsada: encontrado.dataUsada,
    avisoLinhaEditorial: fraseAvisoLinhaEditorial(aviso, existeTemaQuePuxa),
    objetivoRecomendado: aviso.objetivoEmFalta,
    constancia,
  };
}

/** Campos de texto livre da avaliação, para o verificador (regra dura da própria tarefa: sem jargão, emoji, travessão). */
function extrairCamposAvaliarTema(dados: avaliarTemaIA.SaidaAvaliarTema): Record<string, string> {
  return {
    recomendacao: dados.recomendacao,
    anguloSugerido: dados.anguloSugerido ?? "",
    justificativaViralizar: dados.pilares.viralizar.justificativa,
    justificativaGerarCliente: dados.pilares.gerarCliente.justificativa,
    justificativaEncaixe: dados.pilares.encaixe.justificativa,
    justificativaNovidade: dados.pilares.novidade.justificativa,
    justificativaFacilidade: dados.pilares.facilidade.justificativa,
  };
}

/**
 * O rascunho de `/criar/tema-livre` (V5b, item 2; ajuste do item 0 da V6,
 * resto da revisão do PR #50): uma linha por pessoa e por marca, sem
 * prazo. `salvarRascunhoTemaLivre` faz upsert (o índice único `usuarioId`
 * + `clienteId` decide), ou apaga a linha quando o texto fica vazio. Não
 * some mais quando a avaliação termina com sucesso: na viagem, com rede
 * ruim, quem recebe uma nota abaixo da meta, sai e volta precisa achar o
 * texto lá (decisão do Fable, `entregaveis/design-v2/BRIEF.md`, Tema
 * livre, ponto 3). Só some quando a pessoa avalia outro assunto (o
 * salvamento automático já substitui o texto guardado) ou apaga o campo.
 */
export async function salvarRascunhoTemaLivre(usuarioId: string, clienteId: number, texto: string): Promise<void> {
  if (texto.trim() === "") {
    await apagarRascunhoTemaLivre(usuarioId, clienteId);
    return;
  }
  await db()
    .insert(rascunhosTemaLivre)
    .values({ usuarioId, clienteId, texto, atualizadoEm: new Date() })
    .onConflictDoUpdate({
      target: [rascunhosTemaLivre.usuarioId, rascunhosTemaLivre.clienteId],
      set: { texto, atualizadoEm: new Date() },
    });
}

export async function rascunhoTemaLivre(usuarioId: string, clienteId: number): Promise<string | null> {
  const [linha] = await db()
    .select({ texto: rascunhosTemaLivre.texto })
    .from(rascunhosTemaLivre)
    .where(and(eq(rascunhosTemaLivre.usuarioId, usuarioId), eq(rascunhosTemaLivre.clienteId, clienteId)));
  return linha?.texto ?? null;
}

export async function apagarRascunhoTemaLivre(usuarioId: string, clienteId: number): Promise<void> {
  await db()
    .delete(rascunhosTemaLivre)
    .where(and(eq(rascunhosTemaLivre.usuarioId, usuarioId), eq(rascunhosTemaLivre.clienteId, clienteId)));
}

/**
 * `SaidaAvaliarTema` mais `anguloTemProva` (V5b, item 4): se `anguloSugerido`
 * vale a pena mostrar. Calculado por código, nunca pela IA (mesma régua da
 * V2b, item 8, que os três temas do dia já usam: `temaTemProvaSuficiente`,
 * `prova-tema.ts`), sobre `dados.evidencias`, os ids que de fato sustentam
 * esta avaliação. Sem prova suficiente, a tela mostra só "seguir com o meu
 * mesmo assim", nunca o ângulo (regra do `PROXIMO.md`: nada de número ou
 * recomendação sem evidência de verdade por trás).
 */
export type ResultadoAvaliarTema = avaliarTemaIA.SaidaAvaliarTema & {
  nota: number;
  anguloTemProva: boolean;
  /** E45 PR 3: o nome do ramo alternativo que mais casou com o assunto, quando não é o principal; nulo é o ramo principal (ou nenhuma prova). */
  ramoDoAssunto: string | null;
};

/**
 * Achado 8 da revisão do motor (01/10/2026): média simples dos cinco pilares, calculada aqui em
 * vez de pedir para o modelo somar e dividir por 5 (uma conta simples demais para arriscar errar,
 * e código nunca erra uma média). Mesmos cinco pilares de `avaliarTemaIA.schema`.
 */
function mediaCincoPilares(pilares: avaliarTemaIA.SaidaAvaliarTema["pilares"]): number {
  const notas = [
    pilares.viralizar.nota,
    pilares.gerarCliente.nota,
    pilares.encaixe.nota,
    pilares.novidade.nota,
    pilares.facilidade.nota,
  ];
  return notas.reduce((soma, nota) => soma + nota, 0) / notas.length;
}

/**
 * Nota em cinco pilares de um tema proposto pelo cliente (etapa 10, decisão
 * 5 do `PROXIMO.md`): evidência do banco, perfil compilado e modelo do
 * nicho no bloco estável, e o resultado gravado em `avaliacoes_tema`.
 *
 * Passa por `gerarComVerificacao` desde a revisão do PR #17 (ajuste 1 da
 * etapa 12): antes chamava `gerarEstruturado` direto, sem nenhuma checagem
 * local, a mesma classe de lacuna que deixou o roteiro citar evidência
 * inventada. `evidenciasFornecidas` sempre vai (mesmo vazia): a evidência
 * nunca é obrigatória aqui (sem evidência é um resultado válido, com nota
 * baixa no pilar "viralizar"), mas nenhum id fora do que foi fornecido pode
 * ser citado.
 */
export async function avaliarTema(
  cliente: Cliente,
  texto: string,
  /** E43: já resolvida por quem chama (a ação sabe o `clienteId`, então confere o setor dela ao buscar). */
  noticia?: { titulo: string; resumo: string | null; angulo: string | null },
): Promise<ResultadoAvaliarTema> {
  if (!cliente.nichoId) {
    throw new ErroTemas("este cliente ainda nao tem um nicho definido.");
  }

  const perfil = await perfilDoCliente(cliente.id);
  if (!perfil) {
    throw new ErroTemas("o briefing deste cliente ainda nao foi compilado.");
  }

  // E45 PR 3: o tema livre olha o ramo principal e os alternativos que o admin ligou (o modelo do nicho continua sendo o do principal).
  const alternativosDaMarca = await ramosAlternativosDaMarca(cliente.id);
  const [evidencias, modeloNicho, regrasCliente, [nicho]] = await Promise.all([
    evidenciaParaTema(
      cliente.nichoId,
      texto,
      undefined,
      undefined,
      alternativosDaMarca.map((a) => a.nichoId),
      await filtroDeFormatosDaMarca(cliente.id),
    ),
    modeloNichoAtual(cliente.nichoId),
    regrasAtivasDoCliente(cliente.id),
    db().select({ criadoEm: nichos.criadoEm }).from(nichos).where(eq(nichos.id, cliente.nichoId)),
  ]);

  const nomesDosAlternativos = new Map(alternativosDaMarca.map((a) => [a.nichoId, a.nome]));
  // O sinal de momento: as notícias de hoje (setor e assuntos da marca) que tocam o tema. O banco de vídeos só cobre o setor; ausência dele não é sinal contra o assunto.
  const noticiasDoDia = await noticiasQueTocamOTema(cliente, texto);

  const { dados } = await gerarComVerificacao({
    tarefa: "avaliarTema",
    nivel: avaliarTemaIA.nivel,
    effort: avaliarTemaIA.esforco,
    versaoPrompt: avaliarTemaIA.versao,
    clienteId: cliente.id,
    schema: avaliarTemaIA.schema,
    sistemaEstavel: avaliarTemaIA.montarSistemaEstavel({
      perfilCompilado: formatarPerfilCompilado(perfil),
      modeloNicho: formatarModeloNicho(modeloNicho?.modelo ?? null),
      persona: cliente.persona,
      regrasCliente,
    }),
    entrada: avaliarTemaIA.montarEntrada({
      tema: texto,
      evidencias: evidencias.map((v) => ({ ...v, ramo: nomesDosAlternativos.get(v.nichoId ?? -1) })),
      noticia,
      noticiasDoDia,
    }),
    // Achado 11 da revisão do motor (01/10/2026): garante o lembrete de acentuação por último
    // mesmo na segunda tentativa (mesmo raciocínio de `servicos/roteiro.ts`).
    lembreteFinal: avaliarTemaIA.LEMBRETE_ACENTUACAO,
    proibicoes: perfil.fatos.proibicoes,
    exigeEvidencia: false,
    evidenciasFornecidas: evidencias.map((v) => v.id),
    // Achado do Gustavo (06/10/2026): nenhum id de vídeo solto no texto, e sempre "você".
    semIdInterno: true,
    soSegundaPessoa: true,
    // A recomendação traz instrução de gravação de propósito (29/09/2026, `verificarTexto.ts`, gênero "tema").
    generoTexto: "tema",
    extrairCampos: extrairCamposAvaliarTema,
    extrairEvidencias: (d) => d.evidencias,
  });

  const nota = mediaCincoPilares(dados.pilares);

  await db()
    .insert(avaliacoesTema)
    .values({
      clienteId: cliente.id,
      tema: texto,
      pilares: dados.pilares,
      nota: String(nota),
      recomendacao: dados.recomendacao,
      anguloSugerido: dados.anguloSugerido,
      evidencias: dados.evidencias,
    });

  let anguloTemProva = false;
  if (dados.anguloSugerido && dados.evidencias.length > 0 && nicho) {
    const agora = new Date();
    const videosPorId = await buscarVideosParaProva(dados.evidencias);
    const regua = await reguaDoSetor(cliente.nichoId);
    // E45 PR 3, item 0b: a janela e a proporção do Brasil são as do setor de cada vídeo citado (o principal e cada ramo alternativo).
    const regrasPorSetor = new Map<number, RegraDoSetor>([[cliente.nichoId, { janelaDias: janelaDeProva(nicho.criadoEm, agora), proporcaoBrasil: regua.proporcaoBrasil }]]);
    for (const alternativo of alternativosDaMarca) {
      const [setor] = await db().select({ criadoEm: nichos.criadoEm }).from(nichos).where(eq(nichos.id, alternativo.nichoId));
      const reguaAlt = await reguaDoSetor(alternativo.nichoId);
      regrasPorSetor.set(alternativo.nichoId, {
        janelaDias: setor ? janelaDeProva(setor.criadoEm, agora) : janelaDeProva(nicho.criadoEm, agora),
        proporcaoBrasil: reguaAlt.proporcaoBrasil,
      });
    }
    anguloTemProva = temaTemProvaSuficiente(
      dados.evidencias,
      videosPorId,
      agora,
      janelaDeProva(nicho.criadoEm, agora),
      regua.proporcaoBrasil,
      regrasPorSetor,
    );
  }

  return { ...dados, nota, anguloTemProva, ramoDoAssunto: ramoQueMaisCasou(dados.evidencias, evidencias, nomesDosAlternativos) };
}

/**
 * E45 PR 3: o ramo do assunto de um tema livre é o setor com mais vídeos entre os que a nota citou. Só devolve o nome quando esse setor é um
 * ramo alternativo da marca (empate vai para o principal, que não precisa ser dito); sem vídeo citado, nulo.
 */
export function ramoQueMaisCasou(
  idsCitados: number[],
  evidencias: { id: number; nichoId: number | null }[],
  nomesDosAlternativos: Map<number, string>,
): string | null {
  const citados = evidencias.filter((v) => idsCitados.includes(v.id));
  if (citados.length === 0 || nomesDosAlternativos.size === 0) return null;
  const contagem = new Map<number | null, number>();
  for (const v of citados) contagem.set(v.nichoId, (contagem.get(v.nichoId) ?? 0) + 1);
  const doPrincipal = [...contagem.entries()].filter(([id]) => id === null || !nomesDosAlternativos.has(id)).reduce((soma, [, n]) => soma + n, 0);
  let melhor: { nome: string; n: number } | null = null;
  for (const [id, n] of contagem) {
    const nome = id === null ? undefined : nomesDosAlternativos.get(id);
    if (nome && n > doPrincipal && (!melhor || n > melhor.n)) melhor = { nome, n };
  }
  return melhor?.nome ?? null;
}
