/**
 * A busca instantânea de ramo (E45, PR 1): a pessoa digita uma palavra ou uma letra e os ramos do catálogo aparecem na hora, "como
 * uma pesquisa do Google" (exigência do Gustavo em 02/10/2026). Função pura, sem rede e sem banco: roda no navegador a cada tecla.
 *
 * Como casa: cada palavra digitada precisa ser o COMEÇO de alguma palavra do ramo, sem acento, sem maiúscula e sem pontuação
 * ("jiu" acha "jiu-jitsu", "estetica" acha "Estética"), no nome do ramo, nas palavras que levam a ele, na linha de exemplos ou no nome
 * do grupo ("beleza" mostra o grupo Beleza e estética). Quanto mais perto do nome, mais pontos. O resultado vem agrupado (um grupo do
 * catálogo por bloco) e o primeiro da tela é o primeiro ramo do primeiro bloco, o que o Enter escolhe.
 *
 * Três tentativas, da mais exata para a mais generosa, e a lista nunca some por uma palavra que o catálogo não conhece (achado da
 * revisão independente: "salão de beleza" mostrava Cabelo e barbearia até a pessoa terminar de escrever "beleza", e aí esvaziava):
 *  1. todas as palavras digitadas casam com o mesmo ramo;
 *  2. se nada casou, as mesmas palavras sem o plural e sem a vogal final ("dentistas", "cabeleireira", "roupas");
 *  3. se ainda nada casou e há mais de uma palavra, os ramos que casam com ALGUMA delas, os que casam com mais palavras primeiro
 *     ("personal trainer" acha Academia e treino por "personal").
 */
import { GRUPOS_DE_RAMO, RAMOS_DO_CATALOGO, type GrupoDeRamo, type RamoDoCatalogo } from "@/config/ramos";

export type GrupoDeResultados = { grupo: GrupoDeRamo; ramos: RamoDoCatalogo[] };

/** Minúscula, sem acento, pontuação virando espaço, espaços juntos. "Jiu-Jitsu " vira "jiu jitsu". */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function palavrasDe(texto: string): string[] {
  const normalizado = normalizarBusca(texto);
  return normalizado === "" ? [] : normalizado.split(" ");
}

/** Palavras de ligação: ignoradas quando a pessoa digitou algo além delas ("loja de carros" casa por "loja" e "carros"). */
const LIGACAO = ["de", "da", "do", "dos", "das", "e", "em", "a", "o", "para", "com"];
const LIGACAO_SET = new Set(LIGACAO);

type RamoIndexado = {
  ramo: RamoDoCatalogo;
  nome: string[];
  nomeTexto: string;
  termos: string[][];
  termosTexto: string[];
  exemplos: string[];
  grupo: string[];
};

let indice: RamoIndexado[] | null = null;

function indiceDoCatalogo(): RamoIndexado[] {
  if (indice) return indice;
  indice = RAMOS_DO_CATALOGO.map((ramo) => ({
    ramo,
    nome: palavrasDe(ramo.nome),
    nomeTexto: normalizarBusca(ramo.nome),
    termos: ramo.palavras.map(palavrasDe),
    termosTexto: ramo.palavras.map(normalizarBusca),
    exemplos: palavrasDe(ramo.exemplos),
    grupo: palavrasDe(GRUPOS_DE_RAMO.find((g) => g.slug === ramo.grupo)?.nome ?? ""),
  }));
  return indice;
}

/** Pontos de uma palavra digitada contra um conjunto de palavras: 0 quando nenhuma começa com ela. A palavra inteira vale mais que o começo dela. */
function pontosNoConjunto(digitada: string, palavras: string[], base: number): number {
  let melhor = 0;
  for (let posicao = 0; posicao < palavras.length; posicao += 1) {
    const palavra = palavras[posicao];
    if (!palavra.startsWith(digitada)) continue;
    const exata = palavra === digitada ? 10 : 0;
    const proximaDoComeco = posicao === 0 ? 5 : 0;
    melhor = Math.max(melhor, base + exata + proximaDoComeco);
  }
  return melhor;
}

/** O nome do ramo vale mais que as palavras que levam a ele, que valem mais que os exemplos, que valem mais que o nome do grupo. */
function pontosDaPalavra(digitada: string, ramoIndexado: RamoIndexado): number {
  const noNome = pontosNoConjunto(digitada, ramoIndexado.nome, 30);
  let nasPalavras = 0;
  for (const termo of ramoIndexado.termos) nasPalavras = Math.max(nasPalavras, pontosNoConjunto(digitada, termo, 20));
  const nosExemplos = pontosNoConjunto(digitada, ramoIndexado.exemplos, 10);
  const noGrupo = pontosNoConjunto(digitada, ramoIndexado.grupo, 3);
  return Math.max(noNome, nasPalavras, nosExemplos, noGrupo);
}

/**
 * A palavra sem o plural e sem a vogal final, para a segunda tentativa ("dentistas" e "cabeleireira" chegam em "dentist" e
 * "cabeleireir", começos de "dentista" e "cabeleireiro"). Palavra curta fica como está: tirar letra de "casa" ou "bar" acharia tudo.
 */
export function raizDaPalavra(palavra: string): string {
  let raiz = palavra;
  if (raiz.length >= 5 && raiz.endsWith("s")) raiz = raiz.slice(0, -1);
  if (raiz.length >= 5 && /[aeo]$/.test(raiz)) raiz = raiz.slice(0, -1);
  return raiz;
}

/** Pontos do ramo para a consulta inteira, ou 0 quando alguma palavra não casa com nada dele (a primeira e a segunda tentativas). */
function pontosDoRamoEstrito(consulta: string, digitadas: string[], ramoIndexado: RamoIndexado): number {
  let soma = 0;
  for (const digitada of digitadas) {
    const pontos = pontosDaPalavra(digitada, ramoIndexado);
    if (pontos === 0) return 0;
    soma += pontos;
  }
  // A consulta inteira, na ordem em que foi escrita, no começo do nome ou de um termo: quem escreveu "limpeza de pele" quer o
  // ramo cujo termo é exatamente esse, não o que só tem "limpeza" e "pele" soltas.
  if (ramoIndexado.nomeTexto.startsWith(consulta)) soma += 50;
  if (ramoIndexado.termosTexto.some((termo) => termo.startsWith(consulta))) soma += 25;
  return soma;
}

type Pontuado = { ramo: RamoDoCatalogo; ordem: number; pontos: number; casadas: number };

function pontuarEstrito(consulta: string, digitadas: string[], todos: RamoIndexado[]): Pontuado[] {
  return todos
    .map((ramoIndexado, ordem) => ({ ramo: ramoIndexado.ramo, ordem, pontos: pontosDoRamoEstrito(consulta, digitadas, ramoIndexado), casadas: digitadas.length }))
    .filter((p) => p.pontos > 0);
}

/** A terceira tentativa: os ramos que casam com pelo menos uma palavra (como foi digitada ou sem o plural), os que casam com mais primeiro. */
function pontuarParcial(digitadas: string[], todos: RamoIndexado[]): Pontuado[] {
  return todos
    .map((ramoIndexado, ordem) => {
      let pontos = 0;
      let casadas = 0;
      for (const digitada of digitadas) {
        const daPalavra = Math.max(pontosDaPalavra(digitada, ramoIndexado), pontosDaPalavra(raizDaPalavra(digitada), ramoIndexado));
        if (daPalavra > 0) {
          casadas += 1;
          pontos += daPalavra;
        }
      }
      return { ramo: ramoIndexado.ramo, ordem, pontos, casadas };
    })
    .filter((p) => p.casadas > 0);
}

/**
 * As palavras que contam: sem as de ligação, e sem o começo de uma palavra de ligação que a pessoa ainda está escrevendo ("salão d"
 * não pode esvaziar a lista só porque o "d" ainda pode virar "de"). Se só sobrasse ligação, ela mesma é a palavra.
 */
function palavrasQueContam(consulta: string): string[] {
  const todas = consulta.split(" ");
  const contam = todas.filter((palavra) => !LIGACAO_SET.has(palavra));
  if (contam.length === 0) return todas;
  const ultima = todas[todas.length - 1];
  const ultimaEstaSendoEscrita = !LIGACAO_SET.has(ultima) && ultima.length <= 2 && LIGACAO.some((ligacao) => ligacao.startsWith(ultima));
  return ultimaEstaSendoEscrita && contam.length > 1 ? contam.slice(0, -1) : contam;
}

/**
 * Busca no catálogo. Consulta vazia (ou só pontuação) devolve o catálogo inteiro, nos grupos e na ordem do documento aprovado.
 * Com consulta, só os ramos que casam, os grupos pelo melhor ramo de cada um (empate: ordem do catálogo) e os ramos dentro do grupo
 * por pontos (empate: ordem do catálogo).
 */
export function buscarRamos(consultaBruta: string): GrupoDeResultados[] {
  const consulta = normalizarBusca(consultaBruta);
  const todos = indiceDoCatalogo();

  if (consulta === "") {
    return GRUPOS_DE_RAMO.map((grupo) => ({ grupo, ramos: todos.filter((r) => r.ramo.grupo === grupo.slug).map((r) => r.ramo) })).filter(
      (g) => g.ramos.length > 0,
    );
  }

  const digitadas = palavrasQueContam(consulta);
  let pontuados = pontuarEstrito(consulta, digitadas, todos);
  if (pontuados.length === 0) {
    const raizes = digitadas.map(raizDaPalavra);
    if (raizes.some((raiz, i) => raiz !== digitadas[i])) pontuados = pontuarEstrito(consulta, raizes, todos);
  }
  if (pontuados.length === 0 && digitadas.length > 1) pontuados = pontuarParcial(digitadas, todos);

  const porGrupo = new Map<string, Pontuado[]>();
  for (const p of pontuados) {
    const lista = porGrupo.get(p.ramo.grupo) ?? [];
    lista.push(p);
    porGrupo.set(p.ramo.grupo, lista);
  }

  const ordenar = (a: Pontuado, b: Pontuado) => b.casadas - a.casadas || b.pontos - a.pontos || a.ordem - b.ordem;
  const grupos = GRUPOS_DE_RAMO.map((grupo, ordemDoGrupo) => {
    const lista = (porGrupo.get(grupo.slug) ?? []).sort(ordenar);
    return { grupo, ordemDoGrupo, melhor: lista[0], ramos: lista.map((p) => p.ramo) };
  }).filter((g) => g.ramos.length > 0);

  grupos.sort((a, b) => (b.melhor?.casadas ?? 0) - (a.melhor?.casadas ?? 0) || (b.melhor?.pontos ?? 0) - (a.melhor?.pontos ?? 0) || a.ordemDoGrupo - b.ordemDoGrupo);
  return grupos.map(({ grupo, ramos }) => ({ grupo, ramos }));
}

/** O ramo que o Enter escolhe: o primeiro da tela (primeiro do primeiro grupo). */
export function primeiroRamoDosResultados(grupos: readonly GrupoDeResultados[]): RamoDoCatalogo | null {
  return grupos[0]?.ramos[0] ?? null;
}

/** Os ramos na ordem em que aparecem na tela, de cima para baixo (a ordem das setas do teclado). */
export function ramosEmOrdemDeTela(grupos: readonly GrupoDeResultados[]): RamoDoCatalogo[] {
  return grupos.flatMap((g) => g.ramos);
}
