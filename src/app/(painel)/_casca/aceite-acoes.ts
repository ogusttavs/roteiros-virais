"use server";

import { exigirForaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { aceitarTermos, ErroAcessoNegado } from "@/servicos/clientes";

/**
 * Aceite dos termos no primeiro acesso (etapa 12, decisão 7 do
 * `PROXIMO.md`; V3, item 7: é da pessoa, não da marca). O usuário sempre
 * vem da sessão, nunca de um parâmetro (isolamento no nível de rota, mesmo
 * padrão de `conta/acoes.ts`).
 */
export async function aceitarTermosAction(): Promise<void> {
  await exigirForaDoVerComo();
  const sessao = await sessaoDoPainel();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  await aceitarTermos(sessao.user.id);
}
