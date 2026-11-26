"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { dadosFixosDoBriefing } from "@/config/briefing";
import { AJUDA_EM_DA_FICHA, EXEMPLO_DA_FICHA, FICHAS_EM_ORDEM, FRASE_DA_FICHA, NOME_DA_FICHA, objetivoDaFicha, OBJETIVO_DO_SEM_FALA, OBJETIVO_DO_STORY, PARECE_FEITO_PARA } from "@/config/fichas";
import type { EstiloRoteiro, Ficha, FormatoRoteiro, MomentoDoDia, Objetivo, QuemGrava, TipoMarca } from "@/db/schema";
import {
  DESCRICAO_ESTILO_ROTEIRO,
  ESTILOS_ROTEIRO_EM_ORDEM,
  FORMATOS_ROTEIRO_EM_ORDEM,
  ROTULO_ESTILO_ROTEIRO,
  ROTULO_FORMATO_ROTEIRO,
} from "@/ia/enums";
import { hojeISO } from "@/lib/config";
import { novoIdDePedido } from "@/lib/id-do-pedido";
import { ehFalhaDeRede } from "@/lib/offline";
import type { PedidoNaTela } from "@/servicos/pedidos-estado";
import type { OrigemRoteiro } from "@/servicos/roteiro";
import { textosComuns } from "@/textos/comuns";
import { textosObjetivo } from "@/textos/objetivo";
import { textosPedidos } from "@/textos/pedidos";
import { textosPesquisa } from "@/textos/pesquisa";
import { BarraAcao } from "@/ui/componentes/BarraAcao";
import { CampoComFala } from "@/ui/componentes/CampoComFala";
import { CapaImagem } from "@/ui/componentes/CapaImagem";
import { OpcaoObjetivo } from "@/ui/componentes/OpcaoObjetivo";
import { PerguntaMomentoDoDia, PerguntaParaQuando } from "@/ui/componentes/PerguntaAgendamento";
import { TelaEscrevendo } from "@/ui/componentes/TelaEscrevendo";
import { useConexao } from "@/ui/ConexaoContext";
import { useConsultaViva } from "@/ui/useConsultaViva";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import { grupoRecenteDesdeAction } from "../../hoje/acoes";
import { FolhaDetalhesVideo } from "../../referencias/FolhaDetalhesVideo";

import { exemplosDaFichaAction, gerarVersoesAction, sugerirEstiloAction, type ExemploDaFicha } from "./acoes";
import { chaveDaEscolha, gravarEscolha, lerEscolha } from "./escolha-guardada";
import { ESPERA_MAXIMA_MS, guardarDesfecho, guardarEspera, lerEspera, tomarDesfecho } from "./espera-guardada";
import styles from "./ObjetivoTela.module.css";
import { decidirSobreOPedido, type PedidoSeguido } from "./seguir-pedido";

/** A capa do exemplo: a miniatura da plataforma quando existe e carrega; senão o retângulo neutro com o ícone, como no cartão de Referências. */
function CapaDoExemplo({ capaUrl }: { capaUrl: string | null }) {
  const [comErro, setComErro] = useState(false);
  return (
    <span className={styles.exemploCapa} aria-hidden="true" data-capa={capaUrl !== null && !comErro ? "imagem" : "neutra"}>
      {capaUrl !== null && !comErro ? (
        <CapaImagem src={capaUrl} className={styles.exemploCapaImagem} aoFalhar={() => setComErro(true)} />
      ) : (
        <Play size={20} strokeWidth={1.5} aria-hidden="true" />
      )}
    </span>
  );
}

const INTERVALO_DA_CONFERENCIA_MS = 4000;

type Props = {
  origem: OrigemRoteiro;
  temaEscolhidoTexto: string;
  /** E49 PR 1: a ficha que já vem marcada, e de onde veio a recomendação (o tema escolhido, ou o que a pessoa tem postado). */
  fichaRecomendada: Ficha | null;
  recomendadaPor: "tema" | "historico";
  tipo: TipoMarca;
  /** V12c, item 3, a E37b: o `quemGrava` do briefing, para o controle já nascer marcado nele. */
  quemGravaPadrao: QuemGrava | null;
  /** Decisão pendente 5, revisão do Fable no PR #90: veio de "Criar roteiro" num dia vazio que não
   * é hoje; "para quando é" já nasce marcado naquele dia, em vez de hoje. */
  dataInicial?: string;
  /** E43: presente quando o tema veio de "Criar vídeo com esta notícia". */
  noticiaId?: number;
  /** E53 (parte 3): idem, quando a notícia é de um assunto que a marca acompanha. */
  noticiaAssuntoId?: number;
  /** E55 PR 2b: o roteiro é de um assunto em alta, para hoje: a pergunta "Para quando é?" some e a data vai fixa em hoje (o servidor recusa outro dia). */
  paraHoje?: boolean;
  /** E55 PR 2b: a chave do assunto em alta que a pessoa trouxe preso ao Tema livre; vai ao servidor junto, para o roteiro nascer do momento. */
  assuntoEmAlta?: string;
  /** E28 (parte 3): a chave da pergunta do público que a pessoa trouxe presa ao Tema livre; vai ao servidor junto, para o roteiro responder a ela. */
  perguntaChave?: string;
  /** E54 (parte 3): a pesquisa que a pessoa aprovou para este vídeo (`?pesquisa=`), com quantos dados ela marcou; o id vai ao servidor junto, que confere de novo que é desta marca. */
  pesquisa?: { id: number; dados: number };
  /** E74 PR 2a (R-c): o pedido de roteiro deste tema que o servidor ainda escreve (o app reaberto depois de o iPhone fechá-lo), com quanto tempo já passou no relógio do servidor. */
  pedidoDoTema?: { id: string; decorridoMs: number } | null;
};

/** `/criar/objetivo` (etapa 11, brief-frontend.md 6.3; `ObjetivoFluxo.dc.html`). */
export function ObjetivoTela({
  origem,
  temaEscolhidoTexto,
  fichaRecomendada,
  recomendadaPor,
  tipo,
  quemGravaPadrao,
  dataInicial,
  noticiaId,
  noticiaAssuntoId,
  paraHoje = false,
  assuntoEmAlta,
  perguntaChave,
  pesquisa,
  pedidoDoTema = null,
}: Props) {
  // V12c, item 3: pessoa tem "quem aparece" fixo (config/briefing.ts); o controle nem aparece.
  const opcoesQuemAparece = dadosFixosDoBriefing(tipo).quemGrava;
  const router = useRouter();
  // E49 PR 1: a ficha recomendada pelo tema já vem marcada; a pessoa troca. O Story não pergunta.
  const [ficha, setFicha] = useState<Ficha | null>(fichaRecomendada);
  // E49 PR 2: depois de ESCOLHER uma ficha (um toque), ela fica sozinha com "Ver as cinco de novo" e embaixo vêm os exemplos do setor; a recomendada já marcada não fecha a lista.
  const [compacta, setCompacta] = useState(false);
  const [exemplos, setExemplos] = useState<ExemploDaFicha[] | null>(null);
  // Hotfix de 22/10/2026: o toque num exemplo abre a prévia do vídeo NA PRÓPRIA TELA (a mesma folha de Referências), sem sair do passo; o Voltar do aparelho fecha só a folha.
  const [exemploAbertoId, setExemploAbertoId] = useState<number | null>(null);
  const previa = useFolhaNoHistorico(exemploAbertoId !== null, () => setExemploAbertoId(null));
  const exemploAberto = exemplos?.find((e) => e.id === exemploAbertoId) ?? null;
  // O caminho de onde a pessoa está (com os parâmetros de agora): é o que "Ver mais em Referências" leva como `voltar`, para Referências poder trazê-la de volta.
  const caminhoAtual = usePathname();
  const parametrosAtuais = useSearchParams().toString();
  const caminhoParaVoltar = parametrosAtuais ? `${caminhoAtual}?${parametrosAtuais}` : caminhoAtual;
  // Falha de rede não é "sem exemplos": a seção some em silêncio e o roteiro segue.
  const [exemplosFalharam, setExemplosFalharam] = useState(false);
  // O formato vem ANTES da pergunta (passo 18b): Reels é o padrão, e a pessoa escolhe Story se quiser.
  const [formato, setFormato] = useState<FormatoRoteiro>("reels");
  // Os exemplos acompanham a ficha escolhida (só no modo compacto); a resposta de uma escolha anterior que chega tarde não troca a de agora.
  useEffect(() => {
    if (!compacta || !ficha) return;
    let cancelado = false;
    setExemplos(null);
    setExemplosFalharam(false);
    exemplosDaFichaAction(ficha)
      .then((lista) => {
        if (!cancelado) setExemplos(lista);
      })
      .catch(() => {
        if (!cancelado) setExemplosFalharam(true);
      });
    return () => {
      cancelado = true;
    };
  }, [compacta, ficha]);

  /**
   * M4, item 2: o segundo controle segmentado, Falando/Sem fala. Ao contrário do formato (decidido
   * pelo objetivo, por código, sem round-trip), o estilo nasce da evidência do tema, então a
   * sugestão chega por uma Server Action (`sugerirEstiloAction`) assim que a tela monta.
   */
  const [estilo, setEstilo] = useState<EstiloRoteiro>("falado");
  // A pergunta das fichas só existe no Reels falado: o Story não pergunta, e o sem fala segue o roteiro de cenas (a estrutura das fichas pressupõe fala).
  const pergunta = formato === "reels" && estilo === "falado";
  const [estiloTocado, setEstiloTocado] = useState(false);
  /** E40, item 2: "o que este vídeo precisa comunicar?", opcional, até 200 caracteres. */
  const [objetivoDoVideo, setObjetivoDoVideo] = useState("");
  /** V12c, item 3: nasce no padrão do cliente; a pessoa troca só para este vídeo. */
  const [quemAparece, setQuemAparece] = useState<QuemGrava | "">(quemGravaPadrao ?? "");
  /** E39a: "para quando é?" (dúvida 10: nos temas de hoje e no assunto seu, depois do tema escolhido). */
  const [data, setData] = useState(() => (paraHoje ? hojeISO() : (dataInicial ?? hojeISO())));
  const [momentoDoDia, setMomentoDoDia] = useState<MomentoDoDia | null>(null);

  /**
   * Hotfix de 22/10/2026: o que a pessoa já escolheu aqui fica no `sessionStorage`, por tema; quem vai a Referências (ou recarrega) volta e acha tudo como deixou. Lê uma vez, depois de montar (o servidor
   * não tem `sessionStorage`); só passa a gravar depois de ter lido, para o padrão da tela não apagar a escolha guardada.
   */
  const chaveDaEscolhaDoTema = chaveDaEscolha([origem.origem, temaEscolhidoTexto, noticiaId, noticiaAssuntoId, assuntoEmAlta, perguntaChave, pesquisa?.id]);
  const [escolhaLida, setEscolhaLida] = useState(false);

  // A sugestão que chega depois de a pessoa já ter tocado no controle nunca sobrescreve a escolha dela.
  const estiloTocadoRef = useRef(false);
  // A frase que a tela de erro mostra (ou null, sem erro): falha do servidor e queda de rede dizem coisas diferentes.
  const [erro, setErro] = useState<string | null>(null);
  /**
   * E74 PR 1: a espera NÃO roda dentro de `useTransition`. Uma transição assíncrona do React 19 segura todas as outras
   * (o `router.push` do "Voltar depois" ficava na fila até o servidor terminar, uns 2 minutos, e o botão parecia morto).
   * Estado simples, como `PesquisaTela` e `FolhaGravarAgora` já fazem.
   */
  const [escrevendo, setEscrevendo] = useState(false);
  /** Quando a pessoa saiu no meio e voltou: o instante (ms) em que a escrita que ainda corre no servidor começou; a tela espera ela ficar pronta em vez de oferecer escrever de novo. */
  const [retomadaDesde, setRetomadaDesde] = useState<number | null>(null);
  /** A comparação está abrindo (a página nova carrega): a espera continua na tela até lá, nunca o formulário. */
  const [abrindo, setAbrindo] = useState(false);
  /** E74 PR 2a (R-a): o pedido que a tela segue pelo id no servidor, em vez de depender da resposta da escrita. */
  const [seguido, setSeguidoNoEstado] = useState<PedidoSeguido | null>(null);
  /** O mesmo pedido, lido pela consulta: muda junto com o estado, para a consulta que sai logo depois de uma troca (`consultarAgora`) já ver o pedido novo. */
  const seguidoRef = useRef<PedidoSeguido | null>(null);
  const setSeguido = useCallback((novo: PedidoSeguido | null) => {
    seguidoRef.current = novo;
    setSeguidoNoEstado(novo);
  }, []);
  /** A etapa que o servidor disse ("Etapa 2 de 3: ..."), e quando a escrita começou no relógio do aparelho (corrigido pelo do servidor). */
  const [etapa, setEtapa] = useState<string | null>(null);
  const [desdeDoPedido, setDesdeDoPedido] = useState<number | null>(null);
  /** Outro roteiro desta marca está sendo escrito (estado 6 do desenho): a frase, sem escrever nada. */
  const [ocupadoPor, setOcupadoPor] = useState<string | null>(null);
  /** O que o próximo "Tentar de novo" manda: o MESMO id (o pedido que nunca chegou ao servidor) ou o pedido falho que o novo refaz. */
  const proximoEnvioRef = useRef<{ mesmoId?: string; refeitoDe?: string }>({});
  const { avisarRedeOk } = useConexao();
  /**
   * Revisão do PR #62, item 2: "Voltar depois" navegava para o Hoje, mas a transição continuava
   * rodando, e quando `gerarVersoesAction` terminava, o `router.push` para o roteiro disparava de
   * onde a pessoa estivesse (achado do Fable). Mesma ref que `FolhaGravarAgora` já usa: marcada no
   * clique, o sucesso (ou o erro) depois dela não navega nem escreve na tela mais.
   */
  const saiuRef = useRef(false);
  /** A comparação já foi pedida (`router.push`) e a página nova ainda carrega: o formulário não pode voltar a aparecer nesse meio tempo (um toque nele pagaria uma segunda escrita). */
  const navegandoRef = useRef(false);
  useEffect(() => {
    saiuRef.current = false;
    // Sair da tela por qualquer caminho (o voltar do navegador, o gesto do iPhone, um link) também vale: a resposta que chegar depois não navega nem escreve na tela.
    return () => {
      saiuRef.current = true;
    };
  }, []);

  useEffect(() => {
    // Saiu no meio e voltou: a escrita pode já ter acabado (o grupo pronto, ou o erro de sempre) com a pessoa fora da tela.
    const desfecho = tomarDesfecho(chaveDaEscolhaDoTema);
    if (desfecho && "grupo" in desfecho) {
      navegandoRef.current = true;
      setAbrindo(true);
      router.push(`/criar/versoes/${desfecho.grupo}`);
    } else if (desfecho) {
      setErro(desfecho.erro);
    } else {
      const espera = lerEspera(chaveDaEscolhaDoTema);
      // E74 PR 2a (R-c): a verdade é o servidor. O pedido que ele diz andar neste tema vale mesmo sem nada guardado no aparelho (o iPhone fechou o app em segundo plano); o guardado com id
      // é seguido pelo servidor; o guardado sem id (de uma aba de antes desta versão) segue o caminho do PR 1.
      if (pedidoDoTema) {
        const meu = espera?.pedidoId === pedidoDoTema.id;
        setSeguido({ pedidoId: pedidoDoTema.id, desde: meu && espera ? espera.desde : Date.now() - pedidoDoTema.decorridoMs, porque: meu ? "rede" : "servidor", vistoAndando: false });
      } else if (espera?.pedidoId) {
        setSeguido({ pedidoId: espera.pedidoId, desde: espera.desde, porque: "rede", vistoAndando: false });
      } else if (espera !== null) setRetomadaDesde(espera.desde);
    }
    const guardada = lerEscolha(chaveDaEscolhaDoTema, hojeISO());
    if (guardada) {
      if (guardada.formato) setFormato(guardada.formato);
      if (guardada.estiloTocado && guardada.estilo) {
        // Marcado antes da sugestão chegar: a sugestão do tema nunca passa por cima do que a pessoa escolheu.
        estiloTocadoRef.current = true;
        setEstiloTocado(true);
        setEstilo(guardada.estilo);
      }
      if (guardada.ficha) {
        setFicha(guardada.ficha);
        setCompacta(guardada.compacta === true);
      }
      if (guardada.objetivoDoVideo !== undefined) setObjetivoDoVideo(guardada.objetivoDoVideo);
      if (guardada.quemAparece !== undefined && (guardada.quemAparece === "" || opcoesQuemAparece.opcoes.some((o) => o.valor === guardada.quemAparece))) setQuemAparece(guardada.quemAparece);
      if (guardada.data && !paraHoje) setData(guardada.data);
      if (guardada.momentoDoDia !== undefined) setMomentoDoDia(guardada.momentoDoDia);
    }
    setEscolhaLida(true);
    // Só na montagem: a chave é do tema desta tela, que não muda sem a tela desmontar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!escolhaLida) return;
    gravarEscolha(chaveDaEscolhaDoTema, { ficha, compacta, formato, estilo, estiloTocado, objetivoDoVideo, quemAparece, data, momentoDoDia });
  }, [escolhaLida, chaveDaEscolhaDoTema, ficha, compacta, formato, estilo, estiloTocado, objetivoDoVideo, quemAparece, data, momentoDoDia]);

  /**
   * M4, item 2: busca a sugestão assim que a tela monta (o tema já está escolhido antes de chegar
   * aqui, ao contrário do objetivo). `cancelado` evita aplicar uma resposta que chegou depois de a
   * pessoa já ter tocado no controle ou de a tela ter saído.
   */
  useEffect(() => {
    let cancelado = false;
    sugerirEstiloAction(temaEscolhidoTexto)
      .then((sugestao) => {
        if (!cancelado && !estiloTocadoRef.current) setEstilo(sugestao);
      })
      .catch(() => {
        // Sem sugestão por falha de rede: o controle fica em "falado", a pessoa troca se quiser.
      });
    return () => {
      cancelado = true;
    };
  }, [temaEscolhidoTexto]);

  /**
   * Voltou para a tela com a escrita ainda correndo: de 4 em 4 segundos olha se a resposta já chegou (o desfecho guardado) ou se o servidor já tem as versões deste tema; abre a comparação quando
   * ficam prontas, mostra o erro de sempre se a escrita falhou, e passado o prazo desiste e mostra o formulário.
   */
  useEffect(() => {
    if (retomadaDesde === null) return;
    let parou = false;
    function abrir(grupo: string) {
      guardarEspera(chaveDaEscolhaDoTema, null);
      navegandoRef.current = true;
      setAbrindo(true);
      router.push(`/criar/versoes/${grupo}`);
    }
    async function conferir() {
      const desfecho = tomarDesfecho(chaveDaEscolhaDoTema);
      if (desfecho) {
        if ("grupo" in desfecho) abrir(desfecho.grupo);
        else if (!parou) {
          setRetomadaDesde(null);
          setErro(desfecho.erro);
        }
        return;
      }
      if (Date.now() - retomadaDesde! > ESPERA_MAXIMA_MS) {
        guardarEspera(chaveDaEscolhaDoTema, null);
        if (!parou) setRetomadaDesde(null);
        return;
      }
      try {
        // Só vale grupo deste tema: sair do A, escrever o B e voltar ao A não abre a comparação do B.
        const pronto = await grupoRecenteDesdeAction(retomadaDesde!, temaEscolhidoTexto);
        if (parou) return;
        if (pronto) abrir(pronto.grupo);
      } catch {
        // Sem resposta agora (rede): tenta de novo na próxima batida.
      }
    }
    void conferir();
    const id = setInterval(() => void conferir(), INTERVALO_DA_CONFERENCIA_MS);
    return () => {
      parou = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retomadaDesde]);

  /** Abre a comparação das versões (uma vez só: quem chegar depois, a resposta da escrita ou a consulta, não abre de novo). */
  const abrirVersoes = useCallback(
    (grupo: string) => {
      if (navegandoRef.current) return;
      guardarEspera(chaveDaEscolhaDoTema, null);
      avisarRedeOk();
      navegandoRef.current = true;
      setAbrindo(true);
      router.push(`/criar/versoes/${grupo}`);
    },
    [avisarRedeOk, chaveDaEscolhaDoTema, router],
  );

  /**
   * E74 PR 2a (R-a, R-c, R-i, R-j): enquanto há um pedido seguido, pergunta por ele (`GET /api/pedidos/estado?id=`, rota comum, fora da fila de ações do roteador), só com a aba visível, e na hora
   * em que a pessoa volta ao app. Sem rede, a tela continua na espera e diz isso; o pedido não muda por causa da rede.
   */
  const consultarPedido = useCallback(async () => {
    const atual = seguidoRef.current;
    if (!atual) return;
    const resposta = await fetch(`/api/pedidos/estado?id=${encodeURIComponent(atual.pedidoId)}`, { cache: "no-store" });
    const pedido = resposta.ok ? ((await resposta.json()) as PedidoNaTela & { agora: string }) : null;
    if (saiuRef.current || navegandoRef.current) return;
    // A pergunta voltou depois de a tela trocar de pedido (ou de parar de seguir): a resposta é de outro pedido e não vale mais.
    if (seguidoRef.current?.pedidoId !== atual.pedidoId) return;
    const decisao = decidirSobreOPedido(seguidoRef.current, { status: resposta.status, pedido }, Date.now());
    if (decisao.acao === "abrir") {
      abrirVersoes(decisao.grupo);
      return;
    }
    if (decisao.acao === "esperar") {
      setEtapa(decisao.etapa);
      if (decisao.desdeMs !== null) setDesdeDoPedido(decisao.desdeMs);
      if (decisao.vistoAndando && !seguidoRef.current.vistoAndando) setSeguido({ ...seguidoRef.current, vistoAndando: true });
      return;
    }
    // A escrita ainda pendente decide sozinha o que mostrar quando responder: aqui só o que o servidor já confirmou.
    if (seguidoRef.current.porque === "enviando" && decisao.acao !== "falhou") return;
    guardarEspera(chaveDaEscolhaDoTema, null);
    setSeguido(null);
    setEtapa(null);
    setDesdeDoPedido(null);
    if (decisao.acao === "falhou") {
      proximoEnvioRef.current = { refeitoDe: decisao.refeitoDe };
      setErro(decisao.frase);
    } else if (decisao.acao === "nao-chegou") {
      proximoEnvioRef.current = { mesmoId: decisao.mesmoId };
      setErro(decisao.frase);
    }
  }, [abrirVersoes, chaveDaEscolhaDoTema, setSeguido]);
  // Pergunta já ao começar a seguir (a volta ao app, o pedido que a página disse andar); enquanto a escrita não responde, um "não existe" é só o atraso e não muda nada.
  const { semRede, consultarAgora } = useConsultaViva(seguido !== null, consultarPedido, { jaNaEntrada: true });

  async function escrever() {
    if (escrevendo || pergunta && !ficha) return;
    // O Story e o sem fala não têm ficha: o Story grava o objetivo de falar com quem já segue; o sem fala, o de mais gente te conhecer.
    const objetivo: Objetivo = formato === "story" ? OBJETIVO_DO_STORY : !pergunta || !ficha ? OBJETIVO_DO_SEM_FALA : objetivoDaFicha(ficha);
    setErro(null);
    setOcupadoPor(null);
    // E74 PR 2a (R-a): o id do pedido nasce aqui e fica guardado ANTES de a rede ser usada. "Tentar de novo" depois de um pedido que nunca chegou manda o mesmo id; depois de uma falha
    // confirmada, um id novo que diz qual pedido refaz.
    const { mesmoId, refeitoDe } = proximoEnvioRef.current;
    proximoEnvioRef.current = {};
    const pedidoId = mesmoId ?? novoIdDePedido();
    const desdeMs = Date.now();
    guardarEspera(chaveDaEscolhaDoTema, { desde: desdeMs, pedidoId });
    setEtapa(null);
    setDesdeDoPedido(desdeMs);
    setSeguido({ pedidoId, desde: desdeMs, porque: "enviando", vistoAndando: false });
    setEscrevendo(true);
    try {
      const resultado = await gerarVersoesAction(
        origem,
        objetivo,
        formato,
        estilo,
        objetivoDoVideo.trim() || undefined,
        quemAparece || undefined,
        // O assunto do momento é para hoje e a pergunta não existe: sem data, o servidor usa o hoje dele (a data calculada ao montar a tela seria a de ontem se a pessoa a deixasse aberta até a meia-noite).
        paraHoje ? undefined : data,
        formato === "story" ? (momentoDoDia ?? undefined) : undefined,
        noticiaId,
        pergunta ? (ficha ?? undefined) : undefined,
        assuntoEmAlta,
        noticiaAssuntoId,
        perguntaChave,
        pesquisa?.id,
        pedidoId,
        refeitoDe,
      );
      // Com a pessoa fora da tela, o desfecho fica guardado para quando ela voltar a este tema (o grupo pronto, ou a frase que o servidor deu); "continua sendo escrito" não é desfecho:
      // a espera com o id fica, e quem voltar segue o pedido pelo servidor.
      if (saiuRef.current) {
        if (!resultado.ok) guardarDesfecho(chaveDaEscolhaDoTema, { erro: resultado.erro });
        else if ("grupo" in resultado.dado) guardarDesfecho(chaveDaEscolhaDoTema, { grupo: resultado.dado.grupo });
        else if ("jaEmAndamento" in resultado.dado) guardarDesfecho(chaveDaEscolhaDoTema, { erro: resultado.dado.frase });
        return;
      }
      if (navegandoRef.current) return;
      if (!resultado.ok) {
        guardarEspera(chaveDaEscolhaDoTema, null);
        setSeguido(null);
        // Uma recusa ou uma falha que o servidor confirmou (a escrita marcou o pedido como falho): o próximo pedido refaz este.
        proximoEnvioRef.current = { refeitoDe: pedidoId };
        setErro(resultado.erro);
        return;
      }
      const dado = resultado.dado;
      if ("jaEmAndamento" in dado) {
        // Outro roteiro desta marca anda agora: nada foi escrito nem gasto (estado 6 do desenho).
        guardarEspera(chaveDaEscolhaDoTema, null);
        setSeguido(null);
        setOcupadoPor(dado.frase);
        return;
      }
      if ("escrevendo" in dado) {
        // O mesmo pedido já estava sendo escrito (a primeira resposta se perdeu): a tela segue ele, sem escrever de novo.
        setSeguido({ pedidoId: dado.pedidoId, desde: desdeMs, porque: "repetido", vistoAndando: false });
        consultarAgora();
        return;
      }
      // E26 4b: o que nasce são as três versões do tema; o roteiro só existe depois de "Ficar com esta".
      abrirVersoes(dado.grupo);
    } catch (falha) {
      // E74 PR 2a (R-a, achado do Fable de 26/11): perder a resposta NUNCA vira "a conexão caiu" com "Tentar de novo" (no iPhone, bloquear a tela derrubava a resposta com o servidor ainda
      // escrevendo, e quem tocava ali pagava duas vezes). A tela segue o pedido pelo id: a espera continua até o servidor dizer que ficou pronto ou que falhou. Com a pessoa fora da tela,
      // a espera com o id fica guardada, e quem voltar segue o pedido do mesmo jeito.
      if (saiuRef.current || navegandoRef.current) return;
      setSeguido({ pedidoId, desde: desdeMs, porque: ehFalhaDeRede(falha) ? "rede" : "outra", vistoAndando: false });
      consultarAgora();
    } finally {
      if (!saiuRef.current && !navegandoRef.current) setEscrevendo(false);
    }
  }

  function voltarDepois() {
    saiuRef.current = true;
    // E39a: não /criar; o roteiro, pronto, aparece na Agenda do dia para que ele foi marcado.
    router.push("/hoje");
  }

  if (escrevendo || abrindo || retomadaDesde !== null || seguido !== null) {
    return (
      <TelaEscrevendo
        aberto
        fraseDemorando={textosObjetivo.demorando}
        aoVoltarDepois={voltarDepois}
        titulo={textosObjetivo.esperaVersoesTitulo}
        duracao={textosObjetivo.esperaVersoesDuracao}
        etapa={semRede ? textosPedidos.semRede : etapa}
        desdeMs={desdeDoPedido}
      />
    );
  }

  if (ocupadoPor !== null) {
    // Estado 6 do desenho: um roteiro desta marca já está sendo escrito; nenhuma escrita nova, nenhum custo. O Hoje mostra o que está sendo escrito.
    return (
      <div className={styles.pagina}>
        <div className={styles.temaEscolhido}>
          <span className={styles.rotulo}>{textosObjetivo.temaEscolhido}</span>
          <span className={styles.tema}>{temaEscolhidoTexto}</span>
        </div>
        <div className={styles.colunaPrincipal}>
          <div className={styles.espera}>
            <p className={styles.fraseErro} role="status" data-ja-em-andamento>
              {ocupadoPor}
            </p>
            <BarraAcao
              secundaria={{ rotulo: textosComuns.voltar, onClick: () => router.back() }}
              primaria={{ rotulo: textosPedidos.verOQueEstaSendoEscrito, onClick: () => router.push("/hoje") }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (erro !== null) {
    // O tema e o objetivo escolhidos continuam na tela: quem tenta de novo confere o que vai pedir (e o Voltar
    // leva de volta sem perder o tema).
    return (
      <div className={styles.pagina}>
        {/* V15, item 2 (design v2, dúvida 2 do passo 7): no erro, o lado é o tema (e o objetivo, se já
            escolhido). Primeiro no DOM, para a ordem no celular continuar a de sempre. */}
        <div className={styles.escolha}>
          <div className={styles.temaEscolhido}>
            <span className={styles.rotulo}>{textosObjetivo.temaEscolhido}</span>
            <span className={styles.tema}>{temaEscolhidoTexto}</span>
            {pesquisa ? <span className={styles.comPesquisa}>{textosPesquisa.objetivo.comPesquisa(pesquisa.dados)}</span> : null}
          </div>
          {pergunta && ficha ? (
            <div className={styles.temaEscolhido}>
              <span className={styles.rotulo}>{textosObjetivo.objetivoEscolhido}</span>
              <span className={styles.tema}>{NOME_DA_FICHA[ficha]}</span>
            </div>
          ) : null}
        </div>
        <div className={styles.colunaPrincipal}>
          <div className={styles.espera}>
            <p className={styles.fraseErro} role="alert">
              {erro}
            </p>
            <BarraAcao
              secundaria={{ rotulo: textosComuns.voltar, onClick: () => router.back() }}
              primaria={{ rotulo: textosComuns.tentarDeNovo, onClick: escrever, precisaDeRede: true }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pagina}>
      {/* V15, item 2 (design v2, dúvida 1 do passo 7): o lado começa no alto, ao lado do título;
          primeiro no DOM, para a ordem no celular continuar a de sempre. */}
      <div className={styles.temaEscolhido}>
        <span className={styles.rotulo}>{textosObjetivo.temaEscolhido}</span>
        <span className={styles.tema}>{temaEscolhidoTexto}</span>
        {pesquisa ? <span className={styles.comPesquisa}>{textosPesquisa.objetivo.comPesquisa(pesquisa.dados)}</span> : null}
      </div>
      <div className={styles.colunaPrincipal}>
      <h1 className={styles.pergunta}>{formato === "story" ? textosObjetivo.storyTitulo : pergunta ? textosObjetivo.pergunta : textosObjetivo.semFalaTitulo}</h1>
      <p className={styles.apoio}>{formato === "story" ? textosObjetivo.storyApoio : pergunta ? textosObjetivo.apoio : textosObjetivo.semFalaTexto}</p>

      <div className={styles.grupoFormato}>
        <span className={styles.rotulo}>{textosObjetivo.formato}</span>
        <div role="tablist" aria-label={textosObjetivo.formato} className={styles.segmentado}>
          {FORMATOS_ROTEIRO_EM_ORDEM.map((opcao) => (
            <button
              key={opcao}
              type="button"
              role="tab"
              aria-selected={formato === opcao}
              className={[styles.segmentoBotao, formato === opcao ? styles.segmentoAtivo : ""]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setFormato(opcao)}
            >
              {ROTULO_FORMATO_ROTEIRO[opcao]}
            </button>
          ))}
        </div>
        <p className={styles.formatoAjuda}>{textosObjetivo.formatoAjuda[formato]}</p>
      </div>

      {pergunta ? (
        <div data-fichas>
          {fichaRecomendada ? (
            <p className={styles.porque} data-recomendada-por={recomendadaPor}>
              {recomendadaPor === "tema" ? textosObjetivo.recomendaPeloTema : textosObjetivo.recomendaPeloHistorico}
              {textosObjetivo.razaoDaRecomendada[fichaRecomendada]}
            </p>
          ) : null}
          <div role="radiogroup" aria-label={textosObjetivo.pergunta} className={styles.opcoes}>
            {FICHAS_EM_ORDEM.filter((f) => !compacta || f === ficha).map((f) => (
              <OpcaoObjetivo
                key={f}
                titulo={NOME_DA_FICHA[f]}
                ajuda={FRASE_DA_FICHA[f]}
                exemplo={EXEMPLO_DA_FICHA[f]}
                ajudaEm={AJUDA_EM_DA_FICHA[f]}
                marcada={ficha === f}
                recomendada={fichaRecomendada === f}
                rotuloRecomendado={textosObjetivo.recomendado}
                onEscolher={() => {
                  setFicha(f);
                  setCompacta(true);
                }}
              />
            ))}
          </div>
          {compacta && ficha ? (
            <>
              <button type="button" className={styles.verAsCinco} onClick={() => setCompacta(false)}>
                {textosObjetivo.verAsCincoDeNovo}
              </button>
              {exemplosFalharam ? null : (
              <section className={styles.exemplos} aria-labelledby="exemplos-titulo" data-exemplos={exemplos === null ? "carregando" : exemplos.length > 0 ? "com" : "sem"}>
                <h3 id="exemplos-titulo">{textosObjetivo.exemplosTitulo}</h3>
                {exemplos === null ? (
                  <p className={styles.apoio}>{textosObjetivo.carregandoExemplos}</p>
                ) : exemplos.length > 0 ? (
                  <>
                    <p className={styles.apoio}>{textosObjetivo.exemplosFrase(PARECE_FEITO_PARA[ficha])}</p>
                    <ul className={styles.listaExemplos}>
                      {exemplos.map((e) => (
                        <li key={e.id} className={styles.exemplo} data-exemplo={e.id}>
                          <button type="button" className={styles.exemploBotao} aria-haspopup="dialog" onClick={() => setExemploAbertoId(e.id)}>
                            <CapaDoExemplo capaUrl={e.video.capaUrl} />
                            <span className={styles.exemploTexto}>
                              <span className={styles.exemploTitulo}>{e.video.titulo}</span>
                              <span className={styles.exemploConta}>
                                {e.video.contaNome}, {e.video.plataformaData}
                              </span>
                              {e.tipo ? <span className={styles.exemploSelo}>{e.tipo}</span> : null}
                              <span className={styles.exemploVer}>{textosObjetivo.verOVideo}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <Link className={styles.verMais} href={`/referencias?feitoPara=${ficha}&periodo=90&voltar=${encodeURIComponent(caminhoParaVoltar)}`}>
                      {textosObjetivo.verMaisEmReferencias}
                    </Link>
                  </>
                ) : (
                  <div className={styles.semExemplos}>
                    <strong>{textosObjetivo.semExemplosTitulo}</strong>
                    <p>{textosObjetivo.semExemplosTexto}</p>
                  </div>
                )}
              </section>
              )}
            </>
          ) : null}
        </div>
      ) : (
        <div className={styles.cartaoStory} data-story-sem-pergunta>
          <h3>{formato === "story" ? textosObjetivo.storyCartaoTitulo : textosObjetivo.semFalaTitulo}</h3>
          <p>{formato === "story" ? textosObjetivo.storyCartaoTexto : textosObjetivo.semFalaTexto}</p>
        </div>
      )}

      <div className={styles.grupoFormato}>
        <span className={styles.rotulo}>{textosObjetivo.estilo}</span>
        <div role="tablist" aria-label={textosObjetivo.estilo} className={styles.segmentado}>
          {ESTILOS_ROTEIRO_EM_ORDEM.map((opcao) => (
            <button
              key={opcao}
              type="button"
              role="tab"
              aria-selected={estilo === opcao}
              className={[styles.segmentoBotao, estilo === opcao ? styles.segmentoAtivo : ""]
                .filter(Boolean)
                .join(" ")}
              title={DESCRICAO_ESTILO_ROTEIRO[opcao]}
              onClick={() => {
                estiloTocadoRef.current = true;
                setEstiloTocado(true);
                setEstilo(opcao);
              }}
            >
              {ROTULO_ESTILO_ROTEIRO[opcao]}
            </button>
          ))}
        </div>
        {!estiloTocado ? <p className={styles.formatoAjuda}>{textosObjetivo.estiloAjuda[estilo]}</p> : null}
      </div>

      {paraHoje ? null : <PerguntaParaQuando data={data} onChange={setData} />}
      {formato === "story" ? <PerguntaMomentoDoDia valor={momentoDoDia} onChange={setMomentoDoDia} /> : null}

      {opcoesQuemAparece.fixoEmPropriaPessoa ? null : (
        <div className={styles.grupoFormato}>
          <span className={styles.rotulo}>{textosObjetivo.quemAparece}</span>
          <div role="radiogroup" aria-label={textosObjetivo.quemAparece} className={styles.opcoes}>
            {opcoesQuemAparece.opcoes.map((opcao) => (
              <OpcaoObjetivo
                key={opcao.valor}
                titulo={opcao.rotulo}
                marcada={quemAparece === opcao.valor}
                onEscolher={() => setQuemAparece(opcao.valor)}
              />
            ))}
          </div>
        </div>
      )}

      <CampoComFala
        rotulo={`${textosObjetivo.objetivoDoVideo} ${textosObjetivo.objetivoDoVideoOpcional}`}
        ajuda={textosObjetivo.objetivoDoVideoAjuda}
        value={objetivoDoVideo}
        onChange={setObjetivoDoVideo}
        placeholder={textosObjetivo.objetivoDoVideoPlaceholder}
        maxLength={200}
        linhasMin={2}
        nomeArquivo="objetivo-do-video"
      />

      <BarraAcao
        secundaria={{ rotulo: textosComuns.voltar, onClick: () => router.back() }}
        primaria={{ rotulo: textosObjetivo.escrever, onClick: escrever, disabled: pergunta && !ficha, precisaDeRede: true }}
      />
      </div>
      <FolhaDetalhesVideo
        video={exemploAberto?.video ?? null}
        url={exemploAberto?.url ?? null}
        aberto={exemploAbertoId !== null}
        aoFechar={previa.fechar}
        soVer={{ rotuloFechar: textosObjetivo.voltarParaORoteiro }}
      />
    </div>
  );
}
