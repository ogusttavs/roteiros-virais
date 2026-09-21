/**
 * O que a tela `/hoje` e `/hoje/tema-livre` precisam (etapa 10, decisões 3,
 * 4 e 5 do `PROXIMO.md`): os temas do dia com a regra de estabilidade e o
 * aviso da linha editorial, e a nota em cinco pilares de um tema livre.
 */
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";

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
import { hojeISO } from "@/lib/config";
import { evidenciaParaTema, formatarModeloNicho, modeloNichoAtual } from "@/servicos/pesquisa";
import { buscarVideosParaProva, janelaDeProva, temaTemProvaSuficiente } from "@/servicos/prova-tema";

import { regrasAtivasDoCliente } from "./aprendizado";
import { formatarPerfilCompilado, perfilDoCliente } from "./briefing";
import { avisoLinhaEditorial, fraseAvisoLinhaEditorial } from "./linha-editorial";

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

export type ResumoHistorico = {
  diasSeguidos: number;
  gravadosNoMes: number;
  postadosNoMes: number;
  /** Um por dia, dos últimos 30 (mais antigo primeiro, hoje por último). */
  ultimos30Dias: boolean[];
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

  return { diasSeguidos, gravadosNoMes, postadosNoMes, ultimos30Dias };
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
      ),
    )
    .orderBy(desc(temasDia.data))
    .limit(1);

  if (!linha) return null;
  return { temas: linha.temas, dataUsada: linha.data };
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
 * O rascunho de `/hoje/tema-livre` (V5b, item 2; ajuste do item 0 da V6,
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
export type ResultadoAvaliarTema = avaliarTemaIA.SaidaAvaliarTema & { anguloTemProva: boolean };

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
export async function avaliarTema(cliente: Cliente, texto: string): Promise<ResultadoAvaliarTema> {
  if (!cliente.nichoId) {
    throw new ErroTemas("este cliente ainda nao tem um nicho definido.");
  }

  const perfil = await perfilDoCliente(cliente.id);
  if (!perfil) {
    throw new ErroTemas("o briefing deste cliente ainda nao foi compilado.");
  }

  const [evidencias, modeloNicho, regrasCliente, [nicho]] = await Promise.all([
    evidenciaParaTema(cliente.nichoId, texto),
    modeloNichoAtual(cliente.nichoId),
    regrasAtivasDoCliente(cliente.id),
    db().select({ criadoEm: nichos.criadoEm }).from(nichos).where(eq(nichos.id, cliente.nichoId)),
  ]);

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
    entrada: avaliarTemaIA.montarEntrada({ tema: texto, evidencias }),
    proibicoes: perfil.fatos.proibicoes,
    exigeEvidencia: false,
    evidenciasFornecidas: evidencias.map((v) => v.id),
    extrairCampos: extrairCamposAvaliarTema,
    extrairEvidencias: (d) => d.evidencias,
  });

  await db()
    .insert(avaliacoesTema)
    .values({
      clienteId: cliente.id,
      tema: texto,
      pilares: dados.pilares,
      nota: String(dados.nota),
      recomendacao: dados.recomendacao,
      anguloSugerido: dados.anguloSugerido,
      evidencias: dados.evidencias,
    });

  let anguloTemProva = false;
  if (dados.anguloSugerido && dados.evidencias.length > 0 && nicho) {
    const agora = new Date();
    const videosPorId = await buscarVideosParaProva(dados.evidencias);
    anguloTemProva = temaTemProvaSuficiente(dados.evidencias, videosPorId, agora, janelaDeProva(nicho.criadoEm, agora));
  }

  return { ...dados, anguloTemProva };
}
