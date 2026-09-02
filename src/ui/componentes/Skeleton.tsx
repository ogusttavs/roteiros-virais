import styles from "./Skeleton.module.css";

type Props = {
  altura?: number | string;
  largura?: number | string;
  arredondado?: boolean;
  className?: string;
};

export function Skeleton({ altura = 16, largura = "100%", arredondado = false, className }: Props) {
  const classes = [styles.skeleton, arredondado ? styles.arredondado : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      style={{
        height: typeof altura === "number" ? `${altura}px` : altura,
        width: typeof largura === "number" ? `${largura}px` : largura,
      }}
      aria-hidden="true"
    />
  );
}
