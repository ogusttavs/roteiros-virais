/**
 * E28: o que o produto guarda de um comentário do YouTube. A API devolve, junto do texto, o nome, a foto e o endereço de quem
 * escreveu e o id do canal dele; o objeto sai montado campo a campo (nunca espalhando o da API), só com o texto limpo, as curtidas e
 * a data. Para o mesmo texto repetido pela mesma pessoa (o spam de colar a mesma frase) contar uma vez só, o normalizador usa o id
 * do canal de quem escreveu **só na memória, nesta função**: ele nem é devolvido, e por isso nunca chega ao banco.
 */
import { limparComentario } from "@/lib/comentarios";

export type ComentarioNormalizado = {
  /** O id do comentário na plataforma, só para não gravar duas vezes. Não é o id de quem escreveu. */
  idExterno: string;
  texto: string;
  curtidas: number;
  publicadoEm: Date | null;
};

type ThreadCrua = {
  id?: string;
  snippet?: {
    topLevelComment?: {
      id?: string;
      snippet?: {
        textDisplay?: string;
        textOriginal?: string;
        likeCount?: number;
        publishedAt?: string;
        authorChannelId?: { value?: string };
      };
    };
  };
};

export function normalizarComentariosYoutube(resposta: { items?: unknown[] }, maximo = 100): ComentarioNormalizado[] {
  const vistos = new Set<string>();
  const saida: ComentarioNormalizado[] = [];

  for (const bruto of resposta.items ?? []) {
    const thread = (bruto ?? {}) as ThreadCrua;
    const topo = thread.snippet?.topLevelComment;
    const conteudo = topo?.snippet;
    const idExterno = topo?.id ?? thread.id;
    if (!idExterno || !conteudo) continue;

    const texto = limparComentario(conteudo.textOriginal ?? conteudo.textDisplay);
    if (!texto) continue;

    // Quem escreveu, só para tirar a cópia repetida da mesma pessoa; sem autor, a chave é só o texto (repetido por desconhecidos conta uma vez).
    const autor = conteudo.authorChannelId?.value ?? "";
    const chave = `${autor}|${texto.toLowerCase()}`;
    if (vistos.has(chave) || vistos.has(idExterno)) continue;
    vistos.add(chave);
    vistos.add(idExterno);

    const quando = conteudo.publishedAt ? new Date(conteudo.publishedAt) : null;
    saida.push({
      idExterno,
      texto,
      curtidas: Number.isFinite(conteudo.likeCount) ? Math.max(0, Math.trunc(conteudo.likeCount as number)) : 0,
      publicadoEm: quando && !Number.isNaN(quando.getTime()) ? quando : null,
    });
    if (saida.length >= maximo) break;
  }
  return saida;
}
