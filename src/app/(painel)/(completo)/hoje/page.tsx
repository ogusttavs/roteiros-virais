import { redirect } from "next/navigation";

import { hojeISO } from "@/lib/config";
import {
  classificarMultiplo,
  diasDesde,
  formatarMultiplo,
  formatarViewsCompacto,
  formatarViewsExato,
  fraseDiasAtras,
  rotuloMultiploConta,
} from "@/lib/formatarNumero";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario, marcasDoUsuario } from "@/servicos/clientes";
import { ultimoVideoParaAparte, videoSubindoParaAviso } from "@/servicos/curva";
import { evidenciaResumoPorIds, type EvidenciaResumo } from "@/servicos/pesquisa";
import { planoDoDia, planoQueVem } from "@/servicos/plano";
import { corpoDoRoteiro, roteiroDeHoje, roteirosDeHoje, type RoteiroLinha } from "@/servicos/roteiro";
import { resumoHistorico, temasParaCliente } from "@/servicos/temas";
import { textosHoje } from "@/textos/hoje";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import type { EvidenciaTema } from "@/ui/componentes/TemaCartao";

import { SeletorMarcaCelular } from "../../_casca/SeletorMarcaCelular";

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

function paraEvidenciaTema(resumo: EvidenciaResumo | null): EvidenciaTema | null {
  if (!resumo) return null;
  const faixa = classificarMultiplo(resumo.multiplicador);
  return {
    conta: resumo.contaNome ?? resumo.contaHandle,
    multiplo: formatarMultiplo(resumo.multiplicador),
    rotulo: rotuloMultiploConta(faixa, resumo.contaMedianaOrigem),
    views: formatarViewsCompacto(resumo.views),
    quando: resumo.publicadoEm ? fraseDiasAtras(diasDesde(resumo.publicadoEm)) : fraseDiasAtras(0),
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

  const [cliente, marcas] = await Promise.all([clienteAtivoDoUsuario(sessao.user.id), marcasDoUsuario(sessao.user.id)]);
  if (!cliente) {
    redirect("/entrar");
  }

  const hoje = hojeISO();
  const semLimite = cliente.plano === "sem_limite";
  const [resultado, roteiroHoje, roteirosDeHojeBrutos, videoSubindo, resumo, ultimoVideoBruto, planoDeHoje, planoOsDiasQueVem] =
    await Promise.all([
      temasParaCliente(cliente),
      // V9b-0: plano `padrao` só lê o mais recente; plano `sem_limite` lê a lista inteira abaixo.
      semLimite ? Promise.resolve(null) : roteiroDeHoje(cliente.id),
      semLimite ? roteirosDeHoje(cliente.id) : Promise.resolve<RoteiroLinha[]>([]),
      videoSubindoParaAviso(cliente.id),
      resumoHistorico(cliente.id),
      ultimoVideoParaAparte(cliente.id),
      // V9b, item 3: "o seu plano de hoje" e a folha "Meu plano" (só os dias que vêm, a partir de hoje).
      planoDoDia(cliente.id, hoje),
      planoQueVem(cliente.id, hoje),
    ]);

  const avisoVideoSubindo = videoSubindo
    ? textosHoje.avisoVideoSubindo(diaDaSemana(videoSubindo.postadoEm), formatarMultiplo(videoSubindo.multiplicador))
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

  /**
   * O roteiro de hoje tem precedência sobre o estado "sem tema" (revisão do
   * PR #31, item 10; generalizado no V9b-0 para a lista inteira do plano
   * `sem_limite`): quem escreveu o próprio assunto antes da busca de hoje
   * sair não pode ficar sem ver o roteiro que já tem. Sem temas de verdade
   * (`resultado.status !== "ok"`), a lista de temas some da tela (`temas`
   * vazio já esconde "ver os outros temas" em `HojeTela`).
   */
  const temRoteiroHoje = semLimite ? roteirosDeHojeBrutos.length > 0 : roteiroHoje !== null;

  // V9a, item 4: as outras marcas, para o seletor "Falar de" da folha "Gravar agora"; a marca ativa nunca aparece na própria lista.
  const outrasMarcas = marcas.filter((marca) => marca.id !== cliente.id);
  const objetivoRecomendado = resultado.status === "ok" ? resultado.objetivoRecomendado : null;

  if (temRoteiroHoje) {
    const temas = resultado.status === "ok" ? resultado.temas : [];
    const evidenciasTemas =
      resultado.status === "ok"
        ? await Promise.all(temas.map((tema) => evidenciaResumoPorIds(tema.evidencias).then(paraEvidenciaTema)))
        : [];
    const evidenciaRoteiroHoje = roteiroHoje
      ? await evidenciaResumoPorIds(corpoDoRoteiro(roteiroHoje).evidencias).then(paraEvidenciaTema)
      : null;
    const evidenciasRoteirosDeHoje = await Promise.all(
      roteirosDeHojeBrutos.map((r) => evidenciaResumoPorIds(corpoDoRoteiro(r).evidencias).then(paraEvidenciaTema)),
    );

    return (
      <HojeTela
        temas={temas}
        evidenciasTemas={evidenciasTemas}
        avisoLinhaEditorial={resultado.status === "ok" ? resultado.avisoLinhaEditorial : null}
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
        plano={cliente.plano}
        roteirosDeHoje={roteirosDeHojeBrutos.map((r) => ({
          id: r.id,
          objetivo: r.objetivo,
          criadoEm: r.criadoEm,
          corpo: corpoDoRoteiro(r),
          origem: r.origem,
        }))}
        evidenciasRoteirosDeHoje={evidenciasRoteirosDeHoje}
        semana={semana}
        ultimoVideo={ultimoVideo}
        marcaAtiva={cliente}
        marcas={marcas}
        nomePessoa={sessao.user.name}
        objetivoRecomendado={objetivoRecomendado}
        outrasMarcas={outrasMarcas}
        planoDeHoje={planoDeHoje}
        planoQueVem={planoOsDiasQueVem}
      />
    );
  }

  if (resultado.status === "sem_tema") {
    const diasGravados = semana.filter((dia) => dia.gravou).length;
    return (
      <div className={styles.pagina}>
        <BarraTopo
          titulo={textosHoje.titulo}
          direita={<SeletorMarcaCelular marcaAtiva={cliente} marcas={marcas} nomePessoa={sessao.user.name} />}
        />
        <div className={styles.miolo}>
          <HojeCabecalho
            constancia={resultado.constancia}
            diasGravados={diasGravados}
            avisoVideoSubindo={avisoVideoSubindo}
            estado="vazio"
          />
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

  const evidenciasTemas = await Promise.all(
    resultado.temas.map((tema) => evidenciaResumoPorIds(tema.evidencias).then(paraEvidenciaTema)),
  );

  return (
    <HojeTela
      temas={resultado.temas}
      evidenciasTemas={evidenciasTemas}
      avisoLinhaEditorial={resultado.avisoLinhaEditorial}
      avisoVideoSubindo={avisoVideoSubindo}
      constancia={resultado.constancia}
      roteiroHoje={null}
      evidenciaRoteiroHoje={null}
      plano={cliente.plano}
      roteirosDeHoje={[]}
      evidenciasRoteirosDeHoje={[]}
      semana={semana}
      ultimoVideo={ultimoVideo}
      marcaAtiva={cliente}
      marcas={marcas}
      nomePessoa={sessao.user.name}
      objetivoRecomendado={objetivoRecomendado}
      outrasMarcas={outrasMarcas}
      planoDeHoje={planoDeHoje}
      planoQueVem={planoOsDiasQueVem}
    />
  );
}
