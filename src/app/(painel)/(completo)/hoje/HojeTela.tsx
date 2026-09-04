"use client";

import { useRouter } from "next/navigation";

import type { TemaDoDia } from "@/db/schema";
import { ROTULO_TEMA_CARTAO } from "@/ia/enums";
import type { Constancia } from "@/servicos/temas";
import { textosHoje } from "@/textos/hoje";
import { TemaCartao } from "@/ui/componentes/TemaCartao";

import styles from "./HojeTela.module.css";

type Props = {
  temas: TemaDoDia[];
  avisoLinhaEditorial: string | null;
  constancia: Constancia;
};

function fraseConstancia(constancia: Constancia): string {
  if (constancia.tipo === "primeiro_dia") return textosHoje.constancia.primeiroDia;
  if (constancia.tipo === "seguidos") return textosHoje.constancia.seguidos(constancia.dias);
  return textosHoje.constancia.parado(constancia.dias);
}

const DATA_POR_EXTENSO = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

function dataDeHojePorExtenso(): string {
  const texto = DATA_POR_EXTENSO.format(new Date());
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** `/hoje` (etapa 10, brief-frontend.md 6.3), sem o cartão de roteiro (etapa 11). */
export function HojeTela({ temas, avisoLinhaEditorial, constancia }: Props) {
  const router = useRouter();

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalho}>
        <span className={styles.data}>{dataDeHojePorExtenso()}</span>
        <h1 className={styles.titulo}>{textosHoje.titulo}</h1>
        <p className={styles.constancia}>{fraseConstancia(constancia)}</p>
      </div>

      {avisoLinhaEditorial ? <p className={styles.aviso}>{avisoLinhaEditorial}</p> : null}

      <div className={styles.grade}>
        {temas.map((tema, indice) => (
          <TemaCartao
            key={`${tema.titulo}-${indice}`}
            rotulo={ROTULO_TEMA_CARTAO[tema.puxaPara]}
            tema={tema.titulo}
            porque={tema.porQue}
            evidencia={textosHoje.evidencia(tema.evidencias.length)}
            primario={indice === 0}
            rotuloBotao={textosHoje.queroEsse}
            onEscolher={() => router.push(`/hoje/objetivo?tema=${indice}`)}
          />
        ))}
      </div>

      <button type="button" className={styles.outraCoisa} onClick={() => router.push("/hoje/tema-livre")}>
        {textosHoje.outraCoisa}
      </button>
    </div>
  );
}
