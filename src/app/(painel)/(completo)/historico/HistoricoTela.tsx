import Link from "next/link";

import type { CurvaDeVideo } from "@/servicos/curva";
import type { GrupoHistorico } from "@/servicos/historico-regras";
import type { RoteiroHistoricoLinha } from "@/servicos/roteiro";
import type { ResumoHistorico } from "@/servicos/temas";
import { textosHistorico } from "@/textos/historico";
import { Constancia } from "@/ui/componentes/Constancia";

import styles from "./HistoricoTela.module.css";

type ItemComCurva = RoteiroHistoricoLinha & { curva: CurvaDeVideo | null };

type Props = {
  resumo: ResumoHistorico;
  grupos: GrupoHistorico<ItemComCurva>[];
};

const FORMATAR_DATA = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "short",
  timeZone: "America/Sao_Paulo",
});

const HORA_MS = 60 * 60 * 1000;

/** "terça, 2 set" a partir de "AAAA-MM-DD" (`HistoricoTela.dc.html`). */
function formatarData(dataISO: string): string {
  const partes = FORMATAR_DATA.formatToParts(new Date(`${dataISO}T12:00:00`));
  const semana = (partes.find((p) => p.type === "weekday")?.value ?? "").replace("-feira", "");
  const dia = partes.find((p) => p.type === "day")?.value ?? "";
  const mes = (partes.find((p) => p.type === "month")?.value ?? "").replace(".", "");
  return `${semana}, ${dia} ${mes}`;
}

function formatarVezes(valor: number): string {
  return `${valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x`;
}

/**
 * A curva em texto e números, não gráfico (decisão 5 do `PROXIMO.md` da
 * etapa 15, parte 1): cada ponto medido (views, horas desde que postou), e
 * "acima do normal" com a ação prática quando passa de 2x.
 */
function textoCurva(curva: CurvaDeVideo | null, postadoEm: Date | null): string | null {
  if (!curva) return null;
  if (curva.status === "sem_acompanhamento") return textosHistorico.semAcompanhamento;
  if (curva.status === "sem_medicao") return null;

  const pontos = curva.pontos
    .map((p) => {
      const horas = postadoEm ? Math.round((p.coletadoEm.getTime() - postadoEm.getTime()) / HORA_MS) : 0;
      return textosHistorico.pontoCurva(p.views.toLocaleString("pt-BR"), horas);
    })
    .join(" · ");

  if (curva.status === "aprendendo") {
    return [pontos, textosHistorico.aprendendo].filter(Boolean).join(" · ");
  }

  const aviso = curva.acimaDoNormal ? textosHistorico.acimaDoNormal(formatarVezes(curva.multiplicador)) : null;
  return [pontos, aviso].filter(Boolean).join(" · ");
}

/**
 * `/historico` (etapa 12, decisão 3 do `PROXIMO.md`, brief-frontend.md 6.7).
 * Sem estado próprio (nenhum filtro): Server Component puro, como `/hoje`
 * no estado vazio.
 */
export function HistoricoTela({ resumo, grupos }: Props) {
  const numeros = [
    { valor: String(resumo.diasSeguidos), rotulo: textosHistorico.numeros.seguidos },
    { valor: String(resumo.gravadosNoMes), rotulo: textosHistorico.numeros.gravados },
    { valor: String(resumo.postadosNoMes), rotulo: textosHistorico.numeros.postados },
  ];
  const diasGravados = resumo.ultimos30Dias.filter(Boolean).length;

  return (
    <div className={styles.pagina}>
      <h1 className={styles.titulo}>{textosHistorico.titulo}</h1>

      <Constancia
        numeros={numeros}
        dias={resumo.ultimos30Dias}
        rotuloDias={textosHistorico.ultimosDias(diasGravados)}
      />

      <div className={styles.grupos}>
        {grupos.map((grupo) => (
          <section key={grupo.rotulo} className={styles.grupo}>
            <span className={styles.rotuloGrupo}>{grupo.rotulo}</span>
            {grupo.itens.map((item) => {
              const medida = textoCurva(item.curva, item.postadoEm);
              return (
                <Link key={item.id} href={`/roteiros/${item.id}`} className={styles.item}>
                  <span className={styles.itemInfo}>
                    <span className={styles.itemData}>{formatarData(item.data)}</span>
                    <span className={styles.itemTema}>{item.tema}</span>
                    {medida ? <span className={styles.itemMedida}>{medida}</span> : null}
                  </span>
                  <span className={styles.itemStatus}>{textosHistorico.status[item.status]}</span>
                </Link>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
