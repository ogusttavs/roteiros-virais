import { redirect } from "next/navigation";

import { sessaoAtual } from "@/lib/sessao";
import { clienteDoUsuario } from "@/servicos/clientes";
import { videoPorId } from "@/servicos/pesquisa";
import { corpoDoRoteiro, roteiroPorId, versoesDoRoteiro } from "@/servicos/roteiro";

import { RoteiroTela } from "./RoteiroTela";

type Props = { params: Promise<{ id: string }> };

/** `/roteiros/[id]` (etapa 11, brief-frontend.md 6.5; `RoteiroTela.dc.html`). */
export default async function Roteiro({ params }: Props) {
  const { id } = await params;
  const roteiroId = Number(id);

  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteDoUsuario(sessao.user.id);
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

  const [video, versoes] = await Promise.all([
    roteiro.referenciaVideoId ? videoPorId(roteiro.referenciaVideoId) : Promise.resolve(null),
    versoesDoRoteiro(roteiroId),
  ]);

  return (
    <RoteiroTela
      roteiro={roteiro}
      corpo={corpoDoRoteiro(roteiro)}
      video={video}
      versoes={versoes}
    />
  );
}
