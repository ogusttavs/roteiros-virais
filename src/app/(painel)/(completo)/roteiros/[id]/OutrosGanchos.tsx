"use client";

import { Check, CircleAlert, Shuffle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import type { VisaoDosGanchos } from "@/servicos/ganchos-alternativos";
import { ROTULO_DA_EMOCAO, ROTULO_DO_TIPO_DE_ABERTURA, textosGanchos } from "@/textos/ganchos";
import { Botao } from "@/ui/componentes/Botao";
import { Cartao } from "@/ui/componentes/Cartao";
import { useTratarFalha } from "@/ui/ConexaoContext";

import { pedirGanchosAction, trocarGanchoAction } from "./ganchos-acoes";
import styles from "./OutrosGanchos.module.css";

const t = textosGanchos;

type Props = { roteiroId: number; visao: VisaoDosGanchos };
type Resposta = { ok: true; dado: { ganchos: VisaoDosGanchos } } | { ok: false; erro: string };

/**
 * "Outros ganchos" (25/11/2026): um seletor pequeno no alto do roteiro. Um toque pede de 3 a 5 jeitos de abrir o mesmo vídeo (uma vez por roteiro; a lista fica guardada); outro toque troca o gancho do
 * roteiro, e o escolhido fica gravado para a curva dizer depois qual rendeu. No "ver como" e com o roteiro já gravado, a lista só mostra: nenhum botão de trocar.
 */
export function OutrosGanchos({ roteiroId, visao: inicial }: Props) {
  const router = useRouter();
  const tratarFalha = useTratarFalha();
  const [visao, setVisao] = useState<VisaoDosGanchos>(inicial);
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState<"pedindo" | "trocando" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const rodar = useCallback(
    async (como: "pedindo" | "trocando", acao: () => Promise<Resposta>, feito?: string) => {
      if (ocupado) return;
      setOcupado(como);
      setErro(null);
      setAviso(null);
      try {
        const r = await acao();
        if (!r.ok) {
          setErro(r.erro);
          return;
        }
        setVisao({ ...r.dado.ganchos, verComo: visao.verComo });
        setAberto(true);
        if (feito) {
          setAviso(feito);
          router.refresh();
        }
      } catch (falha) {
        setErro(tratarFalha(falha, t.falhaGenerica, t.semConexao));
      } finally {
        setOcupado(null);
      }
    },
    [ocupado, router, tratarFalha, visao.verComo],
  );

  const alternativas = visao.alternativas;
  const podeMexer = !visao.verComo && !visao.fechado;

  return (
    <Cartao variante="recuado" className={styles.caixa} data-outros-ganchos>
      <div className={styles.topo}>
        <p className={styles.titulo}>
          <Shuffle size={18} strokeWidth={1.5} aria-hidden="true" />
          {t.titulo}
        </p>
        {alternativas ? (
          <button type="button" className={styles.link} onClick={() => setAberto((a) => !a)} aria-expanded={aberto}>
            {aberto ? t.botaoFechar : t.botaoAbrir}
          </button>
        ) : podeMexer ? (
          <Botao type="button" variante="secundario" precisaDeRede carregando={ocupado === "pedindo"} disabled={ocupado !== null} onClick={() => void rodar("pedindo", () => pedirGanchosAction(roteiroId))} data-pedir-ganchos>
            {t.botao}
          </Botao>
        ) : null}
      </div>

      {!alternativas ? <p className={styles.nota}>{t.ajuda}</p> : null}
      {ocupado === "pedindo" ? (
        <p className={styles.nota} role="status">
          {t.escrevendo}
        </p>
      ) : null}
      {visao.verComo ? <p className={styles.nota}>{t.aviso.verComo}</p> : null}
      {visao.fechado && !visao.verComo ? <p className={styles.nota}>{t.aviso.fechado}</p> : null}

      {alternativas && aberto ? (
        <ul className={styles.lista}>
          {visao.escolhido !== null && visao.original ? (
            <li className={styles.item} data-gancho-original>
              <span className={styles.rotuloDoItem}>{t.deAntes}</span>
              <p className={styles.texto}>{visao.original.texto}</p>
              {podeMexer ? (
                <Botao type="button" variante="ghost" precisaDeRede disabled={ocupado !== null} carregando={ocupado === "trocando"} onClick={() => void rodar("trocando", () => trocarGanchoAction(roteiroId, "original"), t.voltou)} data-voltar-gancho>
                  {t.voltar}
                </Botao>
              ) : null}
            </li>
          ) : null}
          {alternativas.map((g, i) => {
            const valendo = visao.escolhido === i;
            return (
              <li key={i} className={`${styles.item} ${valendo ? styles.valendo : ""}`} data-gancho-alternativo={i} aria-current={valendo ? "true" : undefined}>
                <p className={styles.texto}>{g.texto}</p>
                <p className={styles.etiquetas}>
                  <span className={styles.etiqueta}>{ROTULO_DO_TIPO_DE_ABERTURA[g.tipoAbertura]}</span>
                  <span className={styles.etiqueta}>{ROTULO_DA_EMOCAO[g.emocao]}</span>
                </p>
                {valendo ? (
                  <span className={styles.usando}>
                    <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                    {t.usando}
                  </span>
                ) : podeMexer ? (
                  <Botao type="button" variante="secundario" precisaDeRede disabled={ocupado !== null} carregando={ocupado === "trocando"} onClick={() => void rodar("trocando", () => trocarGanchoAction(roteiroId, i), t.trocou)} data-usar-gancho={i}>
                    {t.usar}
                  </Botao>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {aviso ? (
        <p className={styles.nota} role="status" data-aviso-gancho>
          {aviso}
        </p>
      ) : null}
      {erro ? (
        <p className={styles.erro} role="alert">
          <CircleAlert size={18} strokeWidth={1.5} aria-hidden="true" />
          {erro}
        </p>
      ) : null}
    </Cartao>
  );
}
