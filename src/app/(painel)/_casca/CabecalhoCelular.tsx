"use client";

import { RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { textosNav } from "@/textos/nav";
import { useConexao } from "@/ui/ConexaoContext";
import { Simbolo } from "@/ui/Logo";

import styles from "./CabecalhoCelular.module.css";
import { SeletorMarcaCelular, type MarcaResumo } from "./SeletorMarcaCelular";
import { useRolagemParaBaixo } from "./useRolagem";

type Props = {
  nomeProduto: string;
  marcaAtiva: MarcaResumo;
  marcas: MarcaResumo[];
  nomePessoa: string;
};

/**
 * Cabecalho fixo do celular: some ao rolar para baixo, volta ao rolar para
 * cima (CascaCelular.dc.html, decisao do Fable no PROXIMO.md). So visivel
 * abaixo de 768px (CabecalhoCelular.module.css). A pilula de marca e o
 * botao "Atualizar" (V3, item 3, Casca.dc.html) ficam do lado direito,
 * depois da identidade do produto.
 *
 * "Atualizar" (V7, itens 4 e 8 do PROXIMO.md) mostra que esta em andamento
 * (o icone gira e o botao nao aceita toque duplo) e, sem rede, nao chama o
 * servidor: `router.refresh()` sem rede vira uma navegacao de documento e
 * derruba o aplicativo para a pagina de erro do navegador.
 */
export function CabecalhoCelular({ nomeProduto, marcaAtiva, marcas, nomePessoa }: Props) {
  const escondido = useRolagemParaBaixo();
  const router = useRouter();
  const { avisarFalhaDeRede } = useConexao();
  const [atualizando, iniciarAtualizacao] = useTransition();

  function atualizar() {
    if (!navigator.onLine) {
      // A faixa "Sem conexao" (Conexao.tsx) diz o resto.
      avisarFalhaDeRede();
      return;
    }
    iniciarAtualizacao(() => {
      router.refresh();
    });
  }

  return (
    <header
      className={marcas.length > 1 ? `${styles.cabecalho} ${styles.comMarca}` : styles.cabecalho}
      style={{ transform: escondido ? "translateY(-100%)" : "translateY(0)" }}
    >
      <div className={styles.identidade}>
        <Simbolo altura={24} />
        <span className={styles.nome}>{nomeProduto}</span>
      </div>
      <div className={styles.direita}>
        <SeletorMarcaCelular marcaAtiva={marcaAtiva} marcas={marcas} nomePessoa={nomePessoa} />
        <button
          type="button"
          className={styles.botaoBarra}
          aria-label={textosNav.atualizar}
          aria-busy={atualizando || undefined}
          disabled={atualizando}
          onClick={atualizar}
        >
          <RotateCw
            size={18}
            aria-hidden="true"
            className={atualizando ? styles.girando : undefined}
          />
          <span className={styles.cede}>{textosNav.atualizar}</span>
        </button>
      </div>
    </header>
  );
}
