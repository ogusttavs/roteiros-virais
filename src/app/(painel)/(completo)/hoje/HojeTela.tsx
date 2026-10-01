"use client";

import { ArrowLeft, Check, ChevronRight, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ROTULO_TEMA_CARTAO } from "@/ia/enums";
import type { AgendaDoDia, DiaDaSemanaAgenda, ItemAgendaDoDia } from "@/servicos/roteiro";
import { textosCriar } from "@/textos/criar";
import { textosHoje } from "@/textos/hoje";
import { textosNav } from "@/textos/nav";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { useConexao } from "@/ui/ConexaoContext";

import { SeletorMarcaCelular, type MarcaResumo } from "../../_casca/SeletorMarcaCelular";
import { useTrocaMarca } from "../../_casca/TrocaMarcaContext";

import { HojeCabecalho } from "./HojeCabecalho";
import styles from "./HojeTela.module.css";

export type AvisoBriefingAgenda = { nota: string; meta: string };
export type ProximoMarcado = { quando: string; rotuloFormato: string };

type Props = {
  semana: DiaDaSemanaAgenda[];
  diaVisualizado: string;
  ehHoje: boolean;
  diaVisualizadoExtenso: string;
  agenda: AgendaDoDia;
  proximoMarcado: ProximoMarcado | null;
  avisoBriefing: AvisoBriefingAgenda | null;
  avisoVideoSubindo: string | null;
  marcaAtiva: MarcaResumo;
  marcas: MarcaResumo[];
  nomePessoa: string;
};

/** Mesma palavra em `Criar` (dúvida 12): "o que a pessoa conta completa o rótulo", mas o rótulo em
 * si (Manhã, Meio do dia, Fim da tarde, Noite) é o mesmo texto nas duas telas. */
const ROTULO_MOMENTO: Record<string, string> = {
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
function rotuloEstado(item: ItemAgendaDoDia, ehHoje: boolean): string {
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

function EstadoItem({ item, ehHoje }: { item: ItemAgendaDoDia; ehHoje: boolean }) {
  const feito = item.status === "gravado" || item.status === "postado";
  const marcado = !ehHoje && item.status === "gerado";
  return (
    <span className={[styles.estado, feito ? styles.estadoFeito : "", marcado ? styles.estadoMarcado : ""].filter(Boolean).join(" ")}>
      {feito ? <Check size={14} strokeWidth={1.75} aria-hidden="true" /> : null}
      {rotuloEstado(item, ehHoje)}
    </span>
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
  agenda,
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

  const diaVazio = agenda.reels.length === 0 && agenda.stories.length === 0;

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

          {diaVazio ? (
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
