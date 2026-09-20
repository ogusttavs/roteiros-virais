"use client";

import { Check, ChevronRight, User } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { iniciaisDe } from "@/lib/iniciais";
import { textosNav } from "@/textos/nav";

import type { MarcaResumo } from "./SeletorMarcaCelular";
import styles from "./SeletorMarcaDesktop.module.css";
import { useTrocaMarca } from "./TrocaMarcaContext";

type Props = {
  marcaAtiva: MarcaResumo;
  marcas: MarcaResumo[];
  nomePessoa: string;
};

const ICONE_TROCAR_PATH_CIMA = "m7 9 5-5 5 5";
const ICONE_TROCAR_PATH_BAIXO = "m7 15 5 5 5-5";

/**
 * O pé da barra lateral do tablet/desktop (Casca.dc.html, `seletorMarca()`
 * de `casca.js`; V3, item 3): com uma marca só, link simples para Conta
 * (estado `umaMarca`); com várias, botão que abre o menu "Suas marcas"
 * (estados `variasMarcas`/`variasMarcasAberto`).
 */
export function SeletorMarcaDesktop({ marcaAtiva, marcas, nomePessoa }: Props) {
  const [aberto, setAberto] = useState(false);
  const { trocar, trocando, marcaAlvo, erro } = useTrocaMarca();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAberto(false);
    }
    document.addEventListener("keydown", aoTeclar);
    menuRef.current?.focus();
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  if (marcas.length <= 1) {
    return (
      <Link href="/conta" className={styles.seletorMarca} title={marcaAtiva.nome} aria-current="page">
        <span className={styles.avatar} aria-hidden="true">
          {iniciaisDe(marcaAtiva.nome)}
        </span>
        <span className={styles.quem}>
          <span className={styles.nomeMarca}>{marcaAtiva.nome}</span>
          <span className={styles.oQueFaz}>{textosNav.conta}</span>
        </span>
      </Link>
    );
  }

  const nomeExibido = trocando && marcaAlvo ? marcaAlvo : marcaAtiva.nome;

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.seletorMarca}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label={textosNav.trocarDeMarcaRotulo(nomeExibido)}
        disabled={trocando}
        onClick={() => setAberto((v) => !v)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {iniciaisDe(nomeExibido)}
        </span>
        <span className={styles.quem}>
          <span className={styles.nomeMarca}>{nomeExibido}</span>
          <span className={styles.oQueFaz}>{textosNav.trocarDeMarca}</span>
        </span>
        <span className={styles.trocar} aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d={ICONE_TROCAR_PATH_CIMA} />
            <path d={ICONE_TROCAR_PATH_BAIXO} />
          </svg>
        </span>
      </button>

      {aberto ? (
        <>
          <div className={styles.veu} aria-hidden="true" onClick={() => setAberto(false)} />
          <div ref={menuRef} role="menu" aria-label={textosNav.suasMarcas} tabIndex={-1} className={styles.menu}>
            <div className={styles.cabecaLista}>
              <span className={styles.rotulo}>{textosNav.suasMarcas}</span>
            </div>
            <div className={styles.listaMarcas}>
              {marcas.map((marca) => {
                const ativa = marca.id === marcaAtiva.id;
                return (
                  <button
                    key={marca.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={ativa}
                    className={styles.itemMarca}
                    disabled={trocando}
                    onClick={() => {
                      setAberto(false);
                      if (!ativa) trocar(marca.id, marca.nome);
                    }}
                  >
                    <span className={ativa ? styles.avatar : `${styles.avatar} ${styles.neutro}`} aria-hidden="true">
                      {iniciaisDe(marca.nome)}
                    </span>
                    <span className={styles.nome}>{marca.nome}</span>
                    {ativa ? <Check size={16} className={styles.visto} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
            <div className={styles.peMenu}>
              <Link href="/conta" role="menuitem" className={styles.itemMarca}>
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
        </>
      ) : null}

      {erro ? (
        <p role="alert" className={styles.erro}>
          {erro}
        </p>
      ) : null}
    </div>
  );
}
