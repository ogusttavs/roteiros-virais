import { notFound, redirect } from "next/navigation";

import { idDaRotaOuNulo } from "@/lib/id-rota";
import { enderecoParaMudarOPedido } from "@/lib/pesquisa-na-hora-rotas";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { pesquisaParaATela, registrarVistaDoFim } from "@/servicos/pesquisa-na-hora";

import { PesquisaTela } from "./PesquisaTela";

type Props = { params: Promise<{ id: string }> };

/**
 * `/criar/pesquisa/[id]` (E54, parte 3; design v2, passo 22, `Pesquisa.dc.html`): a espera da pesquisa, o que ela achou com o trecho e a fonte, a premissa que não bate, a pergunta de
 * posição, o "não achamos" e o erro. É a pesquisa DESTA marca (a de outra nunca abre: `notFound`). Quem deixou "Voltar depois" volta aqui pelo aviso do Criar, em qualquer aparelho.
 */
export default async function Pesquisa({ params }: Props) {
  const { id } = await params;
  const pesquisaId = idDaRotaOuNulo(id);

  const sessao = await sessaoDoPainel();
  if (!sessao) {
    redirect("/entrar");
  }
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }
  if (pesquisaId === null) {
    notFound();
  }

  const pesquisa = await pesquisaParaATela(cliente.id, pesquisaId);
  if (!pesquisa) {
    notFound();
  }

  // A pessoa abriu a pesquisa que terminou sem dado ou em erro: o Criar deixa de lembrar dela.
  if (pesquisa.status === "sem_achados" || pesquisa.status === "erro") await registrarVistaDoFim(cliente.id, pesquisa.id);

  return <PesquisaTela inicial={pesquisa} voltarPara={enderecoParaMudarOPedido(pesquisa.destino)} marcaAtivaId={cliente.id} />;
}
