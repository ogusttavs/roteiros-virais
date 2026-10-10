import { redirect } from "next/navigation";

import { fichaPadraoDoObjetivo, fichaRecomendadaParaTema, type Ficha } from "@/config/fichas";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import type { OrigemRoteiro } from "@/servicos/roteiro";
import { temasParaCliente } from "@/servicos/temas";
import { assuntoEmAltaDaLista } from "@/servicos/tendencias";

import { ObjetivoTela } from "./ObjetivoTela";

type Props = { searchParams: Promise<{ tema?: string; livre?: string; data?: string; noticiaId?: string; alta?: string; momento?: string }> };

/**
 * `/criar/objetivo` (etapa 11, decisão 6 do `PROXIMO.md`; E39a: migrado de `/hoje/objetivo`, a
 * oficina de criação, nunca mais a agenda). Resolve o tema escolhido (`?tema=<índice>`, vindo de
 * `/criar/temas`) ou proposto (`?livre=<texto>`, vindo de `/criar/tema-livre`), e o objetivo
 * recomendado hoje, antes de entregar para a tela de cliente escolher o objetivo e escrever o
 * roteiro.
 */
export default async function Objetivo({ searchParams }: Props) {
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }

  const { tema, livre, data, noticiaId, alta, momento } = await searchParams;
  const resultado = await temasParaCliente(cliente);
  const objetivoRecomendado = resultado.status === "ok" ? resultado.objetivoRecomendado : null;
  // E49 PR 1: com tema do dia, a ficha recomendada vem do `puxaPara` e do texto dele; sem tema (tema livre), vem da linha editorial ("pelo que você tem postado").
  let fichaRecomendada: Ficha | null = objetivoRecomendado ? fichaPadraoDoObjetivo(objetivoRecomendado) : null;
  let recomendadaPor: "tema" | "historico" = "historico";
  // Decisão pendente 5, revisão do Fable no PR #90: veio de "Criar roteiro" num dia vazio.
  const dataInicial = data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : undefined;
  // E43: "Criar vídeo com esta notícia" carrega o id até aqui; `gerarRoteiro` confere de novo contra o setor do cliente.
  const noticiaIdNumero = Number(noticiaId);
  const noticiaIdValida = noticiaId && Number.isInteger(noticiaIdNumero) ? noticiaIdNumero : undefined;

  let origem: OrigemRoteiro;
  let temaEscolhidoTexto: string;
  // E55 PR 2b: o assunto em alta (o tema do momento, ou o que a pessoa trouxe preso ao Tema livre) é para hoje: a pergunta "Para quando é?" some e o roteiro vai para hoje.
  let paraHoje = false;
  let assuntoEmAlta: string | undefined;

  if (livre) {
    origem = { origem: "livre", textoTema: livre };
    temaEscolhidoTexto = livre;
    // A chave só vale se o assunto ainda está na lista de agora; fora dela, é um tema livre comum (o servidor confere de novo).
    if (alta && (await assuntoEmAltaDaLista(alta).catch(() => null))) {
      paraHoje = true;
      assuntoEmAlta = alta;
    }
  } else {
    // E55 PR 2b: vindo de um cartão "Em alta hoje", o tema é o do assunto (`?momento=<chave>`): se o assunto saiu da lista, a pessoa volta ao Criar em vez de cair em outro tema na mesma posição.
    const indice = momento && resultado.status === "ok" ? resultado.temas.findIndex((t) => t.doMomento?.chave === momento) : Number(tema);
    const temaDoDia = resultado.status === "ok" ? resultado.temas[indice] : undefined;
    if (!temaDoDia) {
      redirect("/criar");
    }
    origem = momento ? { origem: "sugerido", temaIndice: indice, temaChave: momento } : { origem: "sugerido", temaIndice: indice };
    temaEscolhidoTexto = temaDoDia.titulo;
    fichaRecomendada = fichaRecomendadaParaTema(temaDoDia);
    recomendadaPor = "tema";
    paraHoje = temaDoDia.doMomento !== undefined;
  }

  return (
    <ObjetivoTela
      origem={origem}
      temaEscolhidoTexto={temaEscolhidoTexto}
      fichaRecomendada={fichaRecomendada}
      recomendadaPor={recomendadaPor}
      tipo={cliente.tipo}
      quemGravaPadrao={cliente.quemGrava}
      dataInicial={dataInicial}
      noticiaId={noticiaIdValida}
      paraHoje={paraHoje}
      assuntoEmAlta={assuntoEmAlta}
    />
  );
}
