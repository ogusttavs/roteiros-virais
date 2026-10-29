/**
 * E47 PR 2: os arquivos da edição no volume próprio (`EDICAO_PASTA`, volume `roteiros_edicao` em produção, montado no app e no worker no mesmo caminho). Dois subdiretórios: `bruto/`
 * (o vídeo que a pessoa mandou, `ed-<id>.video`) e `editado/` (o vídeo pronto, `ed-<id>.mp4`, que os PRs seguintes criam). O banco guarda só o caminho RELATIVO ao volume; aqui está a única
 * função que o transforma em caminho de disco, e ela recusa tudo que não seja o nome que nós mesmos geramos (nada de `..` nem de caminho absoluto).
 *
 * Regras:
 *  - O bruto chega em fluxo, direto para disco (nunca inteiro na memória), num arquivo `.parte` de nome único e só vira `ed-<id>.video` por `rename` quando tem EXATAMENTE o tamanho declarado.
 *  - Nada aqui vai para log além do número da edição.
 *  - A limpeza (`jobs/limpar-edicoes.ts`) apaga pela data de guarda e varre o que não tem dono no banco (processo que caiu no meio, linha apagada).
 */
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function pastaDaEdicao(): string {
  return process.env.EDICAO_PASTA || join(tmpdir(), "roteiros-edicao");
}

export const SUBPASTA_DO_BRUTO = "bruto";
export const SUBPASTA_DO_EDITADO = "editado";

export function nomeRelativoDoBruto(edicaoId: number): string {
  return `${SUBPASTA_DO_BRUTO}/ed-${edicaoId}.video`;
}

export function nomeRelativoDoEditado(edicaoId: number): string {
  return `${SUBPASTA_DO_EDITADO}/ed-${edicaoId}.mp4`;
}

const NOME_VALIDO = /^(bruto\/ed-\d{1,9}\.video|editado\/ed-\d{1,9}\.mp4)$/;

/** O caminho de disco de um nome relativo. Lança se o nome não é um dos que `nomeRelativoDoBruto` e `nomeRelativoDoEditado` geram. */
export function caminhoNoVolume(relativo: string): string {
  if (!NOME_VALIDO.test(relativo)) throw new Error("nome de arquivo de edicao invalido");
  return join(pastaDaEdicao(), ...relativo.split("/"));
}

/** Falha ao guardar o vídeo (corpo ausente, maior ou menor que o declarado, disco). A mensagem é técnica e não leva nada da pessoa. */
export class ErroDoArquivoDeEdicao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDoArquivoDeEdicao";
  }
}

/**
 * Grava o corpo do pedido em disco, em fluxo, como `bruto/ed-<id>.video`. O tamanho tem de bater EXATAMENTE com o declarado ao abrir a edição. Em qualquer falha o arquivo parcial é apagado.
 * Devolve o nome relativo.
 */
export async function guardarBruto(edicaoId: number, corpo: ReadableStream<Uint8Array>, tamanho: number): Promise<string> {
  const relativo = nomeRelativoDoBruto(edicaoId);
  const final = caminhoNoVolume(relativo);
  await mkdir(join(pastaDaEdicao(), SUBPASTA_DO_BRUTO), { recursive: true });
  const parcial = join(pastaDaEdicao(), SUBPASTA_DO_BRUTO, `ed-${edicaoId}.${randomBytes(6).toString("hex")}.parte`);
  const saida = createWriteStream(parcial);
  const falhouAoEscrever = new Promise<never>((_, rejeitar) => saida.once("error", (erro) => rejeitar(erro)));
  falhouAoEscrever.catch(() => undefined);
  const leitor = corpo.getReader();
  let contados = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([leitor.read(), falhouAoEscrever]);
      if (done) break;
      contados += value.byteLength;
      if (contados > tamanho) throw new ErroDoArquivoDeEdicao("o video e maior do que o declarado");
      if (!saida.write(value)) await Promise.race([once(saida, "drain"), falhouAoEscrever]);
    }
    if (contados !== tamanho) throw new ErroDoArquivoDeEdicao("o video e menor do que o declarado");
    await new Promise<void>((resolver, rejeitar) => {
      saida.once("error", rejeitar);
      saida.end(() => resolver());
    });
    await rename(parcial, final);
    return relativo;
  } catch (erro) {
    // Fecha o arquivo ANTES de apagar: apagar com ele ainda aberto deixa o arquivo (no Windows nem apaga).
    if (!saida.closed) {
      await new Promise<void>((resolver) => {
        saida.once("close", () => resolver());
        saida.destroy();
      });
    }
    await rm(parcial, { force: true }).catch(() => undefined);
    throw erro instanceof ErroDoArquivoDeEdicao ? erro : new ErroDoArquivoDeEdicao("nao foi possivel guardar o video");
  } finally {
    leitor.releaseLock?.();
  }
}

/** Apaga um arquivo do volume pelo nome relativo. Não existir não é erro; devolve se algo foi apagado. Falha de disco não lança (a varredura cuida do resto). */
export async function apagarArquivoDaEdicao(relativo: string | null): Promise<boolean> {
  if (!relativo) return false;
  try {
    const caminho = caminhoNoVolume(relativo);
    const existia = await stat(caminho).then(
      () => true,
      () => false,
    );
    await rm(caminho, { force: true });
    return existia;
  } catch {
    return false;
  }
}

export async function arquivoExiste(relativo: string | null): Promise<boolean> {
  if (!relativo) return false;
  try {
    return (await stat(caminhoNoVolume(relativo))).isFile();
  } catch {
    return false;
  }
}

export type SobrasDoVolume = { orfaos: number; partes: number };

/**
 * Varre o volume e apaga o que não tem dono: arquivo `ed-<id>.video` ou `ed-<id>.mp4` cujo nome relativo não está em `nomesComDono` (a linha foi apagada, o arquivo já foi dado como apagado,
 * o worker caiu antes de gravar o caminho) e `.parte` de envio que morreu. Só mexe no que tem mais de `idadeMinimaMs` (um arquivo que acabou de ser renomeado ainda não teve o caminho gravado na linha).
 * Nomes que não são dos que geramos ficam onde estão.
 */
export async function varrerSobrasDoVolume(nomesComDono: ReadonlySet<string>, agora: Date, idadeMinimaMs: number, idadeMinimaDaParteMs: number): Promise<SobrasDoVolume> {
  let orfaos = 0;
  let partes = 0;
  for (const sub of [SUBPASTA_DO_BRUTO, SUBPASTA_DO_EDITADO]) {
    let nomes: string[];
    try {
      nomes = await readdir(join(pastaDaEdicao(), sub));
    } catch {
      continue;
    }
    for (const nome of nomes) {
      const relativo = `${sub}/${nome}`;
      const ehParte = /^ed-\d+\.[0-9a-f]{12}\.parte$/.test(nome);
      if (!ehParte && !NOME_VALIDO.test(relativo)) continue;
      if (!ehParte && nomesComDono.has(relativo)) continue;
      const caminho = join(pastaDaEdicao(), sub, nome);
      try {
        const info = await stat(caminho);
        if (!info.isFile()) continue;
        if (agora.getTime() - info.mtimeMs <= (ehParte ? idadeMinimaDaParteMs : idadeMinimaMs)) continue;
        await rm(caminho, { force: true });
        if (ehParte) partes += 1;
        else orfaos += 1;
      } catch {
        // Sumiu no meio do caminho: já está resolvido.
      }
    }
  }
  return { orfaos, partes };
}
