/**
 * E56 PR 2: as imagens de um post pronto. A Meta só aceita JPEG por `image_url` (`pesquisa/plataformas/docs/meta/publicacao-de-conteudo.md`: "O único formato de imagem compatível é o JPEG"), de 4:5 a 1,91:1 e
 * até 8 MB, e baixa a imagem de um endereço PÚBLICO. Por isso o aplicativo converte PNG para JPEG no servidor (o ffmpeg que a imagem do app já tem), confere a proporção e o peso ANTES de aceitar o post,
 * e guarda o JPEG em disco (`PUBLICAR_PASTA_TEMP/posts/post-<id>/NN.jpg`, o volume que o app e o worker dividem) até o post terminar, falhar ou ser cancelado.
 *
 * O endereço público leva um código assinado (HMAC com o segredo da sessão) com o post, a imagem e o prazo; a rota que serve o arquivo (`app/api/publicar-arquivo/imagem`) confere o código, o prazo e
 * se o post está sendo publicado agora. Nada daqui vai para log além do número do post.
 */
import { execFile } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { LIMITES_DO_POST_PRONTO } from "@/config/post-pronto";
import { config } from "@/lib/config";
import type { CodigoDeRecusaDoPost } from "@/textos/post-pronto";

const executar = promisify(execFile);

export function pastaDosPosts(): string {
  return join(process.env.PUBLICAR_PASTA_TEMP || join(tmpdir(), "roteiros-publicar"), "posts");
}

export function pastaDoPost(postId: number): string {
  return join(pastaDosPosts(), `post-${postId}`);
}

export function nomeDaImagem(indice: number): string {
  return `${String(indice + 1).padStart(2, "0")}.jpg`;
}

export function caminhoDaImagem(postId: number, indice: number): string {
  return join(pastaDoPost(postId), nomeDaImagem(indice));
}

/** Recusa de uma imagem, com o código da frase que a pessoa lê. */
export class ErroDeImagem extends Error {
  constructor(public readonly codigo: CodigoDeRecusaDoPost) {
    super(codigo);
  }
}

export type TipoDeImagem = "jpeg" | "png" | "webp";

/** O tipo pelo conteúdo (os primeiros bytes), nunca pelo nome ou pelo que o navegador disse. */
export function tipoPelosBytes(b: Uint8Array): TipoDeImagem | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "webp";
  return null;
}

/** A proporção cabe no que o Instagram aceita (com a folga de 1% para o arredondamento). */
export function proporcaoAceita(largura: number, altura: number): boolean {
  if (!(largura > 0 && altura > 0)) return false;
  const p = largura / altura;
  const { proporcaoMin, proporcaoMax, folgaDaProporcao } = LIMITES_DO_POST_PRONTO;
  return p >= proporcaoMin * (1 - folgaDaProporcao) && p <= proporcaoMax * (1 + folgaDaProporcao);
}

async function medir(caminho: string): Promise<{ largura: number; altura: number }> {
  try {
    const { stdout } = await executar("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", caminho], { timeout: 30_000 });
    const [l, a] = stdout.trim().split(",").map(Number);
    if (!(l > 0 && a > 0)) throw new Error("sem tamanho");
    return { largura: l, altura: a };
  } catch {
    throw new ErroDeImagem("imagem-ilegivel");
  }
}

export type ImagemPreparada = { jpeg: Buffer; largura: number; altura: number };

/**
 * Confere e prepara UMA imagem escolhida pela pessoa: tipo pelos bytes, tamanho de arquivo, proporção, e devolve o JPEG pronto para a Meta (PNG e WEBP viram JPEG, com o fundo branco onde havia
 * transparência; um JPEG que já cabe em 8 MB segue como está, sem perder qualidade). Passou de 8 MB, tenta uma qualidade menor antes de recusar.
 */
export async function prepararImagem(bytes: Uint8Array): Promise<ImagemPreparada> {
  if (bytes.byteLength === 0) throw new ErroDeImagem("imagem-vazia");
  if (bytes.byteLength > LIMITES_DO_POST_PRONTO.bytesDoArquivoMax) throw new ErroDeImagem("imagem-grande-demais");
  const tipo = tipoPelosBytes(bytes);
  if (!tipo) throw new ErroDeImagem("imagem-tipo");

  const pasta = join(tmpdir(), `roteiros-img-${randomBytes(6).toString("hex")}`);
  await mkdir(pasta, { recursive: true });
  try {
    const entrada = join(pasta, `entrada.${tipo === "jpeg" ? "jpg" : tipo}`);
    await writeFile(entrada, bytes);
    const { largura, altura } = await medir(entrada);
    if (!proporcaoAceita(largura, altura)) throw new ErroDeImagem("imagem-proporcao");
    if (tipo === "jpeg" && bytes.byteLength <= LIMITES_DO_POST_PRONTO.bytesDoJpegMax) return { jpeg: Buffer.from(bytes), largura, altura };

    for (const qualidade of ["2", "5", "9"]) {
      const saida = join(pasta, `saida-${qualidade}.jpg`);
      try {
        await executar(
          "ffmpeg",
          ["-v", "error", "-y", "-i", entrada, "-f", "lavfi", "-i", `color=c=white:s=${largura}x${altura}`, "-filter_complex", "[1:v][0:v]overlay=shortest=1:format=auto,format=yuvj420p", "-frames:v", "1", "-q:v", qualidade, saida],
          { timeout: 60_000 },
        );
      } catch {
        throw new ErroDeImagem("imagem-ilegivel");
      }
      const jpeg = await readFile(saida);
      if (jpeg.byteLength <= LIMITES_DO_POST_PRONTO.bytesDoJpegMax) return { jpeg, largura, altura };
    }
    throw new ErroDeImagem("imagem-pesada");
  } finally {
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Guarda os JPEGs do post na pasta dele. Falhou no meio: não sobra nada. */
export async function guardarImagensDoPost(postId: number, jpegs: Buffer[]): Promise<void> {
  await mkdir(pastaDoPost(postId), { recursive: true });
  try {
    for (let i = 0; i < jpegs.length; i++) await writeFile(caminhoDaImagem(postId, i), jpegs[i]);
  } catch (erro) {
    await apagarImagensDoPost(postId);
    throw erro;
  }
}

/** Apaga as imagens do post. Não existir não é erro. */
export async function apagarImagensDoPost(postId: number): Promise<void> {
  try {
    await rm(pastaDoPost(postId), { recursive: true, force: true });
  } catch {
    // Disco ou permissão: a varredura cuida do resto.
  }
}

/** Os números dos posts que ainda têm pasta em disco (para a varredura apagar a de quem já terminou). */
export async function postsComPastaEmDisco(): Promise<number[]> {
  try {
    const nomes = await readdir(pastaDosPosts());
    return nomes.map((n) => /^post-(\d+)$/.exec(n)?.[1]).filter((n): n is string => !!n).map(Number);
  } catch {
    return [];
  }
}

export async function tamanhoDaImagemGuardada(postId: number, indice: number): Promise<number | null> {
  try {
    const info = await stat(caminhoDaImagem(postId, indice));
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// O endereço público
// ---------------------------------------------------------------------------

/** O endereço vale por 3 horas (a Meta baixa em segundos; o resto é folga para a fila). */
export const VALIDADE_DO_ENDERECO_DA_IMAGEM_MS = 3 * 60 * 60 * 1000;

function assinar(postId: number, indice: number, vence: number): string {
  return createHmac("sha256", config.auth.secret).update(`imagem-publicar:${postId}:${indice}:${vence}`).digest("base64url");
}

export function criarCodigoDaImagem(postId: number, indice: number, agora: Date = new Date()): string {
  const vence = agora.getTime() + VALIDADE_DO_ENDERECO_DA_IMAGEM_MS;
  return `${postId}.${indice}.${vence}.${assinar(postId, indice, vence)}`;
}

export function enderecoPublicoDaImagem(postId: number, indice: number, agora: Date = new Date()): string {
  return `${config.appUrl.replace(/\/$/, "")}/api/publicar-arquivo/imagem/${criarCodigoDaImagem(postId, indice, agora)}/${nomeDaImagem(indice)}`;
}

/** Confere o código (assinatura e prazo) e devolve o post e a imagem a que ele dá acesso; `null` se não vale. */
export function lerCodigoDaImagem(codigo: string, agora: Date = new Date()): { postId: number; indice: number } | null {
  const partes = codigo.split(".");
  if (partes.length !== 4) return null;
  const [idBruto, indiceBruto, venceBruto, assinatura] = partes;
  if (!/^\d{1,9}$/.test(idBruto) || !/^\d{1,2}$/.test(indiceBruto) || !/^\d{10,16}$/.test(venceBruto)) return null;
  const postId = Number(idBruto);
  const indice = Number(indiceBruto);
  const vence = Number(venceBruto);
  const esperada = Buffer.from(assinar(postId, indice, vence));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
  if (vence <= agora.getTime()) return null;
  return { postId, indice };
}
