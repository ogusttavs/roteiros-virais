/**
 * E17 parte 1 (refeita em 23/10/2026): os sinônimos do catálogo de ramos entrando na busca da prova do Tema livre. Função pura, sem rede e sem banco.
 *
 * O catálogo (`config/ramos.ts`) guarda, por ramo, as palavras que a pessoa escreveria para chegar nele ("dentista, ortodontia, implante, clareamento").
 * Quando o tema da pessoa contém um desses termos inteiros, as outras palavras do mesmo ramo são vocabulário vizinho: "IA" e "inteligência artificial",
 * "faxina" e "diarista". A busca usa essas palavras como reforço (vale metade de uma palavra do próprio tema e nunca basta sozinha), não como substituto.
 *
 * Como casa um termo com o tema: sem acento e sem maiúscula, todas as palavras do termo precisam aparecer no tema, cada uma igual a uma palavra do tema
 * ou diferindo só na terminação (plural, gênero: "dentistas" casa "dentista"). Palavra curta ("ia") só casa igual.
 * Os dois ramos que mais termos casaram dão os sinônimos (empate: a ordem do catálogo), no máximo `MAXIMO_DE_SINONIMOS`.
 */
import { RAMOS_DO_CATALOGO } from "@/config/ramos";
import { normalizarBusca } from "@/lib/buscar-ramo";

export const MAXIMO_DE_SINONIMOS = 10;
const MAXIMO_DE_RAMOS = 2;
const LIGACAO = new Set(["de", "da", "do", "dos", "das", "e", "em", "a", "o", "para", "com", "no", "na"]);

function palavrasDe(texto: string): string[] {
  const normalizado = normalizarBusca(texto);
  return normalizado === "" ? [] : normalizado.split(" ").filter((p) => !LIGACAO.has(p));
}

/**
 * Igual, ou só a terminação muda: plural e acréscimo de até duas letras ("dentista" e "dentistas") ou a vogal final trocada ("cabeleireiro" e "cabeleireira").
 * Palavra de menos de 4 letras só casa igual. É de propósito curto: "dente" não casa "dentista" nem "dentro" (a grafia parecida é do `pg_trgm`, na consulta).
 */
function mesmaPalavra(a: string, b: string): boolean {
  if (a === b) return true;
  const menor = Math.min(a.length, b.length);
  if (menor < 4) return false;
  if (a.startsWith(b) || b.startsWith(a)) return Math.abs(a.length - b.length) <= 2;
  const vogais = "aeo";
  return a.length === b.length && menor >= 5 && a.slice(0, -1) === b.slice(0, -1) && vogais.includes(a.at(-1)!) && vogais.includes(b.at(-1)!);
}

function termoCasa(termo: string[], palavrasDoTema: string[]): boolean {
  return termo.length > 0 && termo.every((p) => palavrasDoTema.some((t) => mesmaPalavra(p, t)));
}

type TermoIndexado = { texto: string; palavras: string[] };
type RamoIndexado = { termos: TermoIndexado[]; nome: string[] };

let indice: RamoIndexado[] | null = null;

function indiceDoCatalogo(): RamoIndexado[] {
  if (indice) return indice;
  indice = RAMOS_DO_CATALOGO.map((ramo) => ({
    termos: ramo.palavras.map((texto) => ({ texto, palavras: palavrasDe(texto) })),
    nome: palavrasDe(ramo.nome),
  }));
  return indice;
}

/**
 * As palavras vizinhas do catálogo para um tema, na ordem do catálogo, sem repetir e sem as que o próprio tema já diz.
 * Tema que não toca nenhum termo do catálogo: lista vazia (a busca é a de sempre).
 */
export function sinonimosDoTema(texto: string, maximo = MAXIMO_DE_SINONIMOS): string[] {
  const palavrasDoTema = palavrasDe(texto);
  if (palavrasDoTema.length === 0) return [];

  const pontuados: { casados: number; ordem: number; termos: TermoIndexado[]; casam: Set<string> }[] = [];
  indiceDoCatalogo().forEach((ramo, ordem) => {
    const casam = new Set<string>();
    for (const termo of ramo.termos) if (termoCasa(termo.palavras, palavrasDoTema)) casam.add(termo.texto);
    // O nome do ramo ("Odontologia") também revela o ramo, mas só as palavras do catálogo viram sinônimo.
    const nomeCasa = ramo.nome.length > 0 && termoCasa(ramo.nome, palavrasDoTema);
    const casados = casam.size + (nomeCasa ? 1 : 0);
    if (casados > 0) pontuados.push({ casados, ordem, termos: ramo.termos, casam });
  });

  pontuados.sort((a, b) => b.casados - a.casados || a.ordem - b.ordem);

  const resultado: string[] = [];
  const vistos = new Set<string>();
  for (const ramo of pontuados.slice(0, MAXIMO_DE_RAMOS)) {
    for (const termo of ramo.termos) {
      if (ramo.casam.has(termo.texto)) continue;
      const chave = termo.palavras.join(" ");
      if (chave === "" || vistos.has(chave)) continue;
      // O que o tema já diz não é reforço.
      if (termoCasa(termo.palavras, palavrasDoTema)) continue;
      vistos.add(chave);
      resultado.push(termo.texto);
      if (resultado.length >= maximo) return resultado;
    }
  }
  return resultado;
}
