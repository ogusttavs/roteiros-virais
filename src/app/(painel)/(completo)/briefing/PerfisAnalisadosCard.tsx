import type { PerfilAnalisadoComTipo } from "@/servicos/perfis-analisados";
import { textosBriefing } from "@/textos/briefing";
import cartaoStyles from "@/ui/componentes/Cartao.module.css";

import styles from "./PerfisAnalisadosCard.module.css";

const t = textosBriefing.contextoMarca;

type Props = { perfis: PerfilAnalisadoComTipo[] };

function rotuloDoPerfil(perfil: PerfilAnalisadoComTipo): string {
  if (perfil.origem === "propria_marca") return t.rotuloPropriaMarca;
  return perfil.tipoCitado === "admira" ? t.rotuloAdmira : t.rotuloConcorrente;
}

/**
 * "O que a IA viu nos perfis" (E38, partes 2 e 3): a leitura curta de cada perfil citado pelo
 * cliente (concorrente ou admira) e da própria marca, conferidos de verdade na API
 * (`perfisAnalisados`). Server Component, sem ação nenhuma nesta rodada: só mostra o que o job
 * `analisar-perfil` já escreveu; a conferência roda sozinha quando o perfil é citado ou salvo.
 */
export function PerfisAnalisadosCard({ perfis }: Props) {
  return (
    <section className={[cartaoStyles.cartao, cartaoStyles.recuado, styles.cartao].join(" ")} aria-label={t.titulo}>
      {perfis.length === 0 ? (
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
          <div className={styles.lista}>
            {perfis.map((perfil) => (
              <div key={perfil.id} className={styles.item}>
                <div className={styles.cabecalho}>
                  <span className={styles.handle}>@{perfil.handle}</span>
                  <span className={styles.rotulo}>{rotuloDoPerfil(perfil)}</span>
                </div>
                {perfil.leitura ? (
                  <p className={styles.leitura}>{perfil.leitura}</p>
                ) : perfil.existeNaRede ? (
                  <p className={styles.pendente}>{t.pendente}</p>
                ) : (
                  <p className={styles.naoEncontrado}>{t.naoEncontrado}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
