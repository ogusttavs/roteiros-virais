"use client";

import { Mic, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { DiaAgenda, DiaNaoEntendido } from "@/servicos/plano";
import { textosPlano } from "@/textos/plano";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { Botao } from "@/ui/componentes/Botao";
import { Folha } from "@/ui/componentes/Folha";
import { useTratarFalha } from "@/ui/ConexaoContext";

import styles from "./FolhaColarAgenda.module.css";
import { criarPlanoAction, lerAgendaAction } from "./plano/acoes";

/** Mesmo limite do momento (V9a, item 3; V9b, item 1, "mesmo botão de áudio, mesma rota, mesmo limite"). */
const LIMITE_SEGUNDOS_AUDIO = 120;

type Fase = "entrada" | "gravando" | "transcrevendo" | "lendo" | "revisao" | "confirmando";

/** V9d, item 4: um dia não entendido, mais a data que a pessoa escolheu (vazia até ela preencher). */
type DiaNaoEntendidoComEscolha = DiaNaoEntendido & { dataEscolhida: string };

/** webm/opus no Chrome e no Android, mp4/aac no Safari (`MediaRecorder.isTypeSupported`). */
function tipoMimeSuportado(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return null;
}

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
 * "Colar a agenda" (V9b, item 1): por áudio (mesma rota do momento,
 * `/api/momento/transcrever`) ou por texto direto. Depois de separar em
 * dias (`lerAgendaAction`), a pessoa confere a lista antes de confirmar
 * (`criarPlanoAction`); sem edição campo a campo nesta rodada, só a
 * conferência e o "Montar o plano".
 *
 * `confirmar` chama `router.refresh()` e só depois `aoFechar()`, nessa
 * ordem, em vez de `fecharEDepois` (achado do e2e desta etapa): sem URL
 * nova, o `history.back()` de `fecharEDepois` corre com o `refresh` e o
 * bloco "o seu plano de hoje" às vezes não aparecia sem um recarregamento
 * manual. `fecharEDepois` continua certo para fechar-e-navegar (as outras
 * folhas do projeto); aqui não há navegação, só dado novo na mesma tela.
 */
export function FolhaColarAgenda({ aoFechar }: Props) {
  const router = useRouter();
  const tratarFalha = useTratarFalha();

  const [fase, setFase] = useState<Fase>("entrada");
  const [texto, setTexto] = useState("");
  const [segundos, setSegundos] = useState(0);
  const [semMicrofone, setSemMicrofone] = useState(false);
  const [dias, setDias] = useState<DiaAgenda[]>([]);
  const [diasNaoEntendidos, setDiasNaoEntendidos] = useState<DiaNaoEntendidoComEscolha[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [camposFaltando, setCamposFaltando] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const segundosRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((faixa) => faixa.stop());
    };
  }, []);

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

  async function transcrever(blob: Blob, tipoMime: string) {
    setFase("transcrevendo");
    const forma = new FormData();
    forma.append("audio", blob, `agenda.${tipoMime.includes("mp4") ? "mp4" : "webm"}`);
    forma.append("duracaoS", String(segundosRef.current));

    try {
      const resposta = await fetch("/api/momento/transcrever", { method: "POST", body: forma });
      const dados = (await resposta.json().catch(() => null)) as { transcricao: string } | { erro: string } | null;
      if (!resposta.ok || !dados || "erro" in dados) {
        setErro(textosPlano.erroLerAgenda);
        setFase("entrada");
        return;
      }
      setTexto(dados.transcricao);
      await lerAgenda(dados.transcricao);
    } catch {
      setErro(textosPlano.erroLerAgenda);
      setFase("entrada");
    }
  }

  async function iniciarGravacao() {
    setErro(null);
    const tipoMime = tipoMimeSuportado();
    if (!navigator.mediaDevices?.getUserMedia || !tipoMime) {
      setSemMicrofone(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const gravador = new MediaRecorder(stream, { mimeType: tipoMime });
      pedacosRef.current = [];
      gravador.ondataavailable = (evento) => {
        if (evento.data.size > 0) pedacosRef.current.push(evento.data);
      };
      gravador.onstop = () => {
        stream.getTracks().forEach((faixa) => faixa.stop());
        const blob = new Blob(pedacosRef.current, { type: tipoMime });
        if (blob.size > 0) void transcrever(blob, tipoMime);
        else setFase("entrada");
      };
      gravadorRef.current = gravador;
      segundosRef.current = 0;
      setSegundos(0);
      gravador.start();
      setFase("gravando");
      timerRef.current = setInterval(() => {
        segundosRef.current += 1;
        setSegundos(segundosRef.current);
        if (segundosRef.current >= LIMITE_SEGUNDOS_AUDIO) pararGravacao();
      }, 1000);
    } catch {
      setSemMicrofone(true);
    }
  }

  function pararGravacao() {
    if (timerRef.current) clearInterval(timerRef.current);
    gravadorRef.current?.stop();
  }

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

  const naEntrada = fase === "entrada" || fase === "gravando" || fase === "transcrevendo" || fase === "lendo";

  return (
    <Folha
      titulo={textosPlano.tituloFolhaAgenda}
      aberto
      aoFechar={aoFechar}
      rodape={
        naEntrada ? (
          <Botao
            variante="primario"
            tamanho="lg"
            precisaDeRede
            disabled={fase === "gravando" || fase === "transcrevendo"}
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

          {semMicrofone ? null : (
            <div className={styles.blocoAudio}>
              {fase === "gravando" ? (
                <Botao variante="secundario" tamanho="lg" onClick={pararGravacao}>
                  <Square size={18} strokeWidth={1.75} aria-hidden="true" />
                  {textosPlano.botaoGravarAgenda}
                </Botao>
              ) : (
                <Botao
                  variante="secundario"
                  tamanho="lg"
                  precisaDeRede
                  disabled={fase === "transcrevendo"}
                  carregando={fase === "transcrevendo"}
                  onClick={iniciarGravacao}
                >
                  <Mic size={18} strokeWidth={1.75} aria-hidden="true" />
                  {textosPlano.botaoGravarAgenda}
                </Botao>
              )}
              {fase === "gravando" ? (
                <span className={[styles.status, styles.gravando].join(" ")} aria-live="polite">
                  {segundos}s
                </span>
              ) : null}
            </div>
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
