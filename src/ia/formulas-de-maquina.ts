/**
 * Onda 1 de texto (25/11/2026): o detector por código das fórmulas que denunciam texto escrito por
 * máquina (`R-COPY-26`), mais os dois avisos de forma da fala (`R-COPY-28`, frases picotadas, e
 * `R-COPY-29`, número que não dá para falar em voz alta).
 *
 * A lista é NOSSA: nasceu do português de quem lê texto feito por IA todo dia e dos nossos golden sets,
 * não de material de terceiros. É uma lista FECHADA, com nome por família, e a regra de ouro é "na
 * dúvida, não pega": cada família tem exemplos que pega e exemplos que não pode pegar (o contraste
 * "não é cárie, é erosão" é conversa legítima de dentista quando vem de um fato da ficha ou da
 * evidência; um número na frase também é fato e libera as famílias que dependem de "sem fato").
 *
 * Função pura, sem I/O. Quem usa:
 * - o roteiro (`verificar-copy-roteiro.ts`): reprova na 1ª tentativa, aviso na 2ª, nunca derruba;
 * - os temas do dia (`jobs/temas-do-dia.ts`): tema com fórmula no título ou na descrição volta para o
 *   modelo refazer na 1ª passada; na 2ª fica e só vira aviso no log;
 * - o carrossel e qualquer texto novo: chame `acharFormulasDeMaquina` com os blocos que tiver.
 */

export type BlocoDoTexto = "titulo" | "tema" | "gancho" | "corpo" | "fechamento" | "chamada";

export type AchadoDeFormula = {
  /** A chave estável da família (para teste, log e contagem). */
  familia: FamiliaDeFormula;
  /** O nome da família, em português de gente. */
  nome: string;
  bloco: BlocoDoTexto;
  /** O trecho que casou, já sem acento e em minúsculas (é o que a expressão leu). */
  trecho: string;
  /** A frase pronta para o motivo da reprovação ou do aviso, sem travessão. */
  motivo: string;
};

export type FamiliaDeFormula =
  | "contraste-negado"
  | "virada-de-efeito"
  | "abertura-de-preparacao"
  | "despedida-cordial"
  | "intensificador-vazio"
  | "cada-vez-mais"
  | "paralelismo-de-slogan"
  | "revelacao-vazia";

export type TextoParaConferir = Partial<Record<BlocoDoTexto, string>>;

export type OpcoesDoDetector = {
  /** Tudo o que vale como fato (ficha, momento, evidência): o contraste cujas duas metades estão aqui não pega. */
  fontes?: string;
};

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Texto em uma linha só e com espaços simples, para as expressões não tratarem quebra de linha. */
function emUmaLinha(texto: string): string {
  return texto.split(String.fromCharCode(10)).join(" ").split(String.fromCharCode(13)).join(" ").replace(/[ ]+/g, " ").trim();
}

/** As frases do texto já normalizado (a quebra é no ponto final, exclamação, interrogação e ponto e vírgula). */
function frasesDe(normalizado: string): string[] {
  return normalizado
    .split(/[.!?;]+(?=[ ]|$)/)
    .map((f) => f.trim())
    .filter(Boolean);
}

const TEM_ALGARISMO = /[0-9]/;
/** Os canais de uma chamada concreta: "qualquer dúvida, me chama no zap" é pedido, não despedida. */
const CANAL_CONCRETO = /(whats|zap|direct|\bdm\b|ligue|ligacao|telefone|link|comentario|mensagem|orcamento|agende|agenda)/;

type Familia = {
  id: FamiliaDeFormula;
  nome: string;
  /** O que fazer no lugar, em uma frase para o modelo (e para o motivo). */
  conselho: string;
  blocos: BlocoDoTexto[];
  /** Devolve o trecho que casou ou null. Recebe o bloco inteiro normalizado, em uma linha. */
  achar: (texto: string, opcoes: OpcoesDoDetector) => string | null;
};

const TODOS: BlocoDoTexto[] = ["titulo", "tema", "gancho", "corpo", "fechamento", "chamada"];

// --- 1. Contraste em duas metades ("não é A, é B") ---------------------------------------------

const NEGA = "(?:nao (?:e|foi|era|eh|sao|eram|esta|estao|se trata|tem a ver|vem)|nunca foi|nunca e)";
const AFIRMA = "(?:e|foi|era|eh|sao|eram|esta|estao|se trata|tem a ver|vem|mas sim|na verdade e|e sim)";
const LIGA = "(?: so| apenas| somente| sobre| de| do| da| dos| das| com)?";
const CONTRASTE = new RegExp(
  `(?:^|[^a-z])${NEGA}${LIGA}[ ]+([^,.;:!?]{2,40}?)[ ]*[,;:.!][ ]*(?:mas |e |na verdade,? )?${AFIRMA}${LIGA}[ ]+([^,.;:!?]{2,40})`,
);
const PALAVRAS_FRACAS = new Set(["problema", "questao", "coisa", "sobre", "apenas", "somente", "outro", "outra", "muito", "pouco", "assim", "isso", "esse", "essa", "aquilo", "porque"]);

/** A metade tem base nas fontes quando alguma palavra de conteúdo (5 letras ou mais, fora a lista fraca) está lá. */
function metadeTemBaseNasFontes(metade: string, fontes: string): boolean {
  return metade
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 5 && !PALAVRAS_FRACAS.has(p))
    .some((p) => fontes.includes(p));
}

function acharContraste(texto: string, opcoes: OpcoesDoDetector): string | null {
  const fontes = normalizar(emUmaLinha(opcoes.fontes ?? ""));
  const m = CONTRASTE.exec(texto);
  if (!m) return null;
  const [trecho, a, b] = m;
  // Número é fato: "não é 30 dias, é 45" não é fórmula, é conta.
  if (TEM_ALGARISMO.test(a) || TEM_ALGARISMO.test(b)) return null;
  // As duas metades vêm das fontes (ficha, momento, evidência): é o fato do ramo, não o molde.
  if (fontes && metadeTemBaseNasFontes(a, fontes) && metadeTemBaseNasFontes(b, fontes)) return null;
  return trecho.replace(/^[^a-z]+/, "").trim();
}

// --- 2. Frase de virada de efeito --------------------------------------------------------------

const VIRADA = new RegExp(
  [
    "(?:^|[^a-z])(?:e |mas |so que )?(?:isso|aquilo|essa (?:simples )?(?:mudanca|troca|dica|atitude)) (?:muda|mudou|vai mudar) (?:tudo|o jogo|a sua vida|sua vida)",
    "e (?:e )?(?:ai|aqui) que (?:a magica|a virada|tudo|o jogo|a coisa) (?:acontece|muda|vira|comeca|fica interessante)",
    "mas (?:calma|espera|pera),? (?:ainda )?(?:tem|vem) mais",
    "(?:o|a) (?:melhor|pior|mais (?:incrivel|surpreendente)) (?:ainda )?(?:vem agora|vem a seguir|esta por vir|ainda vem)",
    "o (?:grande |verdadeiro )?segredo (?:e|esta|nao e)(?: que)?(?:[ ,]|$)",
    "(?:prepare-se|se prepara),? (?:porque|pois|que)",
    "voce (?:nao )?vai (?:acreditar|se surpreender|se chocar)",
    "(?:e|entao) o resultado\\?",
    "e adivinha (?:so )?(?:o que|quem)",
    "olha so no que (?:deu|isso deu)",
    "spoiler:",
  ].join("|"),
);

function acharVirada(texto: string): string | null {
  return VIRADA.exec(texto)?.[0].replace(/^[^a-z]+/, "").trim() ?? null;
}

// --- 3. Abertura de preparação -----------------------------------------------------------------

const PREPARACAO = new RegExp(
  [
    "(?:^|[^a-z])(?:hoje|agora) (?:eu )?(?:vou|vamos|quero|venho) (?:te |lhe |vos )?(?:falar|contar|mostrar|explicar|ensinar|trazer|compartilhar|apresentar|dividir)",
    "(?:^|[^a-z])(?:neste|nesse) (?:video|conteudo|reels|post)",
    "(?:^|[^a-z])no video de hoje",
    "(?:^|[^a-z])antes de comecar",
    "(?:^|[^a-z])(?:fica|fique|assista|assiste|presta atencao) ate (?:o )?(?:final|fim)",
    "(?:^|[^a-z])bora la",
    "(?:^|[^a-z])(?:o tema|o assunto) de hoje",
  ].join("|"),
);

function acharPreparacao(texto: string): string | null {
  return PREPARACAO.exec(texto)?.[0].replace(/^[^a-z]+/, "").trim() ?? null;
}

// --- 4. Despedida cordial ----------------------------------------------------------------------

const DESPEDIDA = new RegExp(
  [
    "(?:^|[^a-z])espero que (?:voce |vc )?(?:tenha |tenham )?(?:gostado|ajudado|curtido|aproveitado)",
    "(?:^|[^a-z])espero ter ajudado",
    "(?:^|[^a-z])(?:muito )?obrigad[oa] (?:por (?:assistir|ver|acompanhar|ter assistido|chegar ate aqui)|pela (?:atencao|audiencia|paciencia))",
    "(?:^|[^a-z])ate (?:o |a )?(?:proximo|proxima|breve)(?: video)?(?:[^a-z]|$)",
    "(?:^|[^a-z])(?:um |um grande )?abracos?(?:[,.!]|$)",
    "(?:^|[^a-z])beijos?(?:[,.!]|$)",
    "(?:^|[^a-z])(?:fico|ficamos|estou|estamos) a (?:sua |nossa )?disposicao",
    "(?:^|[^a-z])(?:deixe|deixa|de|dê) (?:o |seu |um )?like",
    "(?:^|[^a-z])(?:se inscreva|inscreva-se|se inscreve)",
    "(?:^|[^a-z])curt[ae] e compartilh[ae]",
  ].join("|"),
);
const DUVIDA_GENERICA = /(?:^|[^a-z])(?:qualquer|se tiver) duvidas?,? (?:e so|me chama|me chame|fico|estou|estamos|conte comigo|conta comigo)[^.!?;]*/;

function acharDespedida(texto: string): string | null {
  const direto = DESPEDIDA.exec(texto)?.[0];
  if (direto) return direto.replace(/^[^a-z]+/, "").trim();
  // "Qualquer dúvida, me chama" sem dizer onde é cortesia; com o canal (zap, direct, link) é o pedido final, que o projeto quer.
  const duvida = DUVIDA_GENERICA.exec(texto)?.[0];
  if (duvida && !CANAL_CONCRETO.test(duvida)) return duvida.replace(/^[^a-z]+/, "").trim();
  return null;
}

// --- 5. Intensificador vazio -------------------------------------------------------------------

const INTENSIFICADOR = /(?:^|[^a-z0-9])(incriveis|incrivel|poderos[oa]s?|transformador(?:es|as|a)?|revolucionari[oa]s?|surpreendentes?|extraordinari[oa]s?|inacreditaveis|inacreditavel|impressionantes?|espetaculares|espetacular|fenomenal|fenomenais)(?![a-z0-9])/;

function acharIntensificador(texto: string): string | null {
  for (const frase of frasesDe(texto)) {
    // Com número na mesma frase o adjetivo está apoiado num fato, e na dúvida não pega.
    if (TEM_ALGARISMO.test(frase)) continue;
    const m = INTENSIFICADOR.exec(frase);
    if (m) return m[1];
  }
  return null;
}

// --- 6. "Cada vez mais" e parentes -------------------------------------------------------------

const CADA_VEZ_MAIS = new RegExp(
  [
    "(?:^|[^a-z])cada (?:vez|dia) mais",
    "(?:^|[^a-z])mais e mais(?:[^a-z]|$)",
    "(?:^|[^a-z])nos dias de hoje",
    "(?:^|[^a-z])nos tempos (?:atuais|modernos)",
    "(?:^|[^a-z])hoje em dia,? (?:cada|todo mundo|as pessoas)",
    "(?:^|[^a-z])na era (?:digital|da informacao|moderna|atual)",
    "(?:^|[^a-z])vivemos (?:em|numa|em uma) (?:era|epoca|tempo|mundo)",
    "(?:^|[^a-z])(?:num|em um|em) mundo (?:cada|onde|em que|cheio|tao|que)",
  ].join("|"),
);

function acharCadaVezMais(texto: string): string | null {
  for (const frase of frasesDe(texto)) {
    if (TEM_ALGARISMO.test(frase)) continue; // "cada vez mais caro: subiu 12% em um ano" é dado
    const m = CADA_VEZ_MAIS.exec(frase);
    if (m) return m[0].replace(/^[^a-z]+/, "").trim();
  }
  return null;
}

// --- 7. Paralelismo de slogan ------------------------------------------------------------------

const SLOGAN_MAIS_MENOS = /(?:^|[^a-z])(?<!quanto )(menos|mais) (?!que |do que |de )([a-z]+(?: [a-z]+){0,2}), (?:mais|menos) (?!que |do que )([a-z]+)/;
const SLOGAN_SEM_SEM_SEM = /(?:^|[^a-z])sem ([a-z]+(?: [a-z]+){0,2}), sem ([a-z]+(?: [a-z]+){0,2})(?:,| e) sem ([a-z]+)/;

function acharSlogan(texto: string): string | null {
  for (const frase of frasesDe(texto)) {
    if (TEM_ALGARISMO.test(frase)) continue;
    const m = SLOGAN_MAIS_MENOS.exec(frase) ?? SLOGAN_SEM_SEM_SEM.exec(frase);
    if (m) return m[0].replace(/^[^a-z]+/, "").trim();
  }
  return null;
}

// --- 8. Revelação vazia ------------------------------------------------------------------------

const REVELACAO = new RegExp(
  [
    "^[^a-z0-9]*(?:descubra|desvende|conheca|voce sabia que)(?![a-z])",
    "(?:^|[^a-z])(?:o que|a verdade que) ninguem (?:te )?(?:conta|fala|diz|avisa|mostra)",
    "(?:^|[^a-z])ninguem te (?:conta|fala|diz|avisa)",
    "(?:^|[^a-z])segredo revelado",
    "(?:^|[^a-z])revelamos",
  ].join("|"),
);

function acharRevelacao(texto: string): string | null {
  return REVELACAO.exec(texto)?.[0].replace(/^[^a-z]+/, "").trim() ?? null;
}

// --- A lista fechada ---------------------------------------------------------------------------

const FAMILIAS: Familia[] = [
  {
    id: "contraste-negado",
    nome: "contraste em duas metades (\"não é A, é B\")",
    conselho: "diga só o que é, direto, com o fato da ficha ou da evidência; o contraste só vale quando as duas metades são fatos",
    blocos: TODOS,
    achar: acharContraste,
  },
  {
    id: "virada-de-efeito",
    nome: "frase de virada de efeito (\"e isso muda tudo\")",
    conselho: "tire o anúncio da virada e conte o que muda, com o fato",
    blocos: ["titulo", "tema", "gancho", "corpo", "fechamento"],
    achar: acharVirada,
  },
  {
    id: "abertura-de-preparacao",
    nome: "abertura que anuncia o assunto (\"hoje vou falar de\", \"neste vídeo\")",
    conselho: "comece direto no fato, no problema ou na cena, sem avisar o que vem",
    blocos: ["titulo", "tema", "gancho"],
    achar: acharPreparacao,
  },
  {
    id: "despedida-cordial",
    nome: "despedida cordial (\"espero que tenha gostado\")",
    conselho: "termine com um pedido claro, num canal só, em vez da cortesia",
    blocos: ["fechamento", "chamada"],
    achar: acharDespedida,
  },
  {
    id: "intensificador-vazio",
    nome: "intensificador sem fato (\"incrível\", \"poderoso\", \"transformador\")",
    conselho: "troque o adjetivo pelo fato que o sustenta (número, prazo, nome, cena)",
    blocos: TODOS,
    achar: acharIntensificador,
  },
  {
    id: "cada-vez-mais",
    nome: "\"cada vez mais\" e parentes (\"nos dias de hoje\", \"na era digital\")",
    conselho: "diga o que mudou e quando, com o dado, em vez da tendência vaga",
    blocos: TODOS,
    achar: acharCadaVezMais,
  },
  {
    id: "paralelismo-de-slogan",
    nome: "paralelismo de slogan (\"menos A, mais B\")",
    conselho: "escreva a frase como se fala na loja, com o fato no lugar do ritmo",
    blocos: TODOS,
    achar: acharSlogan,
  },
  {
    id: "revelacao-vazia",
    nome: "revelação vazia (\"descubra\", \"o que ninguém te conta\")",
    conselho: "diga qual é a coisa em vez de prometer revelar",
    blocos: ["titulo", "tema", "gancho"],
    achar: acharRevelacao,
  },
];

/** Os nomes das famílias, na ordem da lista (para teste, documentação e contagem). */
export const FAMILIAS_DE_FORMULA: { id: FamiliaDeFormula; nome: string }[] = FAMILIAS.map((f) => ({ id: f.id, nome: f.nome }));

const NOME_DO_BLOCO: Record<BlocoDoTexto, string> = {
  titulo: "o título",
  tema: "o tema",
  gancho: "o gancho",
  corpo: "o corpo",
  fechamento: "o fechamento",
  chamada: "a chamada final",
};

/**
 * Confere os blocos de texto contra a lista fechada. Um achado por família e por bloco (o primeiro trecho que casa).
 * Bloco ausente ou vazio é pulado. Nunca lança: texto estranho só não casa.
 */
export function acharFormulasDeMaquina(texto: TextoParaConferir, opcoes: OpcoesDoDetector = {}): AchadoDeFormula[] {
  const achados: AchadoDeFormula[] = [];
  for (const bloco of Object.keys(texto) as BlocoDoTexto[]) {
    const bruto = texto[bloco];
    if (!bruto || !bruto.trim()) continue;
    const normalizado = normalizar(emUmaLinha(bruto));
    for (const familia of FAMILIAS) {
      if (!familia.blocos.includes(bloco)) continue;
      const trecho = familia.achar(normalizado, opcoes);
      if (!trecho) continue;
      achados.push({
        familia: familia.id,
        nome: familia.nome,
        bloco,
        trecho,
        motivo: `R-COPY-26: ${NOME_DO_BLOCO[bloco]} usa a fórmula ${familia.nome}, "${trecho.slice(0, 60)}"; ${familia.conselho}`,
      });
    }
  }
  return achados;
}

/** Só as frases dos motivos, na ordem (o que o `verificarExtra` e o `avisarExtra` devolvem). */
export function motivosDasFormulas(achados: AchadoDeFormula[]): string[] {
  return achados.map((a) => a.motivo);
}

// --- Avisos de forma da fala (R-COPY-28 e R-COPY-29) -------------------------------------------

const PALAVRAS_MAX_DA_FRASE_CURTA = 4;
const FRASES_CURTAS_EM_FILA = 3;

function contarPalavras(frase: string): number {
  return frase.split(/[ ]+/).filter((p) => /[a-z0-9]/.test(p)).length;
}

/** O trecho com três ou mais frases seguidas de até quatro palavras, ou null. As frases são separadas por ponto, exclamação e interrogação. */
export function acharFrasesPicotadas(texto: string): string | null {
  const frases = emUmaLinha(texto)
    .split(/(?<=[.!?])[ ]+/)
    .map((f) => f.trim())
    .filter(Boolean);
  let corrida: string[] = [];
  for (const frase of frases) {
    const n = contarPalavras(normalizar(frase));
    if (n > 0 && n <= PALAVRAS_MAX_DA_FRASE_CURTA) {
      corrida.push(frase);
      if (corrida.length >= FRASES_CURTAS_EM_FILA) return corrida.join(" ");
    } else {
      corrida = [];
    }
  }
  return null;
}

/** O número escrito de um jeito que ninguém fala em voz alta: "10x", "10+", "3-5 dias", "10k", "1,5 mi". */
const NUMERO_ABREVIADO = new RegExp(
  [
    "(?<![a-z0-9])[0-9]+(?:[.,][0-9]+)?x(?![a-z0-9])", // 10x
    "(?<![a-z0-9])[0-9]+\\+(?![0-9])", // 10+
    "(?<![0-9-])[0-9]{1,3}-[0-9]{1,3}(?![0-9-])", // 3-5
    "(?<![a-z0-9])[0-9]+(?:[.,][0-9]+)?k(?![a-z0-9])", // 10k
    "(?<![a-z0-9])[0-9]+(?:[.,][0-9]+)? ?(?:mi|mm)(?![a-z0-9])", // 1,5 mi
  ].join("|"),
);

export function acharNumeroAbreviado(texto: string): string | null {
  return NUMERO_ABREVIADO.exec(normalizar(emUmaLinha(texto)))?.[0].trim() ?? null;
}

/**
 * Os avisos de forma da fala (só gancho, corpo, fechamento e chamada: o que a pessoa fala em voz alta; o texto na tela é outra coisa).
 * Nunca reprovam: a sequência curta às vezes é o ritmo do gancho, e o número abreviado é um indício.
 */
export function avisosDeFormaDaFala(fala: Partial<Record<"gancho" | "corpo" | "fechamento" | "chamada", string>>): string[] {
  const avisos: string[] = [];
  const picotado = [fala.gancho, fala.corpo, fala.fechamento].map((t) => (t ? acharFrasesPicotadas(t) : null)).find(Boolean);
  if (picotado) {
    avisos.push(`R-COPY-28: três ou mais frases seguidas de até ${PALAVRAS_MAX_DA_FRASE_CURTA} palavras ("${picotado.slice(0, 50)}"); junte com "porque", "só que" ou "e aí"`);
  }
  for (const texto of [fala.gancho, fala.corpo, fala.fechamento, fala.chamada]) {
    const numero = texto ? acharNumeroAbreviado(texto) : null;
    if (numero) {
      avisos.push(`R-COPY-29: o número "${numero}" não dá para falar em voz alta; escreva como se diz ("dez vezes", "de três a cinco", "dez mil")`);
      break;
    }
  }
  return avisos;
}
