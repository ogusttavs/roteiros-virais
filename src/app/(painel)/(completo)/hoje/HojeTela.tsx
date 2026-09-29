"use client";

import { CalendarDays, Check, ChevronRight, CirclePlay, RefreshCw, Video } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import type { ConteudoRoteiro, FormatoRoteiro, Objetivo, Plataforma, PlanoMarca, TemaDoDia } from "@/db/schema";
import { ROTULO_TEMA_CARTAO } from "@/ia/enums";
import type { ItemPlano } from "@/servicos/plano";
import type { OrigemRoteiro } from "@/servicos/roteiro";
import type { EstadoDia } from "@/servicos/temas";
import { textosHistorico } from "@/textos/historico";
import { textosHoje } from "@/textos/hoje";
import { textosMomento } from "@/textos/momento";
import { textosNav } from "@/textos/nav";
import { textosPlano } from "@/textos/plano";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { Chips } from "@/ui/componentes/Chips";
import { MotivoSemRede } from "@/ui/componentes/MotivoSemRede";
import { TemaCartao, type EvidenciaTema } from "@/ui/componentes/TemaCartao";
import { ID_FAIXA_SEM_CONEXAO, useConexao } from "@/ui/ConexaoContext";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import { SeletorMarcaCelular, type MarcaResumo } from "../../_casca/SeletorMarcaCelular";
import { useTrocaMarca } from "../../_casca/TrocaMarcaContext";

import { salvarRedePrincipalAction } from "./acoes";
import { FolhaGravarAgora, type ValoresIniciaisMomento } from "./FolhaGravarAgora";
import { FolhaMeuPlano } from "./FolhaMeuPlano";
import { FolhaPlanejarDias } from "./FolhaPlanejarDias";
import { HojeCabecalho } from "./HojeCabecalho";
import { HojeEsqueleto } from "./HojeEsqueleto";
import styles from "./HojeTela.module.css";
import { pularPlanoAction } from "./plano/acoes";

type RoteiroDeHoje = { id: number; objetivo: Objetivo; criadoEm: Date; corpo: ConteudoRoteiro };

/** V9b-0, plano `sem_limite`: cada cartão sabe a própria origem, para o rótulo "momento" do Histórico. */
type RoteiroDeHojeComOrigem = RoteiroDeHoje & { origem: OrigemRoteiro["origem"] };

export type SemanaDia = { rotulo: string; estado: EstadoDia; hoje: boolean };

/** H3, item 1: o aviso que substitui os três temas na porta Reels quando não há tema de hoje. */
export type AvisoSemTema = { titulo: string; texto: string };

export type UltimoVideoAparte = {
  views: string;
  horas: number;
  multiplo: string;
  acimaDoNormal: boolean;
};

/** V12, item 3a: a ordem dos chips é sempre a mesma, na marca e na primeira vez. */
const REDES_PRINCIPAIS: { valor: Plataforma; rotulo: string }[] = [
  { valor: "instagram", rotulo: "Instagram" },
  { valor: "tiktok", rotulo: "TikTok" },
  { valor: "youtube", rotulo: "YouTube" },
];

type Porta = "reels" | "story";

function portaDaUrl(valor: string | null): Porta | null {
  return valor === "reels" || valor === "story" ? valor : null;
}

type Props = {
  temas: TemaDoDia[];
  evidenciasTemas: (EvidenciaTema | null)[];
  avisoLinhaEditorial: string | null;
  avisoVideoSubindo: string | null;
  /** H3, item 1: sem tema (ou com a busca de hoje falhando) e sem roteiro de hoje já escrito. */
  avisoSemTema: AvisoSemTema | null;
  roteiroHoje: RoteiroDeHoje | null;
  evidenciaRoteiroHoje: EvidenciaTema | null;
  /** V9b-0: plano da marca ativa; `sem_limite` troca o cartão único pela lista de cartões abaixo. */
  plano: PlanoMarca;
  /** V9b-0, plano `sem_limite`: todos os roteiros de hoje, mais recente primeiro; vazio no plano `padrao`. */
  roteirosDeHoje: RoteiroDeHojeComOrigem[];
  /** V9b-0, plano `sem_limite`: a evidência de cada roteiro de `roteirosDeHoje`, no mesmo índice. */
  evidenciasRoteirosDeHoje: (EvidenciaTema | null)[];
  semana: SemanaDia[];
  ultimoVideo: UltimoVideoAparte | null;
  /**
   * Para o seletor de marca na barra do topo, só no celular (revisão do PR
   * #31, item 8; V3, item 3: virou a marca ativa, não mais o avatar da
   * pessoa).
   */
  marcaAtiva: MarcaResumo;
  marcas: MarcaResumo[];
  nomePessoa: string;
  /** V9a, item 3: o objetivo já marcado na folha "Gravar agora" (mesma origem de `/hoje/objetivo`). */
  objetivoRecomendado: Objetivo | null;
  /** V9a, item 4: as outras marcas, para o seletor "Falar de" da folha (a ativa já fora desta lista). */
  outrasMarcas: MarcaResumo[];
  /** V9b, item 3: o bloco "o seu plano de hoje", vazio sem plano para hoje. */
  planoDeHoje: ItemPlano[];
  /** V9b, item 3: os dias que vêm, para a folha "Meu plano" (só existe quando há plano hoje). */
  planoQueVem: ItemPlano[];
  /** V12, item 3a: a rede principal da marca ativa, nula até a pessoa responder na porta Reels. */
  redePrincipal: Plataforma | null;
};

function classesDia(dia: SemanaDia): string {
  return [
    styles.dia,
    dia.estado === "gravou" ? styles.diaGravou : "",
    dia.estado === "postou" ? styles.diaPostou : "",
    dia.hoje ? styles.diaHoje : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** "Sua semana", no topo da tela (V12, item 1): os três estados do dia, a legenda e a frase de ritmo. */
function AparteSemanaTopo({ semana }: { semana: SemanaDia[] }) {
  const diasComAtividade = semana.filter((dia) => dia.estado !== "nada").length;
  return (
    <section className={styles.semanaTopo} aria-label={textosHoje.suaSemana}>
      <h4 className={styles.semanaTopoTitulo}>{textosHoje.suaSemana}</h4>
      <div className={styles.semana}>
        {semana.map((dia, indice) => (
          <span key={indice} className={classesDia(dia)}>
            <i></i>
            {dia.rotulo}
          </span>
        ))}
      </div>
      <p className={styles.legendaSemana}>
        <span>
          <i className={styles.legendaGravou}></i>
          {textosHoje.legendaSemana.gravou}
        </span>
        <span>
          <i className={styles.legendaPostou}></i>
          {textosHoje.legendaSemana.postou}
        </span>
        <span>
          <i></i>
          {textosHoje.legendaSemana.nada}
        </span>
      </p>
      <p className={styles.linhaConstancia}>
        <Check size={18} strokeWidth={1.75} aria-hidden="true" className={styles.iconePositivo} />
        <span>{textosHoje.constanciaSemana(diasComAtividade)}</span>
      </p>
    </section>
  );
}

/** V8, ajuste (c) da revisão do Fable: continua abaixo da semana, só quando há vídeo sendo medido. */
function CartaoUltimoVideo({ ultimoVideo }: { ultimoVideo: UltimoVideoAparte }) {
  return (
    <section className={styles.cartaoUltimoVideo} aria-label={textosHoje.seuUltimoVideo}>
      <h4 className={styles.cartaoUltimoVideoTitulo}>{textosHoje.seuUltimoVideo}</h4>
      <span className={styles.curvaValor}>{ultimoVideo.views}</span>
      <span className={styles.curvaLegenda}>{textosHoje.visualizacoesEmHoras(ultimoVideo.views, ultimoVideo.horas)}</span>
      {ultimoVideo.acimaDoNormal ? (
        <span className={styles.curvaAcima}>
          <Check size={16} strokeWidth={1.75} aria-hidden="true" />
          {textosHoje.acimaDoSeuNormal(ultimoVideo.multiplo)}
        </span>
      ) : (
        <span className={styles.curvaLegenda}>{textosHoje.doNormalDaSuaConta(ultimoVideo.multiplo)}</span>
      )}
      <Link href="/historico" className={styles.verComoFoi}>
        {textosHoje.verComoFoi}
      </Link>
    </section>
  );
}

function CartaoRoteiroCompleto({
  roteiro,
  evidencia,
  rotuloOrigem,
}: {
  roteiro: RoteiroDeHoje;
  evidencia: EvidenciaTema | null;
  rotuloOrigem?: string;
}) {
  return (
    <article className={styles.cartaoRoteiro}>
      <div className={styles.tituloArea}>
        <span className={styles.rotulo}>
          {ROTULO_TEMA_CARTAO[roteiro.objetivo]}
          {rotuloOrigem ? ` · ${rotuloOrigem}` : ""}
        </span>
        <h3 className={styles.temaTitulo}>{roteiro.corpo.titulo}</h3>
      </div>
      <p className={styles.porque}>{textosHoje.roteiroGeradoDescricao(roteiro.corpo.duracaoS)}</p>
      {evidencia ? (
        <div className={styles.evidencia}>
          {evidencia.conta ? (
            <span className={styles.evidenciaLinha}>
              <span className={styles.conta}>{evidencia.conta}</span>
            </span>
          ) : null}
          <span className={styles.evidenciaLinha}>
            <b>{evidencia.multiplo}</b> {textosHoje.evidenciaMultiplo(evidencia.rotulo, evidencia.views, evidencia.quando)}
          </span>
        </div>
      ) : null}
      <div className={styles.acoes}>
        <Link href={`/roteiros/${roteiro.id}/gravar`} className={styles.botaoPrimario}>
          <Video size={20} strokeWidth={1.75} aria-hidden="true" />
          {textosHoje.modoGravacao}
        </Link>
        <Link href={`/roteiros/${roteiro.id}`} className={styles.botaoSecundario}>
          {textosHoje.abrirRoteiro}
        </Link>
      </div>
    </article>
  );
}

/** V12, ajuste (d) da revisão do Fable: com dois ou mais roteiros de hoje, título e as duas ações numa linha só. */
function CartaoRoteiroCompacto({ roteiro, rotuloOrigem }: { roteiro: RoteiroDeHojeComOrigem; rotuloOrigem?: string }) {
  return (
    <article className={styles.cartaoRoteiroCompacto}>
      <div className={styles.tituloArea}>
        <span className={styles.rotulo}>
          {ROTULO_TEMA_CARTAO[roteiro.objetivo]}
          {rotuloOrigem ? ` · ${rotuloOrigem}` : ""}
        </span>
        <h4 className={styles.temaTituloCompacto}>{roteiro.corpo.titulo}</h4>
      </div>
      <div className={styles.acoesCompactas}>
        <Link href={`/roteiros/${roteiro.id}/gravar`} className={styles.botaoPrimarioSm}>
          <Video size={16} strokeWidth={1.75} aria-hidden="true" />
          {textosHoje.modoGravacao}
        </Link>
        <Link href={`/roteiros/${roteiro.id}`} className={styles.botaoSecundarioSm}>
          {textosHoje.abrir}
        </Link>
      </div>
    </article>
  );
}

/** `/hoje` (design v2, `entrega/telas/Hoje.dc.html`; V12: o Hoje em duas portas). */
export function HojeTela({
  temas,
  evidenciasTemas,
  avisoLinhaEditorial,
  avisoVideoSubindo,
  avisoSemTema,
  roteiroHoje,
  evidenciaRoteiroHoje,
  plano,
  roteirosDeHoje,
  evidenciasRoteirosDeHoje,
  semana,
  ultimoVideo,
  marcaAtiva,
  marcas,
  nomePessoa,
  objetivoRecomendado,
  outrasMarcas,
  planoDeHoje: planoDeHojeInicial,
  planoQueVem,
  redePrincipal,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const porta = portaDaUrl(searchParams.get("porta"));

  const [outrosAbertos, setOutrosAbertos] = useState(false);
  const [folhaMomentoAberta, setFolhaMomentoAberta] = useState(false);
  const [itemPlanoParaFolha, setItemPlanoParaFolha] = useState<ItemPlano | null>(null);
  const { fechar: fecharFolhaMomento, fecharENavegar: fecharFolhaMomentoENavegar } = useFolhaNoHistorico(
    folhaMomentoAberta,
    () => {
      setFolhaMomentoAberta(false);
      setItemPlanoParaFolha(null);
    },
  );
  const [folhaPlanejarAberta, setFolhaPlanejarAberta] = useState(false);
  const { fechar: fecharFolhaPlanejar } = useFolhaNoHistorico(folhaPlanejarAberta, () => setFolhaPlanejarAberta(false));
  const [folhaMeuPlanoAberta, setFolhaMeuPlanoAberta] = useState(false);
  const { fechar: fecharFolhaMeuPlano, fecharEDepois: fecharFolhaMeuPlanoEDepois } = useFolhaNoHistorico(
    folhaMeuPlanoAberta,
    () => setFolhaMeuPlanoAberta(false),
  );

  // V9b, item 3: "Pular" some do bloco na hora, sem esperar o `router.refresh()` do fim da acao.
  const [planoDeHoje, setPlanoDeHoje] = useState(planoDeHojeInicial);
  const [pulandoId, setPulandoId] = useState<number | null>(null);

  /**
   * `useState(planoDeHojeInicial)` acima só lê a prop na primeira montagem: sem este efeito, o
   * plano recém colado (`FolhaPlanejarDias`, `router.refresh()` sem navegação) nunca aparecia,
   * porque o Hoje não desmonta nesse refresh (achado do e2e desta etapa, `plano.spec.ts`). Este
   * efeito resincroniza sempre que o servidor manda uma lista nova.
   */
  useEffect(() => {
    setPlanoDeHoje(planoDeHojeInicial);
  }, [planoDeHojeInicial]);

  // V12, item 3a: otimista, revertida em silêncio numa falha (mesmo espírito de `pularItemDoPlano` abaixo).
  const [redePrincipalAtual, setRedePrincipalAtual] = useState(redePrincipal);

  function escolherRede(rede: Plataforma) {
    const anterior = redePrincipalAtual;
    setRedePrincipalAtual(rede);
    void salvarRedePrincipalAction(rede).catch(() => {
      setRedePrincipalAtual(anterior);
    });
  }

  function abrirGravarAgoraDoPlano(item: ItemPlano) {
    setItemPlanoParaFolha(item);
    setFolhaMomentoAberta(true);
  }

  async function pularItemDoPlano(item: ItemPlano) {
    if (pulandoId !== null) return;
    setPulandoId(item.id);
    try {
      await pularPlanoAction(item.id);
      setPlanoDeHoje((atual) => atual.filter((i) => i.id !== item.id));
    } catch {
      // A falha fica só visual (o item continua no bloco); tentar de novo e uma frase dedicada
      // ficam para a próxima rodada de acabamento, mesmo espírito das outras acoes desta tela.
    } finally {
      setPulandoId(null);
    }
  }

  /** V12, item 4b: fecha "Meu plano" e só então abre "Planejar os próximos dias" (mesmo padrão de `fecharEDepois`). */
  function planejarDeNovo() {
    fecharFolhaMeuPlanoEDepois(() => setFolhaPlanejarAberta(true));
  }

  const { trocando, marcaAlvo } = useTrocaMarca();
  const { semConexao, avisarFalhaDeRede } = useConexao();
  // Toque que só navega (ou atualiza) espera a resposta do servidor sem mostrar nada; com sinal fraco parecia travado
  // e o segundo toque só descartava o primeiro (V7, item 4 do PROXIMO.md). `acao` diz qual toque está em andamento.
  const [ocupado, iniciarTransicao] = useTransition();
  const [acao, setAcao] = useState<string | null>(null);
  const emAndamento = (chave: string) => ocupado && acao === chave;
  const atualizando = emAndamento("atualizar");

  function ir(chave: string, destino: string) {
    if (ocupado) return;
    setAcao(chave);
    iniciarTransicao(() => router.push(destino));
  }

  function atualizar() {
    if (ocupado) return;
    // Sem rede o pedido cai e o Next sai da tela inteira para a página de erro do navegador; avisa em vez de tentar.
    if (!navigator.onLine) {
      avisarFalhaDeRede();
      return;
    }
    setAcao("atualizar");
    iniciarTransicao(() => router.refresh());
  }

  /**
   * V12, item 2: a porta troca de estado só na URL (`?porta=reels`/`?porta=story`), sem pedir os
   * dados de novo ao servidor (os dois dão conta com o que a página já carregou). `history.pushState`
   * direto, não `router.push`: o Next reaproveita a árvore de componentes e só troca o que
   * `useSearchParams` devolve; o Voltar do aparelho (um `popstate` normal) fecha a porta sozinho.
   */
  function abrirPorta(nova: Porta) {
    window.history.pushState(null, "", `${window.location.pathname}?porta=${nova}`);
  }

  function fecharPorta() {
    window.history.pushState(null, "", window.location.pathname);
  }

  const temRoteiroHoje = plano === "sem_limite" ? roteirosDeHoje.length > 0 : roteiroHoje !== null;
  // V12, item 3b: sem_limite sempre mostra os três temas; no plano padrão, só quando ainda não existe roteiro de hoje.
  const mostrarTemasAbertos = plano === "sem_limite" || !temRoteiroHoje;
  const redeSelecionadaIndice = redePrincipalAtual ? REDES_PRINCIPAIS.findIndex((r) => r.valor === redePrincipalAtual) : null;

  return (
    <div className={styles.pagina}>
      <BarraTopo
        titulo={textosHoje.titulo}
        direita={
          <>
            <SeletorMarcaCelular marcaAtiva={marcaAtiva} marcas={marcas} nomePessoa={nomePessoa} />
            <button
              type="button"
              className={styles.botaoBarra}
              aria-label={textosHoje.atualizar}
              aria-busy={atualizando || undefined}
              disabled={ocupado}
              onClick={atualizar}
            >
              <RefreshCw
                size={18}
                strokeWidth={1.75}
                aria-hidden="true"
                className={atualizando ? styles.girando : undefined}
              />
              {marcas.length <= 1 ? <span>{textosHoje.atualizar}</span> : null}
            </button>
          </>
        }
      />

      {trocando ? (
        <div className={styles.miolo}>
          <HojeCabecalho estado="trocando" mensagemTrocando={textosNav.abrindoMarca(marcaAlvo ?? "")} />
          <HojeEsqueleto mensagemEsperando={textosNav.abrindoMarca(marcaAlvo ?? "")} />
        </div>
      ) : (
        <div className={styles.miolo}>
          <HojeCabecalho avisoVideoSubindo={avisoVideoSubindo} estado="normal" />

          <div className={styles.telaPortas}>
            {avisoLinhaEditorial ? <p className={styles.aviso}>{avisoLinhaEditorial}</p> : null}

            <AparteSemanaTopo semana={semana} />
            {ultimoVideo ? <CartaoUltimoVideo ultimoVideo={ultimoVideo} /> : null}

            {/* V12, item 1: "Seus roteiros de hoje", quando houver. */}
            {temRoteiroHoje ? (
              <section
                className={styles.roteirosHoje}
                aria-label={textosHoje.seusRoteirosDeHoje(plano === "sem_limite" ? roteirosDeHoje.length : 1)}
              >
                <h3 className={styles.roteirosHojeTitulo}>
                  {textosHoje.seusRoteirosDeHoje(plano === "sem_limite" ? roteirosDeHoje.length : 1)}
                </h3>
                {plano === "sem_limite" ? (
                  roteirosDeHoje.length >= 2 ? (
                    roteirosDeHoje.map((roteiro) => (
                      <CartaoRoteiroCompacto
                        key={roteiro.id}
                        roteiro={roteiro}
                        rotuloOrigem={roteiro.origem === "momento" ? textosHistorico.origemMomento : undefined}
                      />
                    ))
                  ) : (
                    roteirosDeHoje.map((roteiro, indice) => (
                      <CartaoRoteiroCompleto
                        key={roteiro.id}
                        roteiro={roteiro}
                        evidencia={evidenciasRoteirosDeHoje[indice] ?? null}
                        rotuloOrigem={roteiro.origem === "momento" ? textosHistorico.origemMomento : undefined}
                      />
                    ))
                  )
                ) : roteiroHoje ? (
                  <CartaoRoteiroCompleto roteiro={roteiroHoje} evidencia={evidenciaRoteiroHoje} />
                ) : null}
              </section>
            ) : null}

            {/* V9b, item 3: "o seu plano de hoje" (ele é do dia, não de uma porta, V12, item 1). */}
            {planoDeHoje.length > 0 ? (
              <section className={styles.planoHoje}>
                <div className={styles.planoHojeCabecalho}>
                  <h4>{textosPlano.tituloBlocoHoje}</h4>
                  <button type="button" className={styles.trocar} onClick={() => setFolhaMeuPlanoAberta(true)}>
                    {textosPlano.botaoMeuPlano}
                  </button>
                </div>
                <div className={styles.listaOutros}>
                  {planoDeHoje.map((item) => (
                    <div key={item.id} className={styles.linhaOutro}>
                      <span className={styles.blocoOutro}>
                        <span className={styles.rotuloOutro}>
                          {item.lugar.trim() || textosPlano.semLugar} · {ROTULO_TEMA_CARTAO[item.objetivo]}
                        </span>
                        <span className={styles.temaOutro}>{item.situacao}</span>
                      </span>
                      <span className={styles.acaoOutro}>
                        {item.estado === "sugerido" ? (
                          <>
                            <button type="button" className={styles.trocar} onClick={() => abrirGravarAgoraDoPlano(item)}>
                              {textosPlano.botaoEscreverRoteiro}
                            </button>
                            <button
                              type="button"
                              className={styles.trocar}
                              disabled={pulandoId === item.id}
                              aria-busy={pulandoId === item.id || undefined}
                              onClick={() => pularItemDoPlano(item)}
                            >
                              {pulandoId === item.id ? textosPlano.pulando : textosPlano.botaoPular}
                            </button>
                          </>
                        ) : item.roteiroId ? (
                          <Link href={`/roteiros/${item.roteiroId}`} className={styles.trocar}>
                            {item.estado === "gravado" ? textosPlano.rotuloGravado : textosPlano.botaoAbrirRoteiro}
                          </Link>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {/* V12, item 2: a pergunta, antes de qualquer porta escolhida. */}
            {porta === null ? (
              <div className={styles.blocoPortas}>
                <p className={styles.perguntaPortas}>{textosHoje.pergunta}</p>
                <div className={styles.portasGrandes}>
                  <button type="button" className={styles.porta} onClick={() => abrirPorta("reels")}>
                    <span className={styles.portaMarca} aria-hidden="true">
                      <Video size={24} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <strong className={styles.portaTitulo}>{textosHoje.portaReels}</strong>
                    <span className={styles.portaAjuda}>{textosHoje.portaReelsAjuda}</span>
                    <span className={styles.portaSeta} aria-hidden="true">
                      <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                  </button>
                  <button type="button" className={styles.porta} onClick={() => abrirPorta("story")}>
                    <span className={styles.portaMarca} aria-hidden="true">
                      <CirclePlay size={24} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <strong className={styles.portaTitulo}>{textosHoje.portaStory}</strong>
                    <span className={styles.portaAjuda}>{textosHoje.portaStoryAjuda}</span>
                    <span className={styles.portaSeta} aria-hidden="true">
                      <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                  </button>
                </div>
              </div>
            ) : porta === "reels" ? (
              <div className={styles.blocoPorta}>
                <div className={styles.portaEscolhida}>
                  <Video size={20} strokeWidth={1.75} aria-hidden="true" />
                  <span>{textosHoje.portaReels}</span>
                  <button type="button" className={[styles.trocar, styles.portaEscolhidaBtn].join(" ")} onClick={fecharPorta}>
                    {textosHoje.trocar}
                  </button>
                </div>

                <div className={styles.grupoRede}>
                  {!redePrincipalAtual ? <span className={styles.perguntaRede}>{textosHoje.ondeVocePostaMais}</span> : null}
                  <Chips
                    rotuloGrupo={textosHoje.ondeVocePostaMais}
                    opcoes={REDES_PRINCIPAIS.map((r) => r.rotulo)}
                    selecionado={redeSelecionadaIndice}
                    onChange={(indice) => escolherRede(REDES_PRINCIPAIS[indice].valor)}
                  />
                  <p className={styles.dicaRede}>{textosHoje.dicaRedePrincipal}</p>
                </div>

                {avisoSemTema ? (
                  <div className={styles.estadoCartao}>
                    <h3>{avisoSemTema.titulo}</h3>
                    <p>{avisoSemTema.texto}</p>
                  </div>
                ) : mostrarTemasAbertos ? (
                  <div className={styles.temasTres}>
                    {temas.map((tema, indice) => (
                      <TemaCartao
                        key={`${tema.titulo}-${indice}`}
                        rotulo={ROTULO_TEMA_CARTAO[tema.puxaPara]}
                        tema={tema.titulo}
                        porque={tema.porQue}
                        evidencia={evidenciasTemas[indice] ?? null}
                        primario={indice === 0}
                        rotuloBotao={plano === "sem_limite" ? textosMomento.escreverRoteiro : textosHoje.queroEsse}
                        abrindo={emAndamento(`tema-${indice}`)}
                        desabilitado={ocupado}
                        precisaDeRede
                        onEscolher={() => ir(`tema-${indice}`, `/hoje/objetivo?tema=${indice}`)}
                      />
                    ))}
                  </div>
                ) : temas.length > 0 ? (
                  <div className={styles.recolhidos}>
                    <button
                      type="button"
                      aria-expanded={outrosAbertos}
                      className={styles.abrirTemas}
                      onClick={() => setOutrosAbertos((a) => !a)}
                    >
                      <span>{outrosAbertos ? textosHoje.esconderOutros : textosHoje.verOutros}</span>
                      <span className={styles.contaTemas}>{textosHoje.contagemTemas(temas.length)}</span>
                    </button>
                    <p className={styles.avisoTrocarTema}>{textosHoje.trocarTemaAviso}</p>
                    {outrosAbertos ? (
                      <div className={styles.listaOutros}>
                        {temas.map((tema, indice) => (
                          <div key={`${tema.titulo}-${indice}`} className={styles.linhaOutro}>
                            <span className={styles.blocoOutro}>
                              <span className={styles.rotuloOutro}>{ROTULO_TEMA_CARTAO[tema.puxaPara]}</span>
                              <span className={styles.temaOutro}>{tema.titulo}</span>
                            </span>
                            <span className={styles.acaoOutro}>
                              <button
                                type="button"
                                className={styles.trocar}
                                disabled={ocupado || semConexao}
                                aria-busy={emAndamento(`trocar-${indice}`) || undefined}
                                aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
                                onClick={() => ir(`trocar-${indice}`, `/hoje/objetivo?tema=${indice}`)}
                              >
                                {emAndamento(`trocar-${indice}`) ? textosHoje.abrindo : textosHoje.trocar}
                              </button>
                              <MotivoSemRede />
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className={styles.duasCartas}>
                  <div className={styles.proprio}>
                    <h4>{textosHoje.querOutroAssunto}</h4>
                    <p>{textosHoje.preferAssuntoSeuTexto}</p>
                    <button
                      type="button"
                      className={styles.botaoSecundario}
                      disabled={ocupado || semConexao}
                      aria-busy={emAndamento("proprio") || undefined}
                      aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
                      onClick={() => ir("proprio", "/hoje/tema-livre")}
                    >
                      {emAndamento("proprio") ? textosHoje.abrindo : textosHoje.escreverMeuAssunto}
                    </button>
                    <MotivoSemRede />
                  </div>

                  <div className={styles.proprio}>
                    <h4>{textosMomento.tituloFolha}</h4>
                    <p>{textosMomento.instrucaoAudio}</p>
                    <button
                      type="button"
                      className={styles.botaoSecundario}
                      disabled={semConexao}
                      aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
                      onClick={() => setFolhaMomentoAberta(true)}
                    >
                      {textosMomento.botaoAbrirHoje}
                    </button>
                    <MotivoSemRede />
                  </div>
                </div>
              </div>
            ) : (
              <div className={styles.blocoPorta}>
                <div className={styles.portaEscolhida}>
                  <CirclePlay size={20} strokeWidth={1.75} aria-hidden="true" />
                  <span>{textosHoje.portaStory}</span>
                  <button type="button" className={[styles.trocar, styles.portaEscolhidaBtn].join(" ")} onClick={fecharPorta}>
                    {textosHoje.trocar}
                  </button>
                </div>

                <div className={styles.duasCartas}>
                  <div className={styles.cartaoAcaoStory}>
                    <span className={styles.portaMarca} aria-hidden="true">
                      <Video size={24} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <div className={styles.tituloArea}>
                      <h3 className={styles.temaTitulo}>{textosMomento.tituloFolha}</h3>
                    </div>
                    <p className={styles.porque}>{textosMomento.instrucaoAudio}</p>
                    <div className={styles.acoes}>
                      <button
                        type="button"
                        className={styles.botaoPrimario}
                        disabled={semConexao}
                        aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
                        onClick={() => setFolhaMomentoAberta(true)}
                      >
                        {textosMomento.botaoAbrirHoje}
                      </button>
                    </div>
                    <MotivoSemRede />
                  </div>

                  <div className={styles.cartaoAcaoStory}>
                    <span className={styles.portaMarca} aria-hidden="true">
                      <CalendarDays size={24} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <div className={styles.tituloArea}>
                      <h3 className={styles.temaTitulo}>{textosPlano.botaoPlanejarDias}</h3>
                    </div>
                    <p className={styles.porque}>{textosHoje.planejarDiasDescricao}</p>
                    <div className={styles.acoes}>
                      <button
                        type="button"
                        className={styles.botaoSecundario}
                        disabled={semConexao}
                        aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
                        onClick={() => setFolhaPlanejarAberta(true)}
                      >
                        {textosPlano.botaoPlanejarDias}
                      </button>
                    </div>
                    <MotivoSemRede />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {folhaMomentoAberta ? (
        <FolhaGravarAgora
          aoFechar={fecharFolhaMomento}
          fecharENavegar={fecharFolhaMomentoENavegar}
          objetivoRecomendado={objetivoRecomendado}
          marcas={outrasMarcas}
          planoItemId={itemPlanoParaFolha?.id}
          formatoInicial={itemPlanoParaFolha ? undefined : (porta === "story" ? "story" : "reels") satisfies FormatoRoteiro}
          valoresIniciais={
            itemPlanoParaFolha
              ? ({
                  onde: itemPlanoParaFolha.lugar,
                  oQueEstaAcontecendo: itemPlanoParaFolha.situacao,
                  oQueDaParaMostrar: itemPlanoParaFolha.oQueMostrar,
                  objetivo: itemPlanoParaFolha.objetivo,
                  formato: itemPlanoParaFolha.formato,
                  marcaId: itemPlanoParaFolha.marcaId,
                } satisfies ValoresIniciaisMomento)
              : undefined
          }
        />
      ) : null}

      {folhaPlanejarAberta ? <FolhaPlanejarDias aoFechar={fecharFolhaPlanejar} /> : null}

      {folhaMeuPlanoAberta ? (
        <FolhaMeuPlano aoFechar={fecharFolhaMeuPlano} itens={planoQueVem} aoPlanejarDeNovo={planejarDeNovo} />
      ) : null}
    </div>
  );
}
