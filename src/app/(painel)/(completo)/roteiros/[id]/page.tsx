import { notFound, redirect } from "next/navigation";

import { idDaRotaOuNulo } from "@/lib/id-rota";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario, marcasDoUsuario } from "@/servicos/clientes";
import { videoPorId } from "@/servicos/pesquisa";
import { blocosParaLeitura, corpoDoRoteiro, roteiroPorId, versoesDoRoteiro } from "@/servicos/roteiro";

import { RoteiroTela } from "./RoteiroTela";

type Props = { params: Promise<{ id: string }> };

/** `/roteiros/[id]` (etapa 11, brief-frontend.md 6.5; `RoteiroTela.dc.html`). */
export default async function Roteiro({ params }: Props) {
  const { id } = await params;
  const roteiroId = idDaRotaOuNulo(id);

  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const [cliente, marcas] = await Promise.all([clienteAtivoDoUsuario(sessao.user.id), marcasDoUsuario(sessao.user.id)]);
  if (!cliente) {
    redirect("/entrar");
  }

  if (roteiroId === null) {
    notFound();
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
      blocos={blocosParaLeitura(roteiro)}
      video={video}
      versoes={versoes}
      marcaAtiva={cliente}
      marcas={marcas}
      nomePessoa={sessao.user.name}
    />
  );
}
