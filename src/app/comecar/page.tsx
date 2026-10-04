import { redirect } from "next/navigation";

import { FaixaDoModo } from "@/app/(painel)/_casca/FaixaVerComo";
import { TrocaMarcaProvider } from "@/app/(painel)/_casca/TrocaMarcaContext";
import { config } from "@/lib/config";
import { sessaoDoPainel } from "@/lib/ver-como";
import { blocoInicial, garantirBriefing, lerBriefing } from "@/servicos/briefing";
import {
  clienteAtivoDoUsuario,
  clienteTemOndeEscolhido,
  dadosOndeIniciais,
  marcasDoUsuario,
} from "@/servicos/clientes";
import { formatosDaMarcaComEstado } from "@/servicos/formatos";
import { pedidoAbertoDaMarca } from "@/servicos/pedidos-de-ramo";
import { ramoAtualDoCliente } from "@/servicos/ramos";
import { textosVerComo } from "@/textos/ver-como";
import { ConexaoDaTela } from "@/ui/ConexaoDaTela";

import { ComecarWizard } from "./ComecarWizard";

export default async function Comecar() {
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }

  // E46 PR 2: no "ver como" esta tela nunca é o assistente (ele grava em nome da pessoa) nem um erro: briefing completo vai ao Hoje, e o resto mostra o aviso com a saída do modo.
  if (sessao.verComo) {
    const existente = await lerBriefing(cliente.id);
    if (existente?.completo) redirect("/hoje");
    return (
      <>
        <FaixaDoModo verComo={sessao.verComo} pessoa={sessao.user.name} conta={cliente.nome} />
        <main style={{ padding: "calc(var(--area-topo) + 2rem) var(--margem-celular) 2rem", maxWidth: "36rem", margin: "0 auto" }} data-ver-como-sem-briefing="">
          <h1>{textosVerComo.semBriefingTitulo(sessao.user.name)}</h1>
          <p>{textosVerComo.semBriefingTexto}</p>
        </main>
      </>
    );
  }

  /**
   * Uma consulta so: `briefing` ja carrega `completo`, sem precisar de uma
   * segunda ida ao banco so para conferir isso antes (achado no code review
   * desta rodada). `marcas` (V12b, item 0): quem tem mais de uma marca troca
   * daqui tambem, sem ficar presa no briefing incompleto de uma so.
   */
  const [briefing, ramoAtual, marcas, pedidoAberto] = await Promise.all([
    garantirBriefing(cliente.id),
    ramoAtualDoCliente(cliente.nichoId),
    marcasDoUsuario(sessao.user.id),
    pedidoAbertoDaMarca(cliente.id),
  ]);

  if (briefing.completo) {
    redirect("/hoje");
  }

  const dadosFixosCompletos = clienteTemOndeEscolhido(cliente) && Boolean(cliente.nichoId || cliente.ramoOutro);

  return (
    <ConexaoDaTela>
      <TrocaMarcaProvider>
        <ComecarWizard
          marcaAtiva={{ id: cliente.id, nome: cliente.nome }}
          marcas={marcas.map((m) => ({ id: m.id, nome: m.nome }))}
          nomePessoa={sessao.user.name}
          dadosFixosCompletos={dadosFixosCompletos}
          dadosFixosIniciais={{
            nome: cliente.nome,
            ...dadosOndeIniciais(cliente),
            site: cliente.site,
            nichoId: cliente.nichoId,
            ramoSlug: ramoAtual?.ramoSlug ?? null,
            ramoNome: ramoAtual?.nome ?? null,
            ramoOutro: cliente.ramoOutro,
            // E45 PR 2: o pedido de ramo aberto (o "Não achei o meu" da marca) e o ramo provisório em que ela espera, se ainda está nele.
            pedidoDeRamo: pedidoAberto
              ? {
                  texto: pedidoAberto.texto,
                  ramoProvisorio:
                    pedidoAberto.setorProvisorioId !== null && pedidoAberto.setorProvisorioId === cliente.nichoId ? (ramoAtual?.nome ?? null) : null,
                }
              : null,
            persona: cliente.persona,
            perfis: cliente.perfis,
            quemGrava: cliente.quemGrava,
          }}
          respostasIniciais={briefing.respostas}
          avaliacoesIniciais={briefing.avaliacoes}
          notaGeralInicial={Number(briefing.notaGeral ?? 0)}
          blocoInicial={blocoInicial(briefing.avaliacoes, cliente.tipo)}
          meta={config.regras.notaMinimaBriefing}
          tipo={cliente.tipo}
          tiposIniciais={(await formatosDaMarcaComEstado(cliente.id)).map((t) => ({ chave: t.chave, ligada: t.ligada }))}
        />
      </TrocaMarcaProvider>
    </ConexaoDaTela>
  );
}
