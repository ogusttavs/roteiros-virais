/**
 * Job `publicar-instagram` (E56 PR 1): por evento, nunca por horário. `receberVideo` (`servicos/publicar-instagram.ts`) manda `{ publicacaoId }` quando o vídeo termina de subir para a Meta; aqui a
 * Meta é perguntada se o vídeo já está pronto e, estando, ele é publicado e o link vai para o roteiro. Se ainda não está, o job agenda a próxima pergunta (a Meta pede no máximo uma por minuto,
 * por até cinco minutos). Não depende da pessoa estar com a tela aberta. O portão por assinatura não entra aqui: é a conclusão de um pedido que a pessoa fez com a assinatura em dia.
 */
import { rodarConferenciaDaPublicacao } from "@/servicos/publicar-instagram";

export type PayloadPublicarInstagram = { publicacaoId: number };

export async function rodarPublicarInstagram(publicacaoId: number): Promise<Record<string, unknown>> {
  if (!Number.isInteger(publicacaoId) || publicacaoId <= 0) throw new Error("uso: npm run job -- publicar-instagram <publicacaoId>");
  return rodarConferenciaDaPublicacao(publicacaoId);
}
