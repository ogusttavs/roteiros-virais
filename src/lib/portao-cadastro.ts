/**
 * E63 PR 1: a parte do portão (`portao-cobranca.ts`) que cuida da marca de cadastro próprio: e-mail confirmado e teto do teste. Vale com a cobrança ligada ou desligada, e só para
 * a marca que tem linha em `cadastros_proprios` (as que o admin criou passam sem mudança). O "ver como" nunca é barrado (o admin só lê).
 */
import { sessaoDoPainel } from "@/lib/ver-como";
import { barreiraDoCadastro, type Barreira, type GastoQueConta } from "@/servicos/cadastro-travas";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { textosCadastro } from "@/textos/cadastro";

export type { Barreira, GastoQueConta };

/** A barreira da marca da sessão, ou `null` para seguir. */
export async function barreiraDoCadastroNaSessao(opcoes: { gasto?: GastoQueConta } = {}): Promise<Barreira | null> {
  const sessao = await sessaoDoPainel();
  if (!sessao || sessao.verComo) return null;
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) return null;
  return barreiraDoCadastro({ clienteId: cliente.id, cortesia: cliente.cortesia, gasto: opcoes.gasto });
}

/** Para onde a Server Action leva a pessoa. */
export function destinoDaBarreira(barreira: Barreira): string {
  return barreira.tipo === "email" ? "/confirmar-email" : `/limite-do-teste?o=${barreira.qual}`;
}

/** A frase curta que a rota `/api` devolve. */
export function fraseDaBarreira(barreira: Barreira): string {
  return barreira.tipo === "email" ? textosCadastro.confirmeSeuEmailCurto : textosCadastro.limiteDoTesteCurto;
}
