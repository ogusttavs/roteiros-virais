"use client";

import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { AgendaDoDia, DiaDoMes } from "@/servicos/roteiro";
import { textosHoje } from "@/textos/hoje";
import { textosPlano } from "@/textos/plano";
import { BarraTopo } from "@/ui/componentes/BarraTopo";

import { SeletorMarcaCelular, type MarcaResumo } from "../../../_casca/SeletorMarcaCelular";
import { FolhaPlanejarDias } from "../FolhaPlanejarDias";
import { EstadoItem, ROTULO_MOMENTO } from "../HojeTela";
import hojeStyles from "../HojeTela.module.css";

import styles from "./MesTela.module.css";

type Props = {
  anoMes: string;
  dias: DiaDoMes[];
  diaSelecionado: string;
  agendaDoDiaSelecionado: AgendaDoDia;
  hoje: string;
  marcaAtiva: MarcaResumo;
  marcas: MarcaResumo[];
  nomePessoa: string;
};

const DIAS_DA_SEMANA_CURTO = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

const FORMATAR_MES = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
function tituloMes(anoMes: string): string {
  const [ano, mes] = anoMes.split("-").map(Number);
  const texto = FORMATAR_MES.format(new Date(Date.UTC(ano, mes - 1, 1, 12)));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function mesAdjacente(anoMes: string, delta: number): string {
  const [ano, mes] = anoMes.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1 + delta, 1, 12));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;
}

const FORMATAR_DIA_MES_EXTENSO = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });
function diaMesExtensoMinusculo(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return FORMATAR_DIA_MES_EXTENSO.format(new Date(Date.UTC(ano, mes - 1, dia, 12)));
}
function diaMesExtenso(dataISO: string): string {
  const texto = diaMesExtensoMinusculo(dataISO);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * `/hoje/mes` (E39b, item e): o calendário do mês, desenho do Opus (passo 10, `Hoje.dc.html`,
 * estado `calendario`). A grade vem pronta do servidor (`mesDaAgenda`); tocar num dia navega para
 * `?dia=`, que recarrega a tela com a agenda daquele dia pronta embaixo (mesmo padrão do `/hoje`
 * com `?dia=`, só que aqui o mês inteiro continua visível).
 */
export function MesTela({ anoMes, dias, diaSelecionado, agendaDoDiaSelecionado, hoje, marcaAtiva, marcas, nomePessoa }: Props) {
  const router = useRouter();
  const [ocupado, iniciarTransicao] = useTransition();
  const [folhaPlanejarAberta, setFolhaPlanejarAberta] = useState(false);

  function ir(destino: string) {
    if (ocupado) return;
    iniciarTransicao(() => router.push(destino));
  }

  const ehHojeSelecionado = diaSelecionado === hoje;
  const itensDoDiaSelecionado = [
    ...agendaDoDiaSelecionado.reels.map((item) => ({ item, momento: textosHoje.agenda.legendaReels })),
    ...agendaDoDiaSelecionado.stories.map((item) => ({
      item,
      momento: item.momentoDoDia ? (ROTULO_MOMENTO[item.momentoDoDia] ?? item.momentoDoDia) : "",
    })),
  ];

  return (
    <div className={hojeStyles.pagina}>
      <BarraTopo
        titulo={textosHoje.agenda.calendario.verOMes}
        direita={<SeletorMarcaCelular marcaAtiva={marcaAtiva} marcas={marcas} nomePessoa={nomePessoa} />}
      />

      <div className={hojeStyles.miolo}>
        <div className={styles.agendaMes}>
          <div className={styles.colunaMes}>
            <div className={hojeStyles.cabecalhoOutroDia}>
              <button type="button" className={hojeStyles.botaoVoltarHoje} disabled={ocupado} onClick={() => ir("/hoje")}>
                <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
                {textosHoje.agenda.voltarParaHoje}
              </button>
            </div>
            <div className={styles.cabecaMes}>
              <h1>{tituloMes(anoMes)}</h1>
              <button
                type="button"
                className={hojeStyles.botaoBarra}
                disabled={ocupado}
                aria-label={textosHoje.agenda.calendario.mesAnterior}
                onClick={() => ir(`/hoje/mes?mes=${mesAdjacente(anoMes, -1)}`)}
              >
                <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={hojeStyles.botaoBarra}
                disabled={ocupado}
                aria-label={textosHoje.agenda.calendario.proximoMes}
                onClick={() => ir(`/hoje/mes?mes=${mesAdjacente(anoMes, 1)}`)}
              >
                <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>

            <section className={[hojeStyles.semanaAgenda, styles.cartaoMes].join(" ")} aria-label={tituloMes(anoMes)}>
              <div className={styles.gradeMes} role="group" aria-label={`Os dias de ${tituloMes(anoMes)}`}>
                {DIAS_DA_SEMANA_CURTO.map((nome) => (
                  <span key={nome} className={styles.nomeSemana}>
                    {nome}
                  </span>
                ))}
                {dias.map((dia) => (
                  <button
                    key={dia.data}
                    type="button"
                    disabled={ocupado}
                    aria-pressed={dia.data === diaSelecionado}
                    aria-label={textosHoje.agenda.calendario.diaMesRotulo(
                      diaMesExtenso(dia.data),
                      dia.marca.qtdReels,
                      dia.marca.qtdStories,
                      dia.atrasado,
                    )}
                    className={[
                      styles.diaMes,
                      dia.foraDoMes ? styles.diaMesFora : "",
                      dia.passado ? styles.diaMesPassado : "",
                      dia.atrasado ? styles.diaMesAtrasado : "",
                      dia.hoje ? styles.diaMesHoje : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => ir(`/hoje/mes?mes=${anoMes}&dia=${dia.data}`)}
                  >
                    {dia.diaDoMes}
                    <span className={hojeStyles.marcas}>
                      {dia.marca.qtdReels > 0 ? <i className={hojeStyles.marcaReels} aria-hidden="true" /> : null}
                      {dia.marca.qtdReels > 1 ? <b className={hojeStyles.contaStory}>{dia.marca.qtdReels}</b> : null}
                      {dia.marca.qtdStories > 0 ? <i className={hojeStyles.marcaStory} aria-hidden="true" /> : null}
                      {dia.marca.qtdStories > 1 ? <b className={hojeStyles.contaStory}>{dia.marca.qtdStories}</b> : null}
                    </span>
                  </button>
                ))}
              </div>
              <p className={hojeStyles.legendaMarcas}>
                <span>
                  <i className={hojeStyles.marcaReels} aria-hidden="true" />
                  {textosHoje.agenda.legendaReels}
                </span>
                <span>
                  <i className={hojeStyles.marcaStory} aria-hidden="true" />
                  {textosHoje.agenda.legendaStory}
                </span>
                <span>
                  <i className={styles.legendaAtrasado} aria-hidden="true" />
                  {textosHoje.agenda.calendario.legendaAtrasado}
                </span>
              </p>
              <div className={styles.peMes}>
                <p>{textosHoje.agenda.calendario.aviso}</p>
                <button type="button" className={hojeStyles.botaoSecundarioSm} onClick={() => setFolhaPlanejarAberta(true)}>
                  {textosPlano.botaoPlanejarDias}
                </button>
              </div>
            </section>
          </div>

          <section className={hojeStyles.secaoDia} aria-labelledby="t-dia-mes">
            <h2 id="t-dia-mes">
              {ehHojeSelecionado
                ? textosHoje.agenda.calendario.hoje(diaMesExtensoMinusculo(diaSelecionado))
                : diaMesExtenso(diaSelecionado)}
            </h2>
            {itensDoDiaSelecionado.length > 0 ? (
              <div className={hojeStyles.listaAgendaCartao}>
                <ol className={hojeStyles.listaAgenda}>
                  {itensDoDiaSelecionado.map(({ item, momento }) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={hojeStyles.itemAgenda}
                        disabled={ocupado}
                        onClick={() => ir(`/roteiros/${item.id}`)}
                      >
                        <span className={hojeStyles.momento}>{momento}</span>
                        <span className={hojeStyles.tituloItem}>{item.titulo}</span>
                        <EstadoItem item={item} ehHoje={ehHojeSelecionado} />
                        <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <p className={hojeStyles.semItemNaColuna}>{textosHoje.agenda.semNadaNaColuna}</p>
            )}
          </section>
        </div>
      </div>

      {folhaPlanejarAberta ? <FolhaPlanejarDias aoFechar={() => setFolhaPlanejarAberta(false)} /> : null}
    </div>
  );
}
