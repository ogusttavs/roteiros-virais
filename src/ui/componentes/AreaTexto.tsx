"use client";

import { CircleAlert } from "lucide-react";
import { useId, type Ref, type TextareaHTMLAttributes } from "react";

import styles from "./AreaTexto.module.css";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> & {
  rotulo: string;
  /** O rotulo continua acessivel (label ligado ao campo), so some visualmente: uso quando outro texto na tela (o enunciado da pergunta) ja serve de rotulo visivel (BriefingTela.dc.html). */
  rotuloOculto?: boolean;
  ajuda?: string;
  erro?: string;
  /** Ja formatado ("128 caracteres") por quem chama. */
  contador?: string;
  /** Linhas visiveis antes de crescer com o texto (entrega/README.md). Ignorado quando `caixaAlta`. */
  linhasMin?: number;
  /**
   * Caixa alta de proposito, com altura fixa e redimensionavel a mao em vez
   * de crescer com o texto (design v2, `base.css`, ".campo textarea"; o
   * tamanho do campo e uma instrucao). So o briefing usa: as outras telas
   * continuam com `linhasMin` mais `field-sizing: content`.
   */
  caixaAlta?: "padrao" | "longa";
  /**
   * P1, item 8: "Usar esta sugestão" precisa levar o foco para o campo
   * depois de copiar o texto. React 19 aceita `ref` como prop comum em
   * componente de funcao, sem `forwardRef`.
   */
  ref?: Ref<HTMLTextAreaElement>;
};

/** Igual a Campo, mas cresce com o texto (`field-sizing: content`, entrega/README.md), a menos que `caixaAlta`. */
export function AreaTexto({
  rotulo,
  rotuloOculto = false,
  ajuda,
  erro,
  contador,
  linhasMin = 3,
  caixaAlta,
  className,
  ref,
  ...props
}: Props) {
  const id = useId();
  const idAjuda = ajuda ? `${id}-ajuda` : undefined;
  const idErro = erro ? `${id}-erro` : undefined;

  return (
    <div className={styles.grupo}>
      <label className={[styles.rotulo, rotuloOculto ? styles.rotuloOculto : ""].filter(Boolean).join(" ")} htmlFor={id}>
        {rotulo}
      </label>
      {ajuda ? (
        <span className={styles.ajuda} id={idAjuda}>
          {ajuda}
        </span>
      ) : null}
      <textarea
        id={id}
        ref={ref}
        rows={caixaAlta ? undefined : linhasMin}
        className={[
          styles.area,
          caixaAlta === "padrao" ? styles.areaAlta : "",
          caixaAlta === "longa" ? styles.areaLonga : "",
          erro ? styles.comErro : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        aria-describedby={[idAjuda, idErro].filter(Boolean).join(" ") || undefined}
        aria-invalid={Boolean(erro)}
        {...props}
      />
      {/* Abaixo do campo, a direita: era ali que o contador se sobrepunha ao texto no painel antigo (design v2, "O que o Briefing resolve", item 1). */}
      {contador ? <span className={styles.contador}>{contador}</span> : null}
      {erro ? (
        <span className={styles.erro} id={idErro} role="alert">
          <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
          {erro}
        </span>
      ) : null}
    </div>
  );
}
