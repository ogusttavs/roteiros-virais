/**
 * E54, a pesquisa na hora: as travas que o CÓDIGO aplica a cada dado antes de a pessoa ver (puro, sem banco nem IA, testado com tabelas).
 * A confiança não depende de o modelo acertar (decisão do Gustavo, 06/10/2026: "tem que ser fonte confiável e tudo que trazer tem que
 * ser verídico pelas fontes"). Cada dado nasce de uma linha da resposta da ferramenta de busca com a citação literal dela, e só fica se:
 *   1. a página é de uma fonte da lista curada (`config/fontes-pesquisa.ts`) e o endereço é https seguro;
 *   2. tem citação da própria ferramenta (url e trecho literal de até 150 caracteres);
 *   3. cada número da frase está no trecho, com a MESMA unidade e a mesma escala ("12%" não é "12 meses", "R$ 2 milhões" não é "R$ 2
 *      bilhões" nem "US$ 2 milhões"), e a frase não traz palavra de quantidade ("dobrou", "metade", "dez"), nome próprio ou sigla que o
 *      trecho, o título da página e a fonte não tenham, nem diz o contrário do trecho (alta x queda, aprovada x tramita);
 *   4. a data da página fica à vista; passou de 12 meses, vem marcado como antigo.
 * Dá para garantir que o dado está escrito numa fonte confiável, com trecho e link; não dá para garantir que a fonte esteja certa, nem que
 * a leitura de uma frase longa seja a que o autor quis. As travas são conservadoras de propósito: o que elas derrubam a pessoa não vê, e
 * o que passa ela ainda vê ao lado do trecho e do link, e decide.
 */
import { fonteDoEndereco, type FonteDePesquisa } from "@/config/fontes-pesquisa";
import type { AchadoDaPesquisa, PerguntaDePosicao, PremissaDaPesquisa } from "@/db/schema";
import type { LinhaDaBusca, PaginaDaBusca, RespostaDaBusca } from "@/ia/busca-na-web";
import { config } from "@/lib/config";

import { enderecoHttpsSeguro, limparParaPrompt } from "./noticias-assuntos";


const DIA_MS = 24 * 60 * 60 * 1000;
/** Quantos dados já vêm marcados quando a pessoa abre os achados ("usar estes três"). */
const MARCADOS_DE_INICIO = 3;

/** Minúsculas e sem acento: a forma em que os textos se comparam. */
export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// ---------------------------------------------------------------------------------------------------------------------
// Números com unidade e escala
// ---------------------------------------------------------------------------------------------------------------------

const ESCALAS: Record<string, number> = { mil: 1e3, milhao: 1e6, milhoes: 1e6, bilhao: 1e9, bilhoes: 1e9, trilhao: 1e12, trilhoes: 1e12 };
const UNIDADES_DE_TEMPO: Record<string, string> = {
  ano: "ano", anos: "ano", mes: "mes", meses: "mes", dia: "dia", dias: "dia", semana: "semana", semanas: "semana", hora: "hora", horas: "hora",
  minuto: "minuto", minutos: "minuto", trimestre: "trimestre", trimestres: "trimestre", semestre: "semestre", semestres: "semestre",
};

export type TokenNumerico = {
  /** `valor|classe`: o que se compara. A classe é `%`, a moeda (`brl`, `usd`, `eur`), a unidade de tempo (`t:mes`) ou vazia. */
  chave: string;
  valor: string;
  classe: string;
  bruto: string;
  /** Os poucos caracteres antes do número, sem acento (para saber se "2026" vem depois de "em"). */
  antes: string;
};

/** O valor de um número escrito do jeito do Brasil ("1.250,75", "4,5", "12.5"); `null` quando não dá para ler sem chutar ("1,2,3", "10.05.2026"). */
function valorCanonico(bruto: string): string | null {
  let valor = bruto;
  if (valor.includes(",")) {
    const partes = valor.split(",");
    // Mais de uma vírgula é lista ("1,2,3"), e ponto depois da vírgula não é número do Brasil ("1.000,5.2").
    if (partes.length > 2 || partes[1].includes(".")) return null;
    valor = valor.replace(/\./g, "").replace(",", ".");
  } else if (valor.includes(".")) {
    const grupos = valor.split(".");
    const milhar = grupos.slice(1).every((g) => g.length === 3) && grupos[0].length <= 3 && !grupos[0].startsWith("0");
    if (milhar) valor = grupos.join("");
    else if (grupos.length > 2) return null;
  }
  const [inteiro, decimal] = valor.split(".");
  const limpoInteiro = inteiro.replace(/^0+(?=\d)/, "");
  const limpoDecimal = (decimal ?? "").replace(/0+$/, "");
  return limpoDecimal ? `${limpoInteiro}.${limpoDecimal}` : limpoInteiro;
}

/**
 * Os números de um texto com a unidade que carregam. O que não dá para ler sem chutar volta como o texto cru (`bruto|?`), que então
 * precisa estar escrito igual no trecho: nunca some em silêncio. Pura.
 */
export function tokensNumericos(texto: string): TokenNumerico[] {
  const tokens: TokenNumerico[] = [];
  for (const m of texto.matchAll(/\d[\d.,]*\d|\d/g)) {
    const bruto = m[0];
    const inicio = m.index ?? 0;
    const fim = inicio + bruto.length;
    const antes = semAcento(texto.slice(Math.max(0, inicio - 9), inicio));
    const depois = semAcento(texto.slice(fim, fim + 28));
    const valor = valorCanonico(bruto);
    if (valor === null) {
      tokens.push({ chave: `${bruto}|?`, valor: bruto, classe: "?", bruto, antes });
      continue;
    }

    let resto = depois;
    let valorFinal = valor;
    const escala = /^\s*(mil|milhao|milhoes|bilhao|bilhoes|trilhao|trilhoes)\b/.exec(resto);
    if (escala) {
      valorFinal = String(Number((Number(valor) * ESCALAS[escala[1]]).toPrecision(12)));
      resto = resto.slice(escala[0].length);
    }

    let classe = "";
    if (/^\s*(%|por cento|pontos? percentuais?|p\.p\.)/.test(depois)) {
      classe = "%";
    } else {
      const moedaDepois = /^\s*(?:de\s+)?(reais|real|dolares|dolar|euros?)\b/.exec(resto);
      const simbolo = /(r\$|us\$|u\$s|€|\$)\s*$/.exec(antes);
      const moeda = moedaDepois?.[1] ?? simbolo?.[1] ?? null;
      if (moeda) {
        classe = /^(r\$|reais|real)$/.test(moeda) ? "brl" : /^(us\$|u\$s|\$|dolares|dolar)$/.test(moeda) ? "usd" : "eur";
      } else {
        const tempo = /^\s*(?:de\s+)?(anos?|meses|mes|dias?|semanas?|horas?|minutos?|trimestres?|semestres?)\b/.exec(resto);
        if (tempo) classe = `t:${UNIDADES_DE_TEMPO[tempo[1]] ?? tempo[1]}`;
      }
    }
    tokens.push({ chave: `${valorFinal}|${classe}`, valor: valorFinal, classe, bruto, antes });
  }
  return tokens;
}

/** As chaves (`valor|classe`) dos números de um texto. */
export function numerosDoTexto(texto: string): string[] {
  return tokensNumericos(texto).map((t) => t.chave);
}

function pareceAno(valor: string): boolean {
  return /^\d{4}$/.test(valor) && Number(valor) >= 1990 && Number(valor) <= 2100;
}

/**
 * A trava 3, a parte dos números: cada número da afirmação está no trecho com a mesma unidade e escala. Um ano que só a data da página
 * tem vale quando a frase o usa como ano ("em 2026") e o trecho não traz nenhum outro ano (senão "em 2026" poderia ser o ano de
 * publicação no lugar do ano do dado). Devolve as chaves que faltam (vazio = confere).
 */
export function numerosForaDoTrecho(afirmacao: string, trecho: string, anoDaPagina: string | null): string[] {
  const doTrecho = tokensNumericos(trecho);
  const noTrecho = new Set(doTrecho.map((t) => t.chave));
  const trechoTemAno = doTrecho.some((t) => pareceAno(t.valor) && t.classe === "");
  const faltam: string[] = [];
  for (const token of tokensNumericos(afirmacao)) {
    if (noTrecho.has(token.chave)) continue;
    const comoAno =
      anoDaPagina !== null &&
      !trechoTemAno &&
      token.classe === "" &&
      token.bruto === token.valor &&
      pareceAno(token.valor) &&
      token.valor === anoDaPagina &&
      /\b(em|de|desde|ate|no ano|ano)\s*$/.test(token.antes);
    if (!comoAno && !faltam.includes(token.chave)) faltam.push(token.chave);
  }
  return faltam;
}

// ---------------------------------------------------------------------------------------------------------------------
// Frase sem número: palavra de quantidade, nome próprio, relação com o trecho e sentido
// ---------------------------------------------------------------------------------------------------------------------

/** Palavras de quantidade que podem carregar um fato sem dígito. "um" e "uma" ficam de fora: são artigos. */
const PALAVRAS_DE_QUANTIDADE = new Set([
  "dois", "duas", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "cem", "mil", "milhao", "milhoes", "bilhao", "bilhoes",
  "metade", "dobro", "dobrou", "dobraram", "triplo", "triplicou", "terco", "ambos", "todos", "nenhum", "nenhuma",
]);

const PALAVRAS_COMUNS = new Set(["brasil", "brasileiro", "brasileira", "brasileiros", "brasileiras", "federal"]);

const STOPWORDS = new Set([
  "para", "como", "mais", "menos", "sobre", "entre", "este", "esta", "esse", "essa", "isso", "isto", "cada", "pelo", "pela", "pelos", "pelas",
  "seu", "sua", "seus", "suas", "foi", "foram", "tem", "tinha", "uma", "umas", "uns", "que", "por", "com", "nao", "sim", "ser", "sao", "esta",
  "estao", "num", "numa", "dos", "das", "nos", "nas", "segundo", "ainda", "apos", "desde", "ate", "onde", "quando", "tambem", "outro", "outra",
  "outros", "outras", "muito", "muita", "muitos", "muitas", "mesmo", "mesma", "outro", "lado", "ano", "anos", "mes", "meses", "dia", "dias",
]);

/** As palavras da frase com a primeira letra maiúscula (fora o começo da frase e o que vem depois de dois-pontos) e as siglas. */
function nomesProprios(texto: string): string[] {
  const nomes: string[] = [];
  const palavras = [...texto.matchAll(/\p{L}+/gu)];
  let inicioDeFrase = true;
  let anterior = 0;
  for (const m of palavras) {
    const intervalo = texto.slice(anterior, m.index ?? 0);
    if (/[.:!?]/.test(intervalo)) inicioDeFrase = true;
    const p = m[0];
    const ehSigla = /^\p{Lu}{2,}\d*$/u.test(p);
    const ehNome = /^\p{Lu}\p{Ll}{2,}$/u.test(p);
    if (!inicioDeFrase && (ehSigla || ehNome)) nomes.push(semAcento(p));
    else if (inicioDeFrase && ehSigla) nomes.push(semAcento(p));
    inicioDeFrase = false;
    anterior = (m.index ?? 0) + p.length;
  }
  return nomes.filter((n) => !PALAVRAS_COMUNS.has(n));
}

function palavrasDeConteudo(texto: string): Set<string> {
  const saida = new Set<string>();
  for (const m of semAcento(texto).matchAll(/[a-z]+/g)) {
    const p = m[0];
    if (p.length < 4 || STOPWORDS.has(p)) continue;
    saida.add(p.length >= 6 ? p.slice(0, 5) : p);
  }
  return saida;
}

function palavrasSoltas(texto: string): Set<string> {
  return new Set([...semAcento(texto).matchAll(/[a-z]+/g)].map((m) => m[0]));
}

const SUBIU = ["alta", "subiu", "subir", "sobe", "aumento", "aumentou", "aumentar", "cresceu", "crescimento", "avanco", "avancou", "elevou", "elevacao", "disparou"];
const CAIU = ["queda", "caiu", "cair", "cai", "recuou", "recuo", "reducao", "reduziu", "diminuiu", "desacelerou", "baixa", "baixou", "despencou"];
const DECIDIDO = ["aprovou", "aprovada", "aprovado", "aprovacao", "sancionou", "sancionada", "sancionado", "publicou", "publicada", "publicado"];
const EM_ABERTO = ["tramita", "tramitacao", "tramitando", "rejeitou", "rejeitada", "rejeitado", "arquivou", "arquivada", "arquivado", "analise"];

function temAlgum(palavras: Set<string>, lista: string[]): boolean {
  return lista.some((p) => palavras.has(p));
}

/**
 * A trava 3, a parte do sentido. Devolve `null` quando a frase combina com o trecho, ou o motivo que a derruba:
 * `termo` (palavra de quantidade, nome próprio ou sigla que o trecho, o título e a fonte não têm), `relacao` (quase nada em comum) e
 * `oposto` (a frase diz alta e o trecho queda, ou aprovada e o trecho tramitação). Pura, e conservadora por desenho.
 */
export function motivoDeNaoBater(frase: string, trecho: string, contexto: { titulo?: string | null; fonteNome?: string; host?: string }): "termo" | "relacao" | "oposto" | null {
  const base = `${trecho} ${contexto.titulo ?? ""} ${contexto.fonteNome ?? ""} ${contexto.host ?? ""}`;
  const noTrecho = palavrasSoltas(trecho);
  const naBase = palavrasSoltas(base);

  for (const palavra of palavrasSoltas(frase)) {
    if (PALAVRAS_DE_QUANTIDADE.has(palavra) && !noTrecho.has(palavra)) return "termo";
  }
  for (const nome of nomesProprios(frase)) {
    if (!naBase.has(nome)) return "termo";
  }

  const deConteudo = palavrasDeConteudo(frase);
  const dabase = palavrasDeConteudo(base);
  const emComum = [...deConteudo].filter((p) => dabase.has(p)).length;
  if (emComum < Math.min(2, deConteudo.size)) return "relacao";

  const daFrase = palavrasSoltas(frase);
  const doTrecho = new Set([...noTrecho, ...palavrasSoltas(contexto.titulo ?? "")]);
  if (temAlgum(daFrase, SUBIU) && !temAlgum(daFrase, CAIU) && temAlgum(doTrecho, CAIU) && !temAlgum(doTrecho, SUBIU)) return "oposto";
  if (temAlgum(daFrase, CAIU) && !temAlgum(daFrase, SUBIU) && temAlgum(doTrecho, SUBIU) && !temAlgum(doTrecho, CAIU)) return "oposto";
  if (temAlgum(daFrase, DECIDIDO) && !temAlgum(daFrase, EM_ABERTO) && temAlgum(doTrecho, EM_ABERTO) && !temAlgum(doTrecho, DECIDIDO)) return "oposto";
  if (temAlgum(daFrase, EM_ABERTO) && !temAlgum(daFrase, DECIDIDO) && temAlgum(doTrecho, DECIDIDO) && !temAlgum(doTrecho, EM_ABERTO)) return "oposto";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Data da página: a trava 4
// ---------------------------------------------------------------------------------------------------------------------

const MESES_EN = new Map<string, number>(
  ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].flatMap((nome, i) => [
    [nome, i + 1] as [string, number],
    [nome.slice(0, 3), i + 1] as [string, number],
  ]),
);
MESES_EN.set("sept", 9);
const MESES_PT = new Map<string, number>(
  ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"].flatMap((nome, i) => [
    [nome, i + 1] as [string, number],
    [nome.slice(0, 3), i + 1] as [string, number],
  ]),
);

function dataIso(ano: number, mes: number, dia: number): string | null {
  if (ano < 1990 || ano > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCMonth() + 1 !== mes || d.getUTCDate() !== dia) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * "April 30, 2025", "Sep 3, 2026", "3 April 2026", "2025-04-30", "30 de abril de 2025" e "30/04/2025" viram AAAA-MM-DD. O que não deu
 * para ler (inclusive "2 days ago" e um dia que não existe) volta `null`: o dado aparece "sem data" e a pessoa decide. Pura.
 */
export function lerDataDaPagina(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const t = semAcento(texto.trim()).replace(/\./g, "");
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return dataIso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
  if (m && MESES_EN.has(m[1])) return dataIso(Number(m[3]), MESES_EN.get(m[1])!, Number(m[2]));
  m = /^(\d{1,2})\s+([a-z]+),?\s+(\d{4})$/.exec(t);
  if (m && MESES_EN.has(m[2])) return dataIso(Number(m[3]), MESES_EN.get(m[2])!, Number(m[1]));
  m = /^(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})$/.exec(t);
  if (m && MESES_PT.has(m[2])) return dataIso(Number(m[3]), MESES_PT.get(m[2])!, Number(m[1]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return dataIso(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/** Mais velho que `meses` meses (contados em 30 dias); data que não se leu nunca é "antiga", só "sem data". */
export function ehAntigo(dataDaPagina: string | null, agora: Date, meses = config.regras.pesquisaNaHoraDadoAntigoMeses): boolean {
  if (!dataDaPagina) return false;
  const quando = new Date(`${dataDaPagina}T12:00:00Z`).getTime();
  return agora.getTime() - quando > meses * 30 * DIA_MS;
}

// ---------------------------------------------------------------------------------------------------------------------
// Das linhas da resposta para os dados conferidos
// ---------------------------------------------------------------------------------------------------------------------

export type DescartesDaPesquisa = {
  semCitacao: number;
  forDaLista: number;
  enderecoInseguro: number;
  numeroForaDoTrecho: number;
  termoForaDoTrecho: number;
  semRelacao: number;
  sentidoOposto: number;
  repetido: number;
  semTexto: number;
  alemDoLimite: number;
};

export const SEM_DESCARTES: DescartesDaPesquisa = {
  semCitacao: 0,
  forDaLista: 0,
  enderecoInseguro: 0,
  numeroForaDoTrecho: 0,
  termoForaDoTrecho: 0,
  semRelacao: 0,
  sentidoOposto: 0,
  repetido: 0,
  semTexto: 0,
  alemDoLimite: 0,
};

const TRAVESSOES = new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}]`, "g");

/** A frase do modelo como a pessoa a lê: sem marcador de lista, sem negrito, sem travessão (regra do projeto). */
function limparLinha(texto: string): string {
  return limparParaPrompt(texto.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").replace(/\*\*/g, ""), 400)
    .replace(new RegExp(`\\s+[${String.fromCharCode(0x2014, 0x2013)}]\\s+`, "g"), ", ")
    .replace(TRAVESSOES, "-")
    .trim();
}

/** Uma frase com endereço, "www." ou "@" não é um dado: é conteúdo que a página quis pôr no nosso texto. */
function temEnderecoOuMencao(texto: string): boolean {
  return /https?:\/\/|www\.|@/i.test(texto);
}

function chaveDaFrase(texto: string): string {
  return semAcento(texto)
    .replace(/(?<!\d)[.,]|[.,](?!\d)/g, " ")
    .replace(/[^\p{L}\p{N}\s.,]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function paginaDaUrl(paginas: PaginaDaBusca[], url: string): PaginaDaBusca | undefined {
  const sem = (u: string) => u.replace(/#.*$/, "").replace(/\/+$/, "");
  return paginas.find((p) => p.url === url) ?? paginas.find((p) => sem(p.url) === sem(url));
}

/**
 * Das linhas da resposta, os dados que passam nas travas, ordenados (a fonte oficial com nome primeiro, depois a imprensa, depois o
 * órgão público genérico; dentro de cada grupo, o não antigo e o mais recente) e limitados. `fontes` e `agora` só os testes trocam. Pura.
 */
export function montarAchados(
  resposta: Pick<RespostaDaBusca, "linhas" | "paginas">,
  opcoes: { agora?: Date; fontes?: FonteDePesquisa[]; limite?: number } = {},
): { achados: AchadoDaPesquisa[]; descartes: DescartesDaPesquisa } {
  const agora = opcoes.agora ?? new Date();
  const limite = opcoes.limite ?? config.regras.pesquisaNaHoraDadosMax;
  const descartes: DescartesDaPesquisa = { ...SEM_DESCARTES };
  const vistos = new Set<string>();
  const candidatos: (Omit<AchadoDaPesquisa, "id"> & { prioridade: number })[] = [];

  for (const linha of resposta.linhas as LinhaDaBusca[]) {
    const texto = limparLinha(linha.texto);
    if (texto.length < 12 || !/\p{L}/u.test(texto) || /^n[ãa]o encontrei/i.test(texto) || temEnderecoOuMencao(texto)) {
      descartes.semTexto += 1;
      continue;
    }
    // Trava 2: sem citação da ferramenta, não é dado.
    const citacoes = linha.citacoes.filter((c) => c.url && c.trecho.trim() !== "");
    if (citacoes.length === 0) {
      descartes.semCitacao += 1;
      continue;
    }
    // Trava 1: a citação é de uma fonte da lista e o endereço é https seguro.
    const daLista = citacoes.filter((c) => fonteDoEndereco(c.url, opcoes.fontes) !== null);
    if (daLista.length === 0) {
      descartes.forDaLista += 1;
      continue;
    }
    const seguras = daLista.filter((c) => enderecoHttpsSeguro(c.url) !== null);
    if (seguras.length === 0) {
      descartes.enderecoInseguro += 1;
      continue;
    }
    // A melhor citação primeiro (a oficial com nome, depois o mais recente): se mais de uma sustenta, é a melhor que sustenta.
    const comPagina = seguras
      .map((c) => {
        const pagina = paginaDaUrl(resposta.paginas, c.url);
        const fonte = fonteDoEndereco(c.url, opcoes.fontes) as FonteDePesquisa;
        return { citacao: c, pagina, fonte, dataDaPagina: lerDataDaPagina(pagina?.idade) };
      })
      .sort((a, b) => prioridadeDaFonte(a.fonte) - prioridadeDaFonte(b.fonte) || (b.dataDaPagina ?? "").localeCompare(a.dataDaPagina ?? ""));

    let sustento: (typeof comPagina)[number] | null = null;
    let motivo: "numero" | "termo" | "relacao" | "oposto" | null = null;
    for (const candidata of comPagina) {
      const { citacao, pagina, fonte, dataDaPagina } = candidata;
      if (numerosForaDoTrecho(texto, citacao.trecho, dataDaPagina?.slice(0, 4) ?? null).length > 0) {
        motivo = motivo ?? "numero";
        continue;
      }
      const naoBate = motivoDeNaoBater(texto, citacao.trecho, { titulo: citacao.titulo ?? pagina?.titulo ?? null, fonteNome: fonte.nome, host: new URL(citacao.url).hostname });
      if (naoBate) {
        motivo = motivo ?? naoBate;
        continue;
      }
      sustento = candidata;
      break;
    }
    if (!sustento) {
      if (motivo === "numero") descartes.numeroForaDoTrecho += 1;
      else if (motivo === "termo") descartes.termoForaDoTrecho += 1;
      else if (motivo === "relacao") descartes.semRelacao += 1;
      else descartes.sentidoOposto += 1;
      continue;
    }

    const chave = chaveDaFrase(texto);
    if (vistos.has(chave)) {
      descartes.repetido += 1;
      continue;
    }
    vistos.add(chave);

    candidatos.push({
      texto,
      fonteNome: sustento.fonte.nome,
      fonteTipo: sustento.fonte.tipo,
      url: new URL(sustento.citacao.url).href,
      titulo: sustento.citacao.titulo ?? sustento.pagina?.titulo ?? null,
      dataDaPagina: sustento.dataDaPagina,
      dataTexto: sustento.pagina?.idade ?? null,
      antigo: ehAntigo(sustento.dataDaPagina, agora),
      citacao: sustento.citacao.trecho.slice(0, 200),
      prioridade: prioridadeDaFonte(sustento.fonte),
    });
  }

  candidatos.sort((a, b) => {
    if (a.prioridade !== b.prioridade) return a.prioridade - b.prioridade;
    if (a.antigo !== b.antigo) return a.antigo ? 1 : -1;
    if (a.dataDaPagina === b.dataDaPagina) return 0;
    if (a.dataDaPagina === null) return 1;
    if (b.dataDaPagina === null) return -1;
    return a.dataDaPagina < b.dataDaPagina ? 1 : -1;
  });
  descartes.alemDoLimite = Math.max(0, candidatos.length - limite);
  const achados: AchadoDaPesquisa[] = candidatos.slice(0, limite).map((c, i) => ({
    id: i + 1,
    texto: c.texto,
    fonteNome: c.fonteNome,
    fonteTipo: c.fonteTipo,
    url: c.url,
    titulo: c.titulo,
    dataDaPagina: c.dataDaPagina,
    dataTexto: c.dataTexto,
    antigo: c.antigo,
    citacao: c.citacao,
  }));
  return { achados, descartes };
}

/** 0 a fonte oficial com nome (IBGE, Banco Central), 1 a imprensa grande, 2 o órgão público genérico (`gov.br`, que cobre até prefeitura). */
function prioridadeDaFonte(fonte: FonteDePesquisa): number {
  if (fonte.tipo === "imprensa") return 1;
  return fonte.dominio === "gov.br" && fonte.nome !== "Governo federal" ? 2 : 0;
}

/** Os dados que já vêm marcados: os primeiros que têm data e não são antigos. O dado sem data fica desmarcado: a pessoa decide. */
export function marcadosDeInicio(achados: AchadoDaPesquisa[]): number[] {
  return achados.filter((a) => !a.antigo && a.dataDaPagina !== null).slice(0, MARCADOS_DE_INICIO).map((a) => a.id);
}

// ---------------------------------------------------------------------------------------------------------------------
// A conferência da premissa (passo 2), com o que o código exige do modelo
// ---------------------------------------------------------------------------------------------------------------------

export type SaidaDaConferencia = {
  premissa: { situacao: "sem_premissa" | "confere" | "nao_confere"; aviso: string | null; anguloSugerido: string | null; achadoIds: number[] };
  perguntaDePosicao: { pergunta: string; opcoes: string[] } | null;
};

export const OPCAO_SEM_OPINIAO = "Prefiro não dar opinião";

function cortar(texto: string | null | undefined, maximo: number): string | null {
  const limpo = limparLinha(texto ?? "");
  if (limpo === "" || temEnderecoOuMencao(limpo)) return null;
  return limpo.length > maximo ? limpo.slice(0, maximo).trimEnd() : limpo;
}

/**
 * O que o modelo devolveu, depois do código: "não bate" só com pelo menos um dado que o sustente, com o aviso escrito e sem número que
 * os dados citados não tenham; senão volta a "confere". A pergunta de posição só com duas a quatro opções, e a última é sempre a de não
 * opinar. Acusar a pessoa de errar sem prova é pior do que deixar passar.
 */
export function sanearConferencia(
  saida: SaidaDaConferencia,
  achados: Pick<AchadoDaPesquisa, "id" | "texto" | "citacao">[],
): { premissa: PremissaDaPesquisa; perguntaDePosicao: PerguntaDePosicao | null } {
  const porId = new Map(achados.map((a) => [a.id, a]));
  const sustentam = [...new Set(saida.premissa.achadoIds)].filter((id) => porId.has(id));
  const aviso = cortar(saida.premissa.aviso, 400);
  const angulo = cortar(saida.premissa.anguloSugerido, 300);
  const base = sustentam.map((id) => `${porId.get(id)!.texto} ${porId.get(id)!.citacao}`).join(" ");
  const numerosDoAviso = aviso ? numerosForaDoTrecho(`${aviso} ${angulo ?? ""}`, base, null) : [];

  let premissa: PremissaDaPesquisa;
  if (saida.premissa.situacao === "nao_confere" && aviso && sustentam.length > 0 && numerosDoAviso.length === 0) {
    premissa = { situacao: "nao_confere", aviso, anguloSugerido: angulo, achadoIds: sustentam };
  } else if (saida.premissa.situacao === "sem_premissa") {
    premissa = { situacao: "sem_premissa", aviso: null, anguloSugerido: null, achadoIds: [] };
  } else {
    premissa = { situacao: "confere", aviso: null, anguloSugerido: null, achadoIds: [] };
  }

  let perguntaDePosicao: PerguntaDePosicao | null = null;
  const pergunta = cortar(saida.perguntaDePosicao?.pergunta, 160);
  const opcoes = (saida.perguntaDePosicao?.opcoes ?? [])
    .map((o) => cortar(o, 60))
    .filter((o): o is string => o !== null && !/^prefiro n[ãa]o/i.test(o))
    .slice(0, 3);
  if (pergunta && opcoes.length >= 1) perguntaDePosicao = { pergunta, opcoes: [...opcoes, OPCAO_SEM_OPINIAO] };
  return { premissa, perguntaDePosicao };
}
