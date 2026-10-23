/**
 * A busca instantânea de assunto (melhoria da E53, 23/10/2026): a pessoa digita e os assuntos do catálogo (`config/assuntos-do-catalogo.ts`) aparecem na hora, com as palavras de busca
 * já prontas. Mesmo espírito da busca de ramo (`buscar-ramo.ts`), função pura, sem rede e sem banco, para rodar no navegador a cada tecla.
 *
 * Como casa:
 *  - Cada palavra digitada precisa ser o COMEÇO de alguma palavra do assunto, sem acento, sem maiúscula e sem pontuação ("eleic" acha "Eleições", "jiu" acha "jiu-jitsu").
 *  - Termo curto inteiro: palavra digitada com uma ou duas letras só casa com uma palavra IGUAL a ela ("ia" acha "IA" e não "iate" nem "iatismo"; "pt" não acha "pteridófita"). Uma letra
 *    sozinha não sugere nada (acharia metade do catálogo).
 *  - Plural e singular: "eleições" acha "eleição", "jornais" acha "jornal", "prefeitos" acha "prefeito" (a palavra digitada também vale sem o plural e sem a vogal final).
 *  - Quanto mais perto do nome, mais pontos: nome, depois as palavras de busca prontas, depois os sinônimos. O nome do grupo só vale quando nada mais casou.
 *
 * Tentativas: (1) todas as palavras digitadas casam com o mesmo assunto; (1b) o mesmo, agora contando o nome do grupo; (2) se nada casou e há mais de uma palavra, os assuntos que casam com ALGUMA delas (os que casam com
 * mais palavras primeiro), para que "dólar hoje" ache Dólar e câmbio mesmo que "hoje" não esteja em lugar nenhum.
 */
import { ASSUNTOS_DO_CATALOGO, GRUPOS_DE_ASSUNTO, type AssuntoDoCatalogo } from "@/config/assuntos-do-catalogo";

import { normalizarBusca, raizDaPalavra } from "./buscar-ramo";

/** Quantas sugestões a lista mostra no máximo. */
export const MAXIMO_DE_SUGESTOES = 8;
/** A palavra digitada com até este tamanho só casa com palavra inteira. */
const TAMANHO_DO_TERMO_CURTO = 2;

const LIGACAO = ["de", "da", "do", "dos", "das", "e", "em", "a", "o", "para", "com", "no", "na", "nos", "nas"];
const LIGACAO_SET = new Set(LIGACAO);

type Indexado = {
  assunto: AssuntoDoCatalogo;
  nome: string[];
  nomeTexto: string;
  palavras: string[][];
  palavrasTexto: string[];
  tambem: string[][];
  grupo: string[];
};

function palavrasDe(texto: string): string[] {
  const normalizado = normalizarBusca(texto);
  return normalizado === "" ? [] : normalizado.split(" ");
}

let indice: Indexado[] | null = null;

function indiceDoCatalogo(): Indexado[] {
  if (indice) return indice;
  indice = ASSUNTOS_DO_CATALOGO.map((assunto) => ({
    assunto,
    nome: palavrasDe(assunto.nome),
    nomeTexto: normalizarBusca(assunto.nome),
    palavras: assunto.palavras.map(palavrasDe),
    palavrasTexto: assunto.palavras.map(normalizarBusca),
    tambem: assunto.tambem.map(palavrasDe),
    grupo: palavrasDe(GRUPOS_DE_ASSUNTO.find((g) => g.slug === assunto.grupo)?.nome ?? ""),
  }));
  return indice;
}

/**
 * O singular de uma palavra do português que o `raizDaPalavra` não alcança: "eleicoes" e "paes" viram "eleicao" e "pao", "jornais" vira "jornal", "papeis" vira "papel", "jovens" vira
 * "jovem". Palavra curta fica como está.
 */
export function singularDaPalavra(palavra: string): string {
  if (palavra.length < 5) return palavra;
  if (/(oes|aes)$/.test(palavra)) return `${palavra.slice(0, -3)}ao`;
  if (/ais$/.test(palavra)) return `${palavra.slice(0, -2)}l`;
  if (/eis$/.test(palavra)) return `${palavra.slice(0, -2)}l`;
  if (/ns$/.test(palavra)) return `${palavra.slice(0, -2)}m`;
  return palavra;
}

/** As formas da palavra que valem na busca, a digitada primeiro. */
function formasDaPalavra(palavra: string): string[] {
  if (palavra.length <= TAMANHO_DO_TERMO_CURTO) return [palavra];
  return [...new Set([palavra, singularDaPalavra(palavra), raizDaPalavra(palavra)])];
}

/** Pontos de uma palavra digitada contra um conjunto de palavras: 0 quando nenhuma casa. Palavra inteira vale mais; o começo do conjunto vale mais. */
function pontosNoConjunto(digitada: string, palavras: string[], base: number): number {
  const curta = digitada.length <= TAMANHO_DO_TERMO_CURTO;
  let melhor = 0;
  for (let posicao = 0; posicao < palavras.length; posicao += 1) {
    const palavra = palavras[posicao];
    if (curta ? palavra !== digitada : !palavra.startsWith(digitada)) continue;
    const exata = palavra === digitada ? 10 : 0;
    const proximaDoComeco = posicao === 0 ? 5 : 0;
    melhor = Math.max(melhor, base + exata + proximaDoComeco);
  }
  return melhor;
}

function pontosDaForma(forma: string, item: Indexado, comGrupo: boolean): number {
  const noNome = pontosNoConjunto(forma, item.nome, 30);
  let nasPalavras = 0;
  for (const termo of item.palavras) nasPalavras = Math.max(nasPalavras, pontosNoConjunto(forma, termo, 20));
  let nosSinonimos = 0;
  for (const termo of item.tambem) nosSinonimos = Math.max(nosSinonimos, pontosNoConjunto(forma, termo, 12));
  const noGrupo = comGrupo ? pontosNoConjunto(forma, item.grupo, 3) : 0;
  return Math.max(noNome, nasPalavras, nosSinonimos, noGrupo);
}

/** O melhor das formas da palavra digitada; as formas que não são a digitada valem um pouco menos (a exata na frente). */
function pontosDaPalavra(digitada: string, item: Indexado, comGrupo: boolean): number {
  let melhor = 0;
  formasDaPalavra(digitada).forEach((forma, i) => {
    const pontos = pontosDaForma(forma, item, comGrupo);
    if (pontos > 0) melhor = Math.max(melhor, i === 0 ? pontos : pontos - 2);
  });
  return melhor;
}

/** As palavras que contam: sem as de ligação, e sem o começo de uma palavra de ligação que a pessoa ainda está escrevendo ("preço d" não pode esvaziar a lista). */
function palavrasQueContam(consulta: string): string[] {
  const todas = consulta.split(" ");
  const contam = todas.filter((palavra) => !LIGACAO_SET.has(palavra));
  if (contam.length === 0) return todas;
  const ultima = todas[todas.length - 1];
  const ultimaEstaSendoEscrita = !LIGACAO_SET.has(ultima) && ultima.length <= 2 && LIGACAO.some((ligacao) => ligacao.startsWith(ultima));
  return ultimaEstaSendoEscrita && contam.length > 1 ? contam.slice(0, -1) : contam;
}

type Pontuado = { assunto: AssuntoDoCatalogo; ordem: number; pontos: number; casadas: number };

function pontuarEstrito(consulta: string, digitadas: string[], todos: Indexado[], comGrupo: boolean): Pontuado[] {
  const resultado: Pontuado[] = [];
  todos.forEach((item, ordem) => {
    let soma = 0;
    for (const digitada of digitadas) {
      const pontos = pontosDaPalavra(digitada, item, comGrupo);
      if (pontos === 0) return;
      soma += pontos;
    }
    // A consulta inteira, na ordem em que foi escrita, no começo do nome ou de uma palavra pronta: quem escreveu "preço da gasolina" quer o assunto cuja palavra é essa.
    if (item.nomeTexto.startsWith(consulta)) soma += 50;
    if (item.palavrasTexto.some((termo) => termo.startsWith(consulta))) soma += 25;
    resultado.push({ assunto: item.assunto, ordem, pontos: soma, casadas: digitadas.length });
  });
  return resultado;
}

function pontuarParcial(digitadas: string[], todos: Indexado[]): Pontuado[] {
  const resultado: Pontuado[] = [];
  todos.forEach((item, ordem) => {
    let pontos = 0;
    let casadas = 0;
    for (const digitada of digitadas) {
      // Na busca parcial, palavra de uma ou duas letras não conta: ela casaria com qualquer coisa solta.
      if (digitada.length <= TAMANHO_DO_TERMO_CURTO) continue;
      const daPalavra = pontosDaPalavra(digitada, item, false);
      if (daPalavra > 0) {
        casadas += 1;
        pontos += daPalavra;
      }
    }
    if (casadas > 0) resultado.push({ assunto: item.assunto, ordem, pontos, casadas });
  });
  return resultado;
}

/**
 * Os assuntos do catálogo que combinam com o que a pessoa digitou, do mais perto para o mais longe (empate: a ordem do catálogo). Consulta vazia, só pontuação ou uma letra sozinha
 * devolve lista vazia: a tela mostra então o que está em alta, não o catálogo inteiro.
 */
export function buscarAssuntos(consultaBruta: string, limite: number = MAXIMO_DE_SUGESTOES): AssuntoDoCatalogo[] {
  const consulta = normalizarBusca(consultaBruta);
  if (consulta === "") return [];
  const digitadas = palavrasQueContam(consulta);
  if (digitadas.length === 1 && digitadas[0].length < 2) return [];

  const todos = indiceDoCatalogo();
  // O nome do grupo só entra se nada casou sem ele: "eleic" mostra Eleições e não o grupo inteiro de política; "esporte" sem nada melhor mostra os assuntos do grupo.
  let pontuados = pontuarEstrito(consulta, digitadas, todos, false);
  if (pontuados.length === 0) pontuados = pontuarEstrito(consulta, digitadas, todos, true);
  if (pontuados.length === 0 && digitadas.length > 1) pontuados = pontuarParcial(digitadas, todos);

  return pontuados
    .sort((a, b) => b.casadas - a.casadas || b.pontos - a.pontos || a.ordem - b.ordem)
    .slice(0, limite)
    .map((p) => p.assunto);
}

/**
 * O que digitou já é exatamente um assunto do catálogo (o nome, sem acento nem maiúscula)? Aí a tela não oferece "sugerir palavras": as palavras prontas já estão na primeira linha.
 */
export function ehNomeDeAssuntoDoCatalogo(texto: string): boolean {
  const consulta = normalizarBusca(texto);
  if (consulta === "") return false;
  return indiceDoCatalogo().some((item) => item.nomeTexto === consulta);
}
