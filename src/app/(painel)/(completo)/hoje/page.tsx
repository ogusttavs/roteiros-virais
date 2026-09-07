import { redirect } from "next/navigation";

import { diasDesde, formatarMultiplo, formatarViewsCompacto, formatarViewsExato } from "@/lib/formatarNumero";
import { sessaoAtual } from "@/lib/sessao";
import { clienteDoUsuario } from "@/servicos/clientes";
import { ultimoVideoParaAparte, videoSubindoParaAviso } from "@/servicos/curva";
import { evidenciaResumoPorIds, type EvidenciaResumo } from "@/servicos/pesquisa";
import { corpoDoRoteiro, roteiroDeHoje } from "@/servicos/roteiro";
import { resumoHistorico, temasParaCliente } from "@/servicos/temas";
import { textosHoje } from "@/textos/hoje";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import type { EvidenciaTema } from "@/ui/componentes/TemaCartao";

import { HojeCabecalho } from "./HojeCabecalho";
import { HojeTela, type SemanaDia, type UltimoVideoAparte } from "./HojeTela";
import styles from "./HojeTela.module.css";

const FORMATAR_DIA = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" });
const FORMATAR_DIA_CURTO = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "America/Sao_Paulo" });

function diaDaSemana(data: Date): string {
  return FORMATAR_DIA.format(data).replace("-feira", "");
}

function diaDaSemanaCurto(data: Date): string {
  return FORMATAR_DIA_CURTO.format(data).replace(".", "");
}

function formatarVezes(valor: number): string {
  return formatarMultiplo(valor);
}

function paraEvidenciaTema(resumo: EvidenciaResumo | null): EvidenciaTema | null {
  if (!resumo) return null;
  return {
    conta: resumo.contaNome ?? resumo.contaHandle,
    multiplo: formatarMultiplo(resumo.multiplicador),
    views: formatarViewsCompacto(resumo.views),
    dias: resumo.publicadoEm ? diasDesde(resumo.publicadoEm) : 0,
    parecidos: resumo.quantidadeParecidos,
  };
}

/** Últimos 7 dias, o mais antigo primeiro, terminando em "hoje" (design v2, aparte "sua semana"). */
function montarSemana(ultimos30Dias: boolean[]): SemanaDia[] {
  const ultimos7 = ultimos30Dias.slice(-7);
  const hoje = new Date();
  return ultimos7.map((gravou, indice) => {
    const eHoje = indice === ultimos7.length - 1;
    const dias = ultimos7.length - 1 - indice;
    const data = new Date(hoje.getTime() - dias * 24 * 60 * 60 * 1000);
    return { rotulo: eHoje ? textosHoje.hoje : diaDaSemanaCurto(data), gravou, hoje: eHoje };
  });
}

export default async function Hoje() {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }

  const [resultado, roteiroHoje, videoSubindo, resumo, ultimoVideoBruto] = await Promise.all([
    temasParaCliente(cliente),
    roteiroDeHoje(cliente.id),
    videoSubindoParaAviso(cliente.id),
    resumoHistorico(cliente.id),
    ultimoVideoParaAparte(cliente.id),
  ]);

  const avisoVideoSubindo = videoSubindo
    ? textosHoje.avisoVideoSubindo(diaDaSemana(videoSubindo.postadoEm), formatarVezes(videoSubindo.multiplicador))
    : null;

  const semana = montarSemana(resumo.ultimos30Dias);
  const ultimoVideo: UltimoVideoAparte | null = ultimoVideoBruto
    ? {
        views: formatarViewsExato(ultimoVideoBruto.views),
        horas: ultimoVideoBruto.horasDesdePostado,
        multiplo: formatarMultiplo(ultimoVideoBruto.multiplicador),
        acimaDoNormal: ultimoVideoBruto.acimaDoNormal,
      }
    : null;

  if (resultado.status === "sem_tema") {
    return (
      <div className={styles.pagina}>
        <BarraTopo titulo={textosHoje.titulo} />
        <div className={styles.miolo}>
          <HojeCabecalho constancia={resultado.constancia} avisoVideoSubindo={avisoVideoSubindo} estado="vazio" />
          <div className={styles.estadoCartao}>
            <h3>{textosHoje.vazioTitulo}</h3>
            <p>{textosHoje.vazio}</p>
            <div className={styles.estadoAcoes}>
              <a href="/hoje/tema-livre" className={styles.botaoPrimario}>
                {textosHoje.escreverMeuAssunto}
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const [evidenciasTemas, evidenciaRoteiroHoje] = await Promise.all([
    Promise.all(resultado.temas.map((tema) => evidenciaResumoPorIds(tema.evidencias).then(paraEvidenciaTema))),
    roteiroHoje ? evidenciaResumoPorIds(corpoDoRoteiro(roteiroHoje).evidencias).then(paraEvidenciaTema) : null,
  ]);

  return (
    <HojeTela
      temas={resultado.temas}
      evidenciasTemas={evidenciasTemas}
      avisoLinhaEditorial={resultado.avisoLinhaEditorial}
      avisoVideoSubindo={avisoVideoSubindo}
      constancia={resultado.constancia}
      roteiroHoje={
        roteiroHoje
          ? {
              id: roteiroHoje.id,
              objetivo: roteiroHoje.objetivo,
              criadoEm: roteiroHoje.criadoEm,
              corpo: corpoDoRoteiro(roteiroHoje),
            }
          : null
      }
      evidenciaRoteiroHoje={evidenciaRoteiroHoje}
      semana={semana}
      ultimoVideo={ultimoVideo}
    />
  );
}
