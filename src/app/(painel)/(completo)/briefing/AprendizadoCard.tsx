"use client";

import { useState, useTransition } from "react";

import type { RegraCliente } from "@/servicos/aprendizado";
import { textosBriefing } from "@/textos/briefing";
import cartaoStyles from "@/ui/componentes/Cartao.module.css";

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
  const [regras, setRegras] = useState(regrasIniciais);
  const [idPendente, setIdPendente] = useState<number | null>(null);
  const [, iniciarTransicao] = useTransition();

  function alternar(regraId: number, ativarDeNovo: boolean) {
    setRegras((atual) =>
      atual.map((regra) =>
        regra.id === regraId ? { ...regra, ativa: ativarDeNovo, desativadaEm: ativarDeNovo ? null : new Date() } : regra,
      ),
    );

    setIdPendente(regraId);
    iniciarTransicao(async () => {
      try {
        if (ativarDeNovo) await reativarRegraAction(regraId);
        else await desativarRegraAction(regraId);
      } catch {
        setRegras((atual) =>
          atual.map((regra) =>
            regra.id === regraId ? { ...regra, ativa: !ativarDeNovo, desativadaEm: ativarDeNovo ? new Date() : null } : regra,
          ),
        );
      } finally {
        setIdPendente((atual) => (atual === regraId ? null : atual));
      }
    });
  }

  return (
    <section
      className={[cartaoStyles.cartao, cartaoStyles.recuado, styles.cartao].join(" ")}
      aria-label={t.titulo}
    >
      <div>
        <h2 className={styles.titulo}>{t.titulo}</h2>
        <p className={styles.subtitulo}>{t.subtitulo}</p>
      </div>

      {regras.length === 0 ? (
        <p className={styles.vazio}>{t.vazio}</p>
      ) : (
        <div className={styles.regras}>
          {regras.map((regra) => (
            <div key={regra.id} className={styles.regra}>
              <span className={styles.oque}>{regra.regra}</span>
              {regra.ativa ? (
                <button
                  type="button"
                  className={styles.acao}
                  disabled={idPendente === regra.id}
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
                    disabled={idPendente === regra.id}
                    onClick={() => alternar(regra.id, true)}
                  >
                    {t.desfazer}
                  </button>
                </span>
              )}
              <span className={styles.deOnde}>
                {regra.ativa ? t.deOnde(regra.contagem, regra.ultimaEm) : t.naoEntraMaisNosSeusRoteiros}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
