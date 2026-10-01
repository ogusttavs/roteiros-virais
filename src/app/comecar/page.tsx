import { redirect } from "next/navigation";

import { TrocaMarcaProvider } from "@/app/(painel)/_casca/TrocaMarcaContext";
import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { blocoInicial, garantirBriefing } from "@/servicos/briefing";
import {
  clienteAtivoDoUsuario,
  clienteTemOndeEscolhido,
  dadosOndeIniciais,
  listarNichosAtivos,
  marcasDoUsuario,
} from "@/servicos/clientes";
import { ConexaoDaTela } from "@/ui/ConexaoDaTela";

import { ComecarWizard } from "./ComecarWizard";

export default async function Comecar() {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }

  /**
   * Uma consulta so: `briefing` ja carrega `completo`, sem precisar de uma
   * segunda ida ao banco so para conferir isso antes (achado no code review
   * desta rodada). `marcas` (V12b, item 0): quem tem mais de uma marca troca
   * daqui tambem, sem ficar presa no briefing incompleto de uma so.
   */
  const [briefing, nichos, marcas] = await Promise.all([
    garantirBriefing(cliente.id),
    listarNichosAtivos(),
    marcasDoUsuario(sessao.user.id),
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
          nichos={nichos}
          dadosFixosCompletos={dadosFixosCompletos}
          dadosFixosIniciais={{
            nome: cliente.nome,
            ...dadosOndeIniciais(cliente),
            site: cliente.site,
            nichoId: cliente.nichoId,
            ramoOutro: cliente.ramoOutro,
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
        />
      </TrocaMarcaProvider>
    </ConexaoDaTela>
  );
}
