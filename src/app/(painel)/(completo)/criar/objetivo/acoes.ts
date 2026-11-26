"use server";

import { ehFicha } from "@/config/fichas";
import { formatoPorChave } from "@/config/formatos";
import type { EstiloRoteiro, Objetivo } from "@/db/schema";
import { sugerirEstiloPelaEvidencia } from "@/ia/enums";
import { ErroIA } from "@/ia/erro";
import { chaveDeVozValida } from "@/lib/chave-da-voz";
import { fraseDoErroDaIAParaASessao } from "@/lib/erro-ia-da-sessao";
import { formatarVideo, legendaSemHashtags } from "@/lib/formatar-video-referencia";
import { idDePedidoOuNulo, novoIdDePedido } from "@/lib/id-do-pedido";
import { idDoBancoOuNulo } from "@/lib/id-rota";
import { exigirAssinaturaValida } from "@/lib/portao-cobranca";
import { type ResultadoAcao } from "@/lib/resultado-acao";
import { recusaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { clienteDaSessaoAtual } from "@/servicos/clientes";
import { filtroDeFormatosDaMarca } from "@/servicos/formatos";
import { evidenciaParaRoteiro, exemplosPorFicha, setoresComPiso } from "@/servicos/pesquisa";
import { ramosAlternativosDaMarca } from "@/servicos/ramos-da-conta";
import {
  ErroRoteiro,
  validarData,
  validarEstilo,
  validarFormato,
  validarMomentoDoDia,
  validarObjetivo,
  validarOrigemDaTelaDoObjetivo,
  validarQuemAparece,
  type OrigemRoteiro,
} from "@/servicos/roteiro";
import { criarPedido, ErroPedido, falharPedido, pedidoDaMarca } from "@/servicos/pedidos";
import { apagarRascunhoSeForDoTexto } from "@/servicos/temas";
import { conferirFolgaDoDia, gerarVersoes, VERSOES_POR_GERACAO } from "@/servicos/versoes";
import { textosPedidos } from "@/textos/pedidos";
import { textosRoteiro } from "@/textos/roteiro";
import type { VideoFormatado } from "@/ui/componentes/ReferenciaCartao";

/** O que a escrita das versões devolve (E74 PR 2a). */
export type ResultadoDasVersoes =
  | { grupo: string }
  /** O mesmo pedido já está sendo escrito (a resposta da primeira vez se perdeu): a tela segue o pedido por este id. */
  | { pedidoId: string; escrevendo: true }
  /** Outro roteiro desta marca está sendo escrito agora: nada foi escrito nem gasto. */
  | { jaEmAndamento: string; frase: string };

/** O que o pedido guarda: o que é preciso para refazer igual, sem nada que não seja desta marca. */
function parametrosDoPedido(params: Parameters<typeof gerarVersoes>[1]): Record<string, unknown> {
  return JSON.parse(JSON.stringify(params)) as Record<string, unknown>;
}

function tituloDoPedido(origem: OrigemRoteiro): string {
  if (origem.origem === "livre") return origem.textoTema;
  if (origem.origem === "sugerido") return origem.temaTitulo ?? textosPedidos.temaDoDia;
  return textosPedidos.temaDoDia;
}

/** A resposta para o mesmo id mandado de novo: o grupo, se já ficou pronto; a frase, se falhou; senão, "continua sendo escrito". Nunca escreve de novo. */
function respostaDoRepetido(pedido: { id: string; estado: string; resultadoTipo: string | null; resultadoId: string | null; motivo: string | null }): ResultadoAcao<ResultadoDasVersoes> {
  if (pedido.estado === "pronto" && pedido.resultadoTipo === "versoes" && pedido.resultadoId) return { ok: true, dado: { grupo: pedido.resultadoId } };
  if (pedido.estado === "falhou") return { ok: false, erro: pedido.motivo || textosPedidos.falhou.roteiro };
  return { ok: true, dado: { pedidoId: pedido.id, escrevendo: true } };
}

/**
 * `/hoje/objetivo` (etapa 11; V9c, item 1: `formato` do controle segmentado; M4, item 2: `estilo`,
 * o segundo controle; E26 4b: escreve as três versões, não um roteiro, e devolve o grupo para a
 * tela de comparar). O cliente sempre vem da sessão. `formato`, `estilo` e `quemAparece` chegam
 * como texto livre do navegador (V9d, item 2): `validarFormato`/`validarEstilo`/`validarQuemAparece`
 * conferem contra a lista antes de chegar ao banco.
 *
 * R1, item 0c: `ErroIA.mensagemCliente` e `ErroRoteiro.message` vêm como resultado, não lançados
 * (Next.js troca a mensagem de uma exceção por um texto genérico em produção); erro de outra
 * natureza (rede, bug) continua subindo, para a tela de espera cair no caminho de sempre.
 *
 * E74 PR 2a: a escrita nasce como um pedido (`pedidos_de_geracao`) com o id que o navegador gerou (`pedidoId`), ANTES de gastar qualquer coisa. O mesmo id de novo devolve o pedido que já
 * existe sem escrever outra vez (a tela que perdeu a resposta pergunta por ele); outro pedido de roteiro andando na marca devolve `jaEmAndamento` com o id dele, sem gastar nada. A falha marca o
 * pedido como falho, e ele deixa de contar no limite (R-o). Sem `pedidoId` (quem chama por dentro, os testes), o servidor gera um: todo roteiro desta tela passa pela mesma trava.
 */
export async function gerarVersoesAction(
  origem: OrigemRoteiro,
  objetivo: Objetivo,
  formato?: string,
  estilo?: string,
  /** E40, item 2: "o que este vídeo precisa comunicar?", campo opcional e curto. */
  objetivoDoVideo?: string,
  /** V12c, item 3, a E37b: troca só deste vídeo; sem valor, usa o quemGrava do cliente. */
  quemAparece?: string,
  /** E39a: "para quando é?", ISO; sem valor, hoje. */
  data?: string,
  /** E39a: "em que momento do dia?", só quando o formato é Story. */
  momentoDoDia?: string,
  /** E43: presente quando o tema veio de "Criar vídeo com esta notícia" (Tema livre, `?noticiaId=`). */
  noticiaId?: number,
  /** E49 PR 1: a ficha do "O que você quer que esse vídeo faça?" (só Reels); valor que não é uma das cinco vale como ausente. */
  ficha?: string,
  /** E55 PR 2b: a chave do assunto em alta trazido para o ramo (Tema livre `?alta=`); o servidor confere que ele ainda está na lista de agora. */
  assuntoEmAlta?: string,
  /** E53 (parte 3): o id da notícia de um assunto da marca (Tema livre `?noticiaAssuntoId=`); `gerarRoteiro` confere que é desta marca. */
  noticiaAssuntoId?: number,
  /** E28 (parte 3): a chave da pergunta do público (Tema livre `?pergunta=`); só 12 caracteres hexadecimais valem, e `gerarRoteiro` a acha de novo nas vozes do setor da marca. */
  perguntaChave?: string,
  /** E54 (parte 2): o id da pesquisa na hora que a pessoa aprovou para este vídeo; só um id de linha vale (um valor que não vale é erro explícito, não "sem pesquisa"), e `gerarVersoes` confere que é desta marca e que está pronta. */
  pesquisaId?: number,
  /** E74 PR 2a: o id do pedido que o navegador gerou ao tocar em "Escrever"; o mesmo id nunca escreve duas vezes. */
  pedidoId?: string,
  /** E74 PR 2a: o pedido que falhou e que "Tentar de novo" refaz (só fica registrado se for desta marca). */
  refeitoDe?: string,
): Promise<ResultadoAcao<ResultadoDasVersoes>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  // Um valor que não é id vale como "sem id" (o servidor gera um); o pedido que já existe não conta contra o próprio teto quando é mandado de novo.
  const idDoPedido = idDePedidoOuNulo(pedidoId);
  await exigirAssinaturaValida({ gasto: "roteiro", pedidoId: idDoPedido ?? undefined });
  const cliente = await clienteDaSessaoAtual();
  // Um id que veio e não vale não vira "sem pesquisa" em silêncio: a pessoa pediu a pesquisa, e o roteiro sairia sem ela.
  const pesquisaValida = pesquisaId === undefined || pesquisaId === null ? undefined : idDoBancoOuNulo(pesquisaId);
  if (pesquisaValida === null) return { ok: false, erro: textosRoteiro.pesquisa.naoEncontrada };
  try {
    // O que chega do navegador é texto livre: a origem é reconstruída campo a campo (nunca espalhada, `validarOrigemDaTelaDoObjetivo`: "momento" é da folha "Gravar agora", que confere
    // a marca citada) e o objetivo é um dos três.
    const origemValida = validarOrigemDaTelaDoObjetivo(origem);
    const params = {
      ...origemValida,
      objetivo: validarObjetivo(objetivo),
      ficha: ehFicha(ficha) ? ficha : undefined,
      formato: validarFormato(formato),
      estilo: validarEstilo(estilo),
      objetivoDoVideo: objetivoDoVideo?.trim() || undefined,
      quemAparece: validarQuemAparece(quemAparece),
      data: validarData(data),
      momentoDoDia: validarMomentoDoDia(momentoDoDia),
      noticiaId,
      assuntoEmAlta: origemValida.origem === "livre" ? assuntoEmAlta : undefined,
      noticiaAssuntoId: origemValida.origem === "livre" ? noticiaAssuntoId : undefined,
      perguntaChave: origemValida.origem === "livre" ? chaveDeVozValida(perguntaChave) : undefined,
      pesquisaId: pesquisaValida,
    };
    const sessaoDoPedido = await sessaoDoPainel();
    const { pedido, novo } = await criarPedido({
      id: idDoPedido ?? novoIdDePedido(),
      clienteId: cliente.id,
      tipo: "roteiro",
      titulo: tituloDoPedido(origemValida),
      parametros: parametrosDoPedido(params),
      criadoPor: sessaoDoPedido?.user.id ?? null,
      refeitoDe: refeitoDe && (await pedidoDaMarca(cliente.id, refeitoDe)) ? refeitoDe : null,
      // A folga do dia é conferida antes de o pedido existir; depois, ela é dele.
      conferirFolga: () => conferirFolgaDoDia(cliente.id, VERSOES_POR_GERACAO),
    });
    if (!novo) return respostaDoRepetido(pedido);

    let grupo: string;
    try {
      ({ grupo } = await gerarVersoes(cliente.id, params, VERSOES_POR_GERACAO, { pedidoId: pedido.id }));
    } catch (falha) {
      // A falha devolve a folga (o pedido deixa de contar) e fica com a frase que a tela mostraria; o erro segue para o tratamento de sempre, abaixo.
      const motivo = falha instanceof ErroIA ? await fraseDoErroDaIAParaASessao(falha) : falha instanceof ErroRoteiro ? falha.message : null;
      await falharPedido(pedido.id, { tipo: "roteiro", codigo: falha instanceof Error ? falha.name : "erro", motivo });
      throw falha;
    }
    // O roteiro saiu deste assunto seu: o rascunho do Tema livre (texto e nota) some, e a próxima visita começa em branco (pedido do Gustavo em 23/10/2026; antes ficava o texto).
    if (origemValida.origem === "livre") {
      const sessao = await sessaoDoPainel();
      if (sessao) await apagarRascunhoSeForDoTexto(sessao.user.id, cliente.id, origemValida.textoTema).catch(() => undefined);
    }
    return { ok: true, dado: { grupo } };
  } catch (falha) {
    if (falha instanceof ErroPedido) {
      if (falha.codigo === "ja-em-andamento" && falha.emAndamentoId) return { ok: true, dado: { jaEmAndamento: falha.emAndamentoId, frase: falha.message } };
      return { ok: false, erro: falha.message };
    }
    if (falha instanceof ErroIA) return { ok: false, erro: await fraseDoErroDaIAParaASessao(falha) };
    if (falha instanceof ErroRoteiro) return { ok: false, erro: falha.message };
    throw falha;
  }
}

/**
 * M4, item 2: a sugestão de estilo pela evidência do tema (mais da metade sem fala sugere sem
 * fala; empate ou sem evidência vale falado). Chamada quando a tela de objetivo monta, para o
 * controle já vir marcado; a pessoa troca se quiser.
 */
export async function sugerirEstiloAction(tema: string): Promise<EstiloRoteiro> {
  const cliente = await clienteDaSessaoAtual();
  if (!cliente.nichoId) return "falado";
  const alternativos = (await ramosAlternativosDaMarca(cliente.id)).map((a) => a.nichoId);
  const evidencias = await evidenciaParaRoteiro(cliente.nichoId, tema, undefined, alternativos, await filtroDeFormatosDaMarca(cliente.id));
  return sugerirEstiloPelaEvidencia(evidencias);
}

/**
 * Um exemplo de "Exemplos que fazem isso" no Criar (E49 PR 2; hotfix de 22/10/2026: agora com o vídeo). `video` é o mesmo `VideoFormatado` do cartão e da folha de detalhes de Referências (a
 * capa, a conta, a data, os números e a leitura), com o título já sem as hashtags; `url` abre a prévia na própria tela. Tudo vem da MESMA consulta que já trazia os exemplos.
 */
export type ExemploDaFicha = { id: number; url: string; tipo: string | null; video: VideoFormatado };

/**
 * "Exemplos que fazem isso" (E49 PR 2): até três vídeos dos ramos da conta que a extração leu como feitos para a ficha escolhida, pelo filtro de tipo ligado da marca e o corte
 * duro de recorte e notícia. A ficha chega como texto livre do navegador (`ehFicha` confere); sem ficha válida, ramo ou vídeo, a lista vem vazia (o estado "ainda não temos exemplos").
 */
export async function exemplosDaFichaAction(ficha: string): Promise<ExemploDaFicha[]> {
  if (!ehFicha(ficha)) return [];
  const cliente = await clienteDaSessaoAtual();
  if (!cliente.nichoId) return [];
  const alternativosDaMarca = await ramosAlternativosDaMarca(cliente.id);
  const alternativos = alternativosDaMarca.map((a) => a.nichoId);
  const nomesDosAlternativos = new Map(alternativosDaMarca.map((a) => [a.nichoId, a.nome] as const));
  const setores = await setoresComPiso([cliente.nichoId, ...alternativos]);
  const lista = await exemplosPorFicha(cliente.nichoId, ficha, { setores, formatosDaMarca: await filtroDeFormatosDaMarca(cliente.id) });
  return lista.map((v) => {
    const video = formatarVideo(v, nomesDosAlternativos);
    return {
      id: v.id,
      url: v.url,
      tipo: formatoPorChave(v.formatoCatalogo)?.nome ?? null,
      // O título do vídeo é a legenda do post; aqui sem as hashtags (se sobrar nada, o assunto que a extração leu).
      video: { ...video, titulo: legendaSemHashtags(v.titulo, v.assunto) || null },
    };
  });
}
