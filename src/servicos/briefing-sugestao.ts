/**
 * E76 PR 1: a sugestão de resposta do briefing (o `exemplo` de `avaliarResposta`) não inventa dado. Numa avaliação externa de um
 * cadastro real (26/11/2026) ela fabricou "5 empresas importaram nos últimos 6 meses", "importar custa um terço na China" e "o
 * Instagram foi lançado há dois meses com 4 posts". Quem toca em "Usar esta sugestão" publica mentira com a própria marca, e a
 * resposta vira a verdade que a IA usa em todo roteiro.
 *
 * O prompt (1.7.0) já manda travar os fatos; esta é a conferência por CÓDIGO, sem IA, depois da geração: todo número, porcentagem,
 * preço, ano ou quantidade da sugestão (com dígito ou por extenso, "dois meses", "um terço", "metade") precisa estar nas FONTES DA
 * MARCA: a resposta do cliente, as outras respostas do briefing, o que lemos do site e das redes e os dados fixos da marca. O que
 * não está vira um espaço entre colchetes em forma de pergunta ("[quantas empresas?]"), que a tela destaca e não deixa avaliar sem
 * completar. Se a sugestão ficar mais colchete que texto, ela é descartada (a tela não mostra sugestão nenhuma).
 *
 * É conservadora de propósito, no mesmo espírito de `conferencia-da-pesquisa.ts` (de onde vêm `semAcento` e a leitura do número
 * escrito do jeito do Brasil): um número que bate com a fonte, mas com outra unidade ("6 meses" contra "6 clientes") ou outro
 * objeto ("5 empresas" contra "5 países"), também vira colchete. O que já está entre colchetes, ou dentro de um endereço, não é
 * conferido. Pura: sem banco, sem IA.
 */
import { dividirPorColchetes } from "@/carrossel/colchetes";

import { semAcento, valorCanonico } from "./conferencia-da-pesquisa";

/** Mais trocas que isto e a sugestão vira um formulário de colchetes: é descartada. */
export const MAXIMO_DE_TROCAS = 4;

/** Menos palavras que isto fora dos colchetes (depois das trocas) e a sugestão não diz mais nada: também é descartada. */
const MINIMO_DE_PALAVRAS_FORA = 3;

/** Palavra que, antes de um número de quatro dígitos, faz dele um ano ("em 2019", "desde 2019"). */
const ANTES_DE_ANO = new Set(["em", "de", "desde", "ate", "ano", "no", "do", "para", "entre", "e"]);

export type ResultadoDaConferencia = {
  /** A sugestão com cada dado sem fonte trocado por colchete, ou vazia quando foi descartada. */
  texto: string;
  /** O que foi trocado, como estava escrito ("5 empresas", "um terço"), na ordem. */
  trocados: string[];
  descartada: boolean;
};

// ---------------------------------------------------------------------------------------------------------------------
// Leitura do texto em pedaços
// ---------------------------------------------------------------------------------------------------------------------

type Lexema = { tipo: "moeda" | "num" | "pal" | "sim"; texto: string; inicio: number; fim: number };

const LEXEMA = /(?<moeda>R\$|US\$|U\$S|€|\$)|(?<num>\d(?:[\d.,]*\d)?)|(?<pal>\p{L}+)|(?<sim>\S)/gu;

function lexemas(texto: string): Lexema[] {
  const lista: Lexema[] = [];
  for (const m of texto.matchAll(LEXEMA)) {
    const grupos = m.groups ?? {};
    const tipo = grupos.moeda ? "moeda" : grupos.num ? "num" : grupos.pal ? "pal" : "sim";
    const inicio = m.index ?? 0;
    lista.push({ tipo, texto: m[0], inicio, fim: inicio + m[0].length });
  }
  return lista;
}

const norm = (palavra: string): string => semAcento(palavra);

/** A chave é do próprio objeto (nunca do protótipo: `"constructor" in {}` é verdade). */
const tem = (objeto: object, chave: string): boolean => Object.prototype.hasOwnProperty.call(objeto, chave);

/** Números por extenso. "um" e "uma" ficam de fora (são artigos), menos antes de ano, mês, semana ou de "milhão". */
const EXTENSO: Record<string, number> = {
  dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14,
  quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
  sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300,
  quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700,
  oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900, mil: 1000,
};

const ESCALA: Record<string, number> = { mil: 1e3, milhao: 1e6, milhoes: 1e6, bilhao: 1e9, bilhoes: 1e9, k: 1e3, mi: 1e6, bi: 1e9 };

/** Unidade de tempo: a chave da classe, a palavra no plural e se é feminina (para "quantos" ou "quantas"). */
const TEMPO: Record<string, { unidade: string; plural: string; feminino: boolean }> = {
  ano: { unidade: "ano", plural: "anos", feminino: false },
  anos: { unidade: "ano", plural: "anos", feminino: false },
  mes: { unidade: "mes", plural: "meses", feminino: false },
  meses: { unidade: "mes", plural: "meses", feminino: false },
  dia: { unidade: "dia", plural: "dias", feminino: false },
  dias: { unidade: "dia", plural: "dias", feminino: false },
  semana: { unidade: "semana", plural: "semanas", feminino: true },
  semanas: { unidade: "semana", plural: "semanas", feminino: true },
  hora: { unidade: "hora", plural: "horas", feminino: true },
  horas: { unidade: "hora", plural: "horas", feminino: true },
  h: { unidade: "hora", plural: "horas", feminino: true },
  minuto: { unidade: "minuto", plural: "minutos", feminino: false },
  minutos: { unidade: "minuto", plural: "minutos", feminino: false },
  min: { unidade: "minuto", plural: "minutos", feminino: false },
  trimestre: { unidade: "trimestre", plural: "trimestres", feminino: false },
  trimestres: { unidade: "trimestre", plural: "trimestres", feminino: false },
  semestre: { unidade: "semestre", plural: "semestres", feminino: false },
  semestres: { unidade: "semestre", plural: "semestres", feminino: false },
  decada: { unidade: "decada", plural: "décadas", feminino: true },
  decadas: { unidade: "decada", plural: "décadas", feminino: true },
};

/** "um" e "uma" só contam como número antes destas unidades ("há um ano", "em uma semana"); "um dia" é jeito de contar história. */
const TEMPO_DEPOIS_DE_UM = new Set(["ano", "mes", "semana", "decada"]);

const MOEDA_POR_PALAVRA: Record<string, string> = { reais: "brl", real: "brl", dolares: "usd", dolar: "usd", euros: "eur", euro: "eur" };
const MOEDA_POR_SIMBOLO: Record<string, string> = { "R$": "brl", "US$": "usd", U$S: "usd", "$": "usd", "€": "eur" };
const COLCHETE_DA_MOEDA: Record<string, string> = { brl: "quanto, em reais?", usd: "quanto, em dólares?", eur: "quanto, em euros?" };

/** Quantidade sem número exato: vale só se a mesma palavra está nas fontes. */
const PALAVRA_DE_QUANTIDADE: Record<string, string> = {
  terco: "quanto?", tercos: "quanto?", metade: "quanto?", dobro: "quanto?", triplo: "quanto?", quadruplo: "quanto?",
  dobrou: "quanto cresceu?", dobraram: "quanto cresceu?", triplicou: "quanto cresceu?", triplicaram: "quanto cresceu?",
  quadruplicou: "quanto cresceu?", quadruplicaram: "quanto cresceu?",
};
/** "centenas de clientes": vale só se a palavra está nas fontes; senão vira "[quantos clientes?]". */
const PALAVRA_DE_MONTANTE = new Set(["dezenas", "centenas", "milhares"]);

/** O que vem depois do número e nunca é o objeto contado ("5 de 10", "3 e meio", "2 no mês"). */
const NAO_E_OBJETO = new Set([
  "de", "do", "da", "dos", "das", "e", "ou", "a", "o", "as", "os", "em", "no", "na", "nos", "nas", "que", "por", "para", "pra", "com", "sem",
  "mais", "menos", "ao", "aos", "se", "ja", "foi", "sao", "era", "eram", "tem", "ate", "entre", "sobre", "num", "numa", "pelo", "pela",
  "pelos", "pelas", "cada", "meio", "meia", "x",
]);

/** Palavras que terminam em "a" e são masculinas: "quantos dias", "quantos problemas". */
const MASCULINAS_EM_A = new Set(["dia", "problema", "sistema", "programa", "tema", "mapa", "clima", "idioma", "planeta", "esquema", "diploma", "telefonema", "poema", "cinema", "pijama", "sofa"]);

function ehFeminina(palavra: string): boolean {
  const p = norm(palavra).replace(/s$/, "");
  if (MASCULINAS_EM_A.has(p)) return false;
  if (/a$/.test(p)) return true;
  return /(cao|coe|dade|gem|gen|vez|vezes|mulher|mulhere|noite|tarde|parte|fase|classe|unidade|cidade|viagen|imagen|mensagen|postagen|ordem|ordens)$/.test(p) || /(coes|dades|gens|zes)$/.test(norm(palavra));
}

function plural(palavra: string): string {
  const p = palavra;
  if (/s$/i.test(p)) return p;
  if (/ão$/i.test(p)) return `${p.slice(0, -2)}ões`;
  if (/[aeiouáéíóúâêô]$/i.test(p)) return `${p}s`;
  if (/[rz]$/i.test(p)) return `${p}es`;
  if (/l$/i.test(p)) return `${p.slice(0, -1)}is`;
  if (/m$/i.test(p)) return `${p.slice(0, -1)}ns`;
  return `${p}s`;
}

/** As formas que a mesma palavra pode ter no singular e no plural, sem acento, para comparar o objeto contado. */
function formas(palavra: string): string[] {
  const p = norm(palavra);
  const lista = new Set([p]);
  if (p.endsWith("oes")) lista.add(`${p.slice(0, -3)}ao`);
  if (p.endsWith("ao")) lista.add(`${p.slice(0, -2)}oes`);
  if (/[rzs]es$/.test(p)) lista.add(p.slice(0, -2));
  if (p.endsWith("s")) lista.add(p.slice(0, -1));
  else lista.add(`${p}s`);
  if (/[rzs]$/.test(p)) lista.add(`${p}es`);
  return [...lista];
}

// ---------------------------------------------------------------------------------------------------------------------
// As quantidades de um texto
// ---------------------------------------------------------------------------------------------------------------------

type Quantidade = {
  inicio: number;
  fim: number;
  /** "numero": valor e classe; "palavra": metade, terço, centenas; "bruto": data, horário, telefone, o que não dá para ler sem chutar. */
  tipo: "numero" | "palavra" | "bruto";
  valor: string;
  /** "%", "brl", "usd", "eur", "t:<unidade>", "ano", "x" ou vazia. */
  classe: string;
  /** O objeto contado, quando a classe é vazia ("empresas" em "5 empresas"). */
  objeto: string | null;
  /** O texto de dentro do colchete que entra no lugar, sem os colchetes. */
  pergunta: string;
};

function pareceAno(valor: string): boolean {
  return /^\d{4}$/.test(valor) && Number(valor) >= 1900 && Number(valor) <= 2100;
}

/** Só espaço entre dois pedaços (nenhum sinal, nenhuma quebra de frase). */
function soEspaco(texto: string, de: number, ate: number): boolean {
  return /^[ \t ]*$/.test(texto.slice(de, ate));
}

/** Os trechos que não se conferem: o que já está entre colchetes e os endereços (site, @, e-mail). */
function trechosProtegidos(texto: string): { inicio: number; fim: number }[] {
  const lista: { inicio: number; fim: number }[] = [];
  let posicao = 0;
  for (const parte of dividirPorColchetes(texto)) {
    if (parte.colchete) lista.push({ inicio: posicao, fim: posicao + parte.texto.length });
    posicao += parte.texto.length;
  }
  for (const m of texto.matchAll(/(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|@[\w.]+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|br|net|org|app|io)(?:\/\S*)?/giu)) {
    const inicio = m.index ?? 0;
    lista.push({ inicio, fim: inicio + m[0].length });
  }
  return lista;
}


const PREFIXO_ENGOLIDO = /(?:^|[^\p{L}])((?:mais|menos|cerca|por volta|em torno) de|quase|aproximadamente|uns|umas)[ \t]+$/iu;

/**
 * Lê as quantidades de um texto. Para cada uma: onde começa e termina o trecho que a carrega (com a moeda, a escala, a unidade e o
 * objeto contado: "R$ 2 mil", "6 meses", "5 empresas"), a chave de comparação e a pergunta que entra no lugar. Pura.
 */
export function quantidadesDoTexto(texto: string): Quantidade[] {
  const lx = lexemas(texto);
  const protegidos = trechosProtegidos(texto);
  const protegido = (pos: number) => protegidos.some((t) => pos >= t.inicio && pos < t.fim);
  const lista: Quantidade[] = [];

  /** O próximo lexema depois de `i`, se só houver espaço entre os dois. */
  const seguinte = (i: number): Lexema | null => {
    const prox = lx[i + 1];
    return prox && soEspaco(texto, lx[i].fim, prox.inicio) ? prox : null;
  };
  /** O próximo lexema, se vier grudado ("10k", "5%"). */
  const colado = (i: number): Lexema | null => {
    const prox = lx[i + 1];
    return prox && prox.inicio === lx[i].fim ? prox : null;
  };
  const palavraEm = (l: Lexema | null | undefined): string => (l && l.tipo === "pal" ? norm(l.texto) : "");

  let i = 0;
  while (i < lx.length) {
    const atual = lx[i];
    if (protegido(atual.inicio)) {
      i += 1;
      continue;
    }

    let valorNumerico: number | null = null;
    let valorBruto: string | null = null;
    let fimIdx = i;

    if (atual.tipo === "num") {
      const antes = texto.slice(Math.max(0, atual.inicio - 1), atual.inicio);
      // Número colado a letra, sublinhado, @, # ou barra à esquerda é código ("B2B", "MP3", "@marca_2019"), não quantidade.
      if (/[\p{L}_@#/]/u.test(antes)) {
        i += 1;
        continue;
      }
      // Data, horário, telefone, proporção ("10/05", "14:30", "14h30", "98765-4321", "24/7"): um trecho só, conferido como está escrito.
      let j = i;
      while (
        lx[j + 2] &&
        lx[j + 1].inicio === lx[j].fim &&
        lx[j + 2].inicio === lx[j + 1].fim &&
        lx[j + 2].tipo === "num" &&
        /^(?:[-/:]|h)$/i.test(lx[j + 1].texto)
      ) {
        j += 2;
      }
      if (j > i) {
        const bruto = texto.slice(atual.inicio, lx[j].fim);
        const separadores = lx.slice(i + 1, j + 1).filter((_, n) => n % 2 === 0).map((l) => l.texto.toLowerCase());
        const pergunta = separadores.some((s) => s === ":" || s === "h")
          ? "que horário?"
          : separadores.every((s) => s === "/") && /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(bruto)
            ? "que data?"
            : "complete aqui";
        lista.push({ inicio: atual.inicio, fim: lx[j].fim, tipo: "bruto", valor: bruto, classe: "", objeto: null, pergunta });
        i = j + 1;
        continue;
      }
      const grudado = colado(i);
      // Ordinal ("1º", "2ª") não é quantidade.
      if (grudado && /^[ºª°]/.test(grudado.texto)) {
        i += 2;
        continue;
      }
      // Colado a uma letra que não é unidade ("1080p", "4G", "3D"): código, não quantidade.
      if (grudado && grudado.tipo === "pal") {
        const g = norm(grudado.texto);
        if (!tem(ESCALA, g) && !tem(TEMPO, g) && g !== "x" && !tem(MOEDA_POR_PALAVRA, g)) {
          i += 2;
          continue;
        }
      }
      const canonico = valorCanonico(atual.texto);
      if (canonico === null) valorBruto = atual.texto;
      else valorNumerico = Number(canonico);
    } else if (atual.tipo === "pal") {
      const p = norm(atual.texto);
      if (tem(PALAVRA_DE_QUANTIDADE, p)) {
        let comeco = atual.inicio;
        // "um terço", "dois terços": o número vai junto para dentro do colchete.
        const anterior = lx[i - 1];
        if ((p === "terco" || p === "tercos") && anterior && /^(um|uma|dois|duas)$/.test(palavraEm(anterior)) && soEspaco(texto, anterior.fim, atual.inicio)) {
          comeco = anterior.inicio;
        }
        lista.push({ inicio: comeco, fim: atual.fim, tipo: "palavra", valor: p, classe: "", objeto: null, pergunta: PALAVRA_DE_QUANTIDADE[p] });
        i += 1;
        continue;
      }
      if (PALAVRA_DE_MONTANTE.has(p)) {
        let fim = atual.fim;
        let pergunta = "quantos?";
        const obj = palavraEm(seguinte(i)) === "de" ? seguinte(i + 1) : null;
        if (obj && obj.tipo === "pal" && !NAO_E_OBJETO.has(norm(obj.texto))) {
          fim = obj.fim;
          pergunta = `${ehFeminina(obj.texto) ? "quantas" : "quantos"} ${plural(obj.texto)}?`;
        }
        lista.push({ inicio: atual.inicio, fim, tipo: "palavra", valor: p, classe: "", objeto: null, pergunta });
        i += 1;
        continue;
      }
      if (tem(EXTENSO, p)) {
        // "dois terços" fica para a palavra "terços", logo adiante.
        if (/^tercos?$/.test(palavraEm(seguinte(i)))) {
          i += 1;
          continue;
        }
        // "vinte e cinco", "dois mil", "mil e quinhentos": a sequência inteira é um número.
        let total = 0;
        let parcial = 0;
        let j = i;
        for (;;) {
          const w = norm(lx[j].texto);
          if (w === "mil") {
            total += (parcial || 1) * 1000;
            parcial = 0;
          } else {
            parcial += EXTENSO[w];
          }
          const prox = seguinte(j);
          if (tem(EXTENSO, palavraEm(prox))) {
            j += 1;
            continue;
          }
          if (palavraEm(prox) === "e" && tem(EXTENSO, palavraEm(seguinte(j + 1)))) {
            j += 2;
            continue;
          }
          break;
        }
        valorNumerico = total + parcial;
        fimIdx = j;
      } else if (p === "um" || p === "uma") {
        const w = palavraEm(seguinte(i));
        if ((tem(TEMPO, w) && TEMPO_DEPOIS_DE_UM.has(TEMPO[w].unidade)) || w === "milhao" || w === "bilhao") {
          valorNumerico = 1;
        } else {
          i += 1;
          continue;
        }
      } else {
        i += 1;
        continue;
      }
    } else {
      i += 1;
      continue;
    }

    let inicio = atual.inicio;
    let classe = "";

    // A moeda escrita antes ("R$ 180").
    const antesDoNumero = lx[i - 1];
    if (antesDoNumero && antesDoNumero.tipo === "moeda" && soEspaco(texto, antesDoNumero.fim, atual.inicio)) {
      classe = MOEDA_POR_SIMBOLO[antesDoNumero.texto] ?? "";
      inicio = antesDoNumero.inicio;
    }

    // A escala ("2 mil", "10k", "3 milhões").
    let k = fimIdx;
    let comEscala = false;
    const escala = colado(k) ?? seguinte(k);
    if (valorNumerico !== null && tem(ESCALA, palavraEm(escala))) {
      valorNumerico = Number((valorNumerico * ESCALA[palavraEm(escala)]).toPrecision(12));
      comEscala = true;
      k += 1;
    }

    // Um ano ("em 2019", "desde 2019", "2019 foi"): quatro dígitos sem ponto, sem moeda e sem escala, com cara de ano pelo que vem antes ou depois.
    const depois = colado(k) ?? seguinte(k);
    const palavraDepois = palavraEm(depois);
    let objeto: string | null = null;
    let pergunta = "quantos?";
    const candidatoAAno = atual.tipo === "num" && !classe && !comEscala && /^\d{4}$/.test(atual.texto) && valorNumerico !== null && pareceAno(String(valorNumerico));
    const palavraAntes = palavraEm(antesDoNumero && soEspaco(texto, antesDoNumero.fim, atual.inicio) ? antesDoNumero : null);
    const ehAno =
      candidatoAAno &&
      depois?.texto !== "%" &&
      !tem(MOEDA_POR_PALAVRA, palavraDepois) &&
      (ANTES_DE_ANO.has(palavraAntes) || !depois || depois.tipo !== "pal" || NAO_E_OBJETO.has(palavraDepois));

    if (ehAno) {
      classe = "ano";
      pergunta = "que ano?";
    } else if (!classe && depois && depois.texto === "%") {
      classe = "%";
      k += 1;
    } else if (!classe && palavraDepois === "por" && palavraEm(seguinte(k + 1)) === "cento") {
      classe = "%";
      k += 2;
    } else if (depois && depois.tipo === "pal") {
      const deMoeda = palavraDepois === "de" ? palavraEm(seguinte(k + 1)) : "";
      if (tem(MOEDA_POR_PALAVRA, palavraDepois) || tem(MOEDA_POR_PALAVRA, deMoeda)) {
        const palavraDaMoeda = tem(MOEDA_POR_PALAVRA, palavraDepois) ? palavraDepois : deMoeda;
        classe = classe || MOEDA_POR_PALAVRA[palavraDaMoeda];
        k += palavraDaMoeda === palavraDepois ? 1 : 2;
      } else if (!classe && tem(TEMPO, palavraDepois)) {
        const tempo = TEMPO[palavraDepois];
        classe = `t:${tempo.unidade}`;
        pergunta = `${tempo.feminino ? "quantas" : "quantos"} ${tempo.plural}?`;
        k += 1;
      } else if (!classe && palavraDepois === "x" && colado(k)) {
        classe = "x";
        pergunta = "quantas vezes?";
        k += 1;
      } else if (!classe && !NAO_E_OBJETO.has(palavraDepois)) {
        objeto = depois.texto;
        pergunta = `${ehFeminina(depois.texto) ? "quantas" : "quantos"} ${plural(depois.texto)}?`;
        k += 1;
      }
    }
    if (classe === "%") pergunta = "quantos por cento?";
    else if (tem(COLCHETE_DA_MOEDA, classe)) pergunta = COLCHETE_DA_MOEDA[classe];

    // "mais de 5 empresas", "uns 3 meses": o jeito de arredondar vai junto para dentro do colchete.
    const prefixo = PREFIXO_ENGOLIDO.exec(texto.slice(0, inicio));
    if (prefixo) inicio = inicio - prefixo[0].length + prefixo[0].indexOf(prefixo[1]);

    lista.push({
      inicio,
      fim: lx[k].fim,
      tipo: valorBruto !== null ? "bruto" : "numero",
      valor: valorBruto ?? String(valorNumerico),
      classe,
      objeto,
      pergunta,
    });
    i = k + 1;
  }
  return lista;
}

// ---------------------------------------------------------------------------------------------------------------------
// As fontes e a conferência
// ---------------------------------------------------------------------------------------------------------------------

type IndiceDasFontes = {
  /** "valor|classe" de toda quantidade das fontes. */
  porClasse: Set<string>;
  /** "valor|forma do objeto" das quantidades sem classe. */
  porObjeto: Set<string>;
  /** Valores que aparecem sozinhos, sem unidade e sem objeto ("custa 180."). */
  soltos: Set<string>;
  /** Todas as palavras das fontes, sem acento. */
  palavras: Set<string>;
  /** O texto das fontes sem acento e com espaço simples, para o trecho escrito igual. */
  texto: string;
};

const textoComparavel = (t: string): string => semAcento(t).replace(/\s+/g, " ");

/** O texto sem o que está entre colchetes: a pergunta de um colchete ("[quantas empresas em 2026?]") nunca vira fonte de um número. */
function semColchetes(texto: string): string {
  return dividirPorColchetes(texto)
    .map((p) => (p.colchete ? " " : p.texto))
    .join("");
}

export function indexarFontes(fontes: string): IndiceDasFontes {
  const limpo = semColchetes(fontes);
  const indice: IndiceDasFontes = {
    porClasse: new Set(),
    porObjeto: new Set(),
    soltos: new Set(),
    palavras: new Set(semAcento(limpo).match(/\p{L}+/gu) ?? []),
    texto: textoComparavel(limpo),
  };
  for (const q of quantidadesDoTexto(limpo)) {
    if (q.tipo !== "numero") continue;
    indice.porClasse.add(`${q.valor}|${q.classe}`);
    if (q.classe === "" && q.objeto) for (const f of formas(q.objeto)) indice.porObjeto.add(`${q.valor}|${f}`);
    if (q.classe === "" && !q.objeto) indice.soltos.add(q.valor);
  }
  return indice;
}

const letraOuDigito = (c: string): boolean => /[\p{L}\d]/u.test(c);

/** O trecho escrito igual nas fontes, sem encostar em outra letra ou dígito ("6 meses" não acha "16 meses" nem "6 mesesinhos"). */
function escritoIgual(trecho: string, indice: IndiceDasFontes): boolean {
  const alvo = textoComparavel(trecho).trim();
  if (!alvo) return false;
  const t = indice.texto;
  for (let de = t.indexOf(alvo); de >= 0; de = t.indexOf(alvo, de + 1)) {
    const antes = t[de - 1] ?? "";
    const depois = t[de + alvo.length] ?? "";
    const bordaAntes = !letraOuDigito(antes) && !(/[.,]/.test(antes) && /\d/.test(t[de - 2] ?? ""));
    const bordaDepois = !letraOuDigito(depois) && !(/[.,]/.test(depois) && /\d/.test(t[de + alvo.length + 1] ?? ""));
    if (bordaAntes && bordaDepois) return true;
  }
  return false;
}

function estaNasFontes(q: Quantidade, trecho: string, indice: IndiceDasFontes): boolean {
  if (escritoIgual(trecho, indice)) return true;
  if (q.tipo === "palavra") return indice.palavras.has(q.valor);
  if (q.tipo === "bruto") return false;
  if (indice.porClasse.has(`${q.valor}|${q.classe}`) && (q.classe !== "" || !q.objeto)) return true;
  // Um ano bate com o mesmo número escrito de qualquer jeito nas fontes (quatro dígitos de 1900 a 2100 não são coincidência).
  if (q.classe === "ano") return indice.porClasse.has(`${q.valor}|`) || indice.soltos.has(q.valor);
  // Um preço bate com o mesmo número solto nas fontes ("o sofá custa 180" e a sugestão diz "R$ 180").
  if (tem(COLCHETE_DA_MOEDA, q.classe)) return indice.soltos.has(q.valor);
  if (q.classe === "" && q.objeto) return formas(q.objeto).some((f) => indice.porObjeto.has(`${q.valor}|${f}`));
  return false;
}

/** No começo de uma frase, a pergunta do colchete começa com maiúscula. */
function comecoDeFrase(texto: string, posicao: number): boolean {
  return /(?:^|[.!?:]\s+|\n\s*)$/.test(texto.slice(0, posicao));
}

/**
 * A conferência: troca por colchete todo dado da sugestão que as fontes não têm. `fontes` é o texto inteiro das FONTES DA MARCA
 * (`montarFontesDaSugestao`). Descarta a sugestão (texto vazio) quando ela passa de `MAXIMO_DE_TROCAS` trocas ou quando sobra
 * pouco texto fora dos colchetes. Sugestão vazia volta vazia, sem descartar. Conferir de novo o que já foi conferido não muda nada.
 */
export function conferirSugestao(exemplo: string, fontes: string): ResultadoDaConferencia {
  if (!exemplo.trim()) return { texto: exemplo, trocados: [], descartada: false };
  const indice = indexarFontes(fontes);
  const trocas: { inicio: number; fim: number; colchete: string; trecho: string }[] = [];
  for (const q of quantidadesDoTexto(exemplo)) {
    const trecho = exemplo.slice(q.inicio, q.fim);
    if (estaNasFontes(q, trecho, indice)) continue;
    const pergunta = comecoDeFrase(exemplo, q.inicio) ? q.pergunta.charAt(0).toUpperCase() + q.pergunta.slice(1) : q.pergunta;
    trocas.push({ inicio: q.inicio, fim: q.fim, colchete: `[${pergunta}]`, trecho });
  }
  if (trocas.length === 0) return { texto: exemplo, trocados: [], descartada: false };

  let texto = "";
  let cursor = 0;
  for (const troca of trocas) {
    texto += exemplo.slice(cursor, troca.inicio) + troca.colchete;
    cursor = troca.fim;
  }
  texto += exemplo.slice(cursor);
  const trocados = trocas.map((t) => t.trecho);

  const palavrasFora = (semColchetes(texto).match(/\p{L}+/gu) ?? []).length;
  if (trocas.length > MAXIMO_DE_TROCAS || palavrasFora < MINIMO_DE_PALAVRAS_FORA) {
    return { texto: "", trocados, descartada: true };
  }
  return { texto, trocados, descartada: false };
}

/**
 * O texto das FONTES DA MARCA para a conferência: a resposta desta pergunta, as outras respostas, o que lemos do site e das redes
 * (o que a pessoa não tirou) e os dados fixos da marca (nome, região, país). Uma linha por fonte; a ordem não importa.
 */
export function montarFontesDaSugestao(dados: {
  resposta: string;
  outrasRespostas: { resposta: string }[];
  lidoDaMarca: { texto: string }[];
  dadosFixos?: (string | null | undefined)[];
}): string {
  return [dados.resposta, ...dados.outrasRespostas.map((r) => r.resposta), ...dados.lidoDaMarca.map((l) => l.texto), ...(dados.dadosFixos ?? [])]
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .join("\n");
}
