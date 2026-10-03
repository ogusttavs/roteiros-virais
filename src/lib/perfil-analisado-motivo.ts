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

export function estadoDoPerfilAnalisado(perfil: {
  leitura: string | null;
  existeNaRede: boolean;
  motivo: MotivoPerfilNaoLido | null;
  rede: Plataforma;
}): EstadoDoPerfilAnalisado {
  if (perfil.leitura) return { tipo: "leitura" };
  if (perfil.existeNaRede) return { tipo: "lendo" };
  return { tipo: "sem_leitura", motivo: perfil.motivo ?? (perfil.rede === "tiktok" ? "tiktok_desligado" : "nao_encontrado") };
}
