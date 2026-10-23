"use server";

import { ehFicha } from "@/config/fichas";
import { formatoPorChave } from "@/config/formatos";
import type { EstiloRoteiro, Objetivo } from "@/db/schema";
import { sugerirEstiloPelaEvidencia } from "@/ia/enums";
import { ErroIA } from "@/ia/erro";
import { chaveDeVozValida } from "@/lib/chave-da-voz";
import { fraseDoErroDaIAParaASessao } from "@/lib/erro-ia-da-sessao";
import { formatarVideo, legendaSemHashtags } from "@/lib/formatar-video-referencia";
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
import { apagarRascunhoSeForDoTexto } from "@/servicos/temas";
import { gerarVersoes } from "@/servicos/versoes";
import { textosRoteiro } from "@/textos/roteiro";
import type { VideoFormatado } from "@/ui/componentes/ReferenciaCartao";

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
): Promise<ResultadoAcao<{ grupo: string }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  await exigirAssinaturaValida();
  const cliente = await clienteDaSessaoAtual();
  // Um id que veio e não vale não vira "sem pesquisa" em silêncio: a pessoa pediu a pesquisa, e o roteiro sairia sem ela.
  const pesquisaValida = pesquisaId === undefined || pesquisaId === null ? undefined : idDoBancoOuNulo(pesquisaId);
  if (pesquisaValida === null) return { ok: false, erro: textosRoteiro.pesquisa.naoEncontrada };
  try {
    // O que chega do navegador é texto livre: a origem é reconstruída campo a campo (nunca espalhada, `validarOrigemDaTelaDoObjetivo`: "momento" é da folha "Gravar agora", que confere
    // a marca citada) e o objetivo é um dos três.
    const origemValida = validarOrigemDaTelaDoObjetivo(origem);
    const { grupo } = await gerarVersoes(cliente.id, {
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
    });
    // O roteiro saiu deste assunto seu: o rascunho do Tema livre (texto e nota) some, e a próxima visita começa em branco (pedido do Gustavo em 23/10/2026; antes ficava o texto).
    if (origemValida.origem === "livre") {
      const sessao = await sessaoDoPainel();
      if (sessao) await apagarRascunhoSeForDoTexto(sessao.user.id, cliente.id, origemValida.textoTema).catch(() => undefined);
    }
    return { ok: true, dado: { grupo } };
  } catch (falha) {
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
