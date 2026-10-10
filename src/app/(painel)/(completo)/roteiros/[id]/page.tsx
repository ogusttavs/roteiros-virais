import { notFound, redirect } from "next/navigation";

import { hojeISO } from "@/lib/config";
import { conviteDeInstalarPodeAparecer } from "@/lib/convite-instalar";
import { idDaRotaOuNulo } from "@/lib/id-rota";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario, marcasDoUsuario, preferenciasDoUsuario } from "@/servicos/clientes";
import { momentoDoRoteiro } from "@/servicos/em-alta";
import { videoPorId } from "@/servicos/pesquisa";
import { blocosParaLeitura, corpoDoRoteiro, roteiroPorId, versoesDoRoteiro } from "@/servicos/roteiro";

import { RoteiroTela } from "./RoteiroTela";

type Props = { params: Promise<{ id: string }> };

/** `/roteiros/[id]` (etapa 11, brief-frontend.md 6.5; `RoteiroTela.dc.html`). */
export default async function Roteiro({ params }: Props) {
  const { id } = await params;
  const roteiroId = idDaRotaOuNulo(id);

  const sessao = await sessaoDoPainel();
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

  const preferencias = await preferenciasDoUsuario(sessao.user.id);
  const [video, versoes, momento] = await Promise.all([
    roteiro.referenciaVideoId ? videoPorId(roteiro.referenciaVideoId) : Promise.resolve(null),
    versoesDoRoteiro(roteiroId),
    // E55 PR 2b: o roteiro que nasceu de um assunto em alta diz se o assunto ainda está em alta (selo e linha de prazo) ou já passou (selo neutro e aviso). Uma falha aqui só tira o selo.
    roteiro.temaDoMomento
      ? momentoDoRoteiro({ data: roteiro.data, temaDoMomento: roteiro.temaDoMomento }, hojeISO()).catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <RoteiroTela
      roteiro={roteiro}
      corpo={corpoDoRoteiro(roteiro)}
      blocos={blocosParaLeitura(roteiro)}
      video={video}
      versoes={versoes}
      momento={momento}
      marcaAtiva={cliente}
      marcas={marcas}
      nomePessoa={sessao.user.name}
      conviteInstalarPodeAparecer={conviteDeInstalarPodeAparecer(preferencias, new Date())}
    />
  );
}
