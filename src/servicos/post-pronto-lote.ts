/**
 * E56 PR 2, envio em lote para a fila (só do admin, por `scripts/enviar-posts-prontos.ts`): lê uma pasta com subpastas `NN-nome/` de imagens (PNG ou JPG) e um `legendas.md`, e põe cada subpasta na fila
 * da marca indicada, na ordem do número. Não passa pela sessão: quem roda é o admin no servidor, e a marca vem do argumento. As imagens e a legenda passam pelas MESMAS conferências do envio
 * pela tela (`montarPost`).
 *
 * O `legendas.md`: um bloco por post, que começa numa linha `## <nome da subpasta>` (ou só o número, `## 01`) e vai até o próximo `## `. O texto do bloco, sem as linhas em branco do começo e do
 * fim, é a legenda (hashtags e quebras de linha incluídas). Linha com um `#` só (hashtag) não abre bloco.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { montarPost, type DepsDoPost } from "@/servicos/post-pronto";

/** O mapa nome da subpasta (ou número) para a legenda. */
export function lerLegendas(markdown: string): Map<string, string> {
  const mapa = new Map<string, string>();
  let chave: string | null = null;
  let linhas: string[] = [];
  const fechar = () => {
    if (chave !== null) mapa.set(chave, linhas.join("\n").trim());
  };
  for (const linha of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const titulo = /^##\s+(.+?)\s*$/.exec(linha);
    if (titulo) {
      fechar();
      chave = titulo[1];
      linhas = [];
    } else if (chave !== null) {
      linhas.push(linha);
    }
  }
  fechar();
  return mapa;
}

const EXTENSOES = /\.(png|jpe?g)$/i;
const porNome = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true });

export type PostDaPasta = { pasta: string; imagens: string[]; legenda: string | null };

/** O que há na pasta, na ordem de saída (pelo número do começo do nome), sem criar nada. */
export async function lerPastaDePosts(pasta: string): Promise<PostDaPasta[]> {
  const entradas = await readdir(pasta, { withFileTypes: true });
  let legendas = new Map<string, string>();
  try {
    legendas = lerLegendas(await readFile(join(pasta, "legendas.md"), "utf-8"));
  } catch {
    // Sem `legendas.md`: cada post sai com o aviso de legenda ausente.
  }
  const subpastas = entradas.filter((e) => e.isDirectory() && /^\d+/.test(e.name)).map((e) => e.name);
  subpastas.sort((a, b) => Number(/^\d+/.exec(a)![0]) - Number(/^\d+/.exec(b)![0]) || porNome(a, b));
  const posts: PostDaPasta[] = [];
  for (const nome of subpastas) {
    const arquivos = (await readdir(join(pasta, nome))).filter((f) => EXTENSOES.test(f)).sort(porNome);
    const numero = /^\d+/.exec(nome)![0];
    const legenda = legendas.get(nome) ?? legendas.get(numero) ?? legendas.get(String(Number(numero))) ?? null;
    posts.push({ pasta: nome, imagens: arquivos.map((f) => join(pasta, nome, f)), legenda });
  }
  return posts;
}

export type ResultadoDoLote = { criados: { pasta: string; postId: number }[]; problemas: { pasta: string; frase: string }[] };

/** Cria os posts da pasta na fila da marca, na ordem. Um post com problema (sem legenda, imagem recusada) não impede os outros: volta em `problemas`. */
export async function importarPostsDaPasta(entrada: { clienteId: number; pasta: string; usuarioId?: string | null }, deps: DepsDoPost = {}): Promise<ResultadoDoLote> {
  const resultado: ResultadoDoLote = { criados: [], problemas: [] };
  for (const post of await lerPastaDePosts(entrada.pasta)) {
    if (post.legenda === null) {
      resultado.problemas.push({ pasta: post.pasta, frase: "Sem legenda no legendas.md." });
      continue;
    }
    const arquivos = await Promise.all(post.imagens.map(async (c) => new Uint8Array(await readFile(c))));
    const criado = await montarPost({ clienteId: entrada.clienteId, usuarioId: entrada.usuarioId ?? null, legenda: post.legenda, arquivos, modo: "fila" }, deps);
    if (criado.ok) resultado.criados.push({ pasta: post.pasta, postId: criado.postId });
    else resultado.problemas.push({ pasta: post.pasta, frase: criado.frase });
  }
  return resultado;
}
