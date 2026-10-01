import { redirect } from "next/navigation";

import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import type { OrigemRoteiro } from "@/servicos/roteiro";
import { temasParaCliente } from "@/servicos/temas";

import { ObjetivoTela } from "./ObjetivoTela";

type Props = { searchParams: Promise<{ tema?: string; livre?: string; data?: string }> };

/**
 * `/criar/objetivo` (etapa 11, decisão 6 do `PROXIMO.md`; E39a: migrado de `/hoje/objetivo`, a
 * oficina de criação, nunca mais a agenda). Resolve o tema escolhido (`?tema=<índice>`, vindo de
 * `/criar/temas`) ou proposto (`?livre=<texto>`, vindo de `/criar/tema-livre`), e o objetivo
 * recomendado hoje, antes de entregar para a tela de cliente escolher o objetivo e escrever o
 * roteiro.
 */
export default async function Objetivo({ searchParams }: Props) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }

  const { tema, livre, data } = await searchParams;
  const resultado = await temasParaCliente(cliente);
  const objetivoRecomendado = resultado.status === "ok" ? resultado.objetivoRecomendado : null;
  // Decisão pendente 5, revisão do Fable no PR #90: veio de "Criar roteiro" num dia vazio.
  const dataInicial = data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : undefined;

  let origem: OrigemRoteiro;
  let temaEscolhidoTexto: string;

  if (livre) {
    origem = { origem: "livre", textoTema: livre };
    temaEscolhidoTexto = livre;
  } else {
    const indice = Number(tema);
    const temaDoDia = resultado.status === "ok" ? resultado.temas[indice] : undefined;
    if (!temaDoDia) {
      redirect("/criar");
    }
    origem = { origem: "sugerido", temaIndice: indice };
    temaEscolhidoTexto = temaDoDia.titulo;
  }

  return (
    <ObjetivoTela
      origem={origem}
      temaEscolhidoTexto={temaEscolhidoTexto}
      objetivoRecomendado={objetivoRecomendado}
      tipo={cliente.tipo}
      quemGravaPadrao={cliente.quemGrava}
      dataInicial={dataInicial}
    />
  );
}
