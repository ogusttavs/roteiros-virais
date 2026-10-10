/**
 * As versões do roteiro (E26, o 4b do corte; passo 23 do Opus): a pessoa escolhe o tema e o objetivo e recebe três jeitos de gravar o mesmo tema, cada um com três notas de um juiz separado, lê
 * cada um inteiro e fica com um. "Gerar outra" escreve mais uma, uma por vez, até o teto de segurança do dia. Só "Ficar com esta" cria o roteiro de verdade.
 *
 * As versões moram em `versoes_do_roteiro`, não em `roteiros` (ver o comentário da tabela): enquanto ninguém escolheu, elas não existem para a agenda, o Histórico, o lembrete nem a curva. A
 * linha guardada é a MESMA que `gerarRoteiro` gravaria (`montarRoteiro`), então escolher é copiar, sem gerar nada de novo.
 *
 * As versões são escritas uma depois da outra, cada uma recebendo o gancho e a abertura das anteriores como "roteiros recentes" (o mecanismo que o roteiro já usa para não repetir vício), e
 * cada nota sai de uma chamada própria no modelo barato, com a mesma rubrica para todas (`ia/prompts/notaDaVersao.ts`, decisão do Fable em 10/10/2026).
 */
import { randomUUID } from "node:crypto";

import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { roteiros, versoesDoRoteiro, type ConteudoRoteiro, type Ficha, type NotasDaVersao, type Objetivo, type VersaoDoRoteiro } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as notaIA from "@/ia/prompts/notaDaVersao";
import { registrarGeracao } from "@/ia/registro";
import { config, hojeISO } from "@/lib/config";
import { logger } from "@/lib/log";
import { EMOJI, encontrarProblemas } from "@/lib/regras-de-texto";
import { textosHoje } from "@/textos/hoje";
import { textosRoteiro } from "@/textos/roteiro";

import { formatarPerfilCompilado, perfilDoCliente } from "./briefing";
import { clientePorId } from "./clientes";
import { temposDosBlocosReels } from "./folha-do-roteiro";
import { inicioDoDiaEmSaoPaulo } from "./noticias-do-dia";
import {
  blocosParaLeitura,
  ErroRoteiro,
  montarRoteiro,
  resolverTemaDoPedido,
  type ParametrosGerarRoteiro,
  type RoteiroLinha,
  type TemaResolvido,
  type ValoresDoRoteiro,
  type VersaoJaEscrita,
} from "./roteiro";

/** Quantas versões a primeira geração escreve. */
export const VERSOES_POR_GERACAO = 3;

/**
 * O que a linha guarda do pedido (`parametros`): o pedido como veio e o tema JÁ resolvido uma vez. "Gerar outra" reusa o tema resolvido em vez de resolver de novo: um tema sugerido é um
 * índice na lista do dia, e a lista muda (de ordem, de dia, de assunto em alta) entre uma versão e a seguinte, e "outra versão" tem de ser do mesmo tema.
 */
export type ParametrosDaVersao = { pedido: ParametrosGerarRoteiro; tema: TemaResolvido };

/** Uma versão como a tela a lê: o roteiro inteiro (`conteudo`), as notas e se já virou roteiro. */
export type VersaoDoGrupo = {
  id: number;
  grupo: string;
  ordem: number;
  tema: string;
  objetivo: Objetivo;
  /** A ficha do "para que é este vídeo" (só Reels falado); nula no Story e no sem fala. */
  ficha: Ficha | null;
  formato: string;
  estilo: string;
  conteudo: ConteudoRoteiro;
  notas: NotasDaVersao | null;
  escolhida: boolean;
  roteiroId: number | null;
  criadoEm: Date;
};

function paraVersaoDoGrupo(linha: VersaoDoRoteiro): VersaoDoGrupo {
  const valores = linha.valores as unknown as ValoresDoRoteiro;
  return {
    id: linha.id,
    grupo: linha.grupo,
    ordem: linha.ordem,
    tema: valores.tema,
    objetivo: valores.objetivo,
    ficha: valores.ficha ?? null,
    formato: valores.formato ?? "reels",
    estilo: valores.estilo ?? "falado",
    conteudo: valores.conteudo,
    notas: linha.notas,
    escolhida: linha.roteiroId !== null,
    roteiroId: linha.roteiroId,
    criadoEm: linha.criadoEm,
  };
}

/** Um bloco do roteiro como a tela de comparar o lê: o tempo ("0 a 3 s", só no Reels falado), o nome do bloco e as linhas (a fala; sem fala, o que mostrar). */
export type BlocoDaVersao = { tempo: string | null; rotulo: string; linhas: string[] };

/** Uma versão como o cliente da tela recebe: sem nada de banco, só o que se desenha. */
export type VersaoParaTela = {
  id: number;
  ordem: number;
  /** O título do roteiro: é o nome da versão na tela. */
  nome: string;
  duracaoS: number;
  notas: NotasDaVersao | null;
  /** Sem nota, mas escrita há pouco: o juiz ainda está trabalhando (a tela diz "a nota está sendo calculada", não "não deu"). */
  notaEmAndamento: boolean;
  blocos: BlocoDaVersao[];
  /** Quando a pessoa já ficou com esta versão: o roteiro em que ela virou. */
  roteiroId: number | null;
};

function blocosDaVersao(v: VersaoDoGrupo): BlocoDaVersao[] {
  const formato = v.formato === "story" ? "story" : "reels";
  const estilo = v.estilo === "sem_fala" ? "sem_fala" : "falado";
  const blocos = blocosParaLeitura({ conteudo: v.conteudo, formato, estilo });
  const tempos = formato === "reels" && estilo === "falado" ? temposDosBlocosReels(v.conteudo.duracaoS) : null;
  return blocos.map((bloco, i) => ({
    tempo: tempos?.[i] ?? null,
    rotulo: bloco.rotulo,
    // Reels sem fala não tem fala: o que a pessoa lê é o que mostrar, e o que está na tela.
    linhas: bloco.paragrafos.length > 0 ? bloco.paragrafos : (bloco.mostrar ?? []),
  }));
}

export function paraVersaoDaTela(v: VersaoDoGrupo, agora = new Date()): VersaoParaTela {
  return {
    id: v.id,
    ordem: v.ordem,
    nome: v.conteudo.titulo,
    duracaoS: v.conteudo.duracaoS,
    notas: v.notas,
    notaEmAndamento: v.notas === null && agora.getTime() - v.criadoEm.getTime() < MINUTOS_DA_NOTA_EM_ANDAMENTO * 60_000,
    blocos: blocosDaVersao(v),
    roteiroId: v.roteiroId,
  };
}

/** As três notas de uma versão, pelo nome que a tela usa. */
export type ChaveDaNota = "viralizar" | "chamarem" | "lembrarem";

/** Qual das três notas é a do objetivo que a pessoa escolheu (o "te chamem" é a de te chamarem, "lembrem de você" a de lembrarem, "mais gente te conheça" a de viralizar). */
export function chaveDaNotaDoObjetivo(objetivo: Objetivo): ChaveDaNota {
  if (objetivo === "conversao") return "chamarem";
  if (objetivo === "engajamento") return "lembrarem";
  return "viralizar";
}

/** A nota do objetivo escolhido: a que ordena a lista. */
export function notaDoObjetivo(notas: NotasDaVersao, objetivo: Objetivo): number {
  return notas[chaveDaNotaDoObjetivo(objetivo)];
}

/**
 * A ordem da comparação (decisão da revisão do desenho, E26): pela nota do objetivo escolhido, do maior para o menor; empate pela média das três; empate de novo pela ordem em que foram
 * escritas. Versão sem nota (o juiz falhou) vai depois das que têm, pela ordem de escrita. Devolve uma cópia.
 */
export function ordenarVersoes(versoes: VersaoDoGrupo[], objetivo: Objetivo): VersaoDoGrupo[] {
  // Duas casas: a soma em ponto flutuante depende da ordem das parcelas, e o empate "de verdade" pede o mesmo número.
  const media = (n: NotasDaVersao) => Math.round(((n.viralizar + n.chamarem + n.lembrarem) / 3) * 100) / 100;
  return [...versoes].sort((a, b) => {
    if (a.notas && !b.notas) return -1;
    if (!a.notas && b.notas) return 1;
    if (a.notas && b.notas) {
      const porObjetivo = notaDoObjetivo(b.notas, objetivo) - notaDoObjetivo(a.notas, objetivo);
      if (porObjetivo !== 0) return porObjetivo;
      const porMedia = media(b.notas) - media(a.notas);
      if (porMedia !== 0) return porMedia;
    }
    return a.ordem - b.ordem;
  });
}

/**
 * O teto de segurança do dia (`ROTEIROS_POR_DIA_MAX`, 20 por padrão): só contra laço ou abuso. A pessoa não vê contador nenhum; quem chega nele lê uma frase própria. Conta as versões escritas
 * hoje (no fuso de São Paulo) por esta marca, e recusa antes de gastar qualquer chamada. É um teto macio: conta o que já foi gravado, então pedidos simultâneos passam juntos pela mesma
 * checagem e uma geração que falha não entra na conta; serve para o uso normal repetido, não para abuso concorrente.
 */
async function exigirFolgaDoDia(clienteId: number, quantidade: number): Promise<void> {
  const [{ total }] = await db()
    .select({ total: sql<number>`count(*)::int` })
    .from(versoesDoRoteiro)
    .where(and(eq(versoesDoRoteiro.clienteId, clienteId), gte(versoesDoRoteiro.criadoEm, inicioDoDiaEmSaoPaulo(new Date()))));
  if (total + quantidade > config.regras.roteirosPorDiaMax) throw new ErroRoteiro(textosRoteiro.versoes.tetoDoDia);
}

/** O gancho que a próxima versão não deve repetir: o falado em Reels; em Story e vídeo sem fala, o que o primeiro cartão diz, ou o texto que ele põe na tela, ou, por fim, o título. */
function ganchoDaVersao(conteudo: ConteudoRoteiro): string {
  if (conteudo.gancho.trim()) return conteudo.gancho;
  const cartoes = conteudo.cartoes ?? [];
  return cartoes.find((c) => c.oQueFalar.trim())?.oQueFalar ?? cartoes.find((c) => c.textoNaTela.trim())?.textoNaTela ?? conteudo.titulo;
}

/**
 * As duas frases do juiz vão para a tela do cliente sem passar pelo verificador do roteiro, então a regra de texto do projeto é aplicada aqui: travessão vira vírgula, emoji sai, e uma frase
 * com jargão é descartada (a tela mostra a versão sem a frase em vez de mostrar uma frase errada).
 */
function limparFrase(frase: string): string {
  const limpa = frase
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(new RegExp(EMOJI.source, "gu"), "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return encontrarProblemas(limpa).length > 0 ? "" : limpa;
}

function jaEscrita(valores: ValoresDoRoteiro): VersaoJaEscrita {
  return { tema: valores.tema, objetivo: valores.objetivo, gancho: ganchoDaVersao(valores.conteudo), tipoAbertura: valores.tipoAbertura ?? null };
}

/**
 * As três notas de uma versão, pelo juiz separado (modelo barato, a mesma rubrica para todas). Nunca derruba a geração: sem perfil compilado ou com erro da IA devolve `null`, e a versão
 * fica sem nota (a tela a mostra assim e a ordena pela ordem em que foi escrita).
 */
async function julgarVersao(clienteId: number, valores: ValoresDoRoteiro): Promise<NotasDaVersao | null> {
  try {
    const cliente = await clientePorId(clienteId);
    const perfil = await perfilDoCliente(clienteId);
    if (!cliente || !perfil) return null;
    const conteudo = valores.conteudo;
    const inicio = Date.now();
    const saida = await gerarEstruturado({
      tarefa: "notaDaVersao",
      nivel: notaIA.nivel,
      effort: notaIA.esforco,
      schema: notaIA.schema,
      sistemaEstavel: notaIA.montarSistemaEstavel({ perfilCompilado: formatarPerfilCompilado(perfil) }),
      entrada:
        notaIA.montarEntrada({
          tema: valores.tema,
          objetivo: valores.objetivo,
          persona: cliente.persona,
          formato: valores.formato === "story" ? "story" : "reels",
          estilo: valores.estilo === "sem_fala" ? "sem_fala" : "falado",
          duracaoS: conteudo.duracaoS,
          titulo: conteudo.titulo,
          gancho: conteudo.gancho,
          corpo: conteudo.corpo,
          fechamento: conteudo.fechamento,
          chamadaFinal: conteudo.chamadaFinal,
          cartoes: conteudo.cartoes,
          legenda: conteudo.legenda ?? null,
        }) + `\n\n${notaIA.LEMBRETE_ACENTUACAO}`,
    });
    // O registro é do custo e da auditoria: se ele falhar, a nota que já foi paga não se perde.
    try {
      await registrarGeracao({
        tarefa: "notaDaVersao",
        versaoPrompt: notaIA.versao,
        modelo: saida.modelo,
        nivel: notaIA.nivel,
        clienteId,
        entradas: { tema: valores.tema, objetivo: valores.objetivo },
        saida: saida.dados,
        uso: {
          tokensEntrada: saida.tokensEntrada,
          tokensSaida: saida.tokensSaida,
          tokensCacheLeitura: saida.tokensCacheLeitura,
          tokensCacheEscrita: saida.tokensCacheEscrita,
        },
        duracaoMs: Date.now() - inicio,
      });
    } catch (erro) {
      logger.warn({ err: erro, clienteId }, "nao foi possivel registrar a nota da versao do roteiro");
    }
    return { ...saida.dados, fraseDoObjetivo: limparFrase(saida.dados.fraseDoObjetivo), jeitoDiferente: limparFrase(saida.dados.jeitoDiferente) };
  } catch (erro) {
    logger.warn({ err: erro, clienteId }, "nao foi possivel julgar a versao do roteiro");
    return null;
  }
}

function ehViolacaoDeUnico(erro: unknown): boolean {
  const e = erro as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/**
 * Grava a versão. Sem `ordemFixa` (o "Gerar outra"), a ordem é a seguinte à maior do grupo NA HORA de gravar, não na de começar a gerar: dois "Gerar outra" ao mesmo tempo escrevem as
 * duas, em ordens seguidas, em vez de uma delas bater no índice único depois de gastar a geração.
 */
async function inserirVersao(clienteId: number, grupo: string, parametros: ParametrosDaVersao, valores: ValoresDoRoteiro, ordemFixa?: number): Promise<VersaoDoRoteiro> {
  for (let tentativa = 0; ; tentativa += 1) {
    let ordem = ordemFixa;
    if (ordem === undefined) {
      const [{ maior }] = await db()
        .select({ maior: sql<number>`coalesce(max(${versoesDoRoteiro.ordem}), 0)::int` })
        .from(versoesDoRoteiro)
        .where(and(eq(versoesDoRoteiro.clienteId, clienteId), eq(versoesDoRoteiro.grupo, grupo)));
      ordem = maior + 1;
    }
    try {
      const [linha] = await db()
        .insert(versoesDoRoteiro)
        .values({ clienteId, grupo, ordem, parametros: parametros as unknown as Record<string, unknown>, valores: valores as unknown as Record<string, unknown> })
        .returning();
      return linha;
    } catch (erro) {
      if (ordemFixa !== undefined || !ehViolacaoDeUnico(erro) || tentativa >= 4) throw erro;
    }
  }
}

async function escreverUmaVersao(
  clienteId: number,
  grupo: string,
  parametros: ParametrosDaVersao,
  jaEscritas: VersaoJaEscrita[],
  ordemFixa?: number,
): Promise<VersaoDoRoteiro> {
  const valores = await montarRoteiro(clienteId, parametros.pedido, { versoesDoMesmoTema: jaEscritas, temaResolvido: parametros.tema });
  return inserirVersao(clienteId, grupo, parametros, valores, ordemFixa);
}

/** Grava as notas. Nunca rejeita: a nota é um enfeite da comparação, e a geração (já paga) não cai por causa dela. */
async function gravarNotas(versaoId: number, notas: NotasDaVersao | null): Promise<void> {
  if (!notas) return;
  try {
    await db().update(versoesDoRoteiro).set({ notas }).where(eq(versoesDoRoteiro.id, versaoId));
  } catch (erro) {
    logger.warn({ err: erro, versaoId }, "nao foi possivel gravar as notas da versao do roteiro");
  }
}

/**
 * Escreve as versões de um tema (três, a primeira vez). Uma depois da outra, cada uma sabendo o gancho e a abertura das anteriores; cada versão é gravada assim que fica pronta (quem sai
 * da tela na espera as encontra depois) e as notas correm em paralelo com a escrita da seguinte. Se a primeira falha, o erro sobe (nada foi gravado); se uma das seguintes falha, o grupo
 * fica com as que deram certo.
 */
export async function gerarVersoes(clienteId: number, params: ParametrosGerarRoteiro, quantidade = VERSOES_POR_GERACAO): Promise<{ grupo: string; versoes: VersaoDoGrupo[] }> {
  await exigirFolgaDoDia(clienteId, quantidade);

  // O tema se resolve uma vez: as três versões (e as de "Gerar outra" depois) são do mesmo tema, mesmo que a lista do dia mude no meio.
  const parametros: ParametrosDaVersao = { pedido: params, tema: await resolverTemaDoPedido(clienteId, params) };
  const grupo = randomUUID();
  const jaEscritas: VersaoJaEscrita[] = [];
  const notasEmAndamento: Promise<void>[] = [];

  for (let ordem = 1; ordem <= quantidade; ordem += 1) {
    try {
      const linha = await escreverUmaVersao(clienteId, grupo, parametros, jaEscritas, ordem);
      const valores = linha.valores as unknown as ValoresDoRoteiro;
      jaEscritas.push(jaEscrita(valores));
      notasEmAndamento.push(julgarVersao(clienteId, valores).then((notas) => gravarNotas(linha.id, notas)));
    } catch (erro) {
      if (ordem === 1) throw erro;
      logger.warn({ err: erro, clienteId, grupo, ordem }, "uma das versoes do roteiro nao ficou pronta; o grupo segue com as outras");
      break;
    }
  }
  await Promise.all(notasEmAndamento);
  return { grupo, versoes: await versoesDoGrupo(clienteId, grupo) };
}

/**
 * "Gerar outra" (sem limite na tela; o teto de segurança do dia só aparece para quem chega nele): mais uma versão do mesmo grupo, com o mesmo pedido da primeira, sabendo o gancho e a
 * abertura de todas as que já existem. Devolve só a nova; a tela a põe no fim, marcada "Nova".
 */
export async function gerarOutraVersao(clienteId: number, grupo: string): Promise<VersaoDoGrupo> {
  const existentes = await db()
    .select()
    .from(versoesDoRoteiro)
    .where(and(eq(versoesDoRoteiro.clienteId, clienteId), eq(versoesDoRoteiro.grupo, grupo)))
    .orderBy(asc(versoesDoRoteiro.ordem));
  if (existentes.length === 0) throw new ErroRoteiro(textosRoteiro.versoes.naoEncontrada);
  await exigirFolgaDoDia(clienteId, 1);

  const parametros = existentes[0].parametros as unknown as ParametrosDaVersao;
  // O assunto em alta é do dia em que foi visto (a mesma regra de planejar para outro dia): um grupo de ontem não escreve mais uma versão de um assunto de ontem.
  if (parametros.tema.doMomento && existentes[0].criadoEm < inicioDoDiaEmSaoPaulo(new Date())) throw new ErroRoteiro(textosHoje.emAlta.naoMudaDeDia);
  const jaEscritas = existentes.map((e) => jaEscrita(e.valores as unknown as ValoresDoRoteiro));
  const linha = await escreverUmaVersao(clienteId, grupo, parametros, jaEscritas);
  const notas = await julgarVersao(clienteId, linha.valores as unknown as ValoresDoRoteiro);
  await gravarNotas(linha.id, notas);
  return paraVersaoDoGrupo({ ...linha, notas });
}

/** O pedido que escreveu o grupo (o tema e o resto como vieram), escopado pela marca; nulo quando o grupo não é desta marca. */
export async function pedidoDoGrupo(clienteId: number, grupo: string): Promise<ParametrosGerarRoteiro | null> {
  const [linha] = await db()
    .select({ parametros: versoesDoRoteiro.parametros })
    .from(versoesDoRoteiro)
    .where(and(eq(versoesDoRoteiro.clienteId, clienteId), eq(versoesDoRoteiro.grupo, grupo)))
    .orderBy(asc(versoesDoRoteiro.ordem))
    .limit(1);
  return linha ? (linha.parametros as unknown as ParametrosDaVersao).pedido : null;
}

/**
 * Para onde "Trocar o objetivo" leva: a tela do objetivo com o mesmo tema (e a notícia, o assunto em alta e o dia, quando havia). Um tema do dia volta pelo índice, ou pela chave quando era um
 * assunto em alta (a lista do dia muda); o que a tela do objetivo não sabe reconstruir volta ao Criar.
 */
export function enderecoParaTrocarOObjetivo(pedido: ParametrosGerarRoteiro, grupo: { tema: string; criadoEm: Date }): string {
  const consulta = new URLSearchParams();
  if (pedido.origem === "livre") {
    consulta.set("livre", pedido.textoTema);
    if (pedido.assuntoEmAlta) consulta.set("alta", pedido.assuntoEmAlta);
    if (pedido.noticiaId) consulta.set("noticiaId", String(pedido.noticiaId));
    if (pedido.noticiaAssuntoId) consulta.set("noticiaAssuntoId", String(pedido.noticiaAssuntoId));
  } else if (pedido.origem === "sugerido") {
    if (pedido.temaChave) consulta.set("momento", pedido.temaChave);
    // O índice é o da lista do dia em que o grupo foi escrito: de outro dia, ele apontaria para outro tema, e o tema é que a pessoa quer de volta.
    else if (hojeISO(grupo.criadoEm) === hojeISO()) consulta.set("tema", String(pedido.temaIndice));
    else consulta.set("livre", grupo.tema);
  } else {
    return "/criar";
  }
  // Um dia que já passou não volta (a tela do objetivo recusa data no passado).
  if (pedido.data && pedido.data >= hojeISO()) consulta.set("data", pedido.data);
  return `/criar/objetivo?${consulta.toString()}`;
}

/** As versões de um grupo, na ordem em que foram escritas; escopadas pela marca (o grupo de outra marca nunca vem). */
export async function versoesDoGrupo(clienteId: number, grupo: string): Promise<VersaoDoGrupo[]> {
  const linhas = await db()
    .select()
    .from(versoesDoRoteiro)
    .where(and(eq(versoesDoRoteiro.clienteId, clienteId), eq(versoesDoRoteiro.grupo, grupo)))
    .orderBy(asc(versoesDoRoteiro.ordem));
  return linhas.map(paraVersaoDoGrupo);
}

/**
 * O grupo de versões de que um roteiro nasceu ("Ficar com esta"), com quantas versões ele tem: para o roteiro dizer que as outras continuam guardadas e levar de volta a elas. Nulo quando o
 * roteiro não veio de uma comparação (momento, plano, os de antes das versões). Escopado pela marca.
 */
export async function grupoDoRoteiro(clienteId: number, roteiroId: number): Promise<{ grupo: string; total: number } | null> {
  const [origem] = await db()
    .select({ grupo: versoesDoRoteiro.grupo })
    .from(versoesDoRoteiro)
    .where(and(eq(versoesDoRoteiro.clienteId, clienteId), eq(versoesDoRoteiro.roteiroId, roteiroId)))
    .limit(1);
  if (!origem) return null;
  const [{ total }] = await db()
    .select({ total: sql<number>`count(*)::int` })
    .from(versoesDoRoteiro)
    .where(and(eq(versoesDoRoteiro.clienteId, clienteId), eq(versoesDoRoteiro.grupo, origem.grupo)));
  return { grupo: origem.grupo, total };
}

/**
 * O grupo de versões que a pessoa pediu e ainda não resolveu, com o que o Hoje e a recuperação precisam: o tema, o pedido e se ainda está sendo escrito. Sem depender de a tela que pediu
 * ainda estar aberta.
 */
export type GrupoEmAberto = {
  grupo: string;
  tema: string;
  objetivo: Objetivo;
  ficha: Ficha | null;
  formato: string;
  estilo: string;
  quantidade: number;
  /** Quando a primeira versão ficou pronta (o começo do grupo). */
  inicio: Date;
  /** Ainda faltam versões e a última é de agora: o servidor continua escrevendo (uma geração que falhou no meio deixa de ser "em escrita" depois de alguns minutos). */
  emEscrita: boolean;
};

/** Janela dentro da qual um grupo ainda é "em aberto" para o Hoje: o dia em que foi escrito e o seguinte (quem gerou à noite escolhe de manhã). */
const DIAS_DO_GRUPO_EM_ABERTO = 2;
/** Depois de quanto tempo sem uma versão nova um grupo incompleto deixa de ser dado como "ainda escrevendo" (a segunda versão falhou: o grupo ficou com as que deram certo). */
const MINUTOS_DE_UM_GRUPO_EM_ESCRITA = 5;
/** Quanto tempo a nota de uma versão pode estar a caminho (o juiz roda enquanto a seguinte é escrita): passado isso, a versão sem nota é "o juiz falhou". */
const MINUTOS_DA_NOTA_EM_ANDAMENTO = 4;

/**
 * O grupo mais novo da marca, se a pessoa ainda não ficou com nenhuma versão dele (os mais velhos, não resolvidos, foram abandonados: quem pediu outro tema ou trocou o objetivo não precisa
 * vê-los de volta). Conta pelo grupo inteiro, não pela janela: um grupo resolvido que ganhou "Gerar outra" depois não volta como aberto. `agora` só existe para os testes.
 */
export async function grupoEmAberto(clienteId: number, agora = new Date()): Promise<GrupoEmAberto | null> {
  const desde = new Date(agora.getTime() - DIAS_DO_GRUPO_EM_ABERTO * 86_400_000);
  const [novo] = await db()
    .select({
      grupo: versoesDoRoteiro.grupo,
      inicio: sql<Date>`min(${versoesDoRoteiro.criadoEm})`,
      fim: sql<Date>`max(${versoesDoRoteiro.criadoEm})`,
      total: sql<number>`count(*)::int`,
      resolvido: sql<boolean>`bool_or(${versoesDoRoteiro.roteiroId} is not null)`,
    })
    .from(versoesDoRoteiro)
    .where(eq(versoesDoRoteiro.clienteId, clienteId))
    .groupBy(versoesDoRoteiro.grupo)
    .having(sql`min(${versoesDoRoteiro.criadoEm}) >= ${desde}`)
    .orderBy(sql`min(${versoesDoRoteiro.criadoEm}) desc`)
    .limit(1);
  if (!novo || novo.resolvido) return null;

  const [primeira] = await db()
    .select()
    .from(versoesDoRoteiro)
    .where(and(eq(versoesDoRoteiro.clienteId, clienteId), eq(versoesDoRoteiro.grupo, novo.grupo)))
    .orderBy(asc(versoesDoRoteiro.ordem))
    .limit(1);
  const base = paraVersaoDoGrupo(primeira);
  const fim = new Date(novo.fim);
  return {
    grupo: novo.grupo,
    tema: base.tema,
    objetivo: base.objetivo,
    ficha: base.ficha,
    formato: base.formato,
    estilo: base.estilo,
    quantidade: novo.total,
    inicio: new Date(novo.inicio),
    emEscrita: novo.total < VERSOES_POR_GERACAO && agora.getTime() - fim.getTime() < MINUTOS_DE_UM_GRUPO_EM_ESCRITA * 60_000,
  };
}

export type ResumoDaFaxinaDeVersoes = {
  /** Os grupos de que alguma versão saiu. */
  gruposLimpos: number;
  /** As versões apagadas (as que ninguém escolheu, de grupos parados há mais de `dias` dias). */
  versoesApagadas: number;
  /** As versões que viraram roteiro e ficam (o link do roteiro para as outras já não tem o que mostrar, mas o roteiro continua inteiro). */
  versoesMantidasPorEscolha: number;
  dias: number;
};

/**
 * A faxina diária das versões (E26 4c): o grupo cuja última versão tem mais de `dias` dias (padrão 30) perde as versões que ninguém escolheu, sejam de um grupo resolvido ou abandonado
 * ("Gerar outra" depois de um tempo adia o grupo inteiro, porque conta a versão mais nova). A versão que virou roteiro fica: é a linha que liga o roteiro ao grupo, e é pequena. Quando
 * o roteiro dela é apagado (a chave estrangeira volta nula), a versão passa a ser "sem escolha" e sai na faxina seguinte. Uma só consulta de apagar, escopo global (todas as marcas).
 */
export async function faxinarVersoes(agora = new Date(), dias = config.regras.diasDasVersoesGuardadas): Promise<ResumoDaFaxinaDeVersoes> {
  const limite = new Date(agora.getTime() - dias * 86_400_000);
  const gruposParados = sql`(select grupo from versoes_do_roteiro group by grupo having max(criado_em) < ${limite})`;

  const apagadas = await db()
    .delete(versoesDoRoteiro)
    .where(and(isNull(versoesDoRoteiro.roteiroId), sql`${versoesDoRoteiro.grupo} in ${gruposParados}`))
    .returning({ grupo: versoesDoRoteiro.grupo });
  const [{ mantidas }] = await db()
    .select({ mantidas: sql<number>`count(*)::int` })
    .from(versoesDoRoteiro)
    .where(sql`${versoesDoRoteiro.roteiroId} is not null and ${versoesDoRoteiro.grupo} in ${gruposParados}`);

  return { gruposLimpos: new Set(apagadas.map((a) => a.grupo)).size, versoesApagadas: apagadas.length, versoesMantidasPorEscolha: mantidas, dias };
}

/**
 * "Ficar com esta": a versão vira o roteiro (a linha de `roteiros` é a que já estava pronta, copiada). Vale uma vez só por versão: escolher de novo devolve o mesmo roteiro, e dois pedidos
 * ao mesmo tempo criam um roteiro só (o primeiro reivindica a versão, o outro lê o resultado). As outras versões do grupo continuam guardadas, para "ver as outras versões", e a pessoa pode
 * ficar com mais de uma (cada uma vira o seu roteiro, como um outro ângulo do mesmo tema). Se o roteiro de uma versão for apagado depois, a versão volta a poder ser escolhida.
 */
export async function ficarComVersao(clienteId: number, versaoId: number): Promise<RoteiroLinha> {
  const [versao] = await db()
    .select()
    .from(versoesDoRoteiro)
    .where(and(eq(versoesDoRoteiro.id, versaoId), eq(versoesDoRoteiro.clienteId, clienteId)));
  if (!versao) throw new ErroRoteiro(textosRoteiro.versoes.naoEncontrada);

  const jaVirou = async (roteiroId: number | null): Promise<RoteiroLinha | null> => {
    if (roteiroId === null) return null;
    const [roteiro] = await db().select().from(roteiros).where(and(eq(roteiros.id, roteiroId), eq(roteiros.clienteId, clienteId)));
    return roteiro ?? null;
  };
  const existente = await jaVirou(versao.roteiroId);
  if (existente) return existente;

  return db().transaction(async (tx) => {
    // Reivindica a versão: só um dos pedidos simultâneos passa daqui. A reivindicação e o `roteiroId` gravam na mesma transação, então "sem roteiro" é "ninguém escolheu" (ou o roteiro foi
    // apagado depois), nunca "alguém está no meio".
    const [reivindicada] = await tx
      .update(versoesDoRoteiro)
      .set({ escolhidaEm: new Date() })
      .where(and(eq(versoesDoRoteiro.id, versaoId), eq(versoesDoRoteiro.clienteId, clienteId), isNull(versoesDoRoteiro.roteiroId)))
      .returning();
    if (!reivindicada) {
      const [atual] = await tx.select().from(versoesDoRoteiro).where(eq(versoesDoRoteiro.id, versaoId));
      const feito = atual?.roteiroId ? await jaVirou(atual.roteiroId) : null;
      if (feito) return feito;
      throw new ErroRoteiro(textosRoteiro.versoes.jaSendoEscolhida);
    }
    // O dia do roteiro é o do pedido quando é um dia planejado que ainda não passou; senão é hoje, na hora de escolher (quem gerou à noite e escolheu de manhã grava o roteiro de hoje, e um
    // dia que já passou não volta a ser "atrasado" por ter ficado esperando).
    const pedido = (versao.parametros as unknown as ParametrosDaVersao).pedido;
    const dia = pedido.data && pedido.data >= hojeISO() ? pedido.data : hojeISO();
    const [roteiro] = await tx
      .insert(roteiros)
      .values({ clienteId, ...(versao.valores as unknown as ValoresDoRoteiro), data: dia })
      .returning();
    await tx.update(versoesDoRoteiro).set({ roteiroId: roteiro.id }).where(eq(versoesDoRoteiro.id, versaoId));
    return roteiro;
  });
}
