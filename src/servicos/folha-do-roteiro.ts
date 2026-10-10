/**
 * A folha do roteiro (E26, passo 23 do Opus, `RoteiroPDF.dc.html`): o roteiro como ele se imprime ou se guarda como imagem, já em frases e sem nenhuma consulta. A mesma folha alimenta a página
 * A4 (o PDF) e o quadro 9:16 (a imagem para o celular); quem desenha só escolhe o que mostrar. Sem marca do aplicativo (regra 3): no alto, o nome da marca da pessoa e a data.
 */
import { fichaDoRoteiro, ROTULO_PARA_QUE } from "@/config/fichas";
import { seloDoTipo } from "@/config/formatos";
import { classificarMultiplo, formatarMultiplo, rotuloMultiploConta } from "@/lib/formatarNumero";
import { BLOCOS_FALADOS, fatiarMarcado, marcadoParaOsParagrafos, paragrafosMarcados, type MarcasParaATela, type TomDoBloco } from "@/lib/marcas-de-fala";
import { textosRoteiro } from "@/textos/roteiro";

import type { VideoParaEmbed } from "./pesquisa";
import { blocosParaLeitura, corpoDoRoteiro, type RoteiroLinha } from "./roteiro";

/** Um pedaço do roteiro na folha: uma fala (ou um cartão) com o tempo no início do bloco, o que aparece na tela e a cena. */
export type UnidadeDaFolha = {
  /** O tempo do bloco ("0 a 3 s"), só na primeira unidade dele e só em Reels falado. */
  tempo: string | null;
  /** O nome do bloco ("Os 3 primeiros segundos"), só na primeira unidade dele. */
  rotulo: string | null;
  /** Um parágrafo da fala; nulo na unidade que só traz o que mostrar (Story e vídeo sem fala sem texto). */
  fala: string | null;
  /** E41 2c: a mesma fala com as marcas (`{p:}`, `{//}`...), quando a folha vai com as marcas; o texto sem elas é `fala`. */
  falaMarcada: string | null;
  /** E41 2c: o tom do bloco ("direto", "perto", "calmo", "firme"), só na primeira unidade dele e só com as marcas. */
  tom: TomDoBloco | null;
  /** O texto na tela e as cenas do bloco, uma linha cada, só na última unidade dele ("Na tela (0 a 2 s): ..."). */
  mostrar: string[];
  /** A última unidade do bloco: leva o filete embaixo. */
  fimDoBloco: boolean;
};

export type FolhaDoRoteiro = {
  marca: string;
  dataLonga: string;
  dataCurta: string;
  titulo: string;
  /** "Reels", "40 segundos", "Para que te chamem", "Tipo: erro comum" (Story não tem os dois últimos). */
  chips: string[];
  /** "O recado deste vídeo": o que a pessoa disse que o vídeo precisa comunicar, quando disse. */
  recado: string | null;
  unidades: UnidadeDaFolha[];
  /** E41 2c: a folha leva as marcas de fala (a legenda curta no pé, porque o papel não abre a folha "Como ler as marcas"). */
  comMarcas: boolean;
  /** "Como editar", só em Reels falado (nos outros formatos o que editar já está em cada cartão). */
  comoEditar: { rotulo: string; texto: string }[] | null;
  /** "De onde veio", só quando o roteiro nasceu de um vídeo do banco. */
  deOndeVeio: { conta: string; resumo: string; trecho: string | null; link: { href: string; texto: string } | null } | null;
  /** A legenda do post, quando o formato tem uma. */
  legenda: string | null;
  /** A linha do pé da imagem: o ritmo de corte e o áudio, uma frase curta de cada ("Corte a cada 4 ou 5 s · sem áudio de fundo", como no desenho); nulo fora do Reels falado. */
  linhaDoPe: string | null;
  /** O nome do arquivo sem a extensão (`roteiro-2026-10-07`). */
  nomeDoArquivo: string;
};

function formatar(data: string, opcoes: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("pt-BR", { ...opcoes, timeZone: "America/Sao_Paulo" }).format(new Date(`${data}T12:00:00`));
}

/** "7 de setembro de 2026": a data do pé do PDF. */
export function dataPorExtenso(data: string): string {
  return formatar(data, { day: "numeric", month: "long", year: "numeric" });
}

function formatarSegundo(segundo: number): string {
  return `${Math.floor(segundo / 60)}:${String(Math.floor(segundo % 60)).padStart(2, "0")}`;
}

function comInicialMinuscula(texto: string): string {
  return texto.length > 0 ? texto[0].toLowerCase() + texto.slice(1) : texto;
}

/**
 * Os quatro tempos de um Reels falado, os mesmos limites que decidem em que bloco cai cada texto na tela (`blocoDoSegundo`): a abertura até os 3 s, o meio até 65% da duração, o fechamento até
 * 85% e a chamada até o fim. Em vídeo curto os limites se encostam em vez de se cruzar.
 */
export function temposDosBlocosReels(duracaoS: number): [string, string, string, string] {
  const total = Math.max(1, Math.round(duracaoS));
  const abertura = Math.min(3, total);
  const meio = Math.max(abertura, Math.round(total * 0.65));
  const fechamento = Math.max(meio, Math.round(total * 0.85));
  const faixa = (de: number, ate: number) => (de === ate ? `${de} s` : `${de} a ${ate} s`);
  return [faixa(0, abertura), faixa(abertura, meio), faixa(meio, fechamento), faixa(fechamento, total)];
}

/** O tamanho de uma fala numa unidade da imagem 9:16 (em letras) e quantas linhas de "Na tela" ou cena cabem juntas: o quadro tem cerca de 520 px para o roteiro, e cada unidade tem de caber sozinha. */
export const LIMITE_DA_FALA_POR_UNIDADE = 420;
const LINHAS_DE_MOSTRAR_POR_UNIDADE = 4;

/** Parte um parágrafo comprido em pedaços de até `limite` letras, sempre no fim de uma frase (ou numa palavra, se uma frase sozinha passa do limite): a imagem nunca corta uma frase no meio. */
export function partirFala(paragrafo: string, limite = LIMITE_DA_FALA_POR_UNIDADE): string[] {
  const texto = paragrafo.trim();
  if (texto.length <= limite) return [texto];
  // Parte só onde há pontuação seguida de espaço: "Dr.Wash" e "R$ 1.000" ficam inteiros, e nenhuma letra do parágrafo fica de fora (a regra antiga descartava o texto até o próximo
  // ponto com espaço).
  const frases = texto.split(/(?<=[.!?])\s+/).filter((f) => f.length > 0);
  const pedacos: string[] = [];
  let atual = "";
  const fechar = () => {
    if (atual.trim()) pedacos.push(atual.trim());
    atual = "";
  };
  for (const frase of frases) {
    if (frase.length > limite) {
      fechar();
      let resto = frase.trim();
      while (resto.length > limite) {
        let corte = resto.lastIndexOf(" ", limite);
        if (corte < limite * 0.5) corte = limite;
        pedacos.push(resto.slice(0, corte).trim());
        resto = resto.slice(corte).trim();
      }
      atual = resto;
      continue;
    }
    if (atual && atual.length + 1 + frase.length > limite) fechar();
    atual = atual ? `${atual} ${frase}` : frase;
  }
  fechar();
  return pedacos;
}

/** A primeira frase de um texto, até `limite` letras: o ritmo de corte inteiro é longo para o pé de uma imagem. */
function primeiraFrase(texto: string, limite = 90): string | null {
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (!limpo) return null;
  const ate = limpo.search(/[.!?](\s|$)/);
  const frase = ate >= 0 ? limpo.slice(0, ate + 1) : limpo;
  if (frase.length <= limite) return frase;
  return `${frase.slice(0, limite - 1).trimEnd()}…`;
}

export function folhaDoRoteiro(roteiro: RoteiroLinha, marca: string, video: VideoParaEmbed | null, marcas: MarcasParaATela | null = null): FolhaDoRoteiro {
  const corpo = corpoDoRoteiro(roteiro);
  const ehStory = roteiro.formato === "story";
  const reelsFalado = !ehStory && roteiro.estilo !== "sem_fala";
  const tempos = reelsFalado ? temposDosBlocosReels(corpo.duracaoS) : null;

  const unidades: UnidadeDaFolha[] = [];
  blocosParaLeitura(roteiro).forEach((bloco, indice) => {
    const mostrar = [...(bloco.mostrar ?? []), ...(bloco.cenas ?? []).map((cena) => textosRoteiro.mostrar.oQueMostrar(`${cena.momento}, ${cena.oQueFazer}`))];
    // Cada pedaço da fala é uma unidade (um parágrafo, ou uma parte dele quando é comprido): a imagem 9:16 parte um bloco entre dois quadros sem cortar uma frase no meio.
    // Com as marcas (E41 2c), cada pedaço leva o seu marcado: o parágrafo marcado é partido nas mesmas palavras; um bloco cujo marcado não bate com o texto sai sem marcas.
    const nomeDoBloco = reelsFalado && marcas ? BLOCOS_FALADOS[indice] : undefined;
    const marcadoDoBloco = nomeDoBloco ? marcadoParaOsParagrafos(bloco.paragrafos, paragrafosMarcados(marcas ?? null, nomeDoBloco)) : null;
    const tomDoBloco = marcadoDoBloco && nomeDoBloco ? (marcas?.blocos.find((b) => b.bloco === nomeDoBloco)?.tom ?? null) : null;
    const falasMarcadas: (string | null)[] = [];
    const falas = bloco.paragrafos.flatMap((p, iParagrafo) => {
      if (p.trim().length === 0) return [];
      const pedacos = partirFala(p);
      const fatias = marcadoDoBloco && marcadoDoBloco.length === bloco.paragrafos.length ? fatiarMarcado(marcadoDoBloco[iParagrafo], pedacos) : null;
      pedacos.forEach((_, i) => falasMarcadas.push(fatias ? fatias[i] : null));
      return pedacos;
    });
    // O que mostrar vai junto da última fala; quando são muitas linhas (várias cenas), as que passam de quatro viram unidades próprias, para nenhuma unidade passar do quadro.
    const grupos: string[][] = [];
    for (let i = 0; i < mostrar.length; i += LINHAS_DE_MOSTRAR_POR_UNIDADE) grupos.push(mostrar.slice(i, i + LINHAS_DE_MOSTRAR_POR_UNIDADE));
    const unidadesDoBloco: (Omit<UnidadeDaFolha, "tempo" | "rotulo" | "fimDoBloco" | "tom" | "falaMarcada"> & { marcada?: string | null })[] =
      falas.length > 0
        ? falas
            .map((fala, i) => ({ fala, marcada: falasMarcadas[i] ?? null, mostrar: i === falas.length - 1 ? (grupos[0] ?? []) : [] }))
            .concat(grupos.slice(1).map((linhas) => ({ fala: "", marcada: null, mostrar: linhas })))
        : grupos.length > 0
          ? grupos.map((linhas) => ({ fala: "", marcada: null, mostrar: linhas }))
          : [{ fala: "", marcada: null, mostrar: [] }];
    unidadesDoBloco.forEach((unidade, i) => {
      unidades.push({
        tempo: i === 0 && tempos ? (tempos[indice] ?? null) : null,
        rotulo: i === 0 ? bloco.rotulo : null,
        fala: unidade.fala || null,
        falaMarcada: unidade.marcada ?? null,
        tom: i === 0 && falasMarcadas.some((m) => m !== null) ? tomDoBloco : null,
        mostrar: unidade.mostrar,
        fimDoBloco: i === unidadesDoBloco.length - 1,
      });
    });
  });
  // Story e vídeo sem fala: "Onde gravar e o que mostrar" (as cenas) não está nos blocos de cada cartão, e o PDF antigo e a tela mostram. Entra no fim, em unidades de até quatro linhas.
  if (!reelsFalado && corpo.cenas.length > 0) {
    const linhas = corpo.cenas.map((cena) => `${cena.momento}: ${cena.oQueFazer}`);
    for (let i = 0; i < linhas.length; i += LINHAS_DE_MOSTRAR_POR_UNIDADE) {
      unidades.push({
        tempo: null,
        rotulo: i === 0 ? textosRoteiro.ondeGravar : null,
        fala: null,
        falaMarcada: null,
        tom: null,
        mostrar: linhas.slice(i, i + LINHAS_DE_MOSTRAR_POR_UNIDADE),
        fimDoBloco: i + LINHAS_DE_MOSTRAR_POR_UNIDADE >= linhas.length,
      });
    }
  }

  const formatos = textosRoteiro.folha.formato;
  const chips = [ehStory ? formatos.story : roteiro.estilo === "sem_fala" ? formatos.reelsSemFala : formatos.reels, textosRoteiro.folha.segundos(corpo.duracaoS)];
  if (!ehStory) {
    chips.push(ROTULO_PARA_QUE[fichaDoRoteiro(roteiro)]);
    const tipo = seloDoTipo(video?.formatoCatalogo);
    if (tipo) chips.push(tipo);
  }

  const edicao = corpo.edicao;
  const comoEditar = reelsFalado
    ? [
        {
          rotulo: textosRoteiro.edicao.texto,
          texto: edicao.textoNaTela.length > 0 ? edicao.textoNaTela.map((item) => `${item.quando}, "${item.oQue}", ${item.onde}`).join("; ") : textosRoteiro.edicao.semTexto,
        },
        { rotulo: textosRoteiro.edicao.corte, texto: edicao.ritmoDeCorte },
        { rotulo: textosRoteiro.edicao.recursos, texto: edicao.recursos.length > 0 ? edicao.recursos.join("; ") : textosRoteiro.edicao.semRecurso },
        { rotulo: textosRoteiro.edicao.audio, texto: edicao.audio ?? textosRoteiro.edicao.semAudio },
      ]
    : null;

  const referencia = edicao.referencia;
  const segundo = referencia && referencia.segundo !== null && referencia.segundo > 0 ? referencia.segundo : null;
  const deOndeVeio =
    video && referencia
      ? {
          conta: video.contaNome ?? video.contaHandle ?? "",
          // "4,1x acima do normal dessa conta. O que funcionou ali: ..." (o número e a frase, como no cartão da tela).
          resumo: `${formatarMultiplo(video.foraDaCurva)} ${rotuloMultiploConta(classificarMultiplo(video.foraDaCurva), video.contaMedianaOrigem)}. ${textosRoteiro.oQueFuncionouAli} ${comInicialMinuscula(video.porQueFuncionou ?? "")}`.trim(),
          trecho: segundo !== null ? textosRoteiro.trechoComeca(formatarSegundo(segundo)) : null,
          link: video.url ? { href: video.url, texto: `${video.url.replace(/^https?:\/\/(www\.)?/, "")}${segundo !== null ? `, a partir de ${formatarSegundo(segundo)}` : ""}` } : null,
        }
      : null;

  return {
    marca,
    dataLonga: formatar(roteiro.data, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    dataCurta: formatar(roteiro.data, { day: "numeric", month: "long" }),
    titulo: corpo.titulo,
    chips,
    recado: roteiro.objetivoDoVideo?.trim() || null,
    unidades,
    comMarcas: unidades.some((u) => u.falaMarcada !== null),
    comoEditar,
    deOndeVeio,
    legenda: corpo.legenda?.trim() || null,
    linhaDoPe: reelsFalado ? [primeiraFrase(edicao.ritmoDeCorte, 60), primeiraFrase(edicao.audio ?? "", 50)].filter(Boolean).join(" · ") || null : null,
    nomeDoArquivo: `roteiro-${roteiro.data}`,
  };
}
