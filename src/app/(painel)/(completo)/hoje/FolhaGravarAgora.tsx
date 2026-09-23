"use client";

import { Mic, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { Objetivo } from "@/db/schema";
import { AJUDA_OBJETIVO, NOME_OBJETIVO, OBJETIVOS_EM_ORDEM } from "@/ia/enums";
import { textosMomento } from "@/textos/momento";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { Botao } from "@/ui/componentes/Botao";
import { Chips } from "@/ui/componentes/Chips";
import { Folha } from "@/ui/componentes/Folha";
import { OpcaoObjetivo } from "@/ui/componentes/OpcaoObjetivo";
import { useTratarFalha } from "@/ui/ConexaoContext";

import styles from "./FolhaGravarAgora.module.css";
import { gerarRoteiroMomentoAction } from "./momento/acoes";

/** O `MediaRecorder` do navegador para aqui (PROXIMO.md, V9a, item 3); a rota recusa áudio mais longo. */
const LIMITE_SEGUNDOS_AUDIO = 120;

type FaseAudio = "inicial" | "gravando" | "transcrevendo" | "erro";

function primeiraMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** webm/opus no Chrome e no Android, mp4/aac no Safari (`MediaRecorder.isTypeSupported`). */
function tipoMimeSuportado(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return null;
}

type MarcaResumo = { id: number; nome: string };

type Props = {
  /** Fecha a folha sem navegar (véu, Escape, "Cancelar", Voltar do aparelho). */
  aoFechar: () => void;
  /** Fecha a folha e só então abre o roteiro novo (`useFolhaNoHistorico`, o mesmo padrão de "abrir o roteiro reescrito"). */
  fecharEDepois: (acao: () => void) => void;
  objetivoRecomendado: Objetivo | null;
  /** As outras marcas de que a pessoa é membro, sem a marca ativa (V9a, item 4, "Falar de"). */
  marcas: MarcaResumo[];
};

/**
 * "Gravar agora" (V9a, item 3): áudio ou texto, sem tela do Opus (regra 11
 * do CLAUDE.md, monta só com `Folha`, `AreaTexto`, `Botao`, `OpcaoObjetivo`
 * e `Chips`, as peças que o design v2 já entregou). Não existe ícone de
 * microfone no conjunto do design (lacuna registrada em `TODO.md`); usa
 * `Mic`/`Square` do `lucide-react`, como o resto do painel já faz para todo
 * ícone fora dos poucos que vêm da entrega (`HojeTela.tsx`, `RoteiroTela.tsx`).
 */
export function FolhaGravarAgora({ aoFechar, fecharEDepois, objetivoRecomendado, marcas }: Props) {
  const router = useRouter();
  const tratarFalha = useTratarFalha();

  const [faseAudio, setFaseAudio] = useState<FaseAudio>("inicial");
  const [segundos, setSegundos] = useState(0);
  const [semMicrofone, setSemMicrofone] = useState(false);
  const [erroAudio, setErroAudio] = useState<string | null>(null);
  const [transcricao, setTranscricao] = useState<string | null>(null);

  const [onde, setOnde] = useState("");
  const [oQueEstaAcontecendo, setOQueEstaAcontecendo] = useState("");
  const [oQueDaParaMostrar, setOQueDaParaMostrar] = useState("");
  const [objetivo, setObjetivo] = useState<Objetivo | null>(objetivoRecomendado);
  const [marcaIndice, setMarcaIndice] = useState<number | null>(marcas.length > 0 ? 0 : null);

  const [camposFaltando, setCamposFaltando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const segundosRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sai gravando (troca de tela, fechar a folha) sem deixar o microfone ligado no fundo.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((faixa) => faixa.stop());
    };
  }, []);

  async function transcrever(blob: Blob, tipoMime: string) {
    setFaseAudio("transcrevendo");
    const forma = new FormData();
    forma.append("audio", blob, `momento.${tipoMime.includes("mp4") ? "mp4" : "webm"}`);
    forma.append("duracaoS", String(segundosRef.current));

    try {
      const resposta = await fetch("/api/momento/transcrever", { method: "POST", body: forma });
      const dados = (await resposta.json().catch(() => null)) as
        | { onde: string; oQueEstaAcontecendo: string; oQueDaParaMostrar: string; transcricao: string }
        | { erro: string }
        | null;
      if (!resposta.ok || !dados || "erro" in dados) {
        setFaseAudio("erro");
        setErroAudio(textosMomento.erroTranscricao);
        return;
      }
      setOnde(dados.onde);
      setOQueEstaAcontecendo(dados.oQueEstaAcontecendo);
      setOQueDaParaMostrar(dados.oQueDaParaMostrar);
      setTranscricao(dados.transcricao);
      setFaseAudio("inicial");
    } catch {
      setFaseAudio("erro");
      setErroAudio(textosMomento.erroTranscricao);
    }
  }

  async function iniciarGravacao() {
    setErroAudio(null);
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
        if (blob.size === 0) {
          setFaseAudio("erro");
          setErroAudio(textosMomento.audioVazio);
          return;
        }
        void transcrever(blob, tipoMime);
      };
      gravadorRef.current = gravador;
      segundosRef.current = 0;
      setSegundos(0);
      gravador.start();
      setFaseAudio("gravando");
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

  function validarCampos(): boolean {
    return onde.trim().length > 0 && oQueEstaAcontecendo.trim().length > 0 && oQueDaParaMostrar.trim().length > 0;
  }

  async function escrever() {
    if (!validarCampos() || !objetivo) {
      setCamposFaltando(true);
      return;
    }
    setCamposFaltando(false);
    setErroEnvio(null);
    setEnviando(true);
    try {
      const marcaId =
        marcaIndice !== null && marcaIndice > 0 ? marcas[marcaIndice - 1]?.id : undefined;
      const { id } = await gerarRoteiroMomentoAction({
        onde,
        oQueEstaAcontecendo,
        oQueDaParaMostrar,
        objetivo,
        marcaId,
        transcricao: transcricao ?? undefined,
      });
      fecharEDepois(() => router.push(`/roteiros/${id}`));
    } catch (falha) {
      setErroEnvio(tratarFalha(falha, textosMomento.erroGerar));
    } finally {
      setEnviando(false);
    }
  }

  const opcoesFalarDe = [textosMomento.falarDeNenhuma, ...marcas.map((marca) => marca.nome)];

  return (
    <Folha
      titulo={textosMomento.tituloFolha}
      aberto
      aoFechar={aoFechar}
      rodape={
        <Botao variante="primario" tamanho="lg" precisaDeRede carregando={enviando} onClick={escrever}>
          {enviando ? textosMomento.escrevendo : textosMomento.escreverRoteiro}
        </Botao>
      }
    >
      <p className={styles.instrucao}>{textosMomento.instrucaoAudio}</p>

      {semMicrofone ? (
        <p className={styles.avisoAudio}>{textosMomento.semMicrofone}</p>
      ) : (
        <div className={styles.blocoAudio}>
          {faseAudio === "gravando" ? (
            <Botao variante="secundario" tamanho="lg" onClick={pararGravacao}>
              <Square size={18} strokeWidth={1.75} aria-hidden="true" />
              {textosMomento.botaoParar}
            </Botao>
          ) : (
            <Botao
              variante="secundario"
              tamanho="lg"
              precisaDeRede
              disabled={faseAudio === "transcrevendo"}
              carregando={faseAudio === "transcrevendo"}
              onClick={iniciarGravacao}
            >
              <Mic size={18} strokeWidth={1.75} aria-hidden="true" />
              {faseAudio === "transcrevendo" ? textosMomento.transcrevendo : textosMomento.botaoGravar}
            </Botao>
          )}
          {faseAudio === "gravando" ? (
            <span className={[styles.status, styles.gravando].join(" ")} aria-live="polite">
              {textosMomento.gravando(segundos)}
            </span>
          ) : null}
          {erroAudio ? (
            <p className={styles.erro} role="alert">
              {erroAudio}
            </p>
          ) : null}
        </div>
      )}

      {transcricao ? (
        <div className={styles.oQueDisse}>
          <span className={styles.oQueDisseRotulo}>{textosMomento.oQueVoceDisse}</span>
          <p className={styles.oQueDisseTexto}>{transcricao}</p>
        </div>
      ) : null}

      <div className={styles.divisor}>{textosMomento.ouEscreva}</div>

      <AreaTexto
        rotulo={textosMomento.rotuloOnde}
        value={onde}
        onChange={(evento) => setOnde(evento.target.value)}
        linhasMin={2}
      />
      <AreaTexto
        rotulo={textosMomento.rotuloOQueEstaAcontecendo}
        value={oQueEstaAcontecendo}
        onChange={(evento) => setOQueEstaAcontecendo(evento.target.value)}
        linhasMin={2}
      />
      <AreaTexto
        rotulo={textosMomento.rotuloOQueDaParaMostrar}
        value={oQueDaParaMostrar}
        onChange={(evento) => setOQueDaParaMostrar(evento.target.value)}
        linhasMin={2}
      />

      <div className={styles.grupoObjetivo}>
        <span className={styles.rotuloGrupo}>{textosMomento.objetivo}</span>
        <div role="radiogroup" aria-label={textosMomento.objetivo} className={styles.opcoesObjetivo}>
          {OBJETIVOS_EM_ORDEM.map((opcao) => (
            <OpcaoObjetivo
              key={opcao}
              titulo={primeiraMaiuscula(NOME_OBJETIVO[opcao])}
              ajuda={AJUDA_OBJETIVO[opcao]}
              marcada={objetivo === opcao}
              recomendada={objetivoRecomendado === opcao}
              rotuloRecomendado={textosMomento.recomendado}
              onEscolher={() => setObjetivo(opcao)}
            />
          ))}
        </div>
      </div>

      {marcas.length > 0 ? (
        <Chips
          rotuloGrupo={textosMomento.falarDe}
          opcoes={opcoesFalarDe}
          selecionado={marcaIndice}
          onChange={setMarcaIndice}
        />
      ) : null}

      {camposFaltando ? (
        <p className={styles.erro} role="alert">
          {textosMomento.campoVazio}
        </p>
      ) : null}
      {erroEnvio ? (
        <p className={styles.erro} role="alert">
          {erroEnvio}
        </p>
      ) : null}
    </Folha>
  );
}
