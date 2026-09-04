"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ConteudoRoteiro, Objetivo, TemaDoDia } from "@/db/schema";
import { ROTULO_TEMA_CARTAO } from "@/ia/enums";
import type { Constancia } from "@/servicos/temas";
import { textosHoje } from "@/textos/hoje";
import { TemaCartao } from "@/ui/componentes/TemaCartao";

import styles from "./HojeTela.module.css";

type RoteiroDeHoje = { id: number; objetivo: Objetivo; criadoEm: Date; corpo: ConteudoRoteiro };

type Props = {
  temas: TemaDoDia[];
  avisoLinhaEditorial: string | null;
  constancia: Constancia;
  roteiroHoje: RoteiroDeHoje | null;
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

function horaDeHoje(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(data);
}

/** `/hoje` (etapa 10, brief-frontend.md 6.3; o cartão de roteiro é a etapa 11, `HojeCelular.dc.html`). */
export function HojeTela({ temas, avisoLinhaEditorial, constancia, roteiroHoje }: Props) {
  const router = useRouter();
  const [outrosAbertos, setOutrosAbertos] = useState(false);

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalho}>
        <span className={styles.data}>{dataDeHojePorExtenso()}</span>
        <h1 className={styles.titulo}>{textosHoje.titulo}</h1>
        <p className={styles.constancia}>{fraseConstancia(constancia)}</p>
      </div>

      {avisoLinhaEditorial ? <p className={styles.aviso}>{avisoLinhaEditorial}</p> : null}

      {roteiroHoje ? (
        <div className={styles.cartaoRoteiro}>
          <span className={styles.rotuloRoteiro}>
            {textosHoje.roteiroDeHoje} · {ROTULO_TEMA_CARTAO[roteiroHoje.objetivo]}
          </span>
          <h2 className={styles.tituloRoteiro}>{roteiroHoje.corpo.titulo}</h2>
          <p className={styles.ganchoRoteiro}>{roteiroHoje.corpo.gancho}</p>
          <span className={styles.escritoAs}>
            {textosHoje.escritoAs(horaDeHoje(roteiroHoje.criadoEm))}
          </span>
          <Link href={`/roteiros/${roteiroHoje.id}`} className={styles.botaoAbrir}>
            {textosHoje.abrirRoteiro}
          </Link>

          <button
            type="button"
            aria-expanded={outrosAbertos}
            className={styles.alternarOutros}
            onClick={() => setOutrosAbertos((a) => !a)}
          >
            {outrosAbertos ? textosHoje.esconderOutros : textosHoje.verOutros}
          </button>

          {outrosAbertos ? (
            <div className={styles.listaOutros}>
              {temas.map((tema, indice) => (
                <div key={`${tema.titulo}-${indice}`} className={styles.linhaOutro}>
                  <span className={styles.blocoOutro}>
                    <span className={styles.rotuloOutro}>{ROTULO_TEMA_CARTAO[tema.puxaPara]}</span>
                    <span className={styles.temaOutro}>{tema.titulo}</span>
                  </span>
                  <button
                    type="button"
                    className={styles.trocar}
                    onClick={() => router.push(`/hoje/objetivo?tema=${indice}`)}
                  >
                    {textosHoje.trocar}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <>
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

          <button
            type="button"
            className={styles.outraCoisa}
            onClick={() => router.push("/hoje/tema-livre")}
          >
            {textosHoje.outraCoisa}
          </button>
        </>
      )}
    </div>
  );
}
