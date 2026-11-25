/**
 * Conferência do vídeo montado: depois que o render escreve a prévia e antes de a pessoa ver, o arquivo é medido (ffprobe e uma passada do ffmpeg com `ebur128`, `silencedetect`, `blackdetect` e
 * `freezedetect`, sem dependência nova nem IA) e comparado com o plano. `avaliar` é puro e é onde estão os limites (`LIMITES_DA_CONFERENCIA`); `medirVideo` é quem roda os processos.
 *
 * Só o defeito de forma é grave (arquivo sem imagem, sem som quando o bruto tinha, do tamanho errado ou ilegível) e manda refazer o render uma vez e, na segunda, a edição vai para revisão.
 * Todo o resto (volume, quadro preto, duração, silêncio ou quadro parado que o plano não pediu, texto que passa do quadro) só vira aviso guardado e a prévia segue normal. É assim até calibrar
 * os limites com as medidas de produção (decisão da Central em 25/11/2026). Os textos daqui são técnicos e só o admin os lê; a pessoa nunca vê.
 * Nada da fala, do título ou da legenda vai para log: só números.
 */
import { AJUSTES_DO_RENDER, LIMITES_DA_CONFERENCIA as L } from "@/config/edicao";
import { executarComLimite, type ExecutorDeProcesso } from "@/jobs/processo";

import { ESTILO_DA_LEGENDA, ESTILO_DO_TITULO, linhasDoTitulo, textoSeguroDoAss, TELA_DO_ASS } from "./ass";
import { larguraDoTexto, medidasDaFonteEmbutida, type MedidasDaFonte } from "./medida-de-texto";
import type { PerfilDeRender } from "./render-grafo";
import type { BlocoLegenda } from "./tipos";

export type Intervalo = { inicio: number; duracao: number };

/** O que as ferramentas leram do arquivo. */
export type MedidasDoVideo = {
  duracaoS: number | null;
  largura: number | null;
  altura: number | null;
  temVideo: boolean;
  temAudio: boolean;
  /** Volume integrado em LUFS, ou `null` quando o ffmpeg não mediu (áudio curto demais ou ausente). */
  volumeLufs: number | null;
  preto: Intervalo[];
  parado: Intervalo[];
  mudo: Intervalo[];
};

export type EsperadoDoVideo = {
  perfil: PerfilDeRender;
  /** A duração que o plano calculou, com o respiro final. */
  duracaoS: number;
  respiroFinalS: number;
  /** O bruto tinha faixa de áudio? O padrão é sim: o grafo do render exige áudio, então um render que terminou veio de um bruto com som. */
  brutoTinhaAudio?: boolean;
};

export type TextoForaDoQuadro = { legenda: number; titulo: number; piorFolgaPx: number };

export type Conferencia = {
  graves: string[];
  leves: string[];
  /** Números para o admin, sem texto de ninguém. */
  medidas: Record<string, number | boolean | null>;
};

const arredondar = (n: number, casas = 2): number => Math.round(n * 10 ** casas) / 10 ** casas;

/** Tira de um intervalo a parte que o plano pediu (o fim escurecendo, o último quadro segurando). `null` quando o intervalo todo é esperado. */
function semOEsperado(i: Intervalo, aPartirDeS: number): Intervalo | null {
  if (i.inicio >= aPartirDeS) return null;
  const fim = Math.min(i.inicio + i.duracao, aPartirDeS);
  return { inicio: i.inicio, duracao: fim - i.inicio };
}

/**
 * Quantas linhas de texto passam do quadro. O texto cabe se a largura dele mais a caixa dos dois lados fica dentro da tela menos as margens laterais do estilo (a mesma conta do `ass.ts`, com a
 * fonte embutida que o libass usa).
 */
export function textoForaDoQuadro(blocos: BlocoLegenda[], titulo: { texto: string; subtitulo: string | null }, fonte: MedidasDaFonte): TextoForaDoQuadro {
  const cabe = (estilo: { caixa: number; margemLateral: number }) => TELA_DO_ASS.largura - 2 * estilo.margemLateral - 2 * estilo.caixa;
  let legenda = 0;
  let tituloFora = 0;
  let piorFolgaPx = Infinity;
  for (const bloco of blocos) {
    const texto = textoSeguroDoAss(bloco.texto);
    if (texto === "") continue;
    const folga = cabe(ESTILO_DA_LEGENDA) - larguraDoTexto(fonte, texto, ESTILO_DA_LEGENDA.tamanho);
    piorFolgaPx = Math.min(piorFolgaPx, folga);
    if (folga < 0) legenda += 1;
  }
  for (const linha of linhasDoTitulo(titulo.texto.toLocaleUpperCase("pt-BR"))) {
    const folga = cabe(ESTILO_DO_TITULO) - larguraDoTexto(fonte, linha, ESTILO_DO_TITULO.tamanho);
    piorFolgaPx = Math.min(piorFolgaPx, folga);
    if (folga < 0) tituloFora += 1;
  }
  return { legenda, titulo: tituloFora, piorFolgaPx: Number.isFinite(piorFolgaPx) ? piorFolgaPx : 0 };
}

/** Compara as medidas com o plano. Puro: os limites estão em `LIMITES_DA_CONFERENCIA`. */
export function avaliar(medidas: MedidasDoVideo, esperado: EsperadoDoVideo, texto: TextoForaDoQuadro): Conferencia {
  const graves: string[] = [];
  const leves: string[] = [];
  const duracao = medidas.duracaoS ?? 0;
  const tela = AJUSTES_DO_RENDER[esperado.perfil];

  // Forma: tem imagem, tem som, o tamanho e a proporção do perfil.
  if (!medidas.temVideo) graves.push("o arquivo nao tem imagem");
  if (!medidas.temAudio && esperado.brutoTinhaAudio !== false) graves.push("o arquivo nao tem audio");
  if (medidas.temVideo && (medidas.largura !== tela.largura || medidas.altura !== tela.altura)) {
    graves.push(`tamanho da imagem ${medidas.largura}x${medidas.altura}, esperado ${tela.largura}x${tela.altura}`);
  }

  // Duração contra a soma dos trechos do plano (com o respiro final). Só `null` (ffprobe não leu) é grave; fora da tolerância é aviso.
  const diferenca = Math.abs(duracao - esperado.duracaoS);
  if (medidas.duracaoS === null) graves.push(`duracao ilegivel, esperada ${arredondar(esperado.duracaoS)} s`);
  else if (diferenca > L.duracaoLeveS) leves.push(`duracao ${arredondar(duracao)} s, esperada ${arredondar(esperado.duracaoS)} s`);

  // Volume e silêncio (só faz sentido se há áudio).
  if (medidas.temAudio) {
    if (medidas.volumeLufs !== null && Math.abs(medidas.volumeLufs - L.alvoDeVolumeLufs) > L.toleranciaDoVolumeLu) {
      leves.push(`volume de ${arredondar(medidas.volumeLufs, 1)} LUFS, alvo ${L.alvoDeVolumeLufs}`);
    } else if (medidas.volumeLufs === null) leves.push("volume nao medido");
    const aPartirDoFim = esperado.duracaoS - esperado.respiroFinalS - 0.5;
    const mudos = medidas.mudo.map((i) => semOEsperado(i, aPartirDoFim)).filter((i): i is Intervalo => i !== null && i.duracao >= L.mudoLongoS);
    if (mudos.length > 0) leves.push(`${mudos.length} trecho(s) mudo(s) acima de ${L.mudoLongoS} s, o maior com ${arredondar(Math.max(...mudos.map((i) => i.duracao)), 1)} s`);
  }

  // Imagem: quadro preto (o fim escurece de propósito) e quadro parado (o último quadro segura pelo respiro do plano).
  const pretos = medidas.preto.map((i) => semOEsperado(i, esperado.duracaoS - L.folgaDoFadeFinalS)).filter((i): i is Intervalo => i !== null);
  const maiorPreto = Math.max(0, ...pretos.map((i) => i.duracao));
  if (maiorPreto >= L.pretoLeveS) leves.push(`quadro preto de ${arredondar(maiorPreto, 1)} s`);
  const parados = medidas.parado.map((i) => semOEsperado(i, esperado.duracaoS - esperado.respiroFinalS - 0.3)).filter((i): i is Intervalo => i !== null && i.duracao >= L.paradoLeveS);
  if (parados.length > 0) leves.push(`${parados.length} trecho(s) de imagem parada acima de ${L.paradoLeveS} s, o maior com ${arredondar(Math.max(...parados.map((i) => i.duracao)), 1)} s`);

  // Texto dentro do quadro.
  if (texto.legenda > 0) leves.push(`${texto.legenda} bloco(s) de legenda mais largos que o quadro`);
  if (texto.titulo > 0) leves.push(`${texto.titulo} linha(s) do titulo mais largas que o quadro`);

  return {
    graves,
    leves,
    medidas: {
      duracaoS: medidas.duracaoS === null ? null : arredondar(medidas.duracaoS),
      diferencaDeDuracaoS: medidas.duracaoS === null ? null : arredondar(diferenca),
      esperadaS: arredondar(esperado.duracaoS),
      largura: medidas.largura,
      altura: medidas.altura,
      temVideo: medidas.temVideo,
      temAudio: medidas.temAudio,
      volumeLufs: medidas.volumeLufs === null ? null : arredondar(medidas.volumeLufs, 1),
      pretoMaxS: arredondar(maiorPreto),
      paradoMaxS: arredondar(Math.max(0, ...parados.map((i) => i.duracao))),
      mudoMaxS: arredondar(Math.max(0, ...medidas.mudo.map((i) => i.duracao))),
      textoMaisLargoQueOQuadro: texto.legenda + texto.titulo,
      piorFolgaDeTextoPx: Math.round(texto.piorFolgaPx),
    },
  };
}

/** Lê a saída de texto dos filtros do ffmpeg. Exportada para o teste. `duracaoS` fecha o intervalo que ficou aberto até o fim do arquivo. */
export function lerSaidaDoFfmpeg(saida: string, duracaoS: number | null): Pick<MedidasDoVideo, "volumeLufs" | "preto" | "parado" | "mudo"> {
  const preto: Intervalo[] = [];
  const parado: Intervalo[] = [];
  const mudo: Intervalo[] = [];
  let paradoAberto: number | null = null;
  let mudoAberto: number | null = null;
  let volumeLufs: number | null = null;
  let noResumo = false;
  for (const linha of saida.split(/\r?\n/)) {
    const p = /black_start:(-?[\d.]+)\s+black_end:(-?[\d.]+)\s+black_duration:(-?[\d.]+)/.exec(linha);
    if (p) preto.push({ inicio: Number(p[1]), duracao: Number(p[3]) });
    const pi = /freeze_start:\s*(-?[\d.]+)/.exec(linha);
    if (pi) paradoAberto = Number(pi[1]);
    const pd = /freeze_duration:\s*(-?[\d.]+)/.exec(linha);
    if (pd && paradoAberto !== null) {
      parado.push({ inicio: paradoAberto, duracao: Number(pd[1]) });
      paradoAberto = null;
    }
    const si = /silence_start:\s*(-?[\d.]+)/.exec(linha);
    if (si) mudoAberto = Math.max(0, Number(si[1]));
    const sd = /silence_duration:\s*(-?[\d.]+)/.exec(linha);
    if (sd && mudoAberto !== null) {
      mudo.push({ inicio: mudoAberto, duracao: Number(sd[1]) });
      mudoAberto = null;
    }
    if (/Summary:/.test(linha)) noResumo = true;
    const i = noResumo ? /\bI:\s+(-?[\d.]+)\s+LUFS/.exec(linha) : null;
    if (i) volumeLufs = Number(i[1]);
  }
  // Um intervalo que só acaba junto com o arquivo não ganha linha de fim.
  if (paradoAberto !== null && duracaoS !== null && duracaoS > paradoAberto) parado.push({ inicio: paradoAberto, duracao: duracaoS - paradoAberto });
  if (mudoAberto !== null && duracaoS !== null && duracaoS > mudoAberto) mudo.push({ inicio: mudoAberto, duracao: duracaoS - mudoAberto });
  return { volumeLufs: volumeLufs !== null && Number.isFinite(volumeLufs) && volumeLufs > -69 ? volumeLufs : null, preto, parado, mudo };
}

/** Roda o ffprobe e uma passada do ffmpeg no arquivo. Lança se o arquivo não abre. */
export async function medirVideo(caminho: string, executar?: ExecutorDeProcesso): Promise<MedidasDoVideo> {
  const sonda = await executarComLimite("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", caminho], 30_000, executar);
  const dados = JSON.parse(sonda.stdout) as { format?: { duration?: string }; streams?: { codec_type?: string; width?: number; height?: number }[] };
  const video = dados.streams?.find((s) => s.codec_type === "video");
  const temAudio = (dados.streams ?? []).some((s) => s.codec_type === "audio");
  const duracao = Number(dados.format?.duration);
  const duracaoS = Number.isFinite(duracao) ? duracao : null;
  const base = { duracaoS, largura: video?.width ?? null, altura: video?.height ?? null, temVideo: Boolean(video), temAudio };

  const filtroDeVideo = `blackdetect=d=${L.pretoLeveS}:pix_th=0.10,freezedetect=n=0.001:d=${L.paradoLeveS}`;
  const filtroDeAudio = `ebur128=framelog=quiet,silencedetect=n=${L.limiarDoMudoDb}dB:d=${L.mudoLongoS}`;
  const argumentos = ["-nostdin", "-v", "info", "-nostats", "-i", caminho];
  if (video) argumentos.push("-vf", filtroDeVideo);
  else argumentos.push("-vn");
  if (temAudio) argumentos.push("-af", filtroDeAudio);
  else argumentos.push("-an");
  argumentos.push("-f", "null", "-");
  const passada = await executarComLimite("ffmpeg", argumentos, L.tempoMaximoDaConferenciaMs, executar);
  return { ...base, ...lerSaidaDoFfmpeg(passada.stderr, duracaoS) };
}

/** Mede o arquivo e confere com o plano (inclui a largura do texto, com a fonte embutida). */
export async function conferirVideo(entrada: {
  caminho: string;
  esperado: EsperadoDoVideo;
  blocos: BlocoLegenda[];
  titulo: { texto: string; subtitulo: string | null };
  executar?: ExecutorDeProcesso;
}): Promise<Conferencia> {
  const medidas = await medirVideo(entrada.caminho, entrada.executar);
  const texto = textoForaDoQuadro(entrada.blocos, entrada.titulo, await medidasDaFonteEmbutida());
  return avaliar(medidas, entrada.esperado, texto);
}
