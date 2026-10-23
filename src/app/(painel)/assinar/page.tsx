import Link from "next/link";
import { redirect } from "next/navigation";

import { destinoSemMarca } from "@/lib/destino-sem-marca";
import { sessaoDoPainel } from "@/lib/ver-como";
import { assinaturaPrincipal, assinaturaVale, assinaturasDaMarca } from "@/servicos/assinatura";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { textosAssinatura } from "@/textos/assinatura";

import { BotoesDaAssinatura } from "./BotoesDaAssinatura";
import { ConfirmandoPagamento } from "./ConfirmandoPagamento";

/**
 * E22 PR 1: `/assinar`, onde cai a marca sem assinatura e sem cortesia quando o portao esta ligado. **Provisorio**: so o que e preciso para o servidor ser provado ponta a
 * ponta (o plano em uma linha e o botao); a tela de verdade, com o desenho do plano, e o PR 2. Fora do grupo `(completo)` de proposito: o portao redireciona para ca, e o
 * layout dele nao pode barrar a propria tela de pagar.
 */
export default async function Assinar({ searchParams }: { searchParams: Promise<{ assinou?: string }> }) {
  const { assinou } = await searchParams;
  const sessao = await sessaoDoPainel();
  if (!sessao) redirect("/entrar");
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) redirect(destinoSemMarca(sessao.user.role));

  const lista = await assinaturasDaMarca(cliente.id);
  const principal = assinaturaPrincipal(lista);
  const vale = principal ? assinaturaVale(principal) : false;
  // Voltou do pagamento (o Checkout leva para `/assinar?assinou=1`): se o aviso do Stripe ja chegou, segue para o Hoje; se nao, espera sem mostrar o botao de assinar de novo.
  if (assinou === "1" && vale) redirect("/hoje?assinou=1");
  const confirmando = assinou === "1" && !vale && !cliente.cortesia;

  return (
    <main>
      <h1>{textosAssinatura.titulo}</h1>
      <p>{textosAssinatura.linhaDoPlano}</p>
      {confirmando ? <ConfirmandoPagamento /> : null}
      {vale ? <p>{textosAssinatura.jaAssinada}</p> : null}
      {cliente.cortesia ? <p>{textosAssinatura.cortesia}</p> : null}
      {sessao.verComo ? null : <BotoesDaAssinatura podeAssinar={!vale && !confirmando} jaTemAssinatura={lista.length > 0} />}
      {vale || cliente.cortesia ? <Link href="/hoje">{textosAssinatura.voltarParaHoje}</Link> : null}
    </main>
  );
}
