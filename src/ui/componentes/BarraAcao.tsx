"use client";

import { ID_FAIXA_SEM_CONEXAO, useConexao } from "@/ui/ConexaoContext";
import { useRecalcularAoFecharTeclado } from "@/ui/useRecalcularAoFecharTeclado";

import styles from "./BarraAcao.module.css";
import { MotivoSemRede } from "./MotivoSemRede";

export type AcaoBarra = {
  rotulo: string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  /**
   * A ação chama o servidor (V7, item 8 do PROXIMO.md): sem conexão o botão
   * fica desabilitado e o motivo ("Precisa de conexão.") aparece embaixo da
   * barra, em vez de a ação falhar ao toque.
   */
  precisaDeRede?: boolean;
};

type Props = {
  /** Opcional: o ultimo bloco do briefing nao tem para onde avancar manualmente (ComecarWizard). */
  primaria?: AcaoBarra;
  secundaria?: AcaoBarra;
  /**
   * H3, item 3: no celular, `/comecar` (o briefing) deixa de ter a barra fixa
   * por cima do resto da tela e passa a ser a última coisa do fluxo da página,
   * grudada no pé (`position: sticky`); sem isto, no iPhone em modo
   * aplicativo, a barra podia flutuar a meio da tela depois de fechar o
   * teclado. As outras telas (Roteiro, Objetivo) continuam fixas: a defesa
   * de `useRecalcularAoFecharTeclado`, abaixo, já vale para todas.
   */
  presaAoFluxo?: boolean;
};

/**
 * Barra fixa na base no celular, com um ou dois botoes (entrega/README.md,
 * "BarraAcao": nao esta no README, nome registrado em TODO.md porque as
 * telas usam mas a entrega nao documentou). As telas da parte 2 usam isto
 * dentro da casca; aqui e so o componente.
 *
 * `data-barra-acoes-propria` (V7, item 1 do PROXIMO.md): a capsula das abas
 * some enquanto esta barra esta na tela (`body:has(...)`, `(painel)/layout.module.css`),
 * como no Roteiro. Sem isto a capsula ficava por cima e cobria metade do
 * botao principal do Objetivo.
 */
export function BarraAcao({ primaria, secundaria, presaAoFluxo }: Props) {
  const { semConexao } = useConexao();
  const primariaSemRede = Boolean(primaria?.precisaDeRede) && semConexao;
  const secundariaSemRede = Boolean(secundaria?.precisaDeRede) && semConexao;
  useRecalcularAoFecharTeclado();

  return (
    <div
      className={[styles.barra, presaAoFluxo ? styles.presaAoFluxo : ""].filter(Boolean).join(" ")}
      data-barra-acoes-propria=""
    >
      <div className={styles.botoes}>
        {secundaria ? (
          <button
            type={secundaria.type ?? "button"}
            onClick={secundaria.onClick}
            disabled={secundaria.disabled || secundariaSemRede}
            aria-describedby={secundariaSemRede ? ID_FAIXA_SEM_CONEXAO : undefined}
            className={styles.secundaria}
          >
            {secundaria.rotulo}
          </button>
        ) : null}
        {primaria ? (
          <button
            type={primaria.type ?? "button"}
            onClick={primaria.onClick}
            disabled={primaria.disabled || primariaSemRede}
            aria-describedby={primariaSemRede ? ID_FAIXA_SEM_CONEXAO : undefined}
            className={styles.primaria}
          >
            {primaria.rotulo}
          </button>
        ) : null}
      </div>
      {primaria?.precisaDeRede || secundaria?.precisaDeRede ? <MotivoSemRede className={styles.motivo} /> : null}
    </div>
  );
}
