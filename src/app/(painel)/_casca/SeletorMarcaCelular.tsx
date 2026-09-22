"use client";

import { ChevronDown, ChevronRight, User } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { iniciaisDe } from "@/lib/iniciais";
import { textosNav } from "@/textos/nav";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";
import { usePuxarParaFechar } from "@/ui/usePuxarParaFechar";

import styles from "./SeletorMarcaCelular.module.css";
import { useTrocaMarca } from "./TrocaMarcaContext";

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
 *
 * V7, item 1 do PROXIMO.md: o Voltar do aparelho fecha a folha em vez de sair
 * da tela (`useFolhaNoHistorico`), arrastar a alça para baixo também fecha
 * (`usePuxarParaFechar`), e a folha não sobra aberta por cima de outra tela:
 * a pílula mora no cabeçalho do layout, que persiste entre rotas.
 */
export function SeletorMarcaCelular({ marcaAtiva, marcas, nomePessoa }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  const { trocar, trocando, marcaAlvo, erro } = useTrocaMarca();
  const { fechar, fecharEDepois } = useFolhaNoHistorico(aberto, () => setAberto(false));
  const { folhaRef, alca } = usePuxarParaFechar(fechar);

  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") fechar();
    }
    document.addEventListener("keydown", aoTeclar);
    folhaRef.current?.focus();
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto, fechar, folhaRef]);

  // Rota nova: a folha fica para trás, em vez de aberta por cima da tela seguinte (V7, item 1 do PROXIMO.md). Cobre o
  // link Conta, o Voltar entre telas da casca e qualquer outra via.
  useEffect(() => {
    setAberto(false);
  }, [pathname]);

  if (marcas.length <= 1) {
    return (
      <Link href="/conta" aria-label={textosNav.conta} className={styles.avatarConta}>
        <span aria-hidden="true">{iniciaisDe(marcaAtiva.nome)}</span>
      </Link>
    );
  }

  const nomeExibido = trocando && marcaAlvo ? marcaAlvo : marcaAtiva.nome;
  const outrasMarcas = marcas.filter((m) => m.id !== marcaAtiva.id);

  // Fecha a folha (e desfaz a entrada do histórico) antes de chamar o servidor: se os dois andassem juntos, o
  // `popstate` do Voltar e a Server Action disputariam a mesma transição do Next (PR #47, `useTrocarMarca`).
  function escolherMarca(marca: MarcaResumo) {
    fecharEDepois(() => trocar(marca.id, marca.nome));
  }

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
              <div className={styles.folhaFundo} aria-hidden="true" data-folha-aberta="" onClick={fechar} />
              <div
                ref={folhaRef}
                role="dialog"
                aria-modal="true"
                aria-label={textosNav.suasMarcas}
                tabIndex={-1}
                data-folha-aberta=""
                className={styles.folha}
              >
                <div className={styles.folhaTopo} {...alca}>
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
                        onClick={() => escolherMarca(marca)}
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
                  <Link
                    href="/conta"
                    className={styles.itemMarca}
                    onClick={(evento) => {
                      evento.preventDefault();
                      fecharEDepois(() => router.push("/conta"));
                    }}
                  >
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
