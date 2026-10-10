"use client";

import { Mic, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { rotuloParaQue } from "@/config/fichas";
import type { CartaoEmAlta as DadosEmAlta } from "@/servicos/em-alta";
import type { AgendaDoDia, DiaDaSemanaAgenda, ItemAtrasado } from "@/servicos/roteiro";
import { textosHoje } from "@/textos/hoje";
import { textosPlano } from "@/textos/plano";
import { CartaoEmAlta, destinoDoCartao } from "@/ui/componentes/CartaoEmAlta";

import {
  AindaValeBloco,
  AtrasadoCard,
  EstadoItem,
  ROTULO_MOMENTO,
  type AindaValeAgenda,
  type AvisoBriefingAgenda,
  type ProximoMarcado,
} from "../hoje/HojeTela";
import styles from "../hoje/HojeTela.module.css";
import { MenuAcoesAgenda } from "../hoje/MenuAcoesAgenda";
import { useDesfazerArquivar } from "../hoje/useDesfazerArquivar";

import { useAbrirContarAgenda } from "./PlanejadorShell";

export type { AindaValeAgenda, AvisoBriefingAgenda, ProximoMarcado };

type Props = {
  semana: DiaDaSemanaAgenda[];
  diaVisualizado: string;
  ehHoje: boolean;
  agenda: AgendaDoDia;
  atrasados: ItemAtrasado[];
  aindaVale: AindaValeAgenda;
  proximoMarcado: ProximoMarcado | null;
  avisoBriefing: AvisoBriefingAgenda | null;
  avisoVideoSubindo: string | null;
  /** E55 PR 2: o mesmo cartão "Em alta hoje" da aba Hoje (só em hoje). */
  emAlta: DadosEmAlta | null;
};

const FORMATAR_DIA_DA_SEMANA_COMPLETO = new Intl.DateTimeFormat("pt-BR", { weekday: "long" });

function diaDaSemanaCompleto(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const texto = FORMATAR_DIA_DA_SEMANA_COMPLETO.format(new Date(ano, mes - 1, dia, 12));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * A visão Dia do planejador (passo 12 do Opus, `/planejamento`, aba própria desde a decisão do
 * Gustavo de 01/10, 22:15; era a aba Hoje inteira na E39a/E39b). Só o miolo da visão:
 * `PlanejadorShell.tsx` tem `BarraTopo` e `CabecaPlano`, uma vez só para as três visões.
 * `AtrasadoCard`/`AindaValeBloco`/`EstadoItem` vêm de `../hoje/HojeTela`, que já tem a mesma
 * lógica para a aba Hoje ("as peças são as mesmas, muda a casa"). Nada se cria aqui: "Criar
 * roteiro" sempre leva para `/criar`.
 */
export function DiaConteudo({
  semana,
  diaVisualizado,
  ehHoje,
  agenda: agendaInicial,
  atrasados,
  aindaVale,
  proximoMarcado,
  avisoBriefing,
  avisoVideoSubindo,
  emAlta,
}: Props) {
  const router = useRouter();
  const aoAbrirContarAgenda = useAbrirContarAgenda();
  const [ocupado, iniciarTransicao] = useTransition();
  const [acao, setAcao] = useState<string | null>(null);
  const { arquivar: arquivarComDesfazer, toast: toastArquivar } = useDesfazerArquivar();

  function ir(chave: string, destino: string) {
    if (ocupado) return;
    setAcao(chave);
    iniciarTransicao(() => router.push(destino));
  }

  /** Mesmo raciocínio de `HojeTela.tsx`: `agenda` vira estado do cliente, para "Gravar hoje"
   * aparecer na hora em "Reels de hoje", sem esperar o `router.refresh()` de fundo. */
  function recarregarAgenda() {
    router.refresh();
  }

  const [agenda, setAgenda] = useState(agendaInicial);
  useEffect(() => {
    setAgenda(agendaInicial);
  }, [agendaInicial]);

  function moverParaReelsDeHoje(item: ItemAtrasado) {
    setAgenda((atual) => ({ ...atual, reels: [item] }));
  }

  const diaVazio = agenda.reels.length === 0 && agenda.stories.length === 0 && !emAlta?.roteiro;

  const [atrasadosResolvidos, setAtrasadosResolvidos] = useState<Set<number>>(new Set());
  const atrasadosVisiveis = atrasados.filter((item) => !atrasadosResolvidos.has(item.id));
  function marcarAtrasadoResolvido(id: number) {
    setAtrasadosResolvidos((atual) => new Set(atual).add(id));
  }

  return (
    <>
      {ehHoje && avisoVideoSubindo ? <p className={styles.avisoVideo}>{avisoVideoSubindo}</p> : null}

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

      <section className={styles.semanaAgenda} aria-label={textosHoje.agenda.proximosDias}>
        <div className={styles.diasAgenda} role="group" aria-label="Os próximos 7 dias">
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
              onClick={() => ir(`dia-${dia.data}`, dia.hoje ? "/planejamento?visao=dia" : `/planejamento?visao=dia&dia=${dia.data}`)}
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

      {ehHoje && emAlta ? (
        <section className={styles.secaoDia} aria-labelledby="t-em-alta">
          <h2 id="t-em-alta">{textosHoje.emAlta.titulo}</h2>
          <CartaoEmAlta
            cartao={emAlta}
            destaque={diaVazio && !emAlta.roteiro && atrasadosVisiveis.length === 0 ? "principal" : "secundario"}
            ocupado={ocupado && acao === "em-alta"}
            aoClicar={() => ir("em-alta", destinoDoCartao(emAlta))}
            estado={emAlta.roteiro ? textosHoje.agenda.estadoReels[emAlta.roteiro.status] : undefined}
            menu={
              emAlta.roteiro ? (
                <MenuAcoesAgenda
                  roteiroId={emAlta.roteiro.id}
                  titulo={emAlta.tema.titulo}
                  data={diaVisualizado}
                  aoArquivar={arquivarComDesfazer}
                  doMomento
                />
              ) : undefined
            }
          />
        </section>
      ) : null}

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
            {ehHoje && proximoMarcado ? ` ${textosHoje.agenda.proximoMarcado(proximoMarcado.quando, proximoMarcado.rotuloFormato)}` : ""}
          </p>
          <button type="button" className={styles.botaoPrimario} onClick={() => ir("criar", `/criar?data=${diaVisualizado}`)}>
            {textosHoje.agenda.criarRoteiro}
          </button>
        </section>
      ) : (
        <div className={styles.diaColunas}>
          {/* O Reels do dia que está dentro do cartão "Em alta hoje" não deixa a coluna dizer "Nada marcado" logo abaixo dele. */}
          {agenda.reels.length === 0 && emAlta?.roteiro ? null : (
          <section className={styles.secaoDia} aria-labelledby="t-reels">
            <h2 id="t-reels">{ehHoje ? textosHoje.agenda.reels.hoje : textosHoje.agenda.reels.outroDia}</h2>
            {agenda.reels.length > 0 ? (
              <>
                <article className={styles.reelsDia}>
                  <div className={styles.linhaTopo}>
                    <span className={styles.objetivoDoDia}>
                      {rotuloParaQue(agenda.reels[0])} · {agenda.reels[0].duracaoS} segundos
                    </span>
                    <EstadoItem item={agenda.reels[0]} ehHoje={ehHoje} />
                  </div>
                  <h3>{agenda.reels[0].titulo}</h3>
                  {ehHoje ? <AindaValeBloco roteiroId={agenda.reels[0].id} aindaVale={aindaVale} aoMudouAlgo={recarregarAgenda} /> : null}
                  <div className={styles.acoesDestaque}>
                    <button
                      type="button"
                      className={styles.botaoPrimario}
                      aria-busy={acao === `item-${agenda.reels[0].id}` || undefined}
                      onClick={() => ir(`item-${agenda.reels[0].id}`, `/roteiros/${agenda.reels[0].id}`)}
                    >
                      {textosHoje.agenda.abrirRoteiro}
                    </button>
                    <MenuAcoesAgenda
                      roteiroId={agenda.reels[0].id}
                      titulo={agenda.reels[0].titulo}
                      data={diaVisualizado}
                      variante="destaque"
                      aoArquivar={arquivarComDesfazer}
                      doMomento={agenda.reels[0].doMomento}
                    />
                  </div>
                </article>
                {agenda.reels.length > 1 ? (
                  <div className={styles.listaAgendaCartao}>
                    <ol className={styles.listaAgenda}>
                      {agenda.reels.slice(1).map((item) => (
                        <li key={item.id} className={styles.linhaComMenu}>
                          <button
                            type="button"
                            className={styles.itemAgenda}
                            aria-busy={acao === `item-${item.id}` || undefined}
                            onClick={() => ir(`item-${item.id}`, `/roteiros/${item.id}`)}
                          >
                            <span className={styles.momento}>{rotuloParaQue(item)}</span>
                            <span className={styles.tituloItem}>{item.titulo}</span>
                            <EstadoItem item={item} ehHoje={ehHoje} />
                          </button>
                          <MenuAcoesAgenda roteiroId={item.id} titulo={item.titulo} data={diaVisualizado} aoArquivar={arquivarComDesfazer} doMomento={item.doMomento} />
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
          )}

          <section className={styles.secaoDia} aria-labelledby="t-stories">
            <h2 id="t-stories">{ehHoje ? textosHoje.agenda.stories.hoje : textosHoje.agenda.stories.outroDia}</h2>
            {agenda.stories.length > 0 ? (
              <div className={styles.listaAgendaCartao}>
                <ol className={styles.listaAgenda}>
                  {agenda.stories.map((item) => (
                    <li key={item.id} className={styles.linhaComMenu}>
                      <button
                        type="button"
                        className={styles.itemAgenda}
                        aria-busy={acao === `item-${item.id}` || undefined}
                        onClick={() => ir(`item-${item.id}`, `/roteiros/${item.id}`)}
                      >
                        <span className={styles.momento}>{item.momentoDoDia ? (ROTULO_MOMENTO[item.momentoDoDia] ?? item.momentoDoDia) : ""}</span>
                        <span className={styles.tituloItem}>{item.titulo}</span>
                        <EstadoItem item={item} ehHoje={ehHoje} />
                      </button>
                      <MenuAcoesAgenda roteiroId={item.id} titulo={item.titulo} data={diaVisualizado} aoArquivar={arquivarComDesfazer} doMomento={item.doMomento} />
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

      {!diaVazio ? (
        <div className={styles.pePlano}>
          <button type="button" className={styles.botaoSecundarioSm} onClick={() => ir("criar", `/criar?data=${diaVisualizado}`)}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            {textosHoje.agenda.planejador.criarRoteiroParaEsteDia}
          </button>
          <button type="button" className={[styles.botaoTexto, styles.soCelular].join(" ")} onClick={aoAbrirContarAgenda}>
            <Mic size={16} strokeWidth={1.75} aria-hidden="true" />
            {textosPlano.botaoContarAgenda}
          </button>
        </div>
      ) : (
        <div className={[styles.pePlano, styles.soCelular].join(" ")}>
          <button type="button" className={styles.botaoTexto} onClick={aoAbrirContarAgenda}>
            <Mic size={16} strokeWidth={1.75} aria-hidden="true" />
            {textosPlano.botaoContarAgenda}
          </button>
        </div>
      )}
      {toastArquivar}
    </>
  );
}
