"use client";

import { ChevronRight, Mic, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { rotuloParaQue } from "@/config/fichas";
import type { ItemPlano } from "@/servicos/plano";
import type { AgendaDoDia, DiaDoMes } from "@/servicos/roteiro";
import { textosHoje } from "@/textos/hoje";
import { textosPlano } from "@/textos/plano";
import { ConfirmarMoverDia } from "@/ui/componentes/ConfirmarMoverDia";

import { EstadoItem, ROTULO_MOMENTO } from "../hoje/HojeTela";
import hojeStyles from "../hoje/HojeTela.module.css";
import { MenuAcoesAgenda } from "../hoje/MenuAcoesAgenda";
import { useDesfazerArquivar } from "../hoje/useDesfazerArquivar";

import styles from "./MesTela.module.css";
import { useAbrirContarAgenda } from "./PlanejadorShell";
import { useMoverDeDia } from "./useMoverDeDia";


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
 * Mesma regra do arrasto, para o "Não vou gravar hoje" do menu nunca divergir dele: a grade do
 * mês cobre bem mais dias que a Semana (o mês inteiro à vista), mas uma data fora dela, digitada
 * à mão no campo de "escolher a data", ainda salva sem perguntar (mesmo limite da Semana).
 */
function perguntaSeConflitoMes(dias: DiaDoMes[], tipo: "reels" | "story", titulo: string, novaData: string): string | null {
  const diaAlvo = dias.find((d) => d.data === novaData);
  if (!diaAlvo) return null;
  const temConflito = tipo === "reels" ? diaAlvo.marca.qtdReels > 0 : diaAlvo.marca.qtdStories > 0;
  if (!temConflito) return null;
  return textosHoje.agenda.planejador.confirmarMoverPergunta(
    titulo,
    diaMesExtenso(novaData),
    tipo === "reels" ? textosHoje.agenda.legendaReels : textosHoje.agenda.legendaStory,
  );
}

/**
 * A visão Mês do planejador (passo 12 do Opus; era `/hoje/mes` inteira na E39b, aba própria desde
 * a decisão do Gustavo de 01/10, 22:15). Só o miolo da visão: `PlanejadorShell.tsx` tem `BarraTopo`
 * e `CabecaPlano` (o título do mês e as setas moram lá agora). Tocar num dia navega para `?dia=`.
 *
 * Mover de dia por arrasto (E39c, parte 2b): a grade do mês só mostra contagem por dia, não os
 * itens; o que se arrasta é a linha do dia selecionado, para qualquer outra célula do mês. O menu
 * de três ações (`MenuAcoesAgenda`) entra junto, só nos itens que ficam arrastáveis (o roteiro
 * ainda "a gravar", não um dia passado), pelo mesmo motivo de `SemanaTela.tsx`: o arrasto é outro
 * caminho para a mesma ação do menu, nunca uma segunda regra. A lista da visão Mês não tinha
 * nenhum menu até aqui (pendência registrada na parte 2a); fora do que o arrasto precisa, continua
 * como estava.
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
  const { arquivar: arquivarComDesfazer, toast: toastArquivar } = useDesfazerArquivar();
  const mover = useMoverDeDia();

  function ir(destino: string) {
    if (ocupado) return;
    iniciarTransicao(() => router.push(destino));
  }

  const ehHojeSelecionado = diaSelecionado === hoje;
  const itensDoDiaSelecionado = [
    ...agendaDoDiaSelecionado.reels.map((item) => ({ item, momento: textosHoje.agenda.legendaReels, tipo: "reels" as const })),
    ...agendaDoDiaSelecionado.stories.map((item) => ({
      item,
      momento: item.momentoDoDia ? (ROTULO_MOMENTO[item.momentoDoDia] ?? item.momentoDoDia) : "",
      tipo: "story" as const,
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
            {dias.map((dia) => {
              const temConflito = mover.itemArrastando
                ? mover.itemArrastando.tipo === "reels"
                  ? dia.marca.qtdReels > 0
                  : dia.marca.qtdStories > 0
                : false;
              return (
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
                    mover.diaAlvo === dia.data ? styles.diaMesAlvo : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => ir(`/planejamento?visao=mes&mes=${anoMes}&dia=${dia.data}`)}
                  onDragOver={(evento) => mover.aoPassarPorCimaDoDia(evento, dia.data, dia.passado)}
                  onDragLeave={(evento) => mover.aoSairDoDia(evento, dia.data)}
                  onDrop={(evento) => mover.aoSoltarNoDia(evento, dia.data, temConflito)}
                >
                  {dia.diaDoMes}
                  <span className={hojeStyles.marcas}>
                    {dia.marca.qtdReels > 0 ? <i className={hojeStyles.marcaReels} aria-hidden="true" /> : null}
                    {dia.marca.qtdReels > 1 ? <b className={hojeStyles.contaStory}>{dia.marca.qtdReels}</b> : null}
                    {dia.marca.qtdStories > 0 ? <i className={hojeStyles.marcaStory} aria-hidden="true" /> : null}
                    {dia.marca.qtdStories > 1 ? <b className={hojeStyles.contaStory}>{dia.marca.qtdStories}</b> : null}
                  </span>
                </button>
              );
            })}
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
                <span className={styles.itemPlanoObjetivo}>{rotuloParaQue({ objetivo: item.objetivo, formato: item.formato })}</span>
              </div>
            ))}
          </div>
        ) : null}
        {itensDoDiaSelecionado.length > 0 ? (
          <div className={hojeStyles.listaAgendaCartao}>
            <ol className={hojeStyles.listaAgenda}>
              {itensDoDiaSelecionado.map(({ item, momento, tipo }) => {
                const podeArrastar = item.status === "gerado" && diaSelecionado >= hoje;
                return (
                  <li
                    key={item.id}
                    className={[hojeStyles.linhaComMenu, mover.itemArrastando?.id === item.id ? styles.linhaArrastando : ""]
                      .filter(Boolean)
                      .join(" ")}
                    draggable={podeArrastar && !item.doMomento}
                    onDragStart={(evento) => podeArrastar && !item.doMomento && mover.aoComecarArrasto(evento, { id: item.id, tipo, titulo: item.titulo }, diaSelecionado)}
                    onDragEnd={mover.aoTerminarArrasto}
                  >
                    <button
                      type="button"
                      className={hojeStyles.itemAgenda}
                      disabled={ocupado}
                      onClick={() => ir(`/roteiros/${item.id}`)}
                    >
                      <span className={hojeStyles.momento}>{momento}</span>
                      <span className={hojeStyles.tituloItem}>{item.titulo}</span>
                      <EstadoItem item={item} ehHoje={ehHojeSelecionado} />
                      {/* O menu de três ações substitui a seta no fim da linha (mesma regra de
                          `HojeTela.module.css`, `.itemAgenda`): só desenha a seta sem o menu ao lado. */}
                      {!podeArrastar ? <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" /> : null}
                    </button>
                    {podeArrastar ? (
                      <MenuAcoesAgenda
                        roteiroId={item.id}
                        titulo={item.titulo}
                        data={diaSelecionado}
                        aoArquivar={arquivarComDesfazer}
                        doMomento={item.doMomento}
                        perguntaSeConflito={(novaData) => perguntaSeConflitoMes(dias, tipo, item.titulo, novaData)}
                      />
                    ) : null}
                  </li>
                );
              })}
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
      {toastArquivar}
      <p className="so-leitor" aria-live="assertive">
        {mover.itemArrastando && mover.diaAlvo
          ? textosHoje.agenda.planejador.movendoPara(mover.itemArrastando.titulo, diaMesExtenso(mover.diaAlvo))
          : ""}
      </p>
      {mover.pendente ? (
        <ConfirmarMoverDia
          pergunta={textosHoje.agenda.planejador.confirmarMoverPergunta(
            mover.pendente.titulo,
            diaMesExtenso(mover.pendente.paraData),
            mover.pendente.tipo === "reels" ? textosHoje.agenda.legendaReels : textosHoje.agenda.legendaStory,
          )}
          movendo={mover.movendo}
          aoConfirmar={mover.confirmarMoverMesmoAssim}
          aoCancelar={mover.cancelarMover}
          confirmarRotulo={textosHoje.agenda.planejador.confirmarMoverBotao}
          cancelarRotulo={textosHoje.agenda.planejador.cancelarMoverBotao}
        />
      ) : null}
      {mover.erro ? (
        <p role="alert" className={styles.erroMover}>
          {mover.erro}
        </p>
      ) : null}
    </div>
  );
}
