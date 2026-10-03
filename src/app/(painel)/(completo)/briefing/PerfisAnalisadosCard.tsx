import { estadoDoPerfilAnalisado } from "@/lib/perfil-analisado-motivo";
import { comArroba } from "@/lib/perfil-redes";
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

const FRASE_POR_MOTIVO = {
  tiktok_desligado: t.tiktokDesligado,
  nao_encontrado: t.naoEncontrado,
  sem_videos: t.semVideos,
  conta_restrita: t.contaRestrita,
} as const;

/** A leitura, o aviso de que ainda está lendo, ou a frase do motivo (só "não encontrado" fala em conferir o @). */
function CorpoDoPerfil({ perfil }: { perfil: PerfilAnalisadoComTipo }) {
  const estado = estadoDoPerfilAnalisado(perfil);
  if (estado.tipo === "leitura") return <p className={styles.leitura}>{perfil.leitura}</p>;
  if (estado.tipo === "lendo") return <p className={styles.pendente}>{t.pendente}</p>;
  return <p className={styles.naoEncontrado}>{FRASE_POR_MOTIVO[estado.motivo]}</p>;
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
                  <span className={styles.handle}>{comArroba(perfil.handle)}</span>
                  <span className={styles.rotulo}>{rotuloDoPerfil(perfil)}</span>
                </div>
                <CorpoDoPerfil perfil={perfil} />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
