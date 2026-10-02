import { hojeISO } from "@/lib/config";
import { somarDiasISO } from "@/servicos/roteiro";
import { textosHoje } from "@/textos/hoje";
import { textosPlanejamento } from "@/textos/planejamento";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { Skeleton } from "@/ui/componentes/Skeleton";

import hojeStyles from "../hoje/HojeTela.module.css";

import { CabecaPlanoEstatica } from "./CabecaPlanoEstatica";
import semanaStyles from "./SemanaTela.module.css";

/** Igual a `page.tsx` (Server Component, não dá para puxar de `SemanaTela.tsx`, que é cliente). */
function segundaDaSemanaISO(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia, 12));
  const diaDaSemanaNum = data.getUTCDay();
  const voltarAteSegunda = diaDaSemanaNum === 0 ? 6 : diaDaSemanaNum - 1;
  data.setUTCDate(data.getUTCDate() - voltarAteSegunda);
  return data.toISOString().slice(0, 10);
}

const FORMATAR_DIA_MES_COM_MES = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" });
function tituloSemana(segunda: string, domingo: string): string {
  const [, mesSegunda] = segunda.split("-");
  const [, mesDomingo] = domingo.split("-");
  const [anoS, mesS, diaS] = segunda.split("-").map(Number);
  const [anoD, mesD, diaD] = domingo.split("-").map(Number);
  if (mesSegunda === mesDomingo) {
    const diaFim = FORMATAR_DIA_MES_COM_MES.format(new Date(Date.UTC(anoD, mesD - 1, diaD, 12)));
    return `${diaS} a ${diaFim}`;
  }
  const diaInicio = FORMATAR_DIA_MES_COM_MES.format(new Date(Date.UTC(anoS, mesS - 1, diaS, 12)));
  const diaFim = FORMATAR_DIA_MES_COM_MES.format(new Date(Date.UTC(anoD, mesD - 1, diaD, 12)));
  return `${diaInicio} a ${diaFim}`;
}

/** Esqueleto da visão Semana (design v2, `Planejar.dc.html`, estado `carregando`): sete dias,
 * cada um com uma a duas linhas em branco, enquanto a semana real carrega. */
export default function CarregandoPlanejamento() {
  const hoje = hojeISO();
  const segunda = segundaDaSemanaISO(hoje);
  const domingo = somarDiasISO(segunda, 6);

  return (
    <div className={hojeStyles.pagina}>
      <BarraTopo titulo={textosPlanejamento.titulo} />
      <div className={hojeStyles.miolo}>
        <CabecaPlanoEstatica tituloPeriodo={tituloSemana(segunda, domingo)} />
        <div className={semanaStyles.semanaPlano} aria-busy="true" aria-label={textosHoje.agenda.planejador.carregandoRotulo}>
          {[2, 1, 0, 1, 2, 0, 2].map((qtdLinhas, indice) => (
            <section key={indice} className={semanaStyles.diaPlano}>
              <div className={semanaStyles.cabecaDia}>
                <Skeleton variante="corpo" largura="3.5rem" />
              </div>
              {Array.from({ length: qtdLinhas }).map((_, linha) => (
                <Skeleton key={linha} variante="corpo" className={semanaStyles.itemPlano} largura="100%" />
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
