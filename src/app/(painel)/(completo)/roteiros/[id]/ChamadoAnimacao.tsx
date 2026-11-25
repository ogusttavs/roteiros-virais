"use client";

import { CircleAlert, Download, Film } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { VisaoDaAnimacao, VistaDaAnimacao } from "@/servicos/animacao";
import { linhaDoEstadoDaAnimacao, textosAnimacao } from "@/textos/animacao";
import { Botao } from "@/ui/componentes/Botao";
import { Cartao } from "@/ui/componentes/Cartao";
import { useTratarFalha } from "@/ui/ConexaoContext";

import { aprovarAnimacaoAction, dispensarAnimacaoAction, pedirAnimacaoAction, tentarAnimacaoDeNovoAction } from "./animacao-acoes";
import styles from "./ChamadoAnimacao.module.css";

const t = textosAnimacao;

/** Perguntar de novo a cada 3 segundos enquanto o vídeo está sendo montado. */
const ESPERA_DA_CONSULTA_MS = 3000;
const ESTADOS_DE_ESPERA = new Set(["pedida", "fazendo_previa", "fazendo_final"]);

type Props = {
  roteiroId: number;
  visao: VisaoDaAnimacao;
};

/**
 * E68 A3: "Sem tempo de gravar hoje? Fazer em animação". Um cartão no corpo do roteiro (só para quem está na lista de contas, a página nem o manda aos outros) que leva o pedido da animação do
 * texto do roteiro até o arquivo para baixar: pedir, prévia sendo montada, prévia para ver (aprovar ou "Agora não"), final sendo montado, final para baixar, ou falha com "Tentar de novo".
 * No "ver como" o cartão só mostra em que ponto está: nenhum botão.
 */
export function ChamadoAnimacao({ roteiroId, visao }: Props) {
  const tratarFalha = useTratarFalha();
  const [animacao, setAnimacao] = useState<VistaDaAnimacao | null>(visao.animacao);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [videoQuebrou, setVideoQuebrou] = useState(false);
  const estado = animacao?.estado ?? null;

  // Enquanto o vídeo é montado, pergunta ao servidor como anda.
  useEffect(() => {
    if (!animacao || !ESTADOS_DE_ESPERA.has(animacao.estado)) return;
    const id = animacao.id;
    let vigente = true;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const consultar = async () => {
      try {
        const resposta = await fetch(`/api/animacao/${id}`, { cache: "no-store" });
        if (!vigente) return;
        if (resposta.ok) setAnimacao((await resposta.json()) as VistaDaAnimacao);
        else if (resposta.status === 404) setAnimacao(null);
      } catch {
        // Sem rede por um instante: tenta de novo na próxima rodada.
      }
      if (vigente) espera = setTimeout(() => void consultar(), ESPERA_DA_CONSULTA_MS);
    };
    espera = setTimeout(() => void consultar(), ESPERA_DA_CONSULTA_MS);
    return () => {
      vigente = false;
      if (espera) clearTimeout(espera);
    };
    // Só recomeça a perguntar quando muda a animação ou o estado dela, não a cada resposta com o mesmo estado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animacao?.id, animacao?.estado]);

  const rodar = useCallback(
    async (acao: () => Promise<{ ok: true; dado: { animacao: VistaDaAnimacao | null } } | { ok: false; erro: string }>) => {
      if (ocupado) return;
      setOcupado(true);
      setErro(null);
      setVideoQuebrou(false);
      try {
        const r = await acao();
        if (!r.ok) {
          setErro(r.erro);
          return;
        }
        setAnimacao(r.dado.animacao);
      } catch (falha) {
        setErro(tratarFalha(falha, t.frases["nao-comecou"], t.frases["nao-comecou"]));
      } finally {
        setOcupado(false);
      }
    },
    [ocupado, tratarFalha],
  );

  const linha = linhaDoEstadoDaAnimacao(estado, animacao?.tempoDaPrevia ?? "", animacao?.tempoDoFinal ?? "", animacao?.motivo);
  const andamento = animacao?.progresso != null && ESTADOS_DE_ESPERA.has(animacao.estado) ? animacao.progresso : null;
  const mostrarBotoes = !visao.verComo;

  return (
    <Cartao variante="recuado" className={styles.chamado} data-chamado-animacao data-estado-da-animacao={estado ?? undefined}>
      <div className={styles.texto}>
        <Film size={20} strokeWidth={1.5} className={styles.icone} aria-hidden="true" />
        <div className={styles.frases}>
          <p className={styles.titulo}>{t.chamado.titulo}</p>
          {linha ? (
            <p className={estado === "falhou" ? styles.falha : styles.estado} role="status">
              {linha}
            </p>
          ) : (
            <p className={styles.nota}>{t.chamado.texto}</p>
          )}
        </div>
      </div>

      {estado && ESTADOS_DE_ESPERA.has(estado) ? <progress className={styles.barra} max={100} value={andamento ?? undefined} aria-label={linha ?? ""} data-progresso /> : null}
      {andamento !== null ? <p className={styles.nota}>{t.aviso.andamento(andamento)}</p> : null}

      {animacao && estado === "previa_pronta" && !visao.verComo ? (
        <>
          <video className={styles.video} controls playsInline preload="metadata" src={`/api/animacao/${animacao.id}/previa`} onError={() => setVideoQuebrou(true)} data-previa-da-animacao />
          {videoQuebrou ? <p className={styles.erro}>{t.aviso.videoQuebrou}</p> : null}
        </>
      ) : null}

      {animacao && estado === "final_pronta" && !visao.verComo ? (
        <>
          <video className={styles.video} controls playsInline preload="metadata" src={`/api/animacao/${animacao.id}/final`} onError={() => setVideoQuebrou(true)} data-final-da-animacao />
          {videoQuebrou ? <p className={styles.erro}>{t.aviso.videoQuebrou}</p> : null}
        </>
      ) : null}

      {erro ? (
        <p className={styles.erro} role="alert">
          <CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
          {erro}
        </p>
      ) : null}

      {visao.verComo ? <p className={styles.nota}>{t.aviso.verComo}</p> : null}

      {mostrarBotoes ? (
        <div className={styles.botoes}>
          {!animacao ? (
            <Botao type="button" variante="secundario" precisaDeRede disabled={ocupado || visao.outraEmAndamento} carregando={ocupado} onClick={() => void rodar(() => pedirAnimacaoAction(roteiroId))} data-pedir-animacao>
              {t.chamado.botao}
            </Botao>
          ) : null}
          {!animacao && visao.outraEmAndamento ? <p className={styles.nota}>{t.frases["em-andamento"]}</p> : null}

          {animacao && estado === "previa_pronta" ? (
            <>
              <Botao type="button" precisaDeRede disabled={ocupado} carregando={ocupado} onClick={() => void rodar(() => aprovarAnimacaoAction(animacao.id))} data-aprovar-animacao>
                {t.acoes.aprovar}
              </Botao>
              <Botao type="button" variante="ghost" disabled={ocupado} onClick={() => void rodar(() => dispensarAnimacaoAction(animacao.id))} data-dispensar-animacao>
                {t.acoes.agoraNao}
              </Botao>
            </>
          ) : null}

          {animacao && estado === "final_pronta" ? (
            <a className={styles.botaoLink} href={`/api/animacao/${animacao.id}/final?baixar=1`} download="video-em-animacao.mp4" data-baixar-animacao>
              <Download size={18} strokeWidth={1.75} aria-hidden="true" />
              {t.acoes.baixar}
            </a>
          ) : null}

          {animacao && estado === "falhou" ? (
            <Botao type="button" precisaDeRede disabled={ocupado} carregando={ocupado} onClick={() => void rodar(() => tentarAnimacaoDeNovoAction(animacao.id))} data-tentar-animacao>
              {t.acoes.tentarDeNovo}
            </Botao>
          ) : null}
        </div>
      ) : null}
    </Cartao>
  );
}
