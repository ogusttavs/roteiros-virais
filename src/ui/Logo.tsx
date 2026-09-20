import { config } from "@/lib/config";

import styles from "./Logo.module.css";

type Props = {
  /** A altura do desenho; a largura sai da proporção do SVG (entrega/README.md). */
  altura?: number;
};

/**
 * O logotipo por extenso (V5, item 3, entregaveis/design-v2/entrega/marca/):
 * "klaki" desenhado, com a luz da marca na barriga do "a". Só a partir de
 * 48 px de largura (IDENTIDADE.md, "nunca usar o logotipo menor que isso");
 * abaixo disso, use `Simbolo`. Dois arquivos, trocados por tema (ver
 * `Logo.module.css`); nunca recolorido fora das versões dadas.
 */
export function Logo({ altura = 28 }: Props) {
  return (
    <span className={styles.marca} style={{ height: altura }} role="img" aria-label={config.appName}>
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG de marca, arquivo estático, sem otimização de imagem. */}
      <img src="/marca/klaki-logotipo.svg" alt="" className={styles.claro} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/marca/klaki-logotipo-branco.svg" alt="" className={styles.escuro} />
    </span>
  );
}

/**
 * O símbolo (a claquete aberta, com a luz na tira): o ícone do aplicativo e
 * o que cabe abaixo de 48 px de largura (barra do topo, barra lateral
 * recolhida, cabeçalhos compactos).
 */
export function Simbolo({ altura = 24 }: Props) {
  return (
    <span className={styles.marca} style={{ height: altura }} role="img" aria-label={config.appName}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/marca/klaki-simbolo.svg" alt="" className={styles.claro} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/marca/klaki-simbolo-branco.svg" alt="" className={styles.escuro} />
    </span>
  );
}
