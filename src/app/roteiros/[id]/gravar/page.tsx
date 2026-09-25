import { redirect } from "next/navigation";

import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario, marcasDoUsuario } from "@/servicos/clientes";
import { blocosParaLeitura, corpoDoRoteiro, roteiroPorId } from "@/servicos/roteiro";

import { GravacaoTela } from "./GravacaoTela";

type Props = { params: Promise<{ id: string }> };

/**
 * `/roteiros/[id]/gravar`: fora de `(painel)/`, de propósito, sem sidebar
 * nem barra de abas (design v2, `entrega/telas/Gravacao.dc.html`, "sem
 * navegação, uma saída"; `PROXIMO.md`, D2 parte 1, item 7). Mesmas guardas
 * de `/roteiros/[id]`.
 */
export default async function Gravar({ params }: Props) {
  const { id } = await params;
  const roteiroId = Number(id);

  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const [cliente, marcas] = await Promise.all([clienteAtivoDoUsuario(sessao.user.id), marcasDoUsuario(sessao.user.id)]);
  if (!cliente) {
    redirect("/entrar");
  }

  if (!Number.isFinite(roteiroId)) {
    redirect("/hoje");
  }

  const roteiro = await roteiroPorId(roteiroId, cliente.id);
  if (!roteiro) {
    redirect("/hoje");
  }

  const corpo = corpoDoRoteiro(roteiro);

  return (
    <GravacaoTela
      roteiroId={roteiro.id}
      titulo={corpo.titulo}
      jaGravado={roteiro.gravadoEm !== null}
      blocos={blocosParaLeitura(roteiro)}
      nomeMarca={marcas.length > 1 ? cliente.nome : undefined}
    />
  );
}
