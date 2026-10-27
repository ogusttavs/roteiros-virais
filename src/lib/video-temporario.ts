/**
 * E19b: o vídeo de uma publicação pela via do Instagram fica guardado por pouco tempo, só para a Meta baixar. Pela via do Facebook o vídeo passava do navegador direto para a Meta (envio
 * retomável); pela via do Instagram esse envio não existe ("Apenas para apps que implementaram o Login do Facebook para Empresas", `pesquisa/plataformas/docs/meta/publicacao-de-conteudo.md`,
 * "Pontos de extremidade"), e a Meta só aceita o vídeo por um endereço público que ELA baixa ("Mídia em servidor público": `publicacao-de-conteudo.md`; `video_url` em
 * `publicacao-ig-user-media.md`: "Criaremos um cURL para o vídeo a partir do URL fornecido, que deve estar em um servidor público").
 *
 * Regras daqui:
 *  - O arquivo vive em disco (nunca inteiro na memória), com o nome da publicação, e é apagado quando a publicação termina, falha ou é cancelada. Quem ficar para trás (processo que caiu) é varrido
 *    pela idade (`IDADE_MAXIMA_MS`).
 *  - O endereço público leva um código assinado (HMAC com o segredo da sessão) com a publicação e o prazo: não dá para adivinhar o endereço de outra publicação, e ele vale algumas horas.
 *    A rota que serve o arquivo (`app/api/publicar-arquivo`) confere o código, o prazo e se a publicação ainda está viva no banco.
 *  - Nada aqui vai para log além do número da publicação.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { config } from "@/lib/config";

/** O endereço público vale por 3 horas (o contêiner da Meta expira em 24, mas o preparo leva minutos: `PREPARO_DA_META_PRAZO_MS`). */
export const VALIDADE_DO_ENDERECO_MS = 3 * 60 * 60 * 1000;
/** Arquivo mais velho que isso é lixo de uma publicação que ninguém concluiu. */
export const IDADE_MAXIMA_MS = 6 * 60 * 60 * 1000;

export function pastaDosVideos(): string {
  return process.env.PUBLICAR_PASTA_TEMP || join(tmpdir(), "roteiros-publicar");
}

export function caminhoDoVideo(publicacaoId: number): string {
  return join(pastaDosVideos(), `pub-${publicacaoId}.video`);
}

/** Falha ao guardar o vídeo (corpo ausente, maior ou menor que o declarado, disco). A mensagem é técnica e não leva nada da pessoa. */
export class ErroDoVideoTemporario extends Error {}

/**
 * Grava o corpo do pedido em disco, em fluxo. O tamanho tem de bater EXATAMENTE com o declarado ao começar a publicação (o mesmo número que a tela e o limite do Instagram conferiram).
 * Em qualquer falha o arquivo parcial é apagado.
 */
export async function guardarVideo(publicacaoId: number, corpo: ReadableStream<Uint8Array>, tamanho: number): Promise<void> {
  await mkdir(pastaDosVideos(), { recursive: true });
  const caminho = caminhoDoVideo(publicacaoId);
  const saida = createWriteStream(caminho);
  const falhouAoEscrever = new Promise<never>((_, rejeitar) => saida.once("error", (erro) => rejeitar(erro)));
  falhouAoEscrever.catch(() => undefined);
  const leitor = corpo.getReader();
  let contados = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([leitor.read(), falhouAoEscrever]);
      if (done) break;
      contados += value.byteLength;
      if (contados > tamanho) throw new ErroDoVideoTemporario("o video e maior do que o declarado");
      if (!saida.write(value)) await Promise.race([once(saida, "drain"), falhouAoEscrever]);
    }
    if (contados !== tamanho) throw new ErroDoVideoTemporario("o video e menor do que o declarado");
    await new Promise<void>((resolver, rejeitar) => {
      saida.once("error", rejeitar);
      saida.end(() => resolver());
    });
  } catch (erro) {
    // Fecha o arquivo ANTES de apagar: apagar com ele ainda abrindo deixa o arquivo (no Windows nem apaga).
    if (!saida.closed) {
      await new Promise<void>((resolver) => {
        saida.once("close", () => resolver());
        saida.destroy();
      });
    }
    await descartarVideo(publicacaoId);
    throw erro instanceof ErroDoVideoTemporario ? erro : new ErroDoVideoTemporario("nao foi possivel guardar o video");
  } finally {
    leitor.releaseLock?.();
  }
}

/** Apaga o arquivo da publicação. Não existir não é erro (o worker e a tela chamam sem saber de onde veio o arquivo). */
export async function descartarVideo(publicacaoId: number): Promise<void> {
  try {
    await rm(caminhoDoVideo(publicacaoId), { force: true });
  } catch {
    // Disco ou permissão: a varredura por idade cuida do resto.
  }
}

/** Apaga o que ficou para trás. Devolve quantos arquivos saíram. */
export async function varrerVideosVelhos(agora: Date = new Date()): Promise<number> {
  let apagados = 0;
  try {
    for (const nome of await readdir(pastaDosVideos())) {
      if (!/^pub-\d+\.video$/.test(nome)) continue;
      const caminho = join(pastaDosVideos(), nome);
      try {
        const info = await stat(caminho);
        if (agora.getTime() - info.mtimeMs > IDADE_MAXIMA_MS) {
          await rm(caminho, { force: true });
          apagados += 1;
        }
      } catch {
        // Sumiu no meio do caminho: já está resolvido.
      }
    }
  } catch {
    // A pasta ainda não existe: nada a varrer.
  }
  return apagados;
}

export async function tamanhoDoVideoGuardado(publicacaoId: number): Promise<number | null> {
  try {
    const info = await stat(caminhoDoVideo(publicacaoId));
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// O endereço público
// ---------------------------------------------------------------------------

function assinar(publicacaoId: number, vence: number): string {
  return createHmac("sha256", config.auth.secret).update(`video-publicar:${publicacaoId}:${vence}`).digest("base64url");
}

/** O código que vai no endereço: `<publicação>.<vencimento>.<assinatura>`. */
export function criarCodigoDoVideo(publicacaoId: number, agora: Date = new Date()): string {
  const vence = agora.getTime() + VALIDADE_DO_ENDERECO_MS;
  return `${publicacaoId}.${vence}.${assinar(publicacaoId, vence)}`;
}

/** O endereço que a Meta baixa. O nome do arquivo no fim só ajuda quem baixa a reconhecer o tipo; o que vale é o código. */
export function enderecoPublicoDoVideo(publicacaoId: number, agora: Date = new Date()): string {
  return `${config.appUrl.replace(/\/$/, "")}/api/publicar-arquivo/${criarCodigoDoVideo(publicacaoId, agora)}/video.mp4`;
}

/** Confere o código (assinatura e prazo) e devolve a publicação a que ele dá acesso; `null` se não vale. */
export function lerCodigoDoVideo(codigo: string, agora: Date = new Date()): { publicacaoId: number } | null {
  const partes = codigo.split(".");
  if (partes.length !== 3) return null;
  const [idBruto, venceBruto, assinatura] = partes;
  if (!/^\d{1,9}$/.test(idBruto) || !/^\d{10,16}$/.test(venceBruto)) return null;
  const publicacaoId = Number(idBruto);
  const vence = Number(venceBruto);
  const esperada = Buffer.from(assinar(publicacaoId, vence));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
  if (vence <= agora.getTime()) return null;
  return { publicacaoId };
}
