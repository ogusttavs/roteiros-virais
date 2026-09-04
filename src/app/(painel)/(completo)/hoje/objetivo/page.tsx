import { redirect } from "next/navigation";

import { sessaoAtual } from "@/lib/sessao";
import { clienteDoUsuario } from "@/servicos/clientes";
import type { OrigemRoteiro } from "@/servicos/roteiro";
import { temasParaCliente } from "@/servicos/temas";

import { ObjetivoTela } from "./ObjetivoTela";

type Props = { searchParams: Promise<{ tema?: string; livre?: string }> };

/**
 * `/hoje/objetivo` (etapa 11, decisão 6 do `PROXIMO.md`): resolve o tema
 * escolhido (`?tema=<índice>`, vindo de `/hoje`) ou proposto (`?livre=<texto>`,
 * vindo de `/hoje/tema-livre`), e o objetivo recomendado hoje, antes de
 * entregar para a tela de cliente escolher o objetivo e escrever o roteiro.
 */
export default async function Objetivo({ searchParams }: Props) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }

  const { tema, livre } = await searchParams;
  const resultado = await temasParaCliente(cliente);
  const objetivoRecomendado = resultado.status === "ok" ? resultado.objetivoRecomendado : null;

  let origem: OrigemRoteiro;
  let temaEscolhidoTexto: string;

  if (livre) {
    origem = { origem: "livre", textoTema: livre };
    temaEscolhidoTexto = livre;
  } else {
    const indice = Number(tema);
    const temaDoDia = resultado.status === "ok" ? resultado.temas[indice] : undefined;
    if (!temaDoDia) {
      redirect("/hoje");
    }
    origem = { origem: "sugerido", temaIndice: indice };
    temaEscolhidoTexto = temaDoDia.titulo;
  }

  return (
    <ObjetivoTela origem={origem} temaEscolhidoTexto={temaEscolhidoTexto} objetivoRecomendado={objetivoRecomendado} />
  );
}
