/**
 * A busca instantânea de ramo (E45, PR 1): a pessoa digita uma palavra ou uma letra e os ramos do catálogo aparecem na hora, "como
 * uma pesquisa do Google" (exigência do Gustavo em 02/10/2026). Função pura, sem rede e sem banco: roda no navegador a cada tecla.
 *
 * Como casa: cada palavra digitada precisa ser o COMEÇO de alguma palavra do ramo, sem acento, sem maiúscula e sem pontuação
 * ("jiu" acha "jiu-jitsu", "estetica" acha "Estética"), no nome do ramo, nas palavras que levam a ele ou na linha de exemplos.
 * Quanto mais perto do nome, mais pontos. O resultado vem agrupado (um grupo do catálogo por bloco) e o primeiro da tela é o
 * primeiro ramo do primeiro bloco, o que o Enter escolhe.
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
const LIGACAO = new Set(["de", "da", "do", "dos", "das", "e", "em", "a", "o", "para", "com"]);

type RamoIndexado = {
  ramo: RamoDoCatalogo;
  nome: string[];
  nomeTexto: string;
  termos: string[][];
  termosTexto: string[];
  exemplos: string[];
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

function pontosDaPalavra(digitada: string, ramoIndexado: RamoIndexado): number {
  const noNome = pontosNoConjunto(digitada, ramoIndexado.nome, 30);
  let nasPalavras = 0;
  for (const termo of ramoIndexado.termos) nasPalavras = Math.max(nasPalavras, pontosNoConjunto(digitada, termo, 20));
  const nosExemplos = pontosNoConjunto(digitada, ramoIndexado.exemplos, 10);
  return Math.max(noNome, nasPalavras, nosExemplos);
}

/** Pontos do ramo para a consulta inteira, ou 0 quando alguma palavra digitada não casa com nada dele. */
function pontosDoRamo(consulta: string, digitadas: string[], ramoIndexado: RamoIndexado): number {
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

  const todasDigitadas = consulta.split(" ");
  const semLigacao = todasDigitadas.filter((palavra) => !LIGACAO.has(palavra));
  const digitadas = semLigacao.length > 0 ? semLigacao : todasDigitadas;

  const pontuados = todos
    .map((ramoIndexado, ordem) => ({ ramo: ramoIndexado.ramo, ordem, pontos: pontosDoRamo(consulta, digitadas, ramoIndexado) }))
    .filter((p) => p.pontos > 0);

  const porGrupo = new Map<string, typeof pontuados>();
  for (const p of pontuados) {
    const lista = porGrupo.get(p.ramo.grupo) ?? [];
    lista.push(p);
    porGrupo.set(p.ramo.grupo, lista);
  }

  const grupos = GRUPOS_DE_RAMO.map((grupo, ordemDoGrupo) => {
    const lista = (porGrupo.get(grupo.slug) ?? []).sort((a, b) => b.pontos - a.pontos || a.ordem - b.ordem);
    return { grupo, ordemDoGrupo, melhor: lista[0]?.pontos ?? 0, ramos: lista.map((p) => p.ramo) };
  }).filter((g) => g.ramos.length > 0);

  grupos.sort((a, b) => b.melhor - a.melhor || a.ordemDoGrupo - b.ordemDoGrupo);
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
