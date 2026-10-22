import Link from "next/link";
import { redirect } from "next/navigation";

import { sessaoDoPainel } from "@/lib/ver-como";
import { assinaturaPrincipal, assinaturaVale, assinaturasDaMarca } from "@/servicos/assinatura";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { textosAssinatura } from "@/textos/assinatura";

import { BotoesDaAssinatura } from "./BotoesDaAssinatura";

/**
 * E22 PR 1: `/assinar`, onde cai a marca sem assinatura e sem cortesia quando o portao esta ligado. **Provisorio**: so o que e preciso para o servidor ser provado ponta a
 * ponta (o plano em uma linha e o botao); a tela de verdade, com o desenho do plano, e o PR 2. Fora do grupo `(completo)` de proposito: o portao redireciona para ca, e o
 * layout dele nao pode barrar a propria tela de pagar.
 */
export default async function Assinar() {
  const sessao = await sessaoDoPainel();
  if (!sessao) redirect("/entrar");
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) redirect("/comecar");

  const lista = await assinaturasDaMarca(cliente.id);
  const principal = assinaturaPrincipal(lista);
  const vale = principal ? assinaturaVale(principal) : false;

  return (
    <main>
      <h1>{textosAssinatura.titulo}</h1>
      <p>{textosAssinatura.linhaDoPlano}</p>
      {vale ? <p>{textosAssinatura.jaAssinada}</p> : null}
      {cliente.cortesia ? <p>{textosAssinatura.cortesia}</p> : null}
      {sessao.verComo ? null : <BotoesDaAssinatura podeAssinar={!vale} jaTemAssinatura={lista.length > 0} />}
      {vale || cliente.cortesia ? <Link href="/hoje">{textosAssinatura.voltarParaHoje}</Link> : null}
    </main>
  );
}
