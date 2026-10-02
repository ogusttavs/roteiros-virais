"use client";

import { ArrowLeft, Check, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { ROTULO_TEMA_CARTAO } from "@/ia/enums";
import type { AgendaDoDia, DiaDaSemanaAgenda, ItemAgendaDoDia, ItemAtrasado } from "@/servicos/roteiro";
import { textosCriar } from "@/textos/criar";
import { textosHoje } from "@/textos/hoje";
import { textosNav } from "@/textos/nav";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import type { EvidenciaTema } from "@/ui/componentes/TemaCartao";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";

import { SeletorMarcaCelular, type MarcaResumo } from "../../_casca/SeletorMarcaCelular";
import { useTrocaMarca } from "../../_casca/TrocaMarcaContext";

import {
  arquivarAtrasadoAction,
  conferirAindaValeAction,
  mudarDataAtrasadoAction,
  type RespostaAindaVale,
} from "./agenda-acoes";
import { FolhaMudarDia } from "./FolhaMudarDia";
import { HojeCabecalho } from "./HojeCabecalho";
import styles from "./HojeTela.module.css";

export type AvisoBriefingAgenda = { nota: string; meta: string };
export type ProximoMarcado = { quando: string; rotuloFormato: string };

/** E39b, item (a): a situação do "ainda vale?" do Reels em destaque, já resolvida pelo servidor (a
 * formatação da evidência precisa do banco, não dá para fazer no cliente). `null` quando o Reels de
 * hoje não foi feito com antecedência (nada a perguntar). */
export type AindaValeAgenda =
  | { status: "naoConferido"; feitoHaDias: number; quando: string }
  | { status: "vale"; quando: string }
  | { status: "novo"; quando: string; assunto: string; evidencia: EvidenciaTema | null }
  | null;

type Props = {
  semana: DiaDaSemanaAgenda[];
  diaVisualizado: string;
  ehHoje: boolean;
  diaVisualizadoExtenso: string;
  agenda: AgendaDoDia;
  atrasados: ItemAtrasado[];
  aindaVale: AindaValeAgenda;
  proximoMarcado: ProximoMarcado | null;
  avisoBriefing: AvisoBriefingAgenda | null;
  avisoVideoSubindo: string | null;
  marcaAtiva: MarcaResumo;
  marcas: MarcaResumo[];
  nomePessoa: string;
};

/** Mesma palavra em `Criar` (dúvida 12): "o que a pessoa conta completa o rótulo", mas o rótulo em
 * si (Manhã, Meio do dia, Fim da tarde, Noite) é o mesmo texto nas duas telas. Exportado para
 * `MesTela.tsx` usar o mesmo rótulo na lista do dia selecionado. */
export const ROTULO_MOMENTO: Record<string, string> = {
  manha: textosCriar.manha,
  meio_dia: textosCriar.meioDia,
  fim_tarde: textosCriar.fimDaTarde,
  noite: textosCriar.noite,
};

/**
 * O rótulo de estado de um item (dúvida 5 e 8 da primeira entrega do passo 10): sempre uma
 * palavra escrita. Num dia que não é hoje, o que ainda não foi gravado diz "marcado" em vez de "a
 * gravar" (ainda não existe, só está reservado); gravado e postado dizem o que já aconteceu,
 * mesmo olhando para outro dia.
 */
/** Exportado para `MesTela.tsx` reusar o mesmo rótulo de estado na lista do dia selecionado. */
export function rotuloEstado(item: ItemAgendaDoDia, ehHoje: boolean): string {
  if (item.status === "gravado") return textosHoje.agenda.estadoReels.gravado;
  if (item.status === "postado") return textosHoje.agenda.estadoReels.postado;
  return ehHoje ? textosHoje.agenda.estadoReels.gerado : textosHoje.agenda.estadoOutroDia;
}

const FORMATAR_DIA_DA_SEMANA_COMPLETO = new Intl.DateTimeFormat("pt-BR", { weekday: "long" });

function diaDaSemanaCompleto(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const texto = FORMATAR_DIA_DA_SEMANA_COMPLETO.format(new Date(ano, mes - 1, dia, 12));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Exportado para `MesTela.tsx` (o dia selecionado do calendário usa o mesmo estado escrito). */
export function EstadoItem({ item, ehHoje }: { item: ItemAgendaDoDia; ehHoje: boolean }) {
  const feito = item.status === "gravado" || item.status === "postado";
  const marcado = !ehHoje && item.status === "gerado";
  return (
    <span className={[styles.estado, feito ? styles.estadoFeito : "", marcado ? styles.estadoMarcado : ""].filter(Boolean).join(" ")}>
      {feito ? <Check size={14} strokeWidth={1.75} aria-hidden="true" /> : null}
      {rotuloEstado(item, ehHoje)}
    </span>
  );
}

const FORMATAR_DATA_POR_EXTENSO_MINUSCULA = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/**
 * E39c, parte 1: as setas da semana somam ou subtraem 7 dias de `diaVisualizado`, sem limite
 * (não é a semana de hoje, é a mesma lógica de `mesAdjacente` em `MesTela.tsx`, cada tela com a
 * sua, nada de puxar `servicos/roteiro.ts` para um componente de cliente).
 */
function diaAdjacente(dataISO: string, deltaDias: number): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + deltaDias, 12)).toISOString().slice(0, 10);
}

/** E39b, item (b): "Era para ontem, domingo, 6 de setembro" quando a data é a de ontem; senão, sem "ontem". */
function eraParaTexto(dataISO: string, hoje: string): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const extenso = FORMATAR_DATA_POR_EXTENSO_MINUSCULA.format(new Date(Date.UTC(ano, mes - 1, dia, 12)));
  const diaSeguinte = new Date(Date.UTC(ano, mes - 1, dia + 1, 12)).toISOString().slice(0, 10);
  return diaSeguinte === hoje ? `ontem, ${extenso}` : extenso;
}

/**
 * E39b, item (b): um atrasado, com as ações certas por estado (`sozinho`: hoje está livre,
 * "Gravar hoje" aparece primeiro; senão, a linha explica por que não aparece). "Mudar o dia" abre
 * `FolhaMudarDia`; as três ações recarregam a Agenda ao terminar (`aoMudouAlgo`).
 */
function AtrasadoCard({
  item,
  sozinho,
  hoje,
  aoResolver,
  aoGravarHoje,
  aoMudouAlgo,
}: {
  item: ItemAtrasado;
  sozinho: boolean;
  hoje: string;
  /** Some da lista na hora, sem esperar o `router.refresh()` de `aoMudouAlgo` buscar a tela de novo a tempo. */
  aoResolver: () => void;
  /**
   * "Gravar hoje" (achado da revisão do Fable no PR #91: a CI flakou 1 de 257, o item demorava a
   * reaparecer em "Reels de hoje"): o item some do Atrasado e aparece em "Reels de hoje" na hora,
   * mesmo raciocínio do `AindaValeBloco`, sem esperar o `router.refresh()` de `aoMudouAlgo`.
   */
  aoGravarHoje: (item: ItemAtrasado) => void;
  aoMudouAlgo: () => void;
}) {
  const tratarFalha = useTratarFalha();
  const [ocupado, iniciarTransicao] = useTransition();
  const [chaveOcupada, setChaveOcupada] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [folhaMudarDiaAberta, setFolhaMudarDiaAberta] = useState(false);

  function executar(chave: string, tarefa: () => Promise<unknown>, aposSucesso?: () => void) {
    if (ocupado) return;
    setErro(null);
    setChaveOcupada(chave);
    iniciarTransicao(async () => {
      try {
        await tarefa();
        aoResolver();
        aposSucesso?.();
        aoMudouAlgo();
      } catch (falha) {
        setErro(tratarFalha(falha, textosHoje.agenda.atrasado.erroSalvar));
      }
    });
  }

  /** A folha tem o próprio "salvando"/erro (`FolhaMudarDia`); aqui só falta fechar ao terminar. */
  async function salvarNovaData(novaData: string) {
    await mudarDataAtrasadoAction(item.id, novaData);
    aoResolver();
    aoMudouAlgo();
    setFolhaMudarDiaAberta(false);
  }

  return (
    <article className={styles.itemAtrasado}>
      <span className={styles.quandoEra}>{textosHoje.agenda.atrasado.eraPara(eraParaTexto(item.data, hoje))}</span>
      <p className={styles.objetivoDoDia}>{ROTULO_TEMA_CARTAO[item.objetivo]}</p>
      <h3>{item.titulo}</h3>
      {erro ? (
        <p role="alert" className={styles.erroAgenda}>
          {erro}
        </p>
      ) : null}
      <div className={styles.acoesAtraso}>
        {sozinho ? (
          <button
            type="button"
            className={styles.botaoPrimario}
            disabled={ocupado}
            aria-busy={chaveOcupada === "gravar" && ocupado}
            onClick={() => executar("gravar", () => mudarDataAtrasadoAction(item.id, hoje), () => aoGravarHoje(item))}
          >
            {textosHoje.agenda.atrasado.gravarHoje}
          </button>
        ) : null}
        <button type="button" className={styles.botaoSecundarioSm} disabled={ocupado} onClick={() => setFolhaMudarDiaAberta(true)}>
          {textosHoje.agenda.atrasado.mudarODia}
        </button>
        <button
          type="button"
          className={styles.botaoBarra}
          disabled={ocupado}
          aria-busy={chaveOcupada === "arquivar" && ocupado}
          onClick={() => executar("arquivar", () => arquivarAtrasadoAction(item.id))}
        >
          {textosHoje.agenda.atrasado.arquivar}
        </button>
      </div>
      {!sozinho ? <p className={styles.porQueNao}>{textosHoje.agenda.atrasado.porQueNaoGravarHoje}</p> : null}
      {folhaMudarDiaAberta ? (
        <FolhaMudarDia aoFechar={() => setFolhaMudarDiaAberta(false)} dataInicial={hoje} aoSalvar={salvarNovaData} />
      ) : null}
    </article>
  );
}

/**
 * E39b, item (a): "ainda vale?", só no Reels em destaque feito com antecedência. "Conferir" chama
 * o servidor e recarrega a Agenda (`aoMudouAlgo`), para a tela sempre mostrar o que está guardado
 * no banco; "Manter o que eu tinha" só esconde a pergunta nesta visita, sem mudar nada no servidor.
 */
type ExibicaoAindaVale = { status: "vale" } | { status: "novo"; assunto: string; evidencia: EvidenciaTema | null };

/**
 * E39b, item (a): "Conferir" mostra a resposta na hora, a partir do que `conferirAindaValeAction`
 * devolveu, sem esperar `router.refresh()` buscar a tela de novo a tempo (achado desta etapa: sob
 * carga, o refresh podia terminar depois do que o teste esperava, embora o banco já estivesse
 * certo; `aoMudouAlgo` continua chamado, para a tela recarregada mais tarde já nascer certa).
 */
function AindaValeBloco({
  roteiroId,
  aindaVale,
  aoMudouAlgo,
}: {
  roteiroId: number;
  aindaVale: AindaValeAgenda;
  aoMudouAlgo: () => void;
}) {
  const router = useRouter();
  const tratarFalha = useTratarFalha();
  const [conferindo, iniciarConferencia] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [mantido, setMantido] = useState(false);
  const [respostaLocal, setRespostaLocal] = useState<RespostaAindaVale | null>(null);

  function conferir() {
    if (conferindo) return;
    setErro(null);
    iniciarConferencia(async () => {
      try {
        const resposta = await conferirAindaValeAction(roteiroId);
        setRespostaLocal(resposta);
        aoMudouAlgo();
      } catch (falha) {
        setErro(tratarFalha(falha, textosHoje.agenda.atrasado.erroSalvar));
      }
    });
  }

  if (!aindaVale || mantido) return null;
  const quando = aindaVale.quando;

  const exibicao: ExibicaoAindaVale | null = respostaLocal
    ? respostaLocal.vale
      ? { status: "vale" }
      : { status: "novo", assunto: respostaLocal.assunto, evidencia: respostaLocal.evidencia }
    : aindaVale.status === "vale"
      ? { status: "vale" }
      : aindaVale.status === "novo"
        ? { status: "novo", assunto: aindaVale.assunto, evidencia: aindaVale.evidencia }
        : null;

  if (!exibicao) {
    return (
      <div className={styles.aindaVale}>
        <span>
          {textosHoje.agenda.aindaVale.feitoHaDias(aindaVale.status === "naoConferido" ? aindaVale.feitoHaDias : 0)}{" "}
          <b>{textosHoje.agenda.aindaVale.pergunta}</b>
        </span>
        {erro ? (
          <p role="alert" className={styles.erroAgenda}>
            {erro}
          </p>
        ) : null}
        <button type="button" className={styles.botaoSecundarioSm} aria-busy={conferindo} disabled={conferindo} onClick={conferir}>
          {conferindo ? textosHoje.agenda.aindaVale.conferindo : textosHoje.agenda.aindaVale.conferir}
        </button>
      </div>
    );
  }

  if (exibicao.status === "vale") {
    return (
      <div className={[styles.respostaVale, styles.respostaValeOk].join(" ")} role="status">
        <Check size={20} strokeWidth={1.75} aria-hidden="true" />
        <div>
          <strong>{textosHoje.agenda.aindaVale.continuaValendo}</strong>
          <p>{textosHoje.agenda.aindaVale.continuaValendoDescricao(quando)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={[styles.respostaVale, styles.respostaValeNovo].join(" ")} role="status">
      <strong>{textosHoje.agenda.aindaVale.saiuAlgoMelhor}</strong>
      <p>{textosHoje.agenda.aindaVale.saiuAlgoMelhorDescricao(quando)}</p>
      {exibicao.evidencia ? (
        <div className={styles.evidencia}>
          {exibicao.evidencia.conta ? (
            <span className={styles.evidenciaLinha}>
              <span className={styles.conta}>{exibicao.evidencia.conta}</span>
            </span>
          ) : null}
          <span className={styles.evidenciaLinha}>
            <b>{exibicao.evidencia.multiplo}</b>{" "}
            {textosHoje.evidenciaMultiplo(exibicao.evidencia.rotulo, exibicao.evidencia.views, exibicao.evidencia.quando)}
          </span>
        </div>
      ) : null}
      <div className={styles.duasAcoes}>
        <button
          type="button"
          className={styles.botaoPrimario}
          onClick={() => router.push(`/criar/tema-livre?tema=${encodeURIComponent(exibicao.assunto)}`)}
        >
          {textosHoje.agenda.aindaVale.criarNovoSobreIsso}
        </button>
        <button type="button" className={styles.botaoSecundarioSm} onClick={() => setMantido(true)}>
          {textosHoje.agenda.aindaVale.manterOQueTinha}
        </button>
      </div>
    </div>
  );
}

/**
 * `/hoje` vira a agenda (E39a, design v2, `Hoje.dc.html`, estados `agenda`, `agendaVazia`,
 * `agendaOutroDia`, `agendaBriefingIncompleto`). Nada se cria aqui: "Criar roteiro" sempre leva
 * para `/criar`. Os estados da E39b (ainda vale, atrasado, calendário) ficam de fora, de
 * propósito: a tela não finge tê-los.
 */
export function HojeTela({
  semana,
  diaVisualizado,
  ehHoje,
  diaVisualizadoExtenso,
  agenda: agendaInicial,
  atrasados,
  aindaVale,
  proximoMarcado,
  avisoBriefing,
  avisoVideoSubindo,
  marcaAtiva,
  marcas,
  nomePessoa,
}: Props) {
  const router = useRouter();
  const { trocando, marcaAlvo } = useTrocaMarca();
  const { avisarFalhaDeRede } = useConexao();
  const [ocupado, iniciarTransicao] = useTransition();
  const [acao, setAcao] = useState<string | null>(null);
  const atualizando = ocupado && acao === "atualizar";

  function ir(chave: string, destino: string) {
    if (ocupado) return;
    setAcao(chave);
    iniciarTransicao(() => router.push(destino));
  }

  function atualizar() {
    if (ocupado) return;
    if (!navigator.onLine) {
      avisarFalhaDeRede();
      return;
    }
    setAcao("atualizar");
    iniciarTransicao(() => router.refresh());
  }

  /** E39b: depois de arquivar, mudar o dia ou conferir "ainda vale", a Agenda recarrega do banco
   * (o estado guardado é sempre a fonte da verdade); `agenda` abaixo é só para "Gravar hoje"
   * aparecer na hora em "Reels de hoje", sem esperar este `router.refresh()`. */
  function recarregarAgenda() {
    router.refresh();
  }

  /**
   * Revisão do Fable no PR #91 (achado de CI, 1 de 257): "Gravar hoje" só tirava o item do
   * Atrasado; "Reels de hoje" esperava o `router.refresh()` de `recarregarAgenda` buscar a tela de
   * novo, e sob carga isso corria o risco de não terminar a tempo (mesma classe de corrida já
   * corrigida para "ainda vale" e "arquivar"). `agenda` vira estado do cliente, com o mesmo
   * `useEffect` de resincronia que `CriarTela.tsx` usa para `planoDeHoje`: sem ele, o refresh de
   * fora (sem navegação, como o de `recarregarAgenda`) não reatualiza a tela se este componente
   * não desmontar.
   */
  const [agenda, setAgenda] = useState(agendaInicial);
  useEffect(() => {
    setAgenda(agendaInicial);
  }, [agendaInicial]);

  /** "Gravar hoje" só aparece quando hoje está livre (`sozinho`), então o Reels do dia vira só este item. */
  function moverParaReelsDeHoje(item: ItemAtrasado) {
    setAgenda((atual) => ({ ...atual, reels: [item] }));
  }

  const diaVazio = agenda.reels.length === 0 && agenda.stories.length === 0;

  /**
   * E39b: some da lista na hora que a ação do atrasado termina, sem esperar `router.refresh()`
   * buscar a tela de novo a tempo (mesmo raciocínio do `AindaValeBloco`). `router.refresh()`
   * continua rodando, para a tela recarregada mais tarde já nascer sem o item resolvido.
   */
  const [atrasadosResolvidos, setAtrasadosResolvidos] = useState<Set<number>>(new Set());
  const atrasadosVisiveis = atrasados.filter((item) => !atrasadosResolvidos.has(item.id));
  function marcarAtrasadoResolvido(id: number) {
    setAtrasadosResolvidos((atual) => new Set(atual).add(id));
  }

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
              <RefreshCw size={18} strokeWidth={1.75} aria-hidden="true" className={atualizando ? styles.girando : undefined} />
              {marcas.length <= 1 ? <span>{textosHoje.atualizar}</span> : null}
            </button>
          </>
        }
      />

      {trocando ? (
        <div className={styles.miolo}>
          <HojeCabecalho estado="trocando" mensagemTrocando={textosNav.abrindoMarca(marcaAlvo ?? "")} />
        </div>
      ) : (
        <div className={styles.miolo}>
          {ehHoje ? (
            <HojeCabecalho avisoVideoSubindo={avisoVideoSubindo} estado="normal" />
          ) : (
            <div className={styles.cabecalhoOutroDia}>
              <button type="button" className={styles.botaoVoltarHoje} onClick={() => ir("voltar-hoje", "/hoje")}>
                <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
                {textosHoje.agenda.voltarParaHoje}
              </button>
              <span className={styles.data}>{textosHoje.agenda.marcadoPara}</span>
              <h1>{diaVisualizadoExtenso}</h1>
            </div>
          )}

          {avisoBriefing ? (
            <section className={styles.avisoBriefing} aria-labelledby="t-aviso-briefing">
              <div>
                <h2 id="t-aviso-briefing">{textosHoje.agenda.briefingPodeRenderMais}</h2>
                <p>{textosHoje.agenda.briefingNotaEMeta(avisoBriefing.nota, avisoBriefing.meta)}</p>
              </div>
              <button type="button" className={styles.botaoSecundarioSm} onClick={() => ir("briefing", "/briefing")}>
                {textosHoje.agenda.abrirBriefing}
              </button>
            </section>
          ) : null}

          <section className={styles.semanaAgenda} aria-label={textosHoje.agenda.estaSemana}>
            <div className={styles.cabecaSemana}>
              <span className={styles.rotulo}>{textosHoje.agenda.estaSemana}</span>
              <div className={styles.acoesSemana}>
                <button
                  type="button"
                  className={styles.botaoBarra}
                  disabled={ocupado}
                  aria-label={textosHoje.agenda.semanaAnterior}
                  onClick={() => ir("semana-anterior", `/hoje?dia=${diaAdjacente(diaVisualizado, -7)}`)}
                >
                  <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={styles.botaoBarra}
                  disabled={ocupado}
                  aria-label={textosHoje.agenda.proximaSemana}
                  onClick={() => ir("proxima-semana", `/hoje?dia=${diaAdjacente(diaVisualizado, 7)}`)}
                >
                  <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
                </button>
                <button type="button" className={styles.botaoSecundarioSm} onClick={() => ir("mes", `/hoje/mes?dia=${diaVisualizado}`)}>
                  {textosHoje.agenda.calendario.verOMes}
                </button>
              </div>
            </div>
            <div className={styles.diasAgenda} role="group" aria-label="Os dias da semana">
              {semana.map((dia) => (
                <button
                  key={dia.data}
                  type="button"
                  disabled={ocupado}
                  aria-pressed={dia.data === diaVisualizado}
                  aria-label={textosHoje.agenda.diaAgendaRotulo(
                    diaDaSemanaCompleto(dia.data),
                    dia.diaDoMes,
                    dia.marca.qtdReels,
                    dia.marca.qtdStories,
                  )}
                  className={[styles.diaAgenda, dia.hoje ? styles.diaAgendaHoje : ""].filter(Boolean).join(" ")}
                  onClick={() => ir(`dia-${dia.data}`, dia.hoje ? "/hoje" : `/hoje?dia=${dia.data}`)}
                >
                  <span className={styles.nomeDia}>{dia.diaDaSemanaCurto}</span>
                  <span className={styles.numero}>{dia.diaDoMes}</span>
                  <span className={styles.marcas}>
                    {dia.marca.qtdReels > 0 ? <i className={styles.marcaReels} aria-hidden="true" /> : null}
                    {dia.marca.qtdReels > 1 ? <b className={styles.contaStory}>{dia.marca.qtdReels}</b> : null}
                    {dia.marca.qtdStories > 0 ? <i className={styles.marcaStory} aria-hidden="true" /> : null}
                    {dia.marca.qtdStories > 1 ? <b className={styles.contaStory}>{dia.marca.qtdStories}</b> : null}
                  </span>
                </button>
              ))}
            </div>
            <p className={styles.legendaMarcas}>
              <span>
                <i className={styles.marcaReels} aria-hidden="true" />
                {textosHoje.agenda.legendaReels}
              </span>
              <span>
                <i className={styles.marcaStory} aria-hidden="true" />
                {textosHoje.agenda.legendaStory}
              </span>
            </p>
          </section>

          {ehHoje && atrasadosVisiveis.length > 0 ? (
            <section className={styles.secaoDia} aria-labelledby="t-atrasado">
              <h2 id="t-atrasado">{textosHoje.agenda.atrasado.titulo}</h2>
              {atrasadosVisiveis.map((item) => (
                <AtrasadoCard
                  key={item.id}
                  item={item}
                  sozinho={diaVazio}
                  hoje={diaVisualizado}
                  aoResolver={() => marcarAtrasadoResolvido(item.id)}
                  aoGravarHoje={moverParaReelsDeHoje}
                  aoMudouAlgo={recarregarAgenda}
                />
              ))}
            </section>
          ) : null}

          {diaVazio && ehHoje && atrasadosVisiveis.length > 0 ? (
            <section className={styles.diaLivre}>
              <p>{textosHoje.agenda.atrasado.foraOAtrasadoNadaMarcado}</p>
              <button type="button" className={styles.botaoSecundarioSm} onClick={() => ir("criar", `/criar?data=${diaVisualizado}`)}>
                {textosHoje.agenda.criarRoteiro}
              </button>
            </section>
          ) : diaVazio ? (
            <section className={styles.diaLivre}>
              <h3>{ehHoje ? textosHoje.agenda.nadaMarcadoTitulo : textosHoje.agenda.nadaMarcadoOutroDiaTitulo}</h3>
              <p>
                {ehHoje ? textosHoje.agenda.nadaMarcado : textosHoje.agenda.nadaMarcadoOutroDia}
                {ehHoje && proximoMarcado
                  ? ` ${textosHoje.agenda.proximoMarcado(proximoMarcado.quando, proximoMarcado.rotuloFormato)}`
                  : ""}
              </p>
              <button
                type="button"
                className={styles.botaoPrimario}
                onClick={() => ir("criar", `/criar?data=${diaVisualizado}`)}
              >
                {textosHoje.agenda.criarRoteiro}
              </button>
            </section>
          ) : (
            <div className={styles.diaColunas}>
              <section className={styles.secaoDia} aria-labelledby="t-reels">
                <h2 id="t-reels">{ehHoje ? textosHoje.agenda.reels.hoje : textosHoje.agenda.reels.outroDia}</h2>
                {agenda.reels.length > 0 ? (
                  <>
                    <article className={styles.reelsDia}>
                      <div className={styles.linhaTopo}>
                        <span className={styles.objetivoDoDia}>
                          {ROTULO_TEMA_CARTAO[agenda.reels[0].objetivo]} · {agenda.reels[0].duracaoS} segundos
                        </span>
                        <EstadoItem item={agenda.reels[0]} ehHoje={ehHoje} />
                      </div>
                      <h3>{agenda.reels[0].titulo}</h3>
                      {ehHoje ? (
                        <AindaValeBloco roteiroId={agenda.reels[0].id} aindaVale={aindaVale} aoMudouAlgo={recarregarAgenda} />
                      ) : null}
                      <button
                        type="button"
                        className={styles.botaoPrimario}
                        aria-busy={acao === `item-${agenda.reels[0].id}` || undefined}
                        onClick={() => ir(`item-${agenda.reels[0].id}`, `/roteiros/${agenda.reels[0].id}`)}
                      >
                        {textosHoje.agenda.abrirRoteiro}
                      </button>
                    </article>
                    {agenda.reels.length > 1 ? (
                      <div className={styles.listaAgendaCartao}>
                        <ol className={styles.listaAgenda}>
                          {agenda.reels.slice(1).map((item) => (
                            <li key={item.id}>
                              <button
                                type="button"
                                className={styles.itemAgenda}
                                aria-busy={acao === `item-${item.id}` || undefined}
                                onClick={() => ir(`item-${item.id}`, `/roteiros/${item.id}`)}
                              >
                                <span className={styles.momento}>{ROTULO_TEMA_CARTAO[item.objetivo]}</span>
                                <span className={styles.tituloItem}>{item.titulo}</span>
                                <EstadoItem item={item} ehHoje={ehHoje} />
                                <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
                              </button>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className={styles.semItemNaColuna}>{textosHoje.agenda.semNadaNaColuna}</p>
                )}
              </section>

              <section className={styles.secaoDia} aria-labelledby="t-stories">
                <h2 id="t-stories">{ehHoje ? textosHoje.agenda.stories.hoje : textosHoje.agenda.stories.outroDia}</h2>
                {agenda.stories.length > 0 ? (
                  <div className={styles.listaAgendaCartao}>
                    <ol className={styles.listaAgenda}>
                      {agenda.stories.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            className={styles.itemAgenda}
                            aria-busy={acao === `item-${item.id}` || undefined}
                            onClick={() => ir(`item-${item.id}`, `/roteiros/${item.id}`)}
                          >
                            <span className={styles.momento}>
                              {item.momentoDoDia ? (ROTULO_MOMENTO[item.momentoDoDia] ?? item.momentoDoDia) : ""}
                            </span>
                            <span className={styles.tituloItem}>{item.titulo}</span>
                            <EstadoItem item={item} ehHoje={ehHoje} />
                            <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <p className={styles.semItemNaColuna}>{textosHoje.agenda.semNadaNaColuna}</p>
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
