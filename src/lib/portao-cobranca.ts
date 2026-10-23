/**
 * E22 PR 2, item 0a: o portão da cobrança fora do layout. O layout do painel manda a marca sem assinatura para `/assinar`, mas ele só protege a PÁGINA: uma Server Action é um endereço
 * que qualquer pessoa logada pode chamar sem passar pela página, e as rotas `/api` (transcrição, PDF, imagem) também. Quem gasta IA, transcrição ou Chromium em nome de uma marca que
 * deveria estar pagando passa por aqui, com a MESMA regra do layout (`marcaPrecisaAssinar`): cobrança ligada, sem cortesia, sem assinatura que vale.
 *
 * - **Desligado (`COBRANCA_ATIVA` ausente), nada muda:** a primeira linha de cada função sai sem ler sessão, marca nem banco.
 * - O "ver como" nunca é barrado (o admin só lê; as ações que escrevem em nome da pessoa já são recusadas por `exigirForaDoVerComo`).
 * - Server Action: `redirect("/assinar")`, que leva a aba aberta para a tela de assinar em vez de mostrar um erro sem explicação.
 * - Rota `/api`: resposta 402 com uma frase (o cliente da rota decide o que mostrar).
 * - `soDepoisDoBriefing`: o briefing vem ANTES do pagamento (decisão 621: a pessoa vê valor antes de pagar), então as ações do onboarding só são barradas depois que o briefing está
 *   completo, exatamente como o layout faz (o briefing incompleto cai em `/comecar`, que fica fora do portão).
 *
 * `scripts/checar-portao-cobranca.ts` reprova no CI uma Server Action do painel ou uma rota `/api` que não chame uma destas funções (ou não esteja na lista de livres, com o motivo).
 */
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { config } from "@/lib/config";
import { sessaoDoPainel } from "@/lib/ver-como";
import { marcaPrecisaAssinar } from "@/servicos/assinatura";
import { briefingCompleto, clienteAtivoDoUsuario } from "@/servicos/clientes";

export type OpcoesDoPortao = { soDepoisDoBriefing?: boolean };

export const FRASE_ASSINATURA_NECESSARIA = "Para continuar, a conta precisa de uma assinatura ativa.";

/** Esta marca (a da sessão) está barrada pela cobrança agora? `cobrancaAtiva` existe para os testes ligarem a cobrança sem mexer no ambiente. */
export async function marcaBarradaPelaCobranca(opcoes: OpcoesDoPortao = {}, cobrancaAtiva: boolean = config.cobranca.ativa): Promise<boolean> {
  if (!cobrancaAtiva) return false;
  const sessao = await sessaoDoPainel();
  // Sem sessão a ação ou a rota responde sozinha (não entrou). No "ver como" o admin só lê.
  if (!sessao || sessao.verComo) return false;
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) return false;
  if (opcoes.soDepoisDoBriefing && !(await briefingCompleto(cliente.id))) return false;
  return marcaPrecisaAssinar(cliente, new Date(), cobrancaAtiva);
}

/** Para Server Actions: se a marca precisa assinar, leva a pessoa para `/assinar` (o redirecionamento interrompe a ação). Chamar antes de qualquer gasto. */
export async function exigirAssinaturaValida(opcoes: OpcoesDoPortao = {}): Promise<void> {
  if (await marcaBarradaPelaCobranca(opcoes)) redirect("/assinar");
}

/** Para rotas `/api`: a resposta 402 quando a marca precisa assinar, ou `null` para seguir. */
export async function recusaDaCobranca(opcoes: OpcoesDoPortao = {}): Promise<NextResponse | null> {
  if (!(await marcaBarradaPelaCobranca(opcoes))) return null;
  return NextResponse.json({ erro: FRASE_ASSINATURA_NECESSARIA }, { status: 402, headers: { "Cache-Control": "private, no-store" } });
}
