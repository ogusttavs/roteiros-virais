/**
 * "Acompanhar um assunto" que sugere enquanto a pessoa digita (melhoria da E53, pedido do Gustavo em 23/10/2026). Aqui moram os dois caminhos que não são o catálogo:
 *
 *  1. O que está em alta no Brasil agora (E55, `tendencias_brasil`), mostrado como "em alta agora" com as palavras de busca que a própria coleta já guardou (`assuntosEmAltaParaAcompanhar`).
 *     Sem custo: é leitura do banco. Assunto delicado (tragédia, morte, política partidária) não é oferecido aqui; ele continua acompanhável pelo catálogo ("Eleições") ou digitado.
 *  2. O assunto que não está no catálogo: o modelo barato propõe de 3 a 6 palavras de busca (`sugerirPalavrasDoAssunto`), a pessoa aceita ou edita. Custo de centavos por pedido, com
 *     cache pelo texto do assunto (90 dias, de nenhuma marca em particular) e teto por marca por dia. Toda chamada passa por `gerarEstruturado` e fica em `geracoes_ia`.
 */
import { and, count, eq, gte } from "drizzle-orm";

import { db } from "@/db";
import { geracoesIA, sugestoesDePalavras, type TendenciaBrasil } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import { ErroIA } from "@/ia/erro";
import * as sugerirIA from "@/ia/prompts/sugerirPalavrasDoAssunto";
import { registrarGeracao } from "@/ia/registro";
import { logger } from "@/lib/log";
import { EMOJI } from "@/lib/regras-de-texto";

import { normalizarTexto } from "./noticias-assuntos";
import { inicioDoDiaEmSaoPaulo } from "./noticias-do-dia";

/** Quanto tempo as palavras sugeridas para um assunto valem antes de pedir ao modelo de novo. */
export const DIAS_DO_CACHE_DE_PALAVRAS = 90;
/** Quantos pedidos NOVOS ao modelo uma marca faz por dia (pedido que acha o cache não conta): segura quem aperta o botão em repetição. */
export const PEDIDOS_DE_PALAVRAS_POR_MARCA_POR_DIA = 20;
/** O mais que uma sugestão devolve (a folha aceita até 7 palavras, e o assunto também conta). */
export const MAXIMO_DE_PALAVRAS_SUGERIDAS = 6;
const LIMITE_DA_PALAVRA = 40;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Erro nomeado; a frase que a pessoa lê vem de `textosNoticias`, escolhida pelo `motivo` (a Server Action faz isso). */
export class ErroSugestaoDePalavras extends Error {
  constructor(
    mensagem: string,
    readonly motivo: "assunto_curto" | "limite_do_dia" | "ia_fora" | "sem_palavras",
  ) {
    super(mensagem);
    this.name = "ErroSugestaoDePalavras";
  }
}

/** Palavras largas demais: trariam qualquer notícia, então não valem como palavra de busca sozinhas. */
const GERAIS_DEMAIS = new Set(["noticia", "noticias", "hoje", "brasil", "ultimas noticias", "agora", "ao vivo", "assunto", "tudo"]);

/**
 * Deixa só o que serve de palavra de busca: sem aspas, hashtag, travessão nem emoji; com os espaços juntos; de 2 a 40 letras; sem as largas demais e sem repetir (sem acento e sem
 * maiúscula). No máximo `MAXIMO_DE_PALAVRAS_SUGERIDAS`, na ordem em que vieram.
 */
export function limparPalavrasSugeridas(brutas: readonly string[]): string[] {
  const vistas = new Set<string>();
  const limpas: string[] = [];
  for (const bruta of brutas) {
    const palavra = bruta
      .replace(/[\u2013\u2014]/g, " ")
      .replace(/["“”'‘’`#<>]/g, "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (palavra.length < 2 || palavra.length > LIMITE_DA_PALAVRA || EMOJI.test(palavra)) continue;
    const chave = normalizarTexto(palavra);
    if (chave.length < 2 || GERAIS_DEMAIS.has(chave) || vistas.has(chave)) continue;
    vistas.add(chave);
    limpas.push(palavra);
    if (limpas.length >= MAXIMO_DE_PALAVRAS_SUGERIDAS) break;
  }
  return limpas;
}

/** O assunto como a pessoa escreveu, com os espaços juntos; nulo quando é curto demais ou comprido demais para ser um assunto. */
export function assuntoLimpo(textoDigitado: string): string | null {
  const texto = textoDigitado.trim().replace(/\s+/g, " ");
  return texto.length >= 2 && texto.length <= 60 ? texto : null;
}

export type ResultadoDaSugestao = { palavras: string[]; doCache: boolean };

/**
 * As palavras de busca para um assunto que a pessoa escreveu. Acha o cache pelo texto; senão confere o teto do dia da marca, pede ao modelo barato, registra a geração e guarda o cache.
 * Quem chama (a Server Action) já conferiu a sessão, o "ver como" e a assinatura.
 */
export async function sugerirPalavrasDoAssunto(clienteId: number, textoDigitado: string, agora: Date = new Date()): Promise<ResultadoDaSugestao> {
  const assunto = assuntoLimpo(textoDigitado);
  const chave = assunto ? normalizarTexto(assunto) : "";
  if (!assunto || chave.length < 2) throw new ErroSugestaoDePalavras("assunto curto demais para sugerir palavras", "assunto_curto");

  const validoDesde = new Date(agora.getTime() - DIAS_DO_CACHE_DE_PALAVRAS * DIA_MS);
  const [guardada] = await db()
    .select({ palavras: sugestoesDePalavras.palavras })
    .from(sugestoesDePalavras)
    .where(and(eq(sugestoesDePalavras.chave, chave), gte(sugestoesDePalavras.criadoEm, validoDesde)));
  if (guardada) {
    const doCache = limparPalavrasSugeridas(guardada.palavras);
    if (doCache.length > 0) return { palavras: doCache, doCache: true };
  }

  const [pedidos] = await db()
    .select({ total: count() })
    .from(geracoesIA)
    .where(and(eq(geracoesIA.tarefa, "sugerirPalavrasDoAssunto"), eq(geracoesIA.clienteId, clienteId), gte(geracoesIA.criadoEm, inicioDoDiaEmSaoPaulo(agora))));
  if ((pedidos?.total ?? 0) >= PEDIDOS_DE_PALAVRAS_POR_MARCA_POR_DIA) {
    throw new ErroSugestaoDePalavras("teto diario de pedidos de palavras da marca", "limite_do_dia");
  }

  const inicio = Date.now();
  let saida;
  try {
    saida = await gerarEstruturado({
      tarefa: "sugerirPalavrasDoAssunto",
      nivel: sugerirIA.nivel,
      effort: sugerirIA.esforco,
      schema: sugerirIA.schema,
      sistemaEstavel: sugerirIA.montarSistemaEstavel(),
      entrada: sugerirIA.montarEntrada({ assunto }),
      maxTokens: 400,
    });
  } catch (erro) {
    if (erro instanceof ErroIA) throw new ErroSugestaoDePalavras("a IA nao respondeu", "ia_fora");
    throw erro;
  }

  // O registro é do custo e da auditoria: se ele falhar, a sugestão que já foi paga não se perde.
  try {
    await registrarGeracao({
      tarefa: "sugerirPalavrasDoAssunto",
      versaoPrompt: sugerirIA.versao,
      modelo: saida.modelo,
      nivel: sugerirIA.nivel,
      clienteId,
      entradas: { assunto },
      saida: saida.dados,
      uso: { tokensEntrada: saida.tokensEntrada, tokensSaida: saida.tokensSaida, tokensCacheLeitura: saida.tokensCacheLeitura, tokensCacheEscrita: saida.tokensCacheEscrita },
      duracaoMs: Date.now() - inicio,
    });
  } catch (erro) {
    logger.error({ err: erro, clienteId }, "nao registrou a geracao das palavras do assunto");
  }

  const palavras = limparPalavrasSugeridas(saida.dados.palavras);
  if (palavras.length === 0) throw new ErroSugestaoDePalavras("a IA nao devolveu palavra que sirva", "sem_palavras");

  await db()
    .insert(sugestoesDePalavras)
    .values({ chave, palavras, criadoEm: agora })
    .onConflictDoUpdate({ target: sugestoesDePalavras.chave, set: { palavras, criadoEm: agora } });
  return { palavras, doCache: false };
}

export type AssuntoEmAltaParaAcompanhar = { chave: string; assunto: string; palavras: string[] };

/**
 * Os assuntos em alta no Brasil agora (a lista de `listaDeTendenciasDeAgora`) na forma que a folha dos assuntos usa: o nome e as palavras de busca que a coleta já guardou (o próprio
 * assunto primeiro). Fora os delicados (`sensivel`: tragédia, morte, política partidária), que a folha não oferece sozinha; fica no máximo `limite`, do mais alto para o mais baixo.
 */
export function assuntosEmAltaParaAcompanhar(lista: { assuntos: readonly Pick<TendenciaBrasil, "chave" | "assunto" | "termos" | "sensivel" | "posicao">[] } | null, limite = 6): AssuntoEmAltaParaAcompanhar[] {
  if (!lista) return [];
  const resultado: AssuntoEmAltaParaAcompanhar[] = [];
  for (const item of [...lista.assuntos].sort((a, b) => a.posicao - b.posicao)) {
    if (item.sensivel) continue;
    const nome = item.assunto.trim().replace(/\s+/g, " ").slice(0, 60).trim();
    if (nome.length < 2) continue;
    const palavras = limparPalavrasSugeridas([nome.slice(0, LIMITE_DA_PALAVRA), ...item.termos]);
    resultado.push({ chave: item.chave, assunto: nome, palavras });
    if (resultado.length >= limite) break;
  }
  return resultado;
}
