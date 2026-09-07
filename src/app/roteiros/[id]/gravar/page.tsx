import { redirect } from "next/navigation";

import { sessaoAtual } from "@/lib/sessao";
import { clienteDoUsuario } from "@/servicos/clientes";
import { corpoDoRoteiro, roteiroPorId } from "@/servicos/roteiro";
import { textosRoteiro } from "@/textos/roteiro";

import { GravacaoTela } from "./GravacaoTela";

type Props = { params: Promise<{ id: string }> };

function splitParagrafos(texto: string): string[] {
  return texto
    .split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean);
}

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

  const corpo = corpoDoRoteiro(roteiro);

  return (
    <GravacaoTela
      roteiroId={roteiro.id}
      titulo={corpo.titulo}
      blocos={[
        { rotulo: textosRoteiro.blocos.abertura, paragrafos: [corpo.gancho] },
        { rotulo: textosRoteiro.blocos.meio, paragrafos: splitParagrafos(corpo.corpo) },
        { rotulo: textosRoteiro.blocos.fechamento, paragrafos: splitParagrafos(corpo.fechamento) },
        { rotulo: textosRoteiro.blocos.chamada, paragrafos: [corpo.chamadaFinal] },
      ]}
    />
  );
}
