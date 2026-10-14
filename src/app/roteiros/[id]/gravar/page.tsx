import { redirect } from "next/navigation";

import { FaixaDoModo } from "@/app/(painel)/_casca/FaixaVerComo";
import { temCapitulos } from "@/lib/marcas-de-fala";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario, marcasDoUsuario } from "@/servicos/clientes";
import { falaDoRoteiro } from "@/servicos/marcar-fala";
import { blocosParaLeitura, corpoDoRoteiro, roteiroPorId } from "@/servicos/roteiro";

import { GravacaoLongaTela } from "./GravacaoLongaTela";
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

  const sessao = await sessaoDoPainel();
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

  // E52 (PR 5, passo 26): o roteiro do vídeo longo tem o modo gravação por capítulo; o curto e o Story seguem o de sempre.
  if (roteiro.duracaoDoVideo === "longo" && temCapitulos(corpo)) {
    return (
      <>
        <FaixaDoModo verComo={sessao.verComo} pessoa={sessao.user.name} conta={cliente.nome} />
        <GravacaoLongaTela
          roteiroId={roteiro.id}
          titulo={corpo.titulo}
          capitulos={corpo.capitulos ?? []}
          gancho={corpo.gancho}
          chamadaFinal={corpo.chamadaFinal}
          jaGravado={roteiro.gravadoEm !== null}
          nomeMarca={marcas.length > 1 ? cliente.nome : undefined}
          fala={falaDoRoteiro(roteiro, sessao.verComo != null)}
          marcaId={cliente.id}
        />
      </>
    );
  }

  return (
    <>
      <FaixaDoModo verComo={sessao.verComo} pessoa={sessao.user.name} conta={cliente.nome} />
      <GravacaoTela
        roteiroId={roteiro.id}
        titulo={corpo.titulo}
        jaGravado={roteiro.gravadoEm !== null}
        blocos={blocosParaLeitura(roteiro)}
        nomeMarca={marcas.length > 1 ? cliente.nome : undefined}
        fala={falaDoRoteiro(roteiro, sessao.verComo != null)}
        marcaId={cliente.id}
      />
    </>
  );
}
