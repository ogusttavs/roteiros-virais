import { notFound, redirect, RedirectType } from "next/navigation";

import { destinoSemMarca } from "@/lib/destino-sem-marca";
import { idDaRotaOuNulo } from "@/lib/id-rota";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario, marcaDoRoteiroDoUsuario } from "@/servicos/clientes";
import { roteiroPorId } from "@/servicos/roteiro";

import { RoteiroDeOutraMarca } from "../RoteiroDeOutraMarca";

type Props = { params: Promise<{ id: string }> };

/**
 * `/roteiros/[id]/de-outra-marca`: o roteiro é de outra marca da pessoa, e esta marca está ativa. Fica num caminho à parte (e não na própria `/roteiros/[id]`) porque o aparelho guarda
 * `/roteiros/<id>` para ler sem rede, e esta tela nunca pode entrar nesse guardado (`public/sw.js` e `src/lib/offline.ts` não casam com este caminho). Refaz a conferência: a troca de marca
 * (o botão desta tela ou o seletor do painel) termina num redirect do servidor para o roteiro, que agora é da marca ativa; se alguém chegar aqui já com a marca certa, esta página leva ao roteiro. No "ver como" (a troca é recusada) e sem acesso à marca do roteiro, leva ao Hoje, sem nome algum.
 */
export default async function RoteiroDeOutraMarcaPagina({ params }: Props) {
  const { id } = await params;
  const roteiroId = idDaRotaOuNulo(id);

  const sessao = await sessaoDoPainel();
  if (!sessao) redirect("/entrar");

  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) redirect(destinoSemMarca(sessao.user.role));
  if (roteiroId === null) notFound();

  if (await roteiroPorId(roteiroId, cliente.id)) redirect(`/roteiros/${roteiroId}`, RedirectType.replace);
  const daOutra = sessao.verComo != null ? null : await marcaDoRoteiroDoUsuario(sessao.user.id, roteiroId);
  if (!daOutra) redirect("/hoje", RedirectType.replace);

  return <RoteiroDeOutraMarca marca={daOutra} roteiroId={roteiroId} />;
}
