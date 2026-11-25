/**
 * Jobs do E56 PR 2 (post pronto de imagem ou carrossel). `publicar-post-pronto` é por evento, `{ postId }`: a pessoa tocou em "Publicar agora" e o worker publica aquele post. `fila-de-posts` roda de
 * minuto em minuto (só com `PUBLICAR_IMAGENS_ATIVO`) e publica o próximo de cada marca, um por vez, com o intervalo `PUBLICAR_INTERVALO_MIN`, parando quando o limite das 24 horas da Meta acaba. O resumo vai
 * para `execucoes_job`: só números e o resultado, nunca nome de conta nem acesso. O portão por assinatura não entra aqui: é a conclusão de um pedido que a pessoa fez com a assinatura em dia.
 */
import { publicarPost, rodarFilaDePosts as rodarFila } from "@/servicos/post-pronto";

export type PayloadPublicarPostPronto = { postId: number };

export async function rodarPublicarPostPronto(postId: number): Promise<Record<string, unknown>> {
  if (!Number.isInteger(postId) || postId <= 0) throw new Error("uso: npm run job -- publicar-post-pronto <postId>");
  const resultado = await publicarPost(postId);
  return { postId, resultado };
}

export async function rodarFilaDePosts(): Promise<Record<string, unknown>> {
  return { ...(await rodarFila()) };
}
