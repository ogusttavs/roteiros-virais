/**
 * Legendas (E47, PR 1): das palavras e da `Edl` saem os blocos de legenda já no tempo do vídeo
 * cortado. Cálculo puro. Regras do editor do Gustavo (`reference/legendas.md`):
 *   - cada palavra mantida vai para a linha do tempo cortada;
 *   - muletas ("hum", "ahn") saem sozinhas; correções de marca, nome e gramática entram como
 *     pares [de, para] que mantêm o tempo;
 *   - blocos de uma linha, com limite de caracteres, de palavras e de 2,5 s;
 *   - quebra em pontuação, em frase nova do transcritor e em pausa maior que 0,35 s;
 *   - nunca junta palavras dos dois lados de um corte;
 *   - linha não termina em artigo, preposição ou conjunção;
 *   - bloco curto demais gruda no vizinho; sem ponto nem vírgula no fim.
 */
import type { BlocoLegenda, Edl, Legendas, OpcoesLegenda, PalavraFalada } from "./tipos";

const MULETAS = new Set(["ã", "hã", "ahn", "hum", "hmm", "éé", "ééé", "ah", "eh"]);
const FIM_DE_FRASE = /[.!?]$/;
const PONTUACAO_NO_FIM = /[.,!?;:]$/;

/** Palavras que não podem fechar uma linha de legenda (artigo, preposição, conjunção, pronome átono). */
const FRACAS = new Set(
  `a o as os um uma uns umas de do da dos das ao aos em no na nos nas num numa com
por pelo pela pra pro para e ou mas que se me te lhe nos qual quais essa esse este esta isso
muito mais tão tudo cada`.split(/\s+/),
);

/** Palavras comuns que o transcritor capitaliza só por abrir um trecho. */
const MINUSCULAS_COMUNS = new Set(
  `a o e é as os um uma de da do das dos em no na nos nas por pra para pro que se
mais mas então aqui ali tem tudo isso esse essa este esta desde parte vou vamos são muito muita
comida sobremesa salgadinho produtos diversos próximo realmente depois quando não desse disso
ela ele eles elas espuma desinfetante eletrônico espero fone`.split(/\s+/),
);

const SEM_DESTAQUE_AUTOMATICO = new Set(["estou", "você", "eu", "é", "e", "o", "a"]);

/** Palavra já posta na linha do tempo cortada. `trecho` é o índice do trecho da `Edl` onde ela cai. */
type PalavraNoTempo = PalavraFalada & { trecho: number };

/** [inicio, fim, texto, trecho] */
type Cue = [number, number, string, number];

function normalizar(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}\p{N}_à-ú%-]/gu, "");
}

function ehMaiuscula(s: string): boolean {
  return s !== s.toLowerCase() && s === s.toUpperCase();
}

function primeiroCaractere(s: string): string {
  return Array.from(s)[0] ?? "";
}

function trocarPrimeiro(s: string, f: (c: string) => string): string {
  const c = primeiroCaractere(s);
  return f(c) + s.slice(c.length);
}

/** Arredonda para o inteiro, empate para o par (como o Python faz). */
function arredondarPar(x: number): number {
  const base = Math.floor(x);
  const resto = x - base;
  if (resto > 0.5) return base + 1;
  if (resto < 0.5) return base;
  return base % 2 === 0 ? base : base + 1;
}

export function formatarTempoSrt(t: number): string {
  let ms = arredondarPar(Math.max(0, t) * 1000);
  const h = Math.floor(ms / 3600000);
  ms -= h * 3600000;
  const m = Math.floor(ms / 60000);
  ms -= m * 60000;
  const s = Math.floor(ms / 1000);
  ms -= s * 1000;
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${dois(h)}:${dois(m)}:${dois(s)},${String(ms).padStart(3, "0")}`;
}

export function blocosParaSrt(blocos: BlocoLegenda[]): string {
  return blocos
    .map((b, n) => {
      // legenda é para ler: sem ponto nem vírgula no fim, mantém ? e !
      const texto = b.texto.replace(/[.,;:]+$/, "");
      return `${n + 1}\n${formatarTempoSrt(b.inicio)} --> ${formatarTempoSrt(b.fim)}\n${texto}\n\n`;
    })
    .join("");
}

/** Leva cada palavra para o trecho mantido em que ela mais se sobrepõe, no tempo do vídeo cortado. */
function paraLinhaDoTempo(palavras: PalavraFalada[], edl: Edl): PalavraNoTempo[] {
  const saida: PalavraNoTempo[] = [];
  for (const w of palavras) {
    let melhor = -1;
    let melhorSobreposicao = 0;
    edl.trechos.forEach((t, idx) => {
      const [a, b] = t.origem;
      const sobreposicao = Math.min(w.fim, b) - Math.max(w.inicio, a);
      if (sobreposicao > melhorSobreposicao) {
        melhor = idx;
        melhorSobreposicao = sobreposicao;
      }
    });
    // entra se boa parte da palavra estiver no trecho (pedacinho de 80 ms no corte não conta)
    if (melhor >= 0 && melhorSobreposicao >= Math.min(0.3, (w.fim - w.inicio) / 2)) {
      const t = edl.trechos[melhor];
      const [a, b] = t.origem;
      const deslocamento = t.destino[0] - a;
      saida.push({
        ...w,
        inicio: Math.max(w.inicio, a) + deslocamento,
        fim: Math.min(w.fim, b) + deslocamento,
        trecho: melhor,
      });
    }
  }
  return saida;
}

/** O transcritor separa "band -aid" e "50 %": cola no anterior. */
function juntarFragmentos(palavras: PalavraFalada[]): PalavraFalada[] {
  const saida: PalavraFalada[] = [];
  for (const w of palavras) {
    const anterior = saida[saida.length - 1];
    if (anterior && (w.texto.startsWith("-") || ["%", "%,", "%."].includes(w.texto))) {
      anterior.texto += w.texto;
      anterior.fim = w.fim;
    } else {
      saida.push({ ...w });
    }
  }
  return saida;
}

function palavrasDe(texto: string): string[] {
  return texto.split(/\s+/).filter((p) => p.length > 0);
}

function pontuacaoFinal(texto: string): string {
  return /[.,!?;:]*$/.exec(texto)?.[0] ?? "";
}

/** Troca trechos de 1+ palavras (sem diferenciar maiúscula e pontuação) mantendo o tempo. */
function aplicarCorrecoes(
  palavras: PalavraNoTempo[],
  correcoes: Array<[string, string]>,
): PalavraNoTempo[] {
  for (const [de, para] of correcoes) {
    const padrao = palavrasDe(de).map(normalizar);
    if (padrao.length === 0) continue;
    let i = 0;
    while (i <= palavras.length - padrao.length) {
      const confere = padrao.every((p, k) => normalizar(palavras[i + k].texto) === p);
      if (confere) {
        const novas = palavrasDe(para);
        if (novas.length === padrao.length) {
          // mesma quantidade de palavras: troca uma a uma e mantém o tempo de cada
          // (assim dá para pontuar uma frase longa sem virar um bloco gigante)
          novas.forEach((nova, k) => {
            const cauda = pontuacaoFinal(palavras[i + k].texto);
            palavras[i + k].texto = PONTUACAO_NO_FIM.test(nova) ? nova : nova + cauda;
          });
          i += padrao.length;
          continue;
        }
        const cauda = pontuacaoFinal(palavras[i + padrao.length - 1].texto);
        palavras[i].texto = para + cauda;
        palavras[i].fim = palavras[i + padrao.length - 1].fim;
        palavras.splice(i + 1, padrao.length - 1);
      }
      i++;
    }
  }
  return palavras;
}

export type EntradaLegendas = {
  /** Todas as palavras transcritas, na mesma ordem usada em `planejarCortes`. */
  palavras: PalavraFalada[];
  edl: Edl;
  /** Pares [de, para] de marca, nome e gramática. */
  correcoes?: Array<[string, string]>;
  /** Palavras a destacar além das automáticas. */
  destaques?: string[];
  /** Palavras que as regras automáticas destacariam e não devem. */
  semDestaque?: string[];
  opcoes?: OpcoesLegenda;
};

export function montarLegendas(entrada: EntradaLegendas): Legendas {
  const { palavras, edl } = entrada;
  const correcoes = entrada.correcoes ?? [];
  const opcoes = entrada.opcoes ?? {};
  const nativo = (opcoes.estilo ?? "nativo") === "nativo";
  const maxCaracteres = opcoes.maxCaracteres || (nativo ? 18 : 26);
  const maxPalavras = opcoes.maxPalavras || (nativo ? 4 : 5);
  const caixaAlta = opcoes.caixaAlta ?? nativo;

  const mantidas = new Set(edl.palavrasMantidas);
  let tl = paraLinhaDoTempo(juntarFragmentos(palavras.filter((_, n) => mantidas.has(n))), edl);
  tl = tl.filter((w) => !MULETAS.has(normalizar(w.texto)));
  tl = aplicarCorrecoes(tl, correcoes);
  if (tl.length === 0) return { blocos: [], srt: "", palavrasChave: [] };

  // minúscula no meio de frase quando o transcritor capitalizou só por abrir trecho.
  // Nome próprio = aparece com maiúscula fora de início de trecho (Brasil, Kawasaki, CFMoto...)
  const proprios = new Set(
    palavras
      .filter((w) => !w.abreTrecho && ehMaiuscula(primeiroCaractere(w.texto)))
      .map((w) => normalizar(w.texto)),
  );
  tl.forEach((w, k) => {
    const anterior = k > 0 ? tl[k - 1].texto : ".";
    const n = normalizar(w.texto);
    if (
      w.abreTrecho &&
      ehMaiuscula(primeiroCaractere(w.texto)) &&
      !FIM_DE_FRASE.test(anterior) &&
      (MINUSCULAS_COMUNS.has(n) || !proprios.has(n)) &&
      !(Array.from(n).length > 1 && ehMaiuscula(w.texto))
    ) {
      w.texto = trocarPrimeiro(w.texto, (c) => c.toLowerCase());
    }
  });
  tl[0].texto = trocarPrimeiro(tl[0].texto, (c) => c.toUpperCase());

  let cues: Cue[] = [];
  let atual: PalavraNoTempo[] = [];
  tl.forEach((w, i) => {
    atual.push(w);
    const prox = i + 1 < tl.length ? tl[i + 1] : null;
    const texto = atual.map((x) => x.texto).join(" ");
    // nunca junta numa legenda palavras de lados diferentes de um corte
    const duro =
      prox === null ||
      PONTUACAO_NO_FIM.test(w.texto) ||
      prox.trecho !== w.trecho ||
      prox.inicio - w.fim > 0.35;
    const cabe =
      prox !== null &&
      atual.length < maxPalavras &&
      texto.length + 1 + prox.texto.length <= maxCaracteres;
    const macio =
      prox !== null && (Boolean(prox.abreTrecho) || !cabe || prox.fim - atual[0].inicio > 2.5);
    if (macio && !duro && FRACAS.has(normalizar(w.texto))) {
      // linha não termina em palavra de ligação ("começa a | descambar", "mas aí o | que"):
      // se cabe, segue junto; senão a palavra fraca abre a próxima linha
      if (cabe && prox !== null && prox.fim - atual[0].inicio <= 3.0) return;
      // leva junto as palavras fracas seguidas ("vamos ver o que | tem" -> "vamos ver | o que tem")
      let k = atual.length - 1;
      while (
        k > 1 &&
        FRACAS.has(normalizar(atual[k - 1].texto)) &&
        !PONTUACAO_NO_FIM.test(atual[k - 1].texto)
      )
        k--;
      if (k > 0) {
        cues.push([
          atual[0].inicio,
          atual[k - 1].fim + 0.08,
          atual
            .slice(0, k)
            .map((x) => x.texto)
            .join(" "),
          w.trecho,
        ]);
        atual = atual.slice(k);
        return;
      }
    }
    if (duro || macio) {
      cues.push([atual[0].inicio, w.fim + 0.08, texto, w.trecho]);
      atual = [];
    }
  });

  // bloco de 1 palavra curto demais gruda no vizinho se couber (evita "pô", "care" sozinhos)
  const unidos: Cue[] = [];
  for (const c of cues) {
    const ult = unidos[unidos.length - 1];
    if (
      ult &&
      (c[1] - c[0] < 0.45 || palavrasDe(c[2]).length === 1) &&
      c[3] === ult[3] &&
      c[0] - ult[1] < 0.2 &&
      ult[2].length + 1 + c[2].length <= maxCaracteres + 6 &&
      !FIM_DE_FRASE.test(ult[2])
    ) {
      ult[1] = c[1];
      ult[2] = `${ult[2]} ${c[2]}`;
    } else {
      unidos.push(c);
    }
  }
  cues = unidos;

  // sem piscar entre blocos e duração mínima
  for (let k = 0; k < cues.length; k++) {
    if (k + 1 < cues.length && cues[k + 1][0] - cues[k][1] < 0.3) cues[k][1] = cues[k + 1][0];
    cues[k][1] = Math.max(cues[k][1], cues[k][0] + 0.5);
    if (k + 1 < cues.length) cues[k][1] = Math.min(cues[k][1], cues[k + 1][0]);
  }

  // palavras-chave (o render pinta de destaque): número/preço, marca/nome próprio e a lista "destaques"
  const maiusculasDasCorrecoes = new Set(
    correcoes.flatMap(([, para]) =>
      palavrasDe(para)
        .filter((x) => ehMaiuscula(primeiroCaractere(x)))
        .map(normalizar),
    ),
  );
  const chaves = new Set<string>();
  for (const w of tl) {
    const n = normalizar(w.texto);
    if (!n || SEM_DESTAQUE_AUTOMATICO.has(n)) continue;
    if (
      /\p{Nd}/u.test(n) ||
      ((proprios.has(n) || maiusculasDasCorrecoes.has(n)) &&
        ehMaiuscula(primeiroCaractere(w.texto)))
    ) {
      chaves.add(w.texto.replace(/[,.!?:;]+$/, ""));
    }
  }
  for (const d of entrada.destaques ?? []) chaves.add(d);
  for (const d of entrada.semDestaque ?? []) chaves.delete(d);

  const blocos: BlocoLegenda[] = cues.map(([inicio, fim, texto]) => ({
    inicio,
    fim,
    texto: caixaAlta ? texto.toUpperCase() : texto,
  }));
  return { blocos, srt: blocosParaSrt(blocos), palavrasChave: [...chaves].sort() };
}
