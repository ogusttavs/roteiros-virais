"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { DiaAgenda, DiaNaoEntendido } from "@/servicos/plano";
import { textosPlano } from "@/textos/plano";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { Botao } from "@/ui/componentes/Botao";
import { Folha } from "@/ui/componentes/Folha";
import { GravadorDeAudio } from "@/ui/componentes/GravadorDeAudio";
import { useGravadorDeAudio } from "@/ui/componentes/useGravadorDeAudio";
import { useTratarFalha } from "@/ui/ConexaoContext";

import styles from "./FolhaPlanejarDias.module.css";
import { criarPlanoAction, lerAgendaAction } from "./plano/acoes";

type Fase = "entrada" | "gravando" | "transcrevendo" | "lendo" | "revisao" | "confirmando";

/** V9d, item 4: um dia não entendido, mais a data que a pessoa escolheu (vazia até ela preencher). */
type DiaNaoEntendidoComEscolha = DiaNaoEntendido & { dataEscolhida: string };

const FORMATAR_DATA = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "short",
  timeZone: "America/Sao_Paulo",
});

function formatarData(dataISO: string): string {
  const partes = FORMATAR_DATA.formatToParts(new Date(`${dataISO}T12:00:00`));
  const semana = (partes.find((p) => p.type === "weekday")?.value ?? "").replace("-feira", "");
  const dia = partes.find((p) => p.type === "day")?.value ?? "";
  const mes = (partes.find((p) => p.type === "month")?.value ?? "").replace(".", "");
  return `${semana}, ${dia} ${mes}`;
}

type Props = {
  aoFechar: () => void;
};

/**
 * "Planejar os próximos dias" (V9b, item 1; V12, item 4b: era "Colar a
 * agenda" até a porta Story do Hoje existir; o nome e a instrução mudaram, o
 * desenho não, `entregaveis/design-v2/entrega/telas/PlanejarDias.dc.html`).
 * Por áudio (mesma rota do momento, `/api/momento/transcrever`) ou por texto
 * direto. Depois de separar em dias (`lerAgendaAction`), a pessoa confere a
 * lista antes de confirmar (`criarPlanoAction`); sem edição campo a campo
 * nesta rodada, só a conferência e o "Montar o plano".
 *
 * `confirmar` chama `router.refresh()` e só depois `aoFechar()`, nessa
 * ordem, em vez de `fecharEDepois` (achado do e2e desta etapa): sem URL
 * nova, o `history.back()` de `fecharEDepois` corre com o `refresh` e o
 * bloco "o seu plano de hoje" às vezes não aparecia sem um recarregamento
 * manual. `fecharEDepois` continua certo para fechar-e-navegar (as outras
 * folhas do projeto); aqui não há navegação, só dado novo na mesma tela.
 */
export function FolhaPlanejarDias({ aoFechar }: Props) {
  const router = useRouter();
  const tratarFalha = useTratarFalha();

  const [fase, setFase] = useState<Fase>("entrada");
  const [texto, setTexto] = useState("");
  const [dias, setDias] = useState<DiaAgenda[]>([]);
  const [diasNaoEntendidos, setDiasNaoEntendidos] = useState<DiaNaoEntendidoComEscolha[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [camposFaltando, setCamposFaltando] = useState(false);

  async function lerAgenda(textoParaLer: string) {
    const limpo = textoParaLer.trim();
    if (!limpo) {
      setCamposFaltando(true);
      return;
    }
    setCamposFaltando(false);
    setErro(null);
    setFase("lendo");
    try {
      const resultado = await lerAgendaAction(limpo);
      if (resultado.dias.length === 0 && resultado.diasNaoEntendidos.length === 0) {
        setErro(textosPlano.semDiaEntendido);
        setFase("entrada");
        return;
      }
      setDias(resultado.dias);
      setDiasNaoEntendidos(resultado.diasNaoEntendidos.map((dia) => ({ ...dia, dataEscolhida: "" })));
      setFase("revisao");
    } catch (falha) {
      setErro(tratarFalha(falha, textosPlano.erroLerAgenda));
      setFase("entrada");
    }
  }

  /** V9d, item 4: a pessoa escolheu a data de um dia que não tinha sido entendido. */
  function escolherData(indice: number, data: string) {
    setDiasNaoEntendidos((atual) => atual.map((dia, i) => (i === indice ? { ...dia, dataEscolhida: data } : dia)));
  }

  /** V9d, item 4: "deixar de fora" remove o cartão; um dia sem data escolhida também fica de fora ao confirmar. */
  function deixarDeFora(indice: number) {
    setDiasNaoEntendidos((atual) => atual.filter((_, i) => i !== indice));
  }

  const gravador = useGravadorDeAudio({
    nomeArquivo: "agenda",
    async onTranscrito(texto) {
      setTexto(texto);
      await lerAgenda(texto);
    },
  });
  /**
   * `audioVazio` fica fora de propósito (comportamento de sempre: gravar e soltar sem falar nada
   * só volta para "entrada", sem aviso nenhum); só a falha de transcrição mostra o erro de sempre.
   */
  useEffect(() => {
    if (gravador.erro === "falhaTranscricao") {
      setErro(textosPlano.erroLerAgenda);
      setFase("entrada");
    }
  }, [gravador.erro]);

  async function confirmar() {
    setErro(null);
    setFase("confirmando");
    try {
      // V9d, item 4: um dia nao entendido sem data escolhida fica de fora, do mesmo jeito que
      // "deixar de fora" (o botao so remove o cartao mais cedo da tela).
      const diasResolvidos: DiaAgenda[] = diasNaoEntendidos
        .filter((dia) => dia.dataEscolhida)
        .map((dia) => ({ data: dia.dataEscolhida, lugar: dia.lugar, compromissos: dia.compromissos }));
      await criarPlanoAction([...dias, ...diasResolvidos]);
      router.refresh();
      aoFechar();
    } catch (falha) {
      setErro(tratarFalha(falha, textosPlano.erroCriarPlano));
      setFase("revisao");
    }
  }

  const naEntrada = fase === "entrada" || fase === "lendo";
  const gravandoOuTranscrevendo = gravador.fase === "gravando" || gravador.fase === "transcrevendo";

  return (
    <Folha
      titulo={naEntrada ? textosPlano.tituloFolhaContar : textosPlano.tituloFolhaRevisao}
      aberto
      aoFechar={aoFechar}
      rodape={
        naEntrada ? (
          <Botao
            variante="primario"
            tamanho="lg"
            precisaDeRede
            disabled={gravandoOuTranscrevendo}
            carregando={fase === "lendo"}
            onClick={() => lerAgenda(texto)}
          >
            {fase === "lendo" ? textosPlano.lendoAgenda : textosPlano.botaoVerDias}
          </Botao>
        ) : (
          <>
            <Botao variante="primario" tamanho="lg" precisaDeRede carregando={fase === "confirmando"} onClick={confirmar}>
              {fase === "confirmando" ? textosPlano.confirmandoPlano : textosPlano.botaoConfirmarPlano}
            </Botao>
            <Botao variante="ghost" tamanho="md" disabled={fase === "confirmando"} onClick={() => setFase("entrada")}>
              {textosPlano.botaoEditar}
            </Botao>
          </>
        )
      }
    >
      {naEntrada ? (
        <>
          <p className={styles.instrucao}>{textosPlano.instrucaoAgenda}</p>

          {gravador.semMicrofone ? null : (
            <GravadorDeAudio
              fase={gravador.fase}
              segundos={gravador.segundos}
              onIniciar={() => void gravador.iniciarGravacao()}
              onParar={gravador.pararGravacao}
              rotuloGravar={textosPlano.botaoGravarAgenda}
              rotuloParar={textosPlano.pararGravacaoAgenda}
              rotuloTranscrevendo={textosPlano.botaoGravarAgenda}
              formatarGravando={textosPlano.gravandoAgenda}
              previa={gravador.previa}
              previaPorReconhecimentoDoAparelho={gravador.previaPorReconhecimentoDoAparelho}
              avisoPreviaComoReserva={gravador.avisoPreviaComoReserva}
            />
          )}

          <div className={styles.divisor}>{textosPlano.ouEscrevaAgenda}</div>

          <AreaTexto
            rotulo={textosPlano.rotuloTextoAgenda}
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            erro={camposFaltando ? textosPlano.campoVazio : undefined}
            caixaAlta="longa"
          />

          {erro ? (
            <p className={styles.erro} role="alert">
              {erro}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className={styles.subtitulo}>{textosPlano.subtituloRevisao}</p>
          <div className={styles.listaDias}>
            {dias.map((dia, indice) => (
              <div key={`${dia.data}-${indice}`} className={styles.diaCartao}>
                <span className={styles.diaData}>{formatarData(dia.data)}</span>
                <span className={styles.diaLugar}>{dia.lugar.trim() || textosPlano.semLugar}</span>
                <ul className={styles.diaCompromissos}>
                  {dia.compromissos.map((compromisso, indiceCompromisso) => (
                    <li key={indiceCompromisso}>{compromisso}</li>
                  ))}
                </ul>
              </div>
            ))}
            {diasNaoEntendidos.map((dia, indice) => (
              <div key={`nao-entendido-${indice}`} className={`${styles.diaCartao} ${styles.diaNaoEntendido}`}>
                <span className={styles.diaData}>{textosPlano.naoEntendiEsteDia}</span>
                <span className={styles.diaLugar}>{dia.lugar.trim() || textosPlano.semLugar}</span>
                <ul className={styles.diaCompromissos}>
                  {dia.compromissos.map((compromisso, indiceCompromisso) => (
                    <li key={indiceCompromisso}>{compromisso}</li>
                  ))}
                </ul>
                <label className={styles.campoData}>
                  <span>{textosPlano.naoEntendiAjuda(dia.referenciaDia)}</span>
                  <input
                    type="date"
                    aria-label={textosPlano.rotuloDataEscolhida}
                    value={dia.dataEscolhida}
                    onChange={(evento) => escolherData(indice, evento.target.value)}
                    className={styles.inputData}
                  />
                </label>
                <Botao variante="ghost" tamanho="md" onClick={() => deixarDeFora(indice)}>
                  {textosPlano.botaoDeixarDeFora}
                </Botao>
              </div>
            ))}
          </div>
          {erro ? (
            <p className={styles.erro} role="alert">
              {erro}
            </p>
          ) : null}
        </>
      )}
    </Folha>
  );
}
