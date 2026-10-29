/**
 * E47 PR 4: um vídeo SINTÉTICO e o plano de edição dele, para provar o render sem nenhum vídeo de ninguém (testes de integração, e2e, `scripts/render-fumaca.ts` e o ensaio do Compose). O vídeo é
 * o `testsrc2` do ffmpeg com um tom de áudio, em pé, 1080x1920 a 30 quadros (HEVC 10 bits com HLG, como o iPhone, se pedido). O plano vem da fala sintética (`sintetica.ts`) e do motor de
 * corte, igual ao da decisão: vários trechos, "combinar" nas trocas de assunto, título e legenda.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { DecisaoDaEdicao } from "@/db/schema";

import { montarPlano } from "./decisao";
import { montarFalaSintetica, type FraseFalada } from "./sintetica";
import type { Edl, Energia, Legendas, PalavraFalada } from "./tipos";

const executar = promisify(execFile);

const FRASES = [
  "Oi gente tudo bem com vocês hoje",
  "Hoje eu vou mostrar três erros ao lavar a louça",
  "O primeiro erro é usar detergente demais no copo",
  "Isso deixa um gosto estranho na água depois",
  "O segundo erro é esquecer o enxágue com água morna",
  "Quase todo mundo faz isso sem perceber nada",
  "O terceiro erro é secar com pano sujo e úmido",
  "Troque o pano todos os dias e pronto",
  "Se você gostou chame no WhatsApp e peça o seu orçamento",
];

export type CasoSintetico = {
  palavras: PalavraFalada[];
  energia: Energia;
  duracaoDoBrutoS: number;
  edl: Edl;
  legenda: Legendas;
  titulo: { texto: string; subtitulo: string | null };
  decisao: DecisaoDaEdicao;
};

/** Uma fala sintética de uns `segundos` segundos e o plano de edição dela (3 frases por trecho, "combinar" a cada troca, a primeira frase de conversa solta cortada). */
export function montarCasoSintetico(segundos: number): CasoSintetico {
  const frases: FraseFalada[] = [];
  let k = 0;
  let total = 0;
  while (total < segundos || frases.length < 5) {
    const texto = FRASES[k % FRASES.length];
    const pausaAntes = k % 3 === 0 ? 1.4 : 0.35;
    frases.push({ texto, pausaAntes });
    const n = texto.split(" ").length;
    total += pausaAntes + 0.24 * n + 0.045 * texto.length;
    k += 1;
  }
  const fala = montarFalaSintetica(frases);
  const trechos: DecisaoDaEdicao["trechos"] = [];
  for (let i = 1; i < fala.faixas.length; i += 3) {
    const ultima = Math.min(i + 2, fala.faixas.length - 1);
    trechos.push({ deIndice: fala.faixas[i].deIndice, ateIndice: fala.faixas[ultima].ateIndice, motivo: "o que fica", transicao: trechos.length === 0 ? "nenhuma" : "combinar" });
  }
  const titulo = { texto: "Você lava a louça do jeito certo?", subtitulo: null };
  const decisao: DecisaoDaEdicao = {
    trechos,
    gancho: { deIndice: trechos[0].deIndice, ateIndice: fala.faixas[1].ateIndice, tentativasDescartadas: 1, porQue: "a abertura mais clara" },
    titulo,
    correcoesDaLegenda: [],
    avisos: [],
  };
  const plano = montarPlano({ palavras: fala.palavras, energia: fala.energia, decisao });
  if (!plano.ok) throw new Error(`o plano sintetico nao montou: ${plano.problemas.join("; ")}`);
  return { palavras: fala.palavras, energia: fala.energia, duracaoDoBrutoS: fala.duracao, edl: plano.edl, legenda: plano.legenda, titulo, decisao };
}

/** Gera o vídeo bruto sintético. `hdr` deixa no formato do iPhone (HEVC 10 bits, HLG, BT.2020). */
export async function gerarVideoSintetico(saida: string, duracaoS: number, opcoes: { hdr?: boolean; largura?: number; altura?: number } = {}): Promise<void> {
  const { largura = 1080, altura = 1920, hdr = false } = opcoes;
  const imagem = `testsrc2=size=${largura}x${altura}:rate=30${hdr ? ",format=yuv420p10le" : ""}`;
  const codec = hdr
    ? ["-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p10le", "-x265-params", "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:log-level=error", "-tag:v", "hvc1"]
    : ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"];
  await executar("ffmpeg", ["-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", imagem, "-f", "lavfi", "-i", "sine=frequency=300:sample_rate=48000", "-t", String(duracaoS), ...codec, "-c:a", "aac", saida]);
}

/** A duração e o tamanho da imagem de um vídeo pronto, lidos pelo ffprobe. */
export async function sondarSaida(caminho: string): Promise<{ duracaoS: number; largura: number; altura: number; temAudio: boolean }> {
  const { stdout } = await executar("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", caminho]);
  const dados = JSON.parse(stdout) as { format: { duration: string }; streams: { codec_type: string; width?: number; height?: number }[] };
  const video = dados.streams.find((s) => s.codec_type === "video");
  return { duracaoS: Number(dados.format.duration), largura: video?.width ?? 0, altura: video?.height ?? 0, temAudio: dados.streams.some((s) => s.codec_type === "audio") };
}
