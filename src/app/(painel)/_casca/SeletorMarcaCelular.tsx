"use client";

import { ChevronDown, ChevronRight, User } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { iniciaisDe } from "@/lib/iniciais";
import { textosNav } from "@/textos/nav";

import styles from "./SeletorMarcaCelular.module.css";
import { useTrocarMarca } from "./useTrocarMarca";

export type MarcaResumo = { id: number; nome: string };

type Props = {
  marcaAtiva: MarcaResumo;
  marcas: MarcaResumo[];
  nomePessoa: string;
};

/**
 * A pílula da marca na barra do topo do celular (Casca.dc.html, estados
 * `variasMarcas`, `variasMarcasAberto` e `trocando`; V3, item 3). Com uma
 * marca só, o avatar simples que já existia (link direto para Conta)
 * continua, sem pílula (estado `umaMarca`).
 */
export function SeletorMarcaCelular({ marcaAtiva, marcas, nomePessoa }: Props) {
  const [aberto, setAberto] = useState(false);
  const { trocar, trocando, marcaAlvo, erro } = useTrocarMarca();
  const folhaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAberto(false);
    }
    document.addEventListener("keydown", aoTeclar);
    folhaRef.current?.focus();
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  if (marcas.length <= 1) {
    return (
      <Link href="/conta" aria-label={textosNav.conta} className={styles.avatarConta}>
        <span aria-hidden="true">{iniciaisDe(marcaAtiva.nome)}</span>
      </Link>
    );
  }

  const nomeExibido = trocando && marcaAlvo ? marcaAlvo : marcaAtiva.nome;
  const outrasMarcas = marcas.filter((m) => m.id !== marcaAtiva.id);

  return (
    <>
      <button
        type="button"
        className={styles.pilulaMarca}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        aria-label={textosNav.trocarDeMarcaRotulo(nomeExibido)}
        onClick={() => setAberto(true)}
        disabled={trocando}
      >
        <span className={styles.pilula}>
          <span className={styles.avatar} aria-hidden="true">
            {iniciaisDe(nomeExibido)}
          </span>
          <span className={styles.nome}>{nomeExibido}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </span>
      </button>

      {aberto
        ? createPortal(
            <>
              <div className={styles.folhaFundo} aria-hidden="true" onClick={() => setAberto(false)} />
              <div
                ref={folhaRef}
                role="dialog"
                aria-modal="true"
                aria-label={textosNav.suasMarcas}
                tabIndex={-1}
                className={styles.folha}
              >
                <div className={styles.folhaTopo}>
                  <span className={styles.folhaAlca} aria-hidden="true" />
                  <h3 className={styles.folhaTitulo}>{textosNav.suasMarcas}</h3>
                </div>
                <div className={styles.folhaCorpo}>
                  <div className={styles.marcaDestaque}>
                    <span className={`${styles.avatar} ${styles.grande}`} aria-hidden="true">
                      {iniciaisDe(marcaAtiva.nome)}
                    </span>
                    <span className={`${styles.nome} ${styles.nomeDestaque}`}>{marcaAtiva.nome}</span>
                    <span className={styles.agora}>{textosNav.estaMarcaAgora}</span>
                  </div>
                  <div className={styles.cabecaLista}>
                    <span className={styles.rotulo}>{textosNav.trocarPara}</span>
                  </div>
                  <div className={styles.listaMarcas}>
                    {outrasMarcas.map((marca) => (
                      <button
                        key={marca.id}
                        type="button"
                        className={styles.itemMarca}
                        disabled={trocando}
                        onClick={() => {
                          setAberto(false);
                          trocar(marca.id, marca.nome);
                        }}
                      >
                        <span className={`${styles.avatar} ${styles.neutro}`} aria-hidden="true">
                          {iniciaisDe(marca.nome)}
                        </span>
                        <span className={styles.nome}>{marca.nome}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.folhaPe}>
                  <Link href="/conta" className={styles.itemMarca}>
                    <span className={styles.circuloPessoa} aria-hidden="true">
                      <User size={16} />
                    </span>
                    <span className={styles.nome}>
                      {textosNav.conta}
                      <small>{nomePessoa}</small>
                    </span>
                    <ChevronRight size={16} className={styles.seta} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </>,
            document.body,
          )
        : null}

      {erro ? createPortal(<p role="alert" className={styles.erro}>{erro}</p>, document.body) : null}
    </>
  );
}
