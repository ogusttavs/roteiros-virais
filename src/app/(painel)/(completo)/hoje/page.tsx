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
import { evidenciaResumoPorIds, setorAindaLendo, type EvidenciaResumo } from "@/servicos/pesquisa";
import { planoDoDia, planoQueVem } from "@/servicos/plano";
import { corpoDoRoteiro, roteiroDeHoje, roteirosDeHoje, type RoteiroLinha } from "@/servicos/roteiro";
import { resumoHistorico, temasParaCliente, type EstadoDia, type ResultadoTemasHoje } from "@/servicos/temas";
import { textosHoje } from "@/textos/hoje";
import type { EvidenciaTema } from "@/ui/componentes/TemaCartao";

import { avisoSemTema } from "./aviso-sem-tema";
import { HojeTela, type SemanaDia, type UltimoVideoAparte } from "./HojeTela";

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

/**
 * Últimos 7 dias, o mais antigo primeiro, terminando em "hoje" (design v2,
 * `Hoje.dc.html`, `.semana-topo`; V12, item 1: os três estados por dia).
 */
function montarSemana(ultimos7DiasEstado: EstadoDia[]): SemanaDia[] {
  const hoje = new Date();
  return ultimos7DiasEstado.map((estado, indice) => {
    const eHoje = indice === ultimos7DiasEstado.length - 1;
    const dias = ultimos7DiasEstado.length - 1 - indice;
    const data = new Date(hoje.getTime() - dias * 24 * 60 * 60 * 1000);
    return { rotulo: eHoje ? textosHoje.hoje : diaDaSemanaCurto(data), estado, hoje: eHoje };
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
      // H3, item 1: uma falha aqui não pode derrubar a página inteira (error.tsx), sem a semana, o
      // plano e "Gravar agora" junto; vira o aviso da porta Reels, como "sem tema".
      temasParaCliente(cliente).catch((): ResultadoTemasHoje | { status: "erro" } => ({ status: "erro" })),
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

  const semana = montarSemana(resumo.ultimos7DiasEstado);
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

  /**
   * H3, item 1: o Hoje é sempre o Hoje das portas (a semana, os roteiros de
   * hoje, o plano, a pergunta e as duas portas), com ou sem tema, com ou sem
   * falha na busca. Sem tema de verdade (`resultado.status !== "ok"`), a
   * lista de temas fica vazia e a porta Reels mostra `avisoSemTemaValor` no
   * lugar dela; com um roteiro de hoje já escrito, o aviso não aparece (quem
   * já tem o que gravar não precisa da explicação).
   */
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
  /** M1, item 5: só consulta quando o aviso realmente pode aparecer, e só existe nicho para checar sem `sem_tema` por falta dele. */
  const aindaLendo =
    !temRoteiroHoje && resultado.status === "sem_tema" && cliente.nichoId ? await setorAindaLendo(cliente.nichoId) : false;
  const avisoSemTemaValor = temRoteiroHoje ? null : avisoSemTema(resultado, new Date(), aindaLendo);

  return (
    <HojeTela
      temas={temas}
      evidenciasTemas={evidenciasTemas}
      avisoLinhaEditorial={resultado.status === "ok" ? resultado.avisoLinhaEditorial : null}
      avisoVideoSubindo={avisoVideoSubindo}
      avisoSemTema={avisoSemTemaValor}
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
      redePrincipal={cliente.redePrincipal}
      tipo={cliente.tipo}
      quemGravaPadrao={cliente.quemGrava}
    />
  );
}
