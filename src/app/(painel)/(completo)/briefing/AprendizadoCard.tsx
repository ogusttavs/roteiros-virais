"use client";

import { CircleAlert } from "lucide-react";
import { useState, useTransition } from "react";

import type { RegraCliente } from "@/servicos/aprendizado";
import { textosBriefing } from "@/textos/briefing";
import cartaoStyles from "@/ui/componentes/Cartao.module.css";
import { MotivoSemRede } from "@/ui/componentes/MotivoSemRede";
import { ID_FAIXA_SEM_CONEXAO, useConexao, useTratarFalha } from "@/ui/ConexaoContext";

// O erro em linha do briefing (icone e cor de erro), o mesmo das respostas, para a mensagem sob a regra.
import perguntaStyles from "../../_briefing/PerguntaCampo.module.css";

import { desativarRegraAction, reativarRegraAction } from "./acoes";
import styles from "./AprendizadoCard.module.css";

const t = textosBriefing.aprendizado;

type Props = { regrasIniciais: RegraCliente[] };

/**
 * "O que a gente aprendeu com você" (E27 parte 2, item 4, `Briefing.dc.html`):
 * as regras ativas com "Não é bem assim" (desativa), as desativadas com
 * "Desfazer" (reativa), e o estado vazio quando o cliente nunca reprovou
 * nada ainda. Otimista, mesmo padrão de `alternarFavorito` em
 * `ReferenciasTela.tsx`: a tela muda na hora, desfaz se a ação falhar.
 */
export function AprendizadoCard({ regrasIniciais }: Props) {
  const { semConexao, avisarRedeOk } = useConexao();
  const tratarFalha = useTratarFalha();
  const [regras, setRegras] = useState(regrasIniciais);
  /**
   * Um Set de ids, nao um id so (V7, item 4 do PROXIMO.md): tocar na regra B com a A ainda pendente
   * liberava o botao da A, e o desfazer da A depois podia apagar um toque novo nela.
   */
  const [idsPendentes, setIdsPendentes] = useState<ReadonlySet<number>>(() => new Set());
  /** A frase de erro de cada regra, embaixo da linha dela. */
  const [erros, setErros] = useState<Record<number, string>>({});
  const [, iniciarTransicao] = useTransition();

  function alternar(regraId: number, ativarDeNovo: boolean) {
    setRegras((atual) =>
      atual.map((regra) =>
        regra.id === regraId ? { ...regra, ativa: ativarDeNovo, desativadaEm: ativarDeNovo ? null : new Date() } : regra,
      ),
    );

    setErros((atual) => {
      const proximo = { ...atual };
      delete proximo[regraId];
      return proximo;
    });
    setIdsPendentes((atual) => new Set(atual).add(regraId));
    iniciarTransicao(async () => {
      try {
        if (ativarDeNovo) await reativarRegraAction(regraId);
        else await desativarRegraAction(regraId);
        avisarRedeOk();
      } catch (falha) {
        // A linha volta ao que era, e a frase diz que nao deu certo (antes voltava calada, e a regra
        // rejeitada seguia guiando os roteiros sem a pessoa saber).
        const frase = ativarDeNovo
          ? tratarFalha(falha, t.erroDesfazer, t.semConexaoDesfazer)
          : tratarFalha(falha, t.erroDesligar, t.semConexaoDesligar);
        setRegras((atual) =>
          atual.map((regra) =>
            regra.id === regraId ? { ...regra, ativa: !ativarDeNovo, desativadaEm: ativarDeNovo ? new Date() : null } : regra,
          ),
        );
        setErros((atual) => ({ ...atual, [regraId]: frase }));
      } finally {
        setIdsPendentes((atual) => {
          const proximo = new Set(atual);
          proximo.delete(regraId);
          return proximo;
        });
      }
    });
  }

  const passo = regras.length === 0 ? "semAprendizado" : regras.some((r) => !r.ativa) ? "regraDesativada" : "normal";

  return (
    <section
      className={[cartaoStyles.cartao, cartaoStyles.recuado, styles.cartao].join(" ")}
      aria-label={t.titulo}
      data-passo={passo}
    >
      {regras.length === 0 ? (
        <>
          <h2 className={styles.titulo}>{t.titulo}</h2>
          <p className={styles.vazio}>{t.vazio}</p>
        </>
      ) : (
        <>
          <div>
            <h2 className={styles.titulo}>{t.titulo}</h2>
            <p className={styles.subtitulo}>{t.subtitulo}</p>
          </div>
          <div className={styles.regras}>
            {regras.map((regra) => (
              <div
                key={regra.id}
                className={[styles.regra, !regra.ativa ? styles.desativada : ""].filter(Boolean).join(" ")}
              >
                <span className={styles.oque}>{regra.regra}</span>
                {regra.ativa ? (
                  <button
                    type="button"
                    className={styles.acao}
                    disabled={idsPendentes.has(regra.id) || semConexao}
                    aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
                    onClick={() => alternar(regra.id, false)}
                  >
                    {t.naoEBemAssim}
                  </button>
                ) : (
                  <span className={styles.desfazer}>
                    {t.desativada}
                    <button
                      type="button"
                      className={styles.acao}
                      disabled={idsPendentes.has(regra.id) || semConexao}
                      aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
                      onClick={() => alternar(regra.id, true)}
                    >
                      {t.desfazer}
                    </button>
                  </span>
                )}
                <span className={styles.deOnde}>
                  {regra.ativa ? t.deOnde(regra.contagem, regra.ultimaEm) : t.naoEntraMaisNosSeusRoteiros}
                </span>
                {/* Sem conexao os dois botoes acima ficam desabilitados: o motivo escrito, na coluna do texto. */}
                <MotivoSemRede className={styles.deOnde} />
                {erros[regra.id] ? (
                  <span className={styles.deOnde} role="alert">
                    <span className={perguntaStyles.erroInline}>
                      <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
                      {erros[regra.id]}
                    </span>
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
