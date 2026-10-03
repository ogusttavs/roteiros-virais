/**
 * Por que um perfil analisado (E38) não tem leitura, e qual frase a tela diz (acabamento a do PR 2:
 * antes, todo perfil sem leitura mostrava "Não achamos este perfil na rede. Confira se o @ está
 * certo.", que só é verdade quando o @ está errado; o TikTok desligado e a conta pessoal não são @
 * errado). Pura e sem servidor, para o cartão (que roda no cliente) e os testes usarem.
 *
 * Linha gravada antes da coluna `motivo` (migração 0053) tem `motivo` nulo: deriva na leitura em vez
 * de um UPDATE em produção (a regra 14 só deixa `ADD COLUMN` e `CREATE TABLE` subirem sem pedir).
 */
import type { MotivoPerfilNaoLido, Plataforma } from "@/db/schema";

export type EstadoDoPerfilAnalisado =
  | { tipo: "leitura" }
  | { tipo: "lendo" }
  | { tipo: "sem_leitura"; motivo: MotivoPerfilNaoLido };

/**
 * O que o PR 1 gravava em `erro` (em produção desde 02/10), antes de existir `motivo`: cada frase velha
 * ainda vale como motivo, para a tela não voltar a dizer "confira o @" de uma conta que existe.
 */
const MOTIVO_DAS_FRASES_ANTIGAS: Record<string, MotivoPerfilNaoLido> = {
  "TikTok fora do ar por enquanto (Apify suspenso).": "tiktok_desligado",
  "o canal nao tem video publicado.": "sem_videos",
  "perfil pessoal ou com restricao de idade.": "conta_restrita",
  "perfil nao encontrado na rede.": "nao_encontrado",
};

export function estadoDoPerfilAnalisado(perfil: {
  leitura: string | null;
  existeNaRede: boolean;
  motivo: MotivoPerfilNaoLido | null;
  rede: Plataforma;
  /** A frase que o PR 1 gravava; só se olha quando `motivo` é nulo (linha de antes da migração 0053). */
  erro?: string | null;
}): EstadoDoPerfilAnalisado {
  if (perfil.leitura) return { tipo: "leitura" };
  if (perfil.existeNaRede) return { tipo: "lendo" };
  const motivoAntigo = perfil.erro ? MOTIVO_DAS_FRASES_ANTIGAS[perfil.erro] : undefined;
  return {
    tipo: "sem_leitura",
    motivo: perfil.motivo ?? motivoAntigo ?? (perfil.rede === "tiktok" ? "tiktok_desligado" : "nao_encontrado"),
  };
}
