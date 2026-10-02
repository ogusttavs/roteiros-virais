"use client";

import { Mic, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { DiaSemanaPlano, ItemSemanaPlano } from "@/servicos/roteiro";
import { textosHoje } from "@/textos/hoje";
import { textosPlano } from "@/textos/plano";

import { ROTULO_MOMENTO } from "../hoje/HojeTela";
import hojeStyles from "../hoje/HojeTela.module.css";
import { MenuAcoesAgenda } from "../hoje/MenuAcoesAgenda";
import { useDesfazerArquivar } from "../hoje/useDesfazerArquivar";

import { useAbrirContarAgenda } from "./PlanejadorShell";
import styles from "./SemanaTela.module.css";

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
 * A visão Semana do planejador (passo 12 do Opus, `Hoje.dc.html`, estado `semana`): sete colunas
 * a partir de 1024px, lista abaixo disso. Até quatro itens por dia; cinco ou mais mostra três e
 * "Ver mais N" (abre a visão Dia daquele dia). O sugerido é tracejado; tocar nele leva ao Criar
 * (`CriarTela.tsx`, `itemPlanoInicial`), não abre roteiro nenhum, porque ainda não existe.
 *
 * Mover de dia por arrasto (do tablet deitado para cima) fica para depois desta rodada; o menu de
 * três ações (`MenuAcoesAgenda`, E39c parte 2a, pedido do Gustavo em 01/10, 21:33) já cobre "não
 * vou gravar hoje" (a mesma folha "Mudar o dia" de antes), arquivar e reprovar com motivo, em
 * qualquer tamanho de tela. Só nos itens que já são roteiro: mover um sugerido de dia é uma ação
 * nova que o código ainda não tem (hipótese mais simples desta rodada, registrada no TODO.md).
 */
export function SemanaConteudo({ dias }: Props) {
  const router = useRouter();
  const aoAbrirContarAgenda = useAbrirContarAgenda();
  const [ocupado, iniciarTransicao] = useTransition();
  const [diasExpandidos, setDiasExpandidos] = useState<Set<string>>(new Set());
  const { arquivar: arquivarComDesfazer, toast: toastArquivar } = useDesfazerArquivar();

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
        />
        {toastArquivar}
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
}: {
  dias: DiaSemanaPlano[];
  ocupado: boolean;
  ir: (destino: string) => void;
  abrirItem: (item: ItemSemanaPlano, data: string) => void;
  aoArquivar: (roteiroId: number) => Promise<void>;
  expandidos: Set<string>;
  setExpandidos: (atualizar: (atual: Set<string>) => Set<string>) => void;
}) {
  return (
    <div className={styles.semanaPlano}>
      {dias.map((dia) => {
        const expandido = expandidos.has(dia.data);
        const itensVisiveis = expandido || dia.itens.length <= MAX_ITENS_VISIVEIS ? dia.itens : dia.itens.slice(0, MAX_ANTES_DE_VER_MAIS);
        const faltam = dia.itens.length - itensVisiveis.length;
        const semNada = dia.itens.length === 0;

        return (
          <section
            key={dia.data}
            className={[styles.diaPlano, dia.hoje ? styles.diaPlanoHoje : "", dia.passado ? styles.diaPlanoPassado : "", semNada ? styles.diaPlanoSemNada : ""]
              .filter(Boolean)
              .join(" ")}
            aria-label={dia.hoje ? `${diaPorExtenso(dia.data)}, hoje` : diaPorExtenso(dia.data)}
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
                {itensVisiveis.map((item) => (
                  <li key={`${item.sugerido ? "sugerido" : "roteiro"}-${item.id}`} className={styles.linhaPlano}>
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
                    {!item.sugerido && item.status === "gerado" && !dia.passado ? (
                      <MenuAcoesAgenda roteiroId={item.id} titulo={item.titulo} data={dia.data} aoArquivar={aoArquivar} />
                    ) : null}
                  </li>
                ))}
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
