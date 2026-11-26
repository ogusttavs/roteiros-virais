/**
 * E68: a palavra de destaque de cada cena do vídeo de animação, por regra fixa (nunca por IA, para a mesma cena sair sempre igual e o teste dizer qual é):
 *
 * 1. Número primeiro. A primeira palavra com algarismo ganha o destaque ("80%", "24h", "2026"). Número puro seguido de uma palavra que não é comum leva as duas ("3 erros", "7 dias"), e "R$"
 *    seguido do valor também ("R$ 200").
 * 2. Sem número, a palavra mais longa que não é palavra comum (artigo, preposição, pronome, conjunção, advérbio de ligação, verbo auxiliar) nem advérbio em "-mente", com pelo menos 4 letras.
 *    No empate vale a última: em português o termo que fecha a frase costuma ser o que ela quer dizer.
 * 3. Nenhuma palavra serve (cena só de palavras comuns): sem destaque.
 *
 * Devolve o intervalo de posições (início e fim, inclusive) em `palavras`, que é o texto da cena partido nos espaços.
 */

/** Pontuação que cerca a palavra e não conta no tamanho (o "%" e o "$" ficam: fazem parte do número). */
const CERCA_INICIO = /^["'“”‘’«»([{¿¡*_]+/u;
const CERCA_FIM = /["'“”‘’«»)\]}.,;:!?…*_]+$/u;

/** O miolo da palavra, sem a pontuação em volta, em minúsculas. */
export function nucleoDaPalavra(palavra: string): string {
  return palavra.replace(CERCA_INICIO, "").replace(CERCA_FIM, "").toLowerCase();
}

/**
 * A palavra em três partes: a pontuação colada antes, o miolo e a pontuação colada depois (vírgula, ponto, dois-pontos, ponto e vírgula, interrogação, exclamação, reticências, aspas, parênteses).
 * Só o miolo vai para a cor do destaque: "semanas," acende "semanas" e a vírgula fica na cor do texto.
 */
export function separarPontuacao(palavra: string): [string, string, string] {
  const antes = CERCA_INICIO.exec(palavra)?.[0] ?? "";
  const resto = palavra.slice(antes.length);
  const depois = CERCA_FIM.exec(resto)?.[0] ?? "";
  return [antes, resto.slice(0, resto.length - depois.length), depois];
}

/** Palavras comuns demais para destacar. Só as de 4 letras ou mais importam (as menores já ficam de fora pelo tamanho), mas as curtas ficam na lista para a regra do número ("3 de"). */
export const PALAVRAS_COMUNS: ReadonlySet<string> = new Set(
  (
    "a o as os um uma uns umas de do da dos das em no na nos nas num numa por pelo pela pelos pelas para pra pro com sem sob sobre entre até após desde contra " +
    "e ou mas nem que se porque porquê pois como quando onde quanto quanta quantos quantas qual quais quem cujo cuja então logo porém também já só não sim " +
    "mais menos muito muita muitos muitas pouco pouca poucos poucas bem mal ainda sempre nunca agora hoje aqui ali lá cá aí assim depois antes durante " +
    "demais bastante apenas talvez quase tanto tanta tantos tantas enquanto embora contudo entretanto inclusive através dentro fora perto longe acima abaixo além junto " +
    "isso isto aquilo esse essa esses essas este esta estes estas aquele aquela aqueles aquelas disso nisso daqui desse dessa deste desta nesse nessa neste nesta " +
    "eu tu você vocês ele ela eles elas nós me te lhe lhes vos meu minha meus minhas teu tua teus tuas seu sua seus suas nosso nossa nossos nossas dele dela deles delas " +
    "ser é são era eram foi foram será seria sido sendo seja sejam fosse estar está estão estava estavam esteve estou ter tem têm tinha tinham teve tenho haver há havia " +
    "fazer faz fazem fez feito pode podem poder posso vai vão ir vou deve devem quer querem acho sabe sabia olha veja vejo tipo coisa coisas gente " +
    "todo toda todos todas tudo nada cada outro outra outros outras mesmo mesma mesmos mesmas qualquer alguém algum alguma alguns algumas ninguém nenhum nenhuma"
  ).split(" "),
);

const ALGARISMO = /\d/u;
const NUMERO_PURO = /^\d+([.,]\d+)?$/u;
const LETRAS_MINIMAS = 4;

function servePalavra(nucleo: string): boolean {
  if (!nucleo || PALAVRAS_COMUNS.has(nucleo)) return false;
  if (nucleo.endsWith("mente")) return false;
  return [...nucleo].length >= LETRAS_MINIMAS;
}

export function palavraEmDestaque(palavras: readonly string[]): [number, number] | null {
  const nucleos = palavras.map(nucleoDaPalavra);

  // 1. Número primeiro.
  for (let i = 0; i < nucleos.length; i += 1) {
    const atual = nucleos[i];
    const seguinte = nucleos[i + 1];
    if (atual === "r$" && seguinte !== undefined && ALGARISMO.test(seguinte)) return [i, i + 1];
    if (!ALGARISMO.test(atual)) continue;
    if (NUMERO_PURO.test(atual) && seguinte !== undefined && seguinte.length >= 2 && !PALAVRAS_COMUNS.has(seguinte) && !ALGARISMO.test(seguinte)) return [i, i + 1];
    return [i, i];
  }

  // 2. A mais longa que não é comum; no empate, a última.
  let melhor = -1;
  let tamanho = 0;
  for (let i = 0; i < nucleos.length; i += 1) {
    if (!servePalavra(nucleos[i])) continue;
    const letras = [...nucleos[i]].length;
    if (letras >= tamanho) {
      melhor = i;
      tamanho = letras;
    }
  }
  return melhor >= 0 ? [melhor, melhor] : null;
}
