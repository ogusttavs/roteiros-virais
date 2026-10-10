"use client";

import { Mic, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { DiaSemanaPlano, ItemSemanaPlano } from "@/servicos/roteiro";
import { textosHoje } from "@/textos/hoje";
import { textosPlano } from "@/textos/plano";
import { ConfirmarMoverDia } from "@/ui/componentes/ConfirmarMoverDia";

import { ROTULO_MOMENTO } from "../hoje/HojeTela";
import hojeStyles from "../hoje/HojeTela.module.css";
import { MenuAcoesAgenda } from "../hoje/MenuAcoesAgenda";
import { useDesfazerArquivar } from "../hoje/useDesfazerArquivar";

import { useAbrirContarAgenda } from "./PlanejadorShell";
import styles from "./SemanaTela.module.css";
import { useMoverDeDia } from "./useMoverDeDia";

type Props = {
  dias: DiaSemanaPlano[];
};

const MAX_ITENS_VISIVEIS = 4;
const MAX_ANTES_DE_VER_MAIS = 3;

const FORMATAR_DIA_SEMANA_EXTENSO = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });
function diaPorExtenso(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const texto = FORMATAR_DIA_SEMANA_EXTENSO.format(new Date(Date.UTC(ano, mes - 1, dia, 12)));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function rotuloTipo(item: ItemSemanaPlano): string {
  if (item.tipo === "reels") return textosHoje.agenda.legendaReels;
  if (item.momentoDoDia) return ROTULO_MOMENTO[item.momentoDoDia] ?? item.momentoDoDia;
  return item.lugar?.trim() || textosHoje.agenda.legendaStory;
}

function rotuloEstadoItem(item: ItemSemanaPlano, dia: DiaSemanaPlano): string {
  if (item.sugerido) return textosHoje.agenda.planejador.sugerido;
  if (item.status === "gravado") return textosHoje.agenda.estadoReels.gravado;
  if (item.status === "postado") return textosHoje.agenda.estadoReels.postado;
  if (dia.hoje) return textosHoje.agenda.estadoReels.gerado;
  return dia.passado ? textosHoje.agenda.planejador.estadoAtrasado : textosHoje.agenda.estadoOutroDia;
}

/**
 * Mesma regra do arrasto (`useMoverDeDia.ts`), para o "Não vou gravar hoje" do menu nunca
 * divergir dele: só sabe responder pelos sete dias já carregados na Semana; uma data escolhida
 * fora dela no campo de "escolher a data" da folha (`FolhaMudarDia`) salva sem perguntar, porque
 * esta visão não tem como saber o que tem lá (limite registrado no TODO.md).
 */
function perguntaSeConflitoSemana(dias: DiaSemanaPlano[], item: ItemSemanaPlano, novaData: string): string | null {
  const diaAlvo = dias.find((d) => d.data === novaData);
  if (!diaAlvo || !diaAlvo.itens.some((outro) => outro.tipo === item.tipo)) return null;
  return textosHoje.agenda.planejador.confirmarMoverPergunta(
    item.titulo,
    diaPorExtenso(novaData),
    item.tipo === "reels" ? textosHoje.agenda.legendaReels : textosHoje.agenda.legendaStory,
  );
}

/**
 * A visão Semana do planejador (passo 12 do Opus, `Hoje.dc.html`, estado `semana`): sete colunas
 * a partir de 1024px, lista abaixo disso. Até quatro itens por dia; cinco ou mais mostra três e
 * "Ver mais N" (abre a visão Dia daquele dia). O sugerido é tracejado; tocar nele leva ao Criar
 * (`CriarTela.tsx`, `itemPlanoInicial`), não abre roteiro nenhum, porque ainda não existe.
 *
 * Mover de dia por arrasto (E39c, parte 2b, do tablet deitado para cima): só nos itens que já têm
 * o menu de três ações (`MenuAcoesAgenda`, um roteiro escrito, não um dia passado), porque o
 * arrasto é só outro caminho para a mesma ação do menu ("Não vou gravar hoje", a folha "Mudar o
 * dia"), nunca uma segunda regra (`useMoverDeDia.ts`). Um sugerido continua sem jeito de mudar de
 * dia nesta rodada (hipótese já registrada na parte 2a).
 */
export function SemanaConteudo({ dias }: Props) {
  const router = useRouter();
  const aoAbrirContarAgenda = useAbrirContarAgenda();
  const [ocupado, iniciarTransicao] = useTransition();
  const [diasExpandidos, setDiasExpandidos] = useState<Set<string>>(new Set());
  const { arquivar: arquivarComDesfazer, toast: toastArquivar } = useDesfazerArquivar();
  const mover = useMoverDeDia();

  function ir(destino: string) {
    if (ocupado) return;
    iniciarTransicao(() => router.push(destino));
  }

  function abrirItem(item: ItemSemanaPlano, data: string) {
    if (item.sugerido) {
      ir(`/criar?data=${data}&plano=${item.id}`);
      return;
    }
    ir(`/roteiros/${item.id}`);
  }

  const semNadaNaSemana = dias.every((dia) => dia.itens.length === 0);

  const rodapeMover = (
    <>
      <p className="so-leitor" aria-live="assertive">
        {mover.itemArrastando && mover.diaAlvo
          ? textosHoje.agenda.planejador.movendoPara(mover.itemArrastando.titulo, diaPorExtenso(mover.diaAlvo))
          : ""}
      </p>
      {mover.pendente ? (
        <ConfirmarMoverDia
          pergunta={textosHoje.agenda.planejador.confirmarMoverPergunta(
            mover.pendente.titulo,
            diaPorExtenso(mover.pendente.paraData),
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
    </>
  );

  if (semNadaNaSemana) {
    return (
      <>
        <section className={styles.periodoVazio} aria-labelledby="t-semana-vazia">
          <h3 id="t-semana-vazia">{textosHoje.agenda.planejador.semanaVaziaTitulo}</h3>
          <p>{textosHoje.agenda.planejador.semanaVaziaDescricao}</p>
          <button type="button" className={hojeStyles.botaoSecundarioSm} onClick={aoAbrirContarAgenda}>
            <Mic size={16} strokeWidth={1.75} aria-hidden="true" />
            {textosPlano.botaoContarAgenda}
          </button>
        </section>
        <DiasGrade
          dias={dias}
          ocupado={ocupado}
          ir={ir}
          abrirItem={abrirItem}
          aoArquivar={arquivarComDesfazer}
          expandidos={diasExpandidos}
          setExpandidos={setDiasExpandidos}
          mover={mover}
        />
        {toastArquivar}
        {rodapeMover}
      </>
    );
  }

  return (
    <>
      <DiasGrade
        dias={dias}
        ocupado={ocupado}
        ir={ir}
        abrirItem={abrirItem}
        aoArquivar={arquivarComDesfazer}
        expandidos={diasExpandidos}
        setExpandidos={setDiasExpandidos}
        mover={mover}
      />
      <div className={[hojeStyles.pePlano, styles.peSemana].join(" ")}>
        <p className={styles.legendaSugerido}>
          <i className={[hojeStyles.marcaStory, styles.marcaSugerida].join(" ")} aria-hidden="true" />
          {textosHoje.agenda.planejador.legendaSugerido}
        </p>
        <button type="button" className={[hojeStyles.botaoTexto, hojeStyles.soCelular].join(" ")} onClick={aoAbrirContarAgenda}>
          <Mic size={16} strokeWidth={1.75} aria-hidden="true" />
          {textosPlano.botaoContarAgenda}
        </button>
      </div>
      {toastArquivar}
      {rodapeMover}
    </>
  );
}

function DiasGrade({
  dias,
  ocupado,
  ir,
  abrirItem,
  aoArquivar,
  expandidos,
  setExpandidos,
  mover,
}: {
  dias: DiaSemanaPlano[];
  ocupado: boolean;
  ir: (destino: string) => void;
  abrirItem: (item: ItemSemanaPlano, data: string) => void;
  aoArquivar: (roteiroId: number) => Promise<void>;
  expandidos: Set<string>;
  setExpandidos: (atualizar: (atual: Set<string>) => Set<string>) => void;
  mover: ReturnType<typeof useMoverDeDia>;
}) {
  return (
    <div className={styles.semanaPlano}>
      {dias.map((dia) => {
        const expandido = expandidos.has(dia.data);
        const itensVisiveis = expandido || dia.itens.length <= MAX_ITENS_VISIVEIS ? dia.itens : dia.itens.slice(0, MAX_ANTES_DE_VER_MAIS);
        const faltam = dia.itens.length - itensVisiveis.length;
        const semNada = dia.itens.length === 0;
        const temConflito = mover.itemArrastando ? dia.itens.some((item) => item.tipo === mover.itemArrastando?.tipo) : false;

        return (
          <section
            key={dia.data}
            className={[
              styles.diaPlano,
              dia.hoje ? styles.diaPlanoHoje : "",
              dia.passado ? styles.diaPlanoPassado : "",
              semNada ? styles.diaPlanoSemNada : "",
              mover.diaAlvo === dia.data ? styles.diaPlanoAlvo : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label={dia.hoje ? `${diaPorExtenso(dia.data)}, hoje` : diaPorExtenso(dia.data)}
            onDragOver={(evento) => mover.aoPassarPorCimaDoDia(evento, dia.data, dia.passado)}
            onDragLeave={(evento) => mover.aoSairDoDia(evento, dia.data)}
            onDrop={(evento) => mover.aoSoltarNoDia(evento, dia.data, temConflito)}
          >
            <div className={styles.cabecaDia}>
              <h3 className={styles.diaTitulo}>
                <span className={styles.nomeDia}>{dia.diaDaSemanaCurto}</span>
                <span className={styles.numero}>{dia.diaDoMes}</span>
              </h3>
              {semNada ? <span className={styles.nada}>{textosHoje.agenda.semNadaNaColuna}</span> : null}
              {!dia.passado ? (
                <button
                  type="button"
                  className={styles.maisDia}
                  disabled={ocupado}
                  aria-label={textosHoje.agenda.planejador.criarRoteiroParaDia(diaPorExtenso(dia.data))}
                  onClick={() => ir(`/criar?data=${dia.data}`)}
                >
                  <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
                </button>
              ) : null}
            </div>

            {semNada ? (
              !dia.passado ? (
                <button type="button" className={styles.criarNoDia} onClick={() => ir(`/criar?data=${dia.data}`)}>
                  <Plus size={20} strokeWidth={1.75} aria-hidden="true" />
                  {textosHoje.agenda.planejador.criarRoteiro}
                </button>
              ) : null
            ) : (
              <ol className={styles.itensDia}>
                {itensVisiveis.map((item) => {
                  const podeArrastar = !item.sugerido && item.status === "gerado" && !dia.passado;
                  return (
                    <li
                      key={`${item.sugerido ? "sugerido" : "roteiro"}-${item.id}`}
                      className={[styles.linhaPlano, mover.itemArrastando?.id === item.id ? styles.linhaPlanoArrastando : ""]
                        .filter(Boolean)
                        .join(" ")}
                      draggable={podeArrastar && !item.doMomento}
                      onDragStart={(evento) => podeArrastar && !item.doMomento && mover.aoComecarArrasto(evento, item, dia.data)}
                      onDragEnd={mover.aoTerminarArrasto}
                    >
                      <button
                        type="button"
                        className={[styles.itemPlano, item.sugerido ? styles.itemPlanoSugerido : ""].filter(Boolean).join(" ")}
                        disabled={ocupado}
                        onClick={() => abrirItem(item, dia.data)}
                      >
                        <span className={styles.tipo}>
                          <i className={item.tipo === "reels" ? hojeStyles.marcaReels : hojeStyles.marcaStory} aria-hidden="true" />
                          {rotuloTipo(item)}
                        </span>
                        <span className={styles.tituloItem}>{item.titulo}</span>
                        <span className={[styles.estado, item.status !== "gerado" && !item.sugerido ? styles.estadoFeito : ""].filter(Boolean).join(" ")}>
                          {rotuloEstadoItem(item, dia)}
                        </span>
                      </button>
                      {podeArrastar ? (
                        <MenuAcoesAgenda
                          roteiroId={item.id}
                          titulo={item.titulo}
                          data={dia.data}
                          aoArquivar={aoArquivar}
                          doMomento={item.doMomento}
                          perguntaSeConflito={(novaData) => perguntaSeConflitoSemana(dias, item, novaData)}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
            {faltam > 0 ? (
              <button
                type="button"
                className={styles.maisItens}
                onClick={() => setExpandidos((atual) => new Set(atual).add(dia.data))}
              >
                {textosHoje.agenda.planejador.verMais(faltam)}
              </button>
            ) : null}
            {!semNada && !dia.passado ? (
              <button
                type="button"
                className={styles.maisFim}
                aria-label={textosHoje.agenda.planejador.criarRoteiroParaDia(diaPorExtenso(dia.data))}
                onClick={() => ir(`/criar?data=${dia.data}`)}
              >
                <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
