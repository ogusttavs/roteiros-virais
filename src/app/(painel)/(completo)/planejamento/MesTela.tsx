"use client";

import { ChevronRight, Mic, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { ROTULO_TEMA_CARTAO } from "@/ia/enums";
import type { ItemPlano } from "@/servicos/plano";
import type { AgendaDoDia, DiaDoMes } from "@/servicos/roteiro";
import { textosHoje } from "@/textos/hoje";
import { textosPlano } from "@/textos/plano";

import { EstadoItem, ROTULO_MOMENTO } from "../hoje/HojeTela";
import hojeStyles from "../hoje/HojeTela.module.css";

import styles from "./MesTela.module.css";
import { useAbrirContarAgenda } from "./PlanejadorShell";


type Props = {
  anoMes: string;
  dias: DiaDoMes[];
  diaSelecionado: string;
  agendaDoDiaSelecionado: AgendaDoDia;
  /** O que "Contar a minha agenda" gerou para este dia e ainda não virou roteiro. */
  planoSugeridoDoDia: ItemPlano[];
  hoje: string;
  /** O dia marcado mais perto, quando o dia selecionado está vazio (dúvida 12: "O mais perto marcado é..."). */
  proximoMarcado: { quando: string; rotuloFormato: string } | null;
};

const DIAS_DA_SEMANA_CURTO = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

const FORMATAR_MES = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
function tituloMes(anoMes: string): string {
  const [ano, mes] = anoMes.split("-").map(Number);
  const texto = FORMATAR_MES.format(new Date(Date.UTC(ano, mes - 1, 1, 12)));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
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
 * A visão Mês do planejador (passo 12 do Opus; era `/hoje/mes` inteira na E39b, aba própria desde
 * a decisão do Gustavo de 01/10, 22:15). Só o miolo da visão: `PlanejadorShell.tsx` tem `BarraTopo`
 * e `CabecaPlano` (o título do mês e as setas moram lá agora). Tocar num dia navega para `?dia=`.
 */
export function MesConteudo({
  anoMes,
  dias,
  diaSelecionado,
  agendaDoDiaSelecionado,
  planoSugeridoDoDia,
  hoje,
  proximoMarcado,
}: Props) {
  const router = useRouter();
  const aoAbrirContarAgenda = useAbrirContarAgenda();
  const [ocupado, iniciarTransicao] = useTransition();

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
  const diaVazio = itensDoDiaSelecionado.length === 0;

  return (
    <div className={styles.agendaMes}>
      <div className={styles.colunaMes}>
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
                onClick={() => ir(`/planejamento?visao=mes&mes=${anoMes}&dia=${dia.data}`)}
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
            <button type="button" className={[hojeStyles.botaoTexto, hojeStyles.soCelular].join(" ")} onClick={aoAbrirContarAgenda}>
              <Mic size={16} strokeWidth={1.75} aria-hidden="true" />
              {textosPlano.botaoContarAgenda}
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
        {planoSugeridoDoDia.length > 0 ? (
          <div className={styles.planoDoDia}>
            {planoSugeridoDoDia.map((item) => (
              <div key={item.id} className={styles.itemPlanoMes}>
                <div className={styles.itemPlanoCabecalho}>
                  <span className={styles.itemPlanoLugar}>{item.lugar.trim() || textosPlano.semLugar}</span>
                  <span className={styles.itemPlanoEstado}>{textosPlano.rotuloPlanejado}</span>
                </div>
                <p className={styles.itemPlanoSituacao}>{item.situacao}</p>
                <span className={styles.itemPlanoObjetivo}>{ROTULO_TEMA_CARTAO[item.objetivo]}</span>
              </div>
            ))}
          </div>
        ) : null}
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
          <div className={styles.diaMesVazio}>
            <h3>{textosHoje.agenda.planejador.nadaMarcadoNesteDiaTitulo}</h3>
            {proximoMarcado ? (
              <p>{textosHoje.agenda.planejador.proximoMarcadoCurto(proximoMarcado.quando, proximoMarcado.rotuloFormato)}</p>
            ) : null}
          </div>
        )}
        <div className={hojeStyles.pePlano}>
          <button type="button" className={hojeStyles.botaoSecundarioSm} disabled={ocupado} onClick={() => ir(`/criar?data=${diaSelecionado}`)}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            {diaVazio ? textosHoje.agenda.planejador.criarRoteiro : textosHoje.agenda.planejador.criarRoteiroParaEsteDia}
          </button>
        </div>
      </section>
    </div>
  );
}
