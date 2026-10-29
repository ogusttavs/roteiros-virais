/**
 * E47 PR 3: as conferências de código da edição, antes do verificador barato (que lê a legenda por significado). São as que valem mais que um modelo, porque são exatas: alerta de corte
 * com palavra ainda soando (o motor já calcula), nome da marca escrito quase certo na legenda, título com número que ninguém falou, título com promessa que o roteiro não faz, título maior
 * que o quadro aguenta. Tudo puro. Cada frase devolvida serve de motivo para o modelo forte decidir de novo, então fala do que está errado e do que fazer.
 */
import { AJUSTES_DA_EDICAO } from "@/config/edicao";
import { encontrarProblemas } from "@/lib/regras-de-texto";

import type { Edl, Legendas, PalavraFalada } from "./tipos";
import { distanciaDeEdicao, normalizar } from "./transcricao";

/** Os nomes que a legenda precisa escrever certo: o da marca, o lugar e os concorrentes que ela citou. Sem repetir e sem vazio. */
export function nomesParaGrafar(dados: { nomeDaMarca: string; cidade?: string | null; regiao?: string | null; concorrentes?: string[] | null }): string[] {
  const todos = [dados.nomeDaMarca, dados.regiao, dados.cidade, ...(dados.concorrentes ?? [])]
    .map((n) => (n ?? "").replace(/\s+/g, " ").trim())
    .filter((n) => n !== "");
  const vistos = new Set<string>();
  return todos.filter((n) => {
    const chave = normalizar(n);
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

/** Quantas letras de diferença ainda contam como "o mesmo nome escrito errado": nome curto só vale exato, e a primeira letra tem de ser a mesma (corta quase todo falso alarme). */
function tolerancia(compacto: string): number {
  if (compacto.length < 5) return 0;
  if (compacto.length === 5) return 1;
  return compacto.length <= 9 ? 2 : 3;
}

export type NomeParecido = { nome: string; achado: string };

/**
 * Nomes que aparecem na legenda quase iguais ao certo, mas diferentes (letra trocada, faltando ou sobrando, ou um espaço onde não devia). Compara sem maiúscula, sem acento e sem espaço
 * (a legenda sai em caixa alta, e "Dr Wash" e "DrWash" são o mesmo nome). Onde o nome certo aparece inteiro, o trecho não conta.
 */
export function nomesParecidosNaLegenda(textoDaLegenda: string, nomes: string[]): NomeParecido[] {
  const palavras = normalizar(textoDaLegenda).split(" ").filter(Boolean);
  const achados: NomeParecido[] = [];
  for (const nome of nomes) {
    const partes = normalizar(nome).split(" ").filter(Boolean);
    const alvo = partes.join("");
    const tol = tolerancia(alvo);
    if (tol === 0) continue;
    const usadas = new Set<number>();
    const candidatos: Array<{ de: number; ate: number; texto: string }> = [];
    for (let tamanho = Math.max(1, partes.length - 1); tamanho <= partes.length + 1; tamanho++) {
      for (let i = 0; i + tamanho <= palavras.length; i++) {
        const janela = palavras.slice(i, i + tamanho);
        const compacto = janela.join("");
        if (compacto === alvo) {
          for (let k = i; k < i + tamanho; k++) usadas.add(k);
        } else if (compacto[0] === alvo[0] && distanciaDeEdicao(compacto, alvo) <= tol) {
          candidatos.push({ de: i, ate: i + tamanho - 1, texto: janela.join(" ") });
        }
      }
    }
    const vistos = new Set<string>();
    for (const c of candidatos) {
      let sobrepoe = false;
      for (let k = c.de; k <= c.ate; k++) if (usadas.has(k)) sobrepoe = true;
      if (sobrepoe || vistos.has(c.texto)) continue;
      vistos.add(c.texto);
      achados.push({ nome, achado: c.texto });
    }
  }
  return achados;
}

const NUMEROS_POR_EXTENSO: Record<string, string> = {
  um: "1", uma: "1", dois: "2", duas: "2", tres: "3", quatro: "4", cinco: "5", seis: "6", sete: "7", oito: "8", nove: "9", dez: "10", onze: "11", doze: "12", treze: "13", quinze: "15",
  vinte: "20", trinta: "30", quarenta: "40", cinquenta: "50", cem: "100", mil: "1000",
};

/** Os números escritos com dígito num texto, sem ponto nem vírgula ("3.956" vira "3956"). */
export function numerosEscritos(texto: string): Set<string> {
  const achados = new Set<string>();
  for (const m of texto.matchAll(/\p{Nd}[\p{Nd}.,]*/gu)) achados.add(m[0].replace(/[.,]+$/g, "").replace(/[.,]/g, ""));
  return achados;
}

/** Os números de um texto como dígitos soltos: os escritos com dígito e os por extenso ("três" vira "3"). */
export function numerosDoTexto(texto: string): Set<string> {
  const achados = numerosEscritos(texto);
  for (const palavra of normalizar(texto).split(" ")) {
    const numero = NUMEROS_POR_EXTENSO[palavra];
    if (numero) achados.add(numero);
  }
  return achados;
}

/** Palavras de promessa absoluta. Só vale quando a palavra NÃO está no roteiro (se o roteiro, que passou pelo verificador, já a usa, o título pode usar). */
const PROMESSAS: Array<{ padrao: RegExp; nome: string }> = [
  { padrao: /garanti/i, nome: "garantia" },
  { padrao: /milagr/i, nome: "milagre" },
  { padrao: /100\s*%/, nome: "100%" },
  { padrao: /sem risco/i, nome: "sem risco" },
  { padrao: /nunca (?:mais )?falha/i, nome: "nunca falha" },
  { padrao: /fique rico|ganhe dinheiro|dinheiro f[aá]cil/i, nome: "promessa de dinheiro" },
  { padrao: /\bcura\b|\bcure\b/i, nome: "cura" },
];

function palavrasDe(texto: string): string[] {
  return texto.split(/\s+/).filter(Boolean);
}

export type TituloDaEdicao = { texto: string; subtitulo: string | null };

/** Problemas do título e do subtítulo. `fala` é o que a pessoa disse (todas as palavras) e `roteiro` o texto do roteiro do dia. */
export function conferirTitulo(titulo: TituloDaEdicao, fala: string, roteiro: string): string[] {
  const problemas: string[] = [];
  const texto = titulo.texto.replace(/\s+/g, " ").trim();
  const A = AJUSTES_DA_EDICAO;
  if (texto === "") return ["o título está vazio"];
  if (palavrasDe(texto).length > A.tituloMaxPalavras || texto.length > A.tituloMaxLetras) {
    problemas.push(`o título é grande demais para o primeiro quadro (no máximo ${A.tituloMaxPalavras} palavras e ${A.tituloMaxLetras} letras)`);
  }
  if (/[!]/.test(texto)) problemas.push("o título tem ponto de exclamação; use pergunta ou frase direta");
  if (/["“”]/.test(texto)) problemas.push("o título tem aspas; tire");
  for (const p of encontrarProblemas(texto)) problemas.push(`o título tem ${p}`);

  const sub = (titulo.subtitulo ?? "").replace(/\s+/g, " ").trim();
  if (sub !== "") {
    if (palavrasDe(sub).length > A.subtituloMaxPalavras || sub.length > A.subtituloMaxLetras) {
      problemas.push(`o subtítulo é grande demais (no máximo ${A.subtituloMaxPalavras} palavras e ${A.subtituloMaxLetras} letras)`);
    }
    for (const p of encontrarProblemas(sub)) problemas.push(`o subtítulo tem ${p}`);
  }

  const verdade = numerosDoTexto(`${fala} ${roteiro}`);
  for (const numero of numerosEscritos(`${texto} ${sub}`)) {
    if (!verdade.has(numero)) problemas.push(`o título cita o número ${numero}, que a pessoa não falou e o roteiro não tem; use só números que ela falou`);
  }
  const alvo = `${texto} ${sub}`;
  for (const { padrao, nome } of PROMESSAS) {
    if (padrao.test(alvo) && !padrao.test(roteiro)) problemas.push(`o título promete "${nome}", e o roteiro não promete isso; tire a promessa`);
  }
  return problemas;
}

/** Avisos para a pessoa que servem: sem travessão, emoji nem jargão, sem repetir, no máximo 3 e com no máximo 200 letras cada. */
export function limparAvisos(avisos: string[]): string[] {
  const vistos = new Set<string>();
  const limpos: string[] = [];
  for (const bruto of avisos) {
    const aviso = bruto.replace(/\s+/g, " ").trim();
    if (aviso === "" || aviso.length > 200 || encontrarProblemas(aviso).length > 0) continue;
    const chave = normalizar(aviso);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    limpos.push(aviso);
    if (limpos.length === 3) break;
  }
  return limpos;
}

export type DadosDaConferencia = {
  edl: Edl;
  legenda: Legendas;
  titulo: TituloDaEdicao;
  palavras: PalavraFalada[];
  textoDoRoteiro: string;
  nomes: string[];
};

/** Tudo o que o código confere sozinho. Lista vazia é "pode ir para o verificador barato". */
export function conferirLocal(dados: DadosDaConferencia): string[] {
  const problemas: string[] = [];
  for (const alerta of dados.edl.alertas) {
    problemas.push(`corte ruim: ${alerta}. Mude o fim do trecho para o fim de uma frase que a pessoa terminou de falar`);
  }
  if (dados.legenda.blocos.length === 0) problemas.push("a legenda ficou vazia");
  const textoDaLegenda = dados.legenda.blocos.map((b) => b.texto).join(" ");
  for (const { nome, achado } of nomesParecidosNaLegenda(textoDaLegenda, dados.nomes)) {
    problemas.push(`o nome "${nome}" aparece na legenda como "${achado}"; acrescente em correcoesDaLegenda a troca das palavras que a pessoa disse (copie da fala) por "${nome}"`);
  }
  const fala = dados.palavras.map((p) => p.texto).join(" ");
  problemas.push(...conferirTitulo(dados.titulo, fala, dados.textoDoRoteiro));
  return problemas;
}
