/**
 * As marcas de fala do roteiro (E41, parte 2; as seis marcas e as regras R-FALA da seção 10 de `briefing-e-rubricas.md`), sem nada de IA: a sintaxe, a leitura, a trava e o conserto mecânico.
 *
 * O texto marcado é o texto da fala com marcas dentro dele, em chaves:
 *
 * - `{p:palavra}`: a palavra de peso (R-FALA-05 e 06);
 * - `{d:um trecho inteiro}`: dito devagar e bem articulado (R-FALA-02, 08 e 14);
 * - `{/}` pausa curta, `{//}` pausa longa (R-FALA-03 e 04), colocadas depois da palavra ou da pontuação em que valem;
 * - `{v}` o tom desce e `{^}` o tom sobe (R-FALA-09), antes da pausa do fim da frase.
 *
 * A TRAVA que importa: o texto sem as marcas é idêntico ao original (`textoIdentico`). A marca nunca muda uma palavra, uma pontuação nem a ordem; a IA só coloca marcas, e o código confere. O
 * conserto mecânico (`consertarMarcas`) trabalha só sobre as palavras que já estão ali, então não consegue quebrar a trava: o que ele faz é pôr o que as regras que "conferem por código"
 * mandam pôr (pausa no fim da frase, a distância máxima entre pausas, o devagar em número e preço e na chamada final, o tom que desce na chamada) e tirar o que elas proíbem (peso demais, tom
 * que sobe em afirmação).
 */

/** Os quatro blocos de um Reels falado, com os nomes de `ConteudoRoteiro`. */
export const BLOCOS_FALADOS = ["gancho", "corpo", "fechamento", "chamadaFinal"] as const;
export type BlocoFalado = (typeof BLOCOS_FALADOS)[number];

/** O tom do bloco numa palavra (R-FALA-10 e 11): uma lista curta e fixa, para o modelo não inventar tom de teatro. */
export const TONS_DO_BLOCO = ["direto", "perto", "calmo", "firme"] as const;
export type TomDoBloco = (typeof TONS_DO_BLOCO)[number];

/** O tom de cada bloco quando o modelo não diz um (ou diz um que não existe). */
export const TOM_PADRAO_DO_BLOCO: Record<BlocoFalado, TomDoBloco> = { gancho: "direto", corpo: "perto", fechamento: "calmo", chamadaFinal: "firme" };

/** Uma palavra do texto, com o que está marcado nela. */
export type Palavra = {
  texto: string;
  peso: boolean;
  devagar: boolean;
  /** O que vem logo depois da palavra: o tom (no máximo um) e a pausa (no máximo uma). */
  tom: "desce" | "sobe" | null;
  pausa: "curta" | "longa" | null;
};

const MARCA = /\{(p|d):([^{}]+)\}|\{(\/\/|\/|v|\^)\}/g;

/** Espaço branco colapsado e aparado: a "forma" de um texto para comparar sem se importar com onde estavam as quebras e os espaços duplos. */
export function normalizar(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

type Evento = { tipo: "texto" | "peso" | "devagar"; valor: string } | { tipo: "marca"; valor: "/" | "//" | "v" | "^" };

function eventos(marcado: string): Evento[] {
  const lista: Evento[] = [];
  let posicao = 0;
  for (const m of marcado.matchAll(MARCA)) {
    const inicio = m.index ?? 0;
    if (inicio > posicao) lista.push({ tipo: "texto", valor: marcado.slice(posicao, inicio) });
    posicao = inicio + m[0].length;
    if (m[1] === "p") lista.push({ tipo: "peso", valor: m[2] });
    else if (m[1] === "d") lista.push({ tipo: "devagar", valor: m[2] });
    else lista.push({ tipo: "marca", valor: m[3] as "/" | "//" | "v" | "^" });
  }
  if (posicao < marcado.length) lista.push({ tipo: "texto", valor: marcado.slice(posicao) });
  return lista;
}

function nova(texto: string, peso: boolean, devagar: boolean): Palavra {
  return { texto, peso, devagar, tom: null, pausa: null };
}

/**
 * Lê o texto marcado em palavras, cada uma com as suas marcas. As palavras são exatamente as "palavras" do texto sem as marcas (separadas por espaço): o que está colado, com ou sem
 * marca no meio ("{p:mancha}, e", "guarda{p:-chuva}"), é uma palavra só, e por isso a leitura seguida da escrita nunca muda o texto. Uma marca de pausa ou de tom antes de qualquer palavra
 * não tem a que se prender e é ignorada.
 */
export function lerPalavras(marcado: string): Palavra[] {
  const palavras: Palavra[] = [];
  let terminouEmEspaco = true;
  for (const evento of eventos(marcado)) {
    if (evento.tipo === "marca") {
      const ultima = palavras[palavras.length - 1];
      if (!ultima) continue;
      if (evento.valor === "v") ultima.tom = "desce";
      else if (evento.valor === "^") ultima.tom = "sobe";
      else if (evento.valor === "/") ultima.pausa = ultima.pausa === "longa" ? "longa" : "curta";
      else ultima.pausa = "longa";
      continue;
    }
    const valor = evento.valor;
    const peso = evento.tipo === "peso";
    const devagar = evento.tipo === "devagar";
    const comecaComEspaco = /^\s/.test(valor);
    const partes = valor.split(/\s+/).filter((parte) => parte.length > 0);
    partes.forEach((parte, k) => {
      const anterior = palavras[palavras.length - 1];
      if (k === 0 && anterior && !terminouEmEspaco && !comecaComEspaco) {
        anterior.texto += parte;
        anterior.peso = anterior.peso || peso;
        anterior.devagar = anterior.devagar || devagar;
        return;
      }
      palavras.push(nova(parte, peso, devagar));
    });
    if (valor.length > 0) terminouEmEspaco = /\s$/.test(valor);
  }
  return palavras;
}

const ABRE = "“\"'(\\[«‘¿¡";
const FECHA = ".,;:!?…\"')\\]»”’";
const PONTUACAO_DAS_PONTAS = new RegExp(`^([${ABRE}]*)(.*?)([${FECHA}]*)$`, "su");

/** Separa a pontuação das pontas de um texto: a marca de peso e a de devagar ficam só no miolo, e a pontuação, as aspas e o parêntese ficam de fora, como estavam. */
function pontas(texto: string): { abre: string; miolo: string; fecha: string } {
  const m = PONTUACAO_DAS_PONTAS.exec(texto);
  if (!m || m[2] === "") return { abre: "", miolo: texto, fecha: "" };
  return { abre: m[1], miolo: m[2], fecha: m[3] };
}

function sufixo(p: Palavra): string {
  return `${p.tom === "desce" ? "{v}" : p.tom === "sobe" ? "{^}" : ""}${p.pausa === "longa" ? "{//}" : p.pausa === "curta" ? "{/}" : ""}`;
}

/**
 * Escreve as palavras de volta como texto marcado. Palavras seguidas ditas devagar voltam num `{d:...}` só (e o peso de uma palavra dita devagar não aparece: o trecho inteiro já é o
 * destaque). A pontuação das pontas fica fora da marca: `{p:mancha},` e não `{p:mancha,}`.
 */
export function escreverPalavras(palavras: Palavra[]): string {
  const partes: string[] = [];
  let i = 0;
  while (i < palavras.length) {
    if (palavras[i].devagar) {
      const grupo: Palavra[] = [];
      while (i < palavras.length && palavras[i].devagar) {
        grupo.push(palavras[i]);
        i += 1;
        // Uma pausa ou um tom fecha o trecho devagar (a marca vem logo depois da chave).
        if (grupo[grupo.length - 1].tom || grupo[grupo.length - 1].pausa) break;
      }
      const junto = grupo.map((p) => p.texto).join(" ");
      const abre = pontas(grupo[0].texto).abre;
      const fecha = grupo.length === 1 ? pontas(grupo[0].texto).fecha : pontas(grupo[grupo.length - 1].texto).fecha;
      const miolo = junto.slice(abre.length, junto.length - fecha.length);
      const marcas = sufixo(grupo[grupo.length - 1]);
      partes.push(miolo.length > 0 ? `${abre}{d:${miolo}}${fecha}${marcas}` : `${junto}${marcas}`);
      continue;
    }
    const palavra = palavras[i];
    if (palavra.peso) {
      const { abre, miolo, fecha } = pontas(palavra.texto);
      partes.push(`${abre}{p:${miolo}}${fecha}${sufixo(palavra)}`);
    } else {
      partes.push(`${palavra.texto}${sufixo(palavra)}`);
    }
    i += 1;
  }
  return partes.join(" ");
}

/** O texto sem nenhuma marca. */
export function textoSemMarcas(marcado: string): string {
  return normalizar(marcado.replace(MARCA, (_inteira, tipo: string | undefined, conteudo: string | undefined) => (tipo ? (conteudo ?? "") : "")));
}

/** Marcas fechadas e com a sintaxe certa: depois de tirar todas as marcas válidas não sobra chave nenhuma. */
export function marcasBemFormadas(marcado: string): boolean {
  return !/[{}]/.test(marcado.replace(MARCA, ""));
}

/** A trava: o texto sem as marcas é o original, palavra por palavra, pontuação por pontuação (só o espaço branco pode diferir). */
export function textoIdentico(original: string, marcado: string): boolean {
  return marcasBemFormadas(marcado) && normalizar(original) === textoSemMarcas(marcado);
}

/** Um texto com chave não pode ser marcado: a chave é a sintaxe das marcas, e o texto de um roteiro nunca a tem. */
export function temChaveNoTexto(texto: string): boolean {
  return /[{}]/.test(texto);
}

/** Quantas palavras há no texto. */
export function contarPalavras(texto: string): number {
  const n = normalizar(texto);
  return n === "" ? 0 : n.split(" ").length;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// O conserto mecânico (as regras que "conferem por código")
// ---------------------------------------------------------------------------------------------------------------------------------

/** Abreviatura com ponto: não termina a frase ("Dra. Ana", "R. Augusta", "Tel. 3333"). "etc." fica de fora de propósito: quase sempre fecha a frase. */
const ABREVIATURAS = /^(dr|dra|sr|sra|prof|profa|av|ex|obs|r|tel|cel|apt|apto|jr|pág|pag)\.$/i;
/** "1." no começo de uma frase é o número de uma lista, não o fim dela. */
const NUMERO_DE_LISTA = /^\d{1,2}\.$/;
const FIM_DE_FRASE = /[.!?…]["')\]”’»]*$/;
const PERGUNTA = /\?[!?"')\]”’»]*$/;
const ABERTURA_E_FECHAMENTO = /^["'(\[“‘«¿¡]+|["')\]”’»]+$/g;
const NUMERO_OU_PRECO = /\d|^R\$$|%$/;
const UNIDADE_DEPOIS_DO_NUMERO =
  /^(reais?|real|centavos?|mil|milh(?:ão|ões|ao|oes)|%|por|cento|dias?|horas?|minutos?|segundos?|semanas?|anos?|meses|mês|mes|km|kg|g|m|cm|mm|litros?|ml|vezes|unidades?|metros?)[.,;:!?]*$/i;
/** Onde a frase já respira: antes de "e", "mas", "porque" e parecidas. "que" e "se" ficam de fora ("tudo o que eu fiz" não se parte). */
const CONJUNCOES_DE_QUEBRA = /^(e|mas|porque|pois|porém|porem|ou|então|entao|quando)$/i;
/** Palavra que não fica sozinha no fim de um trecho: artigo, preposição, "que", "se", "e"... A pausa não vai depois dela. */
const PALAVRA_DE_LIGACAO = /^(o|a|os|as|um|uma|uns|umas|de|do|da|dos|das|em|no|na|nos|nas|ao|aos|à|às|para|pra|por|pelo|pela|com|sem|que|se|me|te|lhe|e|ou|mas|não|nao)$/i;

/** A palavra sem pontuação nem aspas. */
function limpa(texto: string): string {
  return texto.replace(/[^\p{L}\p{N}]/gu, "");
}

/** Dá para respirar logo depois da palavra `k`? Não, se ela é de ligação (artigo, preposição) ou se a próxima é "que" ou "se" ("tudo o | que eu fiz"). */
function podeRespirarDepois(palavras: Palavra[], k: number): boolean {
  if (PALAVRA_DE_LIGACAO.test(limpa(palavras[k].texto))) return false;
  const proxima = palavras[k + 1];
  return !(proxima && /^(que|se)$/i.test(limpa(proxima.texto)));
}

/** As muletas de abertura (R-FALA-01): a primeira palavra do vídeo não pode ser uma delas. */
export const MULETAS_DE_ABERTURA = ["é", "então", "entao", "bom", "tipo", "né", "ne", "ah", "hum", "eh"];

/** O que o conserto precisa saber do roteiro (R-FALA-14 e 15 trocam a distância máxima entre pausas). */
export type ContextoDasMarcas = {
  /** O bloco da chamada final: a última frase dele é dita devagar e com o tom que desce (R-FALA-08 e 09). */
  chamadaFinal?: boolean;
  /** Ambiente com barulho (R-FALA-14) ou público mais velho (R-FALA-15): menos palavras entre as pausas. */
  maisDevagar?: boolean;
};

/** Distância máxima entre pausas, em palavras: de 4 a 5 segundos de fala a 150 palavras por minuto (R-FALA-02 e 03). */
export const MAXIMO_DE_PALAVRAS_ENTRE_PAUSAS = 12;
export const MAXIMO_DE_PALAVRAS_ENTRE_PAUSAS_MAIS_DEVAGAR = 9;

/** Uma frase mais comprida que isto não cabe num fôlego (R-FALA-04): vira aviso, porque o texto não pode ser quebrado por quem marca. */
export const MAXIMO_DE_PALAVRAS_POR_FRASE = 25;
export const MAXIMO_DE_PALAVRAS_POR_FRASE_MAIS_DEVAGAR = 20;

function frases(palavras: Palavra[]): { de: number; ate: number }[] {
  const resultado: { de: number; ate: number }[] = [];
  let inicio = 0;
  palavras.forEach((p, i) => {
    const marcadorDeLista = i === inicio && NUMERO_DE_LISTA.test(p.texto);
    if (FIM_DE_FRASE.test(p.texto) && !ABREVIATURAS.test(p.texto) && !marcadorDeLista) {
      resultado.push({ de: inicio, ate: i });
      inicio = i + 1;
    }
  });
  if (inicio < palavras.length) resultado.push({ de: inicio, ate: palavras.length - 1 });
  return resultado;
}

/**
 * Põe o que falta e tira o que sobra, só pelas regras que conferem por código. Devolve o texto marcado e uma linha por conserto (para o registro e para a conferência humana).
 * Nunca mexe no texto: trabalha sobre as palavras que já estão ali.
 */
export function consertarMarcas(marcado: string, contexto: ContextoDasMarcas = {}): { texto: string; correcoes: string[] } {
  const palavras = lerPalavras(marcado);
  const correcoes: string[] = [];
  if (palavras.length === 0) return { texto: "", correcoes };

  const limite = contexto.maisDevagar ? MAXIMO_DE_PALAVRAS_ENTRE_PAUSAS_MAIS_DEVAGAR : MAXIMO_DE_PALAVRAS_ENTRE_PAUSAS;
  const sentencas = frases(palavras);

  // R-FALA-08: número e preço, ditos devagar, com a unidade que vem depois ("297 reais por mês", "dois mil", "30%").
  const devagar = (k: number): boolean => {
    if (palavras[k].devagar) return false;
    palavras[k].devagar = true;
    palavras[k].peso = false;
    return true;
  };
  palavras.forEach((p, i) => {
    if (!NUMERO_OU_PRECO.test(p.texto)) return;
    let mudou = devagar(i);
    let j = i + 1;
    // A unidade (e o "por mês" que vem junto), até três palavras, sem atravessar o fim da frase.
    for (let n = 0; n < 3 && !FIM_DE_FRASE.test(palavras[j - 1].texto) && palavras[j] && UNIDADE_DEPOIS_DO_NUMERO.test(palavras[j].texto.replace(ABERTURA_E_FECHAMENTO, "")); n += 1, j += 1) {
      mudou = devagar(j) || mudou;
    }
    if (mudou) correcoes.push(`R-FALA-08: "${p.texto}" dito devagar`);
  });

  // R-FALA-08: a chamada final é dita devagar: a última frase do bloco, e a anterior quando a última é só um fecho curto ("Obrigado!"), porque o pedido está nela.
  if (contexto.chamadaFinal) {
    const ultima = sentencas[sentencas.length - 1];
    const alvos = ultima.ate - ultima.de + 1 <= 3 && sentencas.length > 1 ? [sentencas[sentencas.length - 2], ultima] : [ultima];
    for (const alvo of alvos) {
      const temDevagar = palavras.slice(alvo.de, alvo.ate + 1).some((p) => p.devagar);
      if (temDevagar) continue;
      for (let i = alvo.de; i <= alvo.ate; i++) devagar(i);
      correcoes.push("R-FALA-08: a chamada final dita devagar");
    }
  }

  for (const { de, ate } of sentencas) {
    const fim = palavras[ate];
    const ehPergunta = PERGUNTA.test(fim.texto);

    // R-FALA-05: no máximo um peso por frase curta (dois, não colados, por frase comprida), nunca duas palavras de peso seguidas.
    const maximoDePeso = ate - de + 1 <= 10 ? 1 : 2;
    let pesos = 0;
    for (let i = de; i <= ate; i++) {
      if (!palavras[i].peso) continue;
      const colado = i > de && palavras[i - 1].peso;
      if (colado || pesos >= maximoDePeso) {
        palavras[i].peso = false;
        correcoes.push(`R-FALA-05: peso tirado de "${palavras[i].texto}"`);
      } else {
        pesos += 1;
      }
    }

    // R-FALA-09: o tom só sobe em pergunta de verdade (a que termina em "?"), no fim dela.
    for (let i = de; i <= ate; i++) {
      if (palavras[i].tom === "sobe" && !(ehPergunta && i === ate)) {
        palavras[i].tom = null;
        correcoes.push(`R-FALA-09: tom que sobe tirado de "${palavras[i].texto}" (não é pergunta)`);
      }
    }

    // R-FALA-03: toda frase termina em pausa longa (a curta é do meio da frase).
    if (fim.pausa !== "longa") {
      fim.pausa = "longa";
      correcoes.push(`R-FALA-03: pausa longa no fim da frase "...${fim.texto}"`);
    }
  }

  // R-FALA-09: a chamada final é sempre afirmação e termina com o tom descendo (mesmo que o modelo tenha posto o tom que sobe).
  if (contexto.chamadaFinal) {
    const ultima = sentencas[sentencas.length - 1];
    const fim = palavras[ultima.ate];
    if (fim.tom !== "desce") {
      fim.tom = "desce";
      correcoes.push("R-FALA-09: a chamada final termina com o tom descendo");
    }
  }

  // R-FALA-03: nenhum trecho passa do máximo de palavras sem uma pausa (a pausa curta vai onde a frase já respira: vírgula, ou antes de uma conjunção; senão, no meio).
  // A palavra que fecha o trecho conta (com a pausa dela): "um dois ... treze." com 13 palavras e a pausa longa na 13ª também passa do limite de 12.
  let desdeAPausa = 0;
  for (let i = 0; i < palavras.length; i++) {
    desdeAPausa += 1;
    if (desdeAPausa > limite) {
      const inicio = i - desdeAPausa + 1;
      const meio = inicio + Math.floor(desdeAPausa / 2);
      let melhor = -1;
      let distanciaMelhor = Infinity;
      for (let k = inicio + 2; k < i; k++) {
        const aposVirgula = /[,;:]["')\]”’»]*$/.test(palavras[k].texto);
        const antesDeConjuncao = palavras[k + 1] !== undefined && CONJUNCOES_DE_QUEBRA.test(limpa(palavras[k + 1].texto)) && podeRespirarDepois(palavras, k);
        if (!(aposVirgula || antesDeConjuncao) || palavras[k].pausa) continue;
        const distancia = Math.abs(k - meio);
        if (distancia < distanciaMelhor) {
          melhor = k;
          distanciaMelhor = distancia;
        }
      }
      // Sem vírgula nem conjunção, o ponto mais perto do meio onde a frase pode respirar (nunca entre o artigo e o nome, nem antes de "que").
      if (melhor < 0) {
        for (let d = 0; d < desdeAPausa && melhor < 0; d++) {
          for (const k of d === 0 ? [meio] : [meio - d, meio + d]) {
            if (k > inicio && k < i && !palavras[k].pausa && podeRespirarDepois(palavras, k)) {
              melhor = k;
              break;
            }
          }
        }
      }
      const onde = melhor >= 0 ? melhor : meio;
      palavras[onde].pausa = "curta";
      correcoes.push(`R-FALA-03: pausa curta depois de "${palavras[onde].texto}" (trecho comprido)`);
      desdeAPausa = i - onde;
    }
    if (palavras[i].pausa) desdeAPausa = 0;
  }

  return { texto: escreverPalavras(palavras), correcoes };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// As conferências que não mexem em marca: viram aviso (texto de apoio), porque o texto não pode ser mudado por quem marca
// ---------------------------------------------------------------------------------------------------------------------------------

/** Uma conferência por código que a tela mostra como texto de apoio (nunca como marca). */
export type ConferenciaDeFala =
  | { regra: "R-FALA-01"; muleta: string }
  | { regra: "R-FALA-04"; comeco: string; palavras: number }
  | { regra: "R-FALA-14" }
  | { regra: "R-FALA-15" };

const SEM_ACENTO = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * R-FALA-14: o lugar onde se grava tem barulho (oficina, rua, obra, feira, fábrica...). "Segunda-feira" e "mão de obra" não são lugar, e "máquina" fica de fora (máquina de lavar é o
 * produto de muita marca, não o barulho).
 */
export function ambienteComBarulho(textos: string[]): boolean {
  const junto = SEM_ACENTO(textos.join(" ").toLowerCase());
  return /\b(oficina|rua|transito|barulh\w*|ruido|galpao|fabrica|estacionamento|ao ar livre|cozinha industrial|trem|onibus|avenida)\b|(?<!mao de )\bobras?\b|(?<!-)\bfeira\b/.test(junto);
}

/** R-FALA-15: o briefing descreve um público acima de 60 anos. */
export function publicoMaisVelho(textos: string[]): boolean {
  const junto = SEM_ACENTO(textos.join(" ").toLowerCase());
  if (/\b(idos[oa]s?|terceira idade|melhor idade|aposentad[oa]s?|maiores de 60|acima de 60|60 anos ou mais|60 ?\+)/.test(junto)) return true;
  // "60 anos de mercado" é da empresa, não do público.
  const daEmpresa = /^\s+de\s+(?:mercado|experiencia|estrada|historia|tradicao|existencia|fundacao|atuacao)/;
  for (const m of junto.matchAll(/\b(\d{2})\s*(?:anos|a\s*\d{2}\s*anos)/g)) {
    const depois = junto.slice((m.index ?? 0) + m[0].length);
    if (Number(m[1]) >= 60 && !daEmpresa.test(depois)) return true;
  }
  return false;
}

/** A primeira palavra de um texto, sem pontuação nem maiúscula e COM o acento ("É" é muleta, "E" não é). */
function primeiraPalavra(texto: string): string {
  const palavra = normalizar(textoSemMarcas(texto)).split(" ")[0] ?? "";
  return palavra.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * As conferências por código que não mudam o texto: muleta na primeira palavra do vídeo (R-FALA-01), frase que não cabe num fôlego (R-FALA-04) e os dois avisos de ambiente (R-FALA-14 e
 * 15). `textos` é o texto de cada bloco, sem marcas.
 */
export function conferirFala(textos: Partial<Record<BlocoFalado, string>>, contexto: { ambienteComBarulho?: boolean; publicoMaisVelho?: boolean } = {}): ConferenciaDeFala[] {
  const lista: ConferenciaDeFala[] = [];
  const primeiro = BLOCOS_FALADOS.map((b) => textos[b]).find((t) => t && t.trim() !== "");
  if (primeiro) {
    const palavra = primeiraPalavra(primeiro);
    if (palavra && MULETAS_DE_ABERTURA.includes(palavra)) {
      lista.push({ regra: "R-FALA-01", muleta: normalizar(primeiro).split(" ")[0].replace(/[^\p{L}\p{N}]/gu, "") });
    }
  }
  const limite = contexto.ambienteComBarulho || contexto.publicoMaisVelho ? MAXIMO_DE_PALAVRAS_POR_FRASE_MAIS_DEVAGAR : MAXIMO_DE_PALAVRAS_POR_FRASE;
  for (const bloco of BLOCOS_FALADOS) {
    const texto = textos[bloco];
    if (!texto) continue;
    const palavras = lerPalavras(texto);
    for (const { de, ate } of frases(palavras)) {
      const quantas = ate - de + 1;
      if (quantas > limite) {
        lista.push({
          regra: "R-FALA-04",
          comeco: palavras
            .slice(de, de + 6)
            .map((p) => p.texto)
            .join(" "),
          palavras: quantas,
        });
      }
    }
  }
  if (contexto.ambienteComBarulho) lista.push({ regra: "R-FALA-14" });
  if (contexto.publicoMaisVelho) lista.push({ regra: "R-FALA-15" });
  return lista;
}

/** A palavra de peso mais provável de um texto sem nada marcado, só para o simulador (`ia/mock.ts`): a mais comprida de cada frase (com pelo menos 5 letras). */
export function pesoPelaMaisComprida(texto: string): string {
  const palavras = lerPalavras(texto);
  for (const { de, ate } of frases(palavras)) {
    let melhor = -1;
    let tamanho = 4;
    for (let i = de; i <= ate; i++) {
      const limpa = palavras[i].texto.replace(/[^\p{L}\p{N}]/gu, "");
      if (limpa.length > tamanho) {
        tamanho = limpa.length;
        melhor = i;
      }
    }
    if (melhor >= 0) palavras[melhor].peso = true;
  }
  return escreverPalavras(palavras);
}
